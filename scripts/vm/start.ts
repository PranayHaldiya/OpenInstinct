// Container entrypoint for Maritime VMs. Starts PostgreSQL on the persistent
// volume, applies migrations, then runs the eve server and Next.js.
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
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
      },
      stdio: "inherit",
    })
  );
  // Next's standalone server: the image ships only its traced output.
  supervise(
    "next",
    spawn(process.execPath, [join(appRoot, "server.js")], {
      cwd: appRoot,
      env: { ...environment, HOSTNAME: "0.0.0.0", PORT: port },
      stdio: "inherit",
    })
  );
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
