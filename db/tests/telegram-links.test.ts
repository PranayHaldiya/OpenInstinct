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

describe("telegram links", () => {
  it("links a Telegram account with a single-use code", async () => {
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
    await client.exec(`
      INSERT INTO "user" (id, name, email) VALUES
        ('alice', 'Alice', 'alice@example.com'),
        ('bob', 'Bob', 'bob@example.com');
    `);

    const pgliteDatabase = drizzle(client, { schema });
    // SAFETY: PGlite implements the query-builder surface exercised by this service while retaining the shared Drizzle schema.
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- The focused test swaps only the database driver.
    vi.spyOn(Database, "db", "get").mockReturnValue(pgliteDatabase as never);
    const links = await import("@db/services/telegram-links");
    const alice = { userId: "better-auth:alice", workspaceId: "w:alice" };
    const bob = { userId: "better-auth:bob", workspaceId: "w:bob" };

    const staleCode = await links.createTelegramLinkCode(alice);
    const code = await links.createTelegramLinkCode(alice);
    expect(code).toMatch(links.telegramLinkCodePattern);

    // Issuing a new code invalidates the previous one.
    expect(
      await links.redeemTelegramLinkCode(staleCode, "tg-1")
    ).toBeUndefined();
    expect(
      await links.redeemTelegramLinkCode("not-a-code", "tg-1")
    ).toBeUndefined();
    expect(await links.isTelegramLinked(alice)).toBe(false);

    expect(await links.redeemTelegramLinkCode(code, "tg-1")).toBe("alice");
    expect(await links.findUserIdByTelegramUserId("tg-1")).toBe("alice");
    expect(await links.isTelegramLinked(alice)).toBe(true);
    // Codes are single-use.
    expect(await links.redeemTelegramLinkCode(code, "tg-2")).toBeUndefined();

    // Relinking the same Telegram account to another user moves it.
    const bobCode = await links.createTelegramLinkCode(bob);
    expect(await links.redeemTelegramLinkCode(bobCode, "tg-1")).toBe("bob");
    expect(await links.findUserIdByTelegramUserId("tg-1")).toBe("bob");
    expect(await links.isTelegramLinked(alice)).toBe(false);

    // Expired codes are rejected.
    const expiring = await links.createTelegramLinkCode(alice);
    await client.exec(
      `UPDATE telegram_links SET link_code_expires_at = now() - interval '1 minute' WHERE user_id = 'alice'`
    );
    expect(
      await links.redeemTelegramLinkCode(expiring, "tg-3")
    ).toBeUndefined();

    await expect(
      links.createTelegramLinkCode({ userId: "telegram:1", workspaceId: "w" })
    ).rejects.toThrow("signed-in user");
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
