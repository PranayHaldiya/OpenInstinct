import { readFile, readdir } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { MemoryDocumentConflictError } from "eve/memory/file";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as Database from "@db";
import * as schema from "../schema";

const databases: PGlite[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  vi.resetModules();
  await Promise.all(databases.splice(0).map((database) => database.close()));
});

describe("postgres memory backend", () => {
  it("creates, reads and replaces documents with version checks", async () => {
    const client = new PGlite();
    databases.push(client);
    const migrations = (
      await readdir(new URL("../migrations/", import.meta.url))
    )
      .filter((filename) => filename.endsWith(".sql"))
      .toSorted();
    for (const migration of migrations) {
      // oxlint-disable-next-line eslint/no-await-in-loop -- Migrations must apply in order.
      await applyMigration(client, migration);
    }
    const pgliteDatabase = drizzle(client, { schema });
    // SAFETY: PGlite implements the query-builder surface exercised by this service while retaining the shared Drizzle schema.
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- The focused test swaps only the database driver.
    vi.spyOn(Database, "db", "get").mockReturnValue(pgliteDatabase as never);
    const { postgresMemoryBackend: backend } =
      await import("@db/services/memory-documents");
    const signal = new AbortController().signal;

    expect(await backend.read({ key: "k", signal })).toBeNull();
    const created = await backend.write({
      content: "one",
      expectedVersion: null,
      key: "k",
      signal,
    });
    await expect(
      backend.write({ content: "dup", expectedVersion: null, key: "k", signal })
    ).rejects.toBeInstanceOf(MemoryDocumentConflictError);
    const updated = await backend.write({
      content: "two",
      expectedVersion: created.version,
      key: "k",
      signal,
    });
    await expect(
      backend.write({
        content: "stale",
        expectedVersion: created.version,
        key: "k",
        signal,
      })
    ).rejects.toBeInstanceOf(MemoryDocumentConflictError);
    expect(await backend.read({ key: "k", signal })).toEqual({
      content: "two",
      version: updated.version,
    });
  }, 20_000);
});

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
