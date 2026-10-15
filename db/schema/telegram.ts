import { foreignKey, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { user } from "./auth";

// One row per OpenInstinct user. A pending link code is stored only as a hash;
// redeeming it from Telegram's /start deep link records the Telegram user id.
export const telegramLinks = pgTable(
  "telegram_links",
  {
    userId: text("user_id").primaryKey(),
    telegramUserId: text("telegram_user_id").unique(),
    linkCodeHash: text("link_code_hash").unique(),
    linkCodeExpiresAt: timestamp("link_code_expires_at", {
      mode: "date",
      precision: 3,
      withTimezone: true,
    }),
    linkedAt: timestamp("linked_at", {
      mode: "date",
      precision: 3,
      withTimezone: true,
    }),
  },
  (table) => [
    foreignKey({
      name: "telegram_links_user_id_fkey",
      columns: [table.userId],
      foreignColumns: [user.id],
    }).onDelete("cascade"),
  ]
);
