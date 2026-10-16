import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  jsonb,
  pgTable,
  serial,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

const timestampColumn = (name: string) =>
  timestamp(name, { mode: "date", precision: 3, withTimezone: true });

export const hubUserStatuses = ["provisioning", "ready", "failed"] as const;

// Hub only: which Maritime VM serves each Telegram user.
export const hubUsers = pgTable(
  "hub_users",
  {
    telegramUserId: text("telegram_user_id").primaryKey(),
    name: text("name").notNull(),
    agentId: text("agent_id"),
    publicUrl: text("public_url"),
    forwardSecret: text("forward_secret").notNull(),
    status: text("status", { enum: hubUserStatuses }).notNull(),
    lastError: text("last_error"),
    // The country the user's VM last searched jobs for, so the hub screens
    // remote postings open there.
    country: text("country"),
    createdAt: timestampColumn("created_at").defaultNow().notNull(),
    updatedAt: timestampColumn("updated_at").defaultNow().notNull(),
  },
  (table) => [
    index("hub_users_status_idx").on(table.status),
    check(
      "hub_users_status_check",
      sql`${table.status} IN ('provisioning', 'ready', 'failed')`
    ),
  ]
);

// Hub only: Telegram updates waiting for their user's VM to come up.
export const hubPendingUpdates = pgTable(
  "hub_pending_updates",
  {
    id: serial("id").primaryKey(),
    telegramUserId: text("telegram_user_id").notNull(),
    update: jsonb("update").notNull(),
    attempts: integer("attempts").notNull().default(0),
    createdAt: timestampColumn("created_at").defaultNow().notNull(),
  },
  (table) => [index("hub_pending_updates_user_idx").on(table.telegramUserId)]
);
