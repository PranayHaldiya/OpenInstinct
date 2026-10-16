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

describe("hub users", () => {
  it("records the country each user searches jobs for", async () => {
    const client = await migratedDatabase();
    const pgliteDatabase = drizzle(client, { schema });
    // SAFETY: PGlite implements the query-builder surface exercised by these services while retaining the shared Drizzle schema.
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- The focused test swaps only the database driver.
    vi.spyOn(Database, "db", "get").mockReturnValue(pgliteDatabase as never);
    const users = await import("@db/services/hub/users");

    for (const telegramUserId of ["1", "2", "3"]) {
      // oxlint-disable-next-line eslint/no-await-in-loop -- Users are created one at a time for a stable order.
      await users.claimHubUser({
        forwardSecret: "secret",
        name: `User ${telegramUserId}`,
        telegramUserId,
      });
    }
    expect(await users.listHubUserCountries()).toEqual([]);

    expect(await users.recordHubUserCountry("1", "IN")).toBe(true);
    expect(await users.recordHubUserCountry("1", "IN")).toBe(false);
    expect(await users.recordHubUserCountry("2", "IN")).toBe(true);
    expect(await users.recordHubUserCountry("3", "US")).toBe(true);
    expect((await users.listHubUserCountries()).toSorted()).toEqual([
      "IN",
      "US",
    ]);
    expect(await users.recordHubUserCountry("missing", "GB")).toBe(false);
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
