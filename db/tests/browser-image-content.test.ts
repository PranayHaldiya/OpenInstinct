import { readFile, readdir } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as schema from "../schema";

const databases: PGlite[] = [];
const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.resetModules();
  await Promise.all(databases.splice(0).map((database) => database.close()));
});

describe("browser image content without a Blob store", () => {
  it("stores, serves and deletes image bytes in Postgres", async () => {
    // Maritime VMs have no Blob store; a fresh env module sees none.
    vi.stubEnv("BLOB_READ_WRITE_TOKEN", undefined);
    vi.stubEnv("BLOB_STORE_ID", undefined);
    vi.resetModules();
    const client = await migratedDatabase();
    const Database = await import("@db");
    // SAFETY: PGlite implements the query-builder surface exercised by these services while retaining the shared Drizzle schema.
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- The focused test swaps only the database driver.
    const pgliteDatabase = drizzle(client, { schema }) as never;
    vi.spyOn(Database, "db", "get").mockReturnValue(pgliteDatabase);
    const scope = await import("@db/services/scope");
    const images = await import("@db/services/browser-images");
    const content = await import("@db/services/browser-image-content");
    const alice = { userId: "alice", workspaceId: "workspace:alice" };
    await scope.ensureScope(alice);

    const reserved = await images.reserveBrowserImageArtifact(alice, {
      browserSessionId: "browser-alice",
      idempotencyKey: "worker:call-image",
      label: "Application form",
      rootSessionId: "session-alice",
      sourceKind: "viewport",
      workerSessionId: "worker-alice",
    });
    if (reserved.status !== "pending")
      throw new Error("Expected a reservation.");
    const storagePathname = `${reserved.reservation.storagePathname}/hash-1`;
    await content.storeBrowserImageContent({
      artifactId: reserved.reservation.id,
      bytes: png,
      contentHash: "hash-1",
      mediaType: "image/png",
      storagePathname,
    });
    const stored = {
      byteSize: png.byteLength,
      mediaType: "image/png",
      storagePathname,
    };

    const opened = await content.openBrowserImageContent(stored, {});
    if (opened?.status !== 200) throw new Error("Expected the image bytes.");
    expect(opened.etag).toBe('"hash-1"');
    expect(
      new Uint8Array(await new Response(opened.body).arrayBuffer())
    ).toEqual(png);
    expect(
      await content.openBrowserImageContent(stored, { ifNoneMatch: '"hash-1"' })
    ).toEqual({ etag: '"hash-1"', status: 304 });
    expect(await content.readBrowserImageContent(stored)).toEqual(png);
    expect(
      await content.readBrowserImageContent({ ...stored, byteSize: 9 })
    ).toBeUndefined();

    await content.deleteBrowserImageContent(storagePathname);
    expect(await content.openBrowserImageContent(stored, {})).toBeUndefined();
    expect(await content.readBrowserImageContent(stored)).toBeUndefined();
  }, 30_000);
});

async function migratedDatabase() {
  const client = new PGlite();
  databases.push(client);
  const migrations = (await readdir(new URL("../migrations/", import.meta.url)))
    .filter((filename) => filename.endsWith(".sql"))
    .toSorted();
  /* oxlint-disable eslint/no-await-in-loop -- Migrations and their statements must apply in order. */
  for (const migration of migrations) {
    const source = await readFile(
      new URL(`../migrations/${migration}`, import.meta.url),
      "utf8"
    );
    for (const statement of source.split("--> statement-breakpoint")) {
      if (statement.trim()) await client.exec(statement);
    }
  }
  /* oxlint-enable eslint/no-await-in-loop */
  return client;
}
