import { and, eq } from "drizzle-orm";
import {
  MemoryDocumentConflictError,
  type MemoryDocumentBackend,
} from "eve/memory/file";
import { db, memoryDocuments } from "@db";

/** eve file-memory documents stored in this deployment's Postgres. */
export const postgresMemoryBackend: MemoryDocumentBackend = {
  async read({ key }) {
    const [row] = await db
      .select({
        content: memoryDocuments.content,
        version: memoryDocuments.version,
      })
      .from(memoryDocuments)
      .where(eq(memoryDocuments.key, key))
      .limit(1);
    return row ? { content: row.content, version: String(row.version) } : null;
  },
  async write({ content, expectedVersion, key }) {
    if (expectedVersion === null) {
      const [created] = await db
        .insert(memoryDocuments)
        .values({ content, key, version: 1 })
        .onConflictDoNothing()
        .returning({ version: memoryDocuments.version });
      if (!created) throw new MemoryDocumentConflictError(key);
      return { content, version: String(created.version) };
    }
    const next = Number(expectedVersion) + 1;
    const [updated] = await db
      .update(memoryDocuments)
      .set({ content, updatedAt: new Date(), version: next })
      .where(
        and(
          eq(memoryDocuments.key, key),
          eq(memoryDocuments.version, Number(expectedVersion))
        )
      )
      .returning({ version: memoryDocuments.version });
    if (!updated) throw new MemoryDocumentConflictError(key);
    return { content, version: String(updated.version) };
  },
};
