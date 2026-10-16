import { readFile, readdir } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as Database from "@db";
import * as schema from "../schema";

const databases: PGlite[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  vi.resetModules();
  await Promise.all(databases.splice(0).map((database) => database.close()));
});

describe("job applying services", () => {
  it("keeps profiles and documents per user and grants single-use", async () => {
    const client = await migratedDatabase();
    const pgliteDatabase = drizzle(client, { schema });
    // SAFETY: PGlite implements the query-builder surface exercised by these services while retaining the shared Drizzle schema.
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- The focused test swaps only the database driver.
    vi.spyOn(Database, "db", "get").mockReturnValue(pgliteDatabase as never);
    const profile = await import("@db/services/jobs/profile");
    const documents = await import("@db/services/jobs/documents");
    const grants = await import("@db/services/jobs/grants");
    const alice = { userId: "better-auth:alice", workspaceId: "w:alice" };
    const bob = { userId: "better-auth:bob", workspaceId: "w:bob" };

    expect(await profile.getJobProfileFacts(alice)).toBeUndefined();
    await profile.saveJobProfileFacts(alice, "Built an agent platform.");
    await profile.saveJobProfileFacts(alice, "Built an MCP server.");
    expect((await profile.getJobProfileFacts(alice))?.facts).toBe(
      "Built an MCP server."
    );
    expect(await profile.getJobProfileFacts(bob)).toBeUndefined();

    await documents.saveJobDocument(alice, {
      content: Buffer.from("%PDF-1.7 resume"),
      filename: "resume.pdf",
      label: "agents",
      mimeType: "application/pdf",
    });
    await documents.saveJobDocument(alice, {
      content: Buffer.from("%PDF-1.7 v2"),
      filename: "resume-v2.pdf",
      label: "agents",
      mimeType: "application/pdf",
    });
    expect(await documents.listJobDocuments(alice)).toEqual([
      expect.objectContaining({ filename: "resume-v2.pdf", label: "agents" }),
    ]);
    expect(
      Buffer.from(
        (await documents.readJobDocument(alice, "agents"))?.content ?? []
      ).toString()
    ).toBe("%PDF-1.7 v2");
    expect(await documents.readJobDocument(bob, "agents")).toBeUndefined();

    // Uploads arrive under a file-name label and get renamed or deleted.
    await documents.saveJobDocument(alice, {
      content: Buffer.from("%PDF-1.7 upload"),
      filename: "Alice CV.pdf",
      label: "alice-cv",
      mimeType: "application/pdf",
    });
    expect(await documents.renameJobDocument(alice, "alice-cv", "agents")).toBe(
      false
    );
    expect(await documents.renameJobDocument(bob, "alice-cv", "mine")).toBe(
      false
    );
    expect(
      await documents.renameJobDocument(alice, "alice-cv", "fullstack")
    ).toBe(true);
    expect(
      (await documents.listJobDocuments(alice)).map((row) => row.label)
    ).toEqual(["agents", "fullstack"]);
    expect(await documents.deleteJobDocument(bob, "fullstack")).toBe(false);
    expect(await documents.deleteJobDocument(alice, "fullstack")).toBe(true);
    expect(
      (await documents.listJobDocuments(alice)).map((row) => row.label)
    ).toEqual(["agents"]);

    const grant = await grants.createJobSubmissionGrant(alice, {
      browserSessionId: "browser-1",
      company: "Acme",
    });
    // Another user or another browser session can't spend it.
    expect(
      await grants.consumeJobSubmissionGrant(bob, grant.token, "browser-1")
    ).toBeUndefined();
    expect(
      await grants.consumeJobSubmissionGrant(alice, grant.token, "browser-2")
    ).toBeUndefined();
    expect(
      await grants.consumeJobSubmissionGrant(alice, grant.token, "browser-1")
    ).toMatchObject({ company: "Acme" });
    // A spent grant doesn't work twice.
    expect(
      await grants.consumeJobSubmissionGrant(alice, grant.token, "browser-1")
    ).toBeUndefined();

    const expired = await grants.createJobSubmissionGrant(alice, {
      browserSessionId: "browser-1",
      company: "Acme",
    });
    await client.exec(
      `UPDATE job_submission_grants SET expires_at = now() - interval '1 minute' WHERE token = '${expired.token}'`
    );
    expect(
      await grants.consumeJobSubmissionGrant(alice, expired.token, "browser-1")
    ).toBeUndefined();
  }, 30_000);
});

async function migratedDatabase() {
  const client = new PGlite();
  databases.push(client);
  const migrations = (await readdir(new URL("../migrations/", import.meta.url)))
    .filter((filename) => filename.endsWith(".sql"))
    .toSorted();
  for (const migration of migrations) {
    // oxlint-disable-next-line eslint/no-await-in-loop -- Migrations must apply in order.
    await applyMigration(client, migration);
  }
  return client;
}

async function applyMigration(database: PGlite, filename: string) {
  const source = await readFile(
    new URL(`../migrations/${filename}`, import.meta.url),
    "utf8"
  );
  for (const statement of source.split("--> statement-breakpoint")) {
    // oxlint-disable-next-line eslint/no-await-in-loop -- Statements must apply in order.
    if (statement.trim()) await database.exec(statement);
  }
}
