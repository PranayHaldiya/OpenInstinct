// Container entrypoint for Maritime VMs. Starts PostgreSQL on the persistent
// volume, applies migrations, then runs the eve server and Next.js.
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { createServer, request as forward } from "node:http";
import { join } from "node:path";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";
import { z } from "zod";

// oxlint-disable-next-line eslint/no-restricted-properties -- the VM supervisor must forward Maritime's injected environment to the app
const inheritedEnvironment = { ...process.env };
const dataRoot = inheritedEnvironment.OI_DATA_DIR ?? "/data";
const appRoot = "/app";
const postgresBin = "/usr/lib/postgresql/15/bin";
const postgresData = join(dataRoot, "postgres");
const postgresLog = join(dataRoot, "postgres-log", "server.log");
const databaseUrl =
  "postgresql://postgres@127.0.0.1:5432/open_instinct?sslmode=disable";
// eve/next's default loopback port for the built agent in production.
const eveProductionPort = "4274";
// Bind PORT only: Maritime's own forwarder holds the exposed port inside the
// VM and passes public traffic to PORT.
const port = inheritedEnvironment.PORT ?? "8080";
const publicUrl =
  inheritedEnvironment.OI_PUBLIC_URL ??
  (inheritedEnvironment.MARITIME_AGENT_ID
    ? `https://api.maritime.sh/a/${inheritedEnvironment.MARITIME_AGENT_ID}`
    : `http://127.0.0.1:${port}`);

// Maritime serves the VM at https://api.maritime.sh/a/<agentId> and strips
// that prefix before traffic reaches PORT. Next.js serves the app under the
// prefix so its pages, assets and links work at the public URL; the image is
// built with a same-length placeholder base path that boot swaps for it.
const basePath = new URL(publicUrl).pathname.replace(/\/+$/, "");
const builtBasePath = inheritedEnvironment.OI_BUILT_BASE_PATH ?? "";
// Next.js listens here when the launcher's proxy holds PORT.
const nextInternalPort = "3100";

const secretsSchema = z.object({
  betterAuthSecret: z.string().min(32),
  secretEncryptionKey: z.string().min(40),
});

const children: ChildProcess[] = [];

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    for (const child of children) child.kill(signal);
    stopPostgres();
    process.exit(0);
  });
}

await main();

async function main() {
  // Micro-VM init may not honor the image's WORKDIR.
  process.chdir(appRoot);
  mkdirSync(dataRoot, { recursive: true });
  const secrets = installationSecrets();
  startPostgres();
  persistWorkflowState();
  const environment = {
    ...inheritedEnvironment,
    BETTER_AUTH_SECRET:
      inheritedEnvironment.BETTER_AUTH_SECRET ?? secrets.betterAuthSecret,
    BETTER_AUTH_URL: publicUrl,
    DATABASE_URL: databaseUrl,
    DATABASE_URL_UNPOOLED: databaseUrl,
    NODE_ENV: "production" as const,
    OI_PUBLIC_URL: publicUrl,
    SECRET_ENCRYPTION_KEY:
      inheritedEnvironment.SECRET_ENCRYPTION_KEY ?? secrets.secretEncryptionKey,
  };
  await applyMigrations();
  const servedBasePath = applyBasePath();
  // `next start` proxies eve routes to its fixed production port but does not
  // launch the eve server outside Vercel, so run it here.
  supervise(
    "eve",
    spawn(process.execPath, [join(appRoot, ".output", "server", "index.mjs")], {
      cwd: appRoot,
      env: {
        ...environment,
        HOST: "127.0.0.1",
        NITRO_HOST: "127.0.0.1",
        NITRO_PORT: eveProductionPort,
        PORT: eveProductionPort,
        // Workflow step callbacks must reach eve directly; through the public
        // URL they hit Next, which neither forwards nor authorizes them.
        WORKFLOW_LOCAL_BASE_URL: `http://127.0.0.1:${eveProductionPort}`,
      },
      stdio: "inherit",
    })
  );
  // Next's standalone server: the image ships only its traced output.
  supervise(
    "next",
    spawn(process.execPath, [join(appRoot, "server.js")], {
      cwd: appRoot,
      env: servedBasePath
        ? { ...environment, HOSTNAME: "127.0.0.1", PORT: nextInternalPort }
        : { ...environment, HOSTNAME: "0.0.0.0", PORT: port },
      stdio: "inherit",
    })
  );
  if (servedBasePath) restorePrefix(servedBasePath);
}

/**
 * Rewrites the build's placeholder base path to this VM's public prefix in
 * Next's output, and returns the base path Next will serve. If the output
 * can't be rewritten, Next keeps serving the placeholder, which the proxy
 * still reaches, so webhooks keep working while page links stay broken.
 */
function applyBasePath() {
  if (!builtBasePath || builtBasePath === basePath) return basePath;
  // Next.js also writes the base path regex-escaped, as `\/a\/…` in route
  // matchers and `\\/a\\/…` inside JSON manifests; swap every form.
  const escapings = [
    (path: string) => path.replaceAll("/", String.raw`\\/`),
    (path: string) => path.replaceAll("/", String.raw`\/`),
    (path: string) => path,
  ];
  const swaps = escapings.map((escape) => ({
    from: Buffer.from(escape(builtBasePath)),
    to: Buffer.from(escape(basePath)),
  }));
  let rewritten = 0;
  try {
    const files = [
      join(appRoot, "server.js"),
      ...listFiles(join(appRoot, ".next")),
    ];
    for (const file of files) {
      const content = readFileSync(file);
      if (!swaps.some(({ from }) => content.includes(from))) continue;
      writeFileSync(
        file,
        swaps.reduce(
          (text, { from, to }) => replaceAll(text, from, to),
          content
        )
      );
      rewritten += 1;
    }
  } catch (error) {
    console.error("[vm] could not apply the base path", error);
    return builtBasePath;
  }
  console.info(
    `[vm] serving under ${basePath || "/"} (${String(rewritten)} files)`
  );
  return basePath;
}

function listFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return listFiles(path);
    return entry.isFile() ? [path] : [];
  });
}

function replaceAll(content: Buffer, from: Buffer, to: Buffer) {
  const parts: Buffer[] = [];
  let start = 0;
  for (
    let index = content.indexOf(from);
    index !== -1;
    index = content.indexOf(from, start)
  ) {
    parts.push(content.subarray(start, index), to);
    start = index + from.length;
  }
  parts.push(content.subarray(start));
  return Buffer.concat(parts);
}

/** Holds PORT and puts the prefix Maritime strips back before Next sees it. */
function restorePrefix(prefix: string) {
  const server = createServer((incoming, outgoing) => {
    const path = incoming.url ?? "/";
    const prefixed =
      path === prefix ||
      path.startsWith(`${prefix}/`) ||
      path.startsWith(`${prefix}?`);
    const upstream = forward(
      {
        headers: incoming.headers,
        host: "127.0.0.1",
        method: incoming.method,
        // Next serves the base path itself without a trailing slash and
        // redirects `${prefix}/` there, so the bare root maps to the prefix.
        path: prefixed
          ? path
          : path === "/" || path.startsWith("/?")
            ? `${prefix}${path.slice(1)}`
            : `${prefix}${path}`,
        port: nextInternalPort,
      },
      (response) => {
        outgoing.writeHead(
          response.statusCode ?? 502,
          response.statusMessage,
          response.headers
        );
        response.pipe(outgoing);
      }
    );
    upstream.once("error", () => {
      if (!outgoing.headersSent) outgoing.writeHead(502);
      outgoing.end();
    });
    incoming.pipe(upstream);
  });
  server.once("error", (error) => {
    console.error("[vm] prefix proxy failed", error);
    for (const child of children) child.kill("SIGTERM");
    stopPostgres();
    process.exit(1);
  });
  server.listen(Number(port), "0.0.0.0");
}

/** Either server exiting takes the VM down so the host restarts it whole. */
function supervise(label: string, child: ChildProcess) {
  children.push(child);
  child.once("exit", (code) => {
    console.error(`[vm] ${label} exited with ${String(code)}`);
    for (const other of children) if (other !== child) other.kill("SIGTERM");
    stopPostgres();
    process.exit(code ?? 1);
  });
}

/** Per-VM secrets, created on first boot and kept on the persistent volume. */
function installationSecrets() {
  const path = join(dataRoot, "secrets.json");
  if (existsSync(path)) {
    return secretsSchema.parse(JSON.parse(readFileSync(path, "utf8")));
  }
  const secrets = {
    betterAuthSecret: randomBytes(48).toString("base64url"),
    secretEncryptionKey: randomBytes(32).toString("base64"),
  };
  writeFileSync(path, JSON.stringify(secrets), { mode: 0o600 });
  return secrets;
}

function asPostgres(command: string, args: string[]) {
  return spawnSync("runuser", ["-u", "postgres", "--", command, ...args], {
    encoding: "utf8",
  });
}

function startPostgres() {
  mkdirSync(postgresData, { recursive: true });
  mkdirSync(join(dataRoot, "postgres-log"), { recursive: true });
  spawnSync("chown", [
    "-R",
    "postgres:postgres",
    postgresData,
    join(dataRoot, "postgres-log"),
  ]);
  if (!existsSync(join(postgresData, "PG_VERSION"))) {
    const init = asPostgres(`${postgresBin}/initdb`, [
      "-D",
      postgresData,
      "-U",
      "postgres",
      "--auth=trust",
      "--encoding=UTF8",
    ]);
    if (init.status !== 0) throw new Error(`initdb failed: ${init.stderr}`);
  }
  const options =
    "-c listen_addresses=127.0.0.1 -c port=5432 -c unix_socket_directories=/tmp";
  const pgCtl = (args: string[]) =>
    asPostgres(`${postgresBin}/pg_ctl`, ["-D", postgresData, ...args]);
  let started = pgCtl(["-o", options, "-l", postgresLog, "-w", "start"]);
  if (started.status !== 0) {
    // A crash can leave a stale pid file behind; clear it and try once more.
    rmSync(join(postgresData, "postmaster.pid"), { force: true });
    started = pgCtl(["-o", options, "-l", postgresLog, "-w", "start"]);
  }
  if (started.status !== 0) {
    throw new Error(`postgres failed to start: ${started.stderr}`);
  }
  const check = spawnSync(
    "psql",
    [
      "-h",
      "127.0.0.1",
      "-U",
      "postgres",
      "-tAc",
      "SELECT 1 FROM pg_database WHERE datname = 'open_instinct'",
    ],
    { encoding: "utf8" }
  );
  if (check.stdout.trim() !== "1") {
    const created = spawnSync(
      "psql",
      [
        "-h",
        "127.0.0.1",
        "-U",
        "postgres",
        "-c",
        "CREATE DATABASE open_instinct",
      ],
      { encoding: "utf8" }
    );
    if (created.status !== 0) {
      throw new Error(`creating the database failed: ${created.stderr}`);
    }
  }
}

function stopPostgres() {
  asPostgres(`${postgresBin}/pg_ctl`, [
    "-D",
    postgresData,
    "-m",
    "fast",
    "stop",
  ]);
}

/** eve's local workflow world writes under .eve; keep it on the volume. */
function persistWorkflowState() {
  const target = join(dataRoot, "workflow-data");
  const link = join(appRoot, ".eve", ".workflow-data");
  mkdirSync(target, { recursive: true });
  mkdirSync(join(appRoot, ".eve"), { recursive: true });
  if (existsSync(link) && !lstatSync(link).isSymbolicLink()) {
    rmSync(link, { force: true, recursive: true });
  }
  if (!existsSync(link)) symlinkSync(target, link);
}

async function applyMigrations() {
  const pool = new Pool({ connectionString: databaseUrl, max: 1 });
  try {
    await migrate(drizzle({ client: pool }), {
      migrationsFolder: join(appRoot, "db", "migrations"),
    });
  } finally {
    await pool.end();
  }
}
