import { integer, pgTable, text, timestamp } from "drizzle-orm/pg-core";

// File-memory documents for self-hosted deployments without Vercel Blob. One
// row per eve memory scope key; version guards optimistic writes.
export const memoryDocuments = pgTable("memory_documents", {
  key: text("key").primaryKey(),
  content: text("content").notNull(),
  version: integer("version").notNull(),
  updatedAt: timestamp("updated_at", {
    mode: "date",
    precision: 3,
    withTimezone: true,
  })
    .defaultNow()
    .notNull(),
});
