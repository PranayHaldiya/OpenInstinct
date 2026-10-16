import { and, asc, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { db, hubPendingUpdates, hubUsers } from "@db";

type QueuedUpdate = (typeof hubPendingUpdates.$inferSelect)["update"];

export type HubUser = typeof hubUsers.$inferSelect;

export async function getHubUser(telegramUserId: string) {
  const [row] = await db
    .select()
    .from(hubUsers)
    .where(eq(hubUsers.telegramUserId, telegramUserId))
    .limit(1);
  return row;
}

/** Inserts a provisioning row once; concurrent first messages share it. */
export async function claimHubUser(input: {
  readonly forwardSecret: string;
  readonly name: string;
  readonly telegramUserId: string;
}) {
  const [created] = await db
    .insert(hubUsers)
    .values({ ...input, status: "provisioning" })
    .onConflictDoNothing()
    .returning();
  return {
    created: Boolean(created),
    user: created ?? (await getHubUser(input.telegramUserId)),
  };
}

export async function updateHubUser(
  telegramUserId: string,
  patch: Partial<
    Pick<HubUser, "agentId" | "lastError" | "publicUrl" | "status">
  >
) {
  await db
    .update(hubUsers)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(hubUsers.telegramUserId, telegramUserId));
}

/** Saves the country a user's VM searches for; true when it changed. */
export async function recordHubUserCountry(
  telegramUserId: string,
  country: string
) {
  const rows = await db
    .update(hubUsers)
    .set({ country, updatedAt: new Date() })
    .where(
      and(
        eq(hubUsers.telegramUserId, telegramUserId),
        sql`${hubUsers.country} IS DISTINCT FROM ${country}`
      )
    )
    .returning({ telegramUserId: hubUsers.telegramUserId });
  return rows.length > 0;
}

/** Every country a hub user searches jobs for. */
export async function listHubUserCountries() {
  const rows = await db
    .selectDistinct({ country: hubUsers.country })
    .from(hubUsers)
    .where(isNotNull(hubUsers.country));
  return rows.flatMap((row) => (row.country ? [row.country] : []));
}

export async function listHubUsersByStatus(
  statuses: readonly HubUser["status"][]
) {
  return db
    .select()
    .from(hubUsers)
    .where(inArray(hubUsers.status, [...statuses]))
    .orderBy(asc(hubUsers.createdAt));
}

export async function queueHubUpdate(
  telegramUserId: string,
  update: QueuedUpdate
) {
  await db.insert(hubPendingUpdates).values({ telegramUserId, update });
}

/**
 * Locks and returns one user's queued updates, oldest first. `deliver` runs
 * inside the lock; delivered rows are deleted, the rest stay for a retry.
 */
export async function drainHubUpdates(
  telegramUserId: string,
  deliver: (update: QueuedUpdate) => Promise<boolean> | boolean
) {
  return db.transaction(async (tx) => {
    const rows = await tx
      .select()
      .from(hubPendingUpdates)
      .where(eq(hubPendingUpdates.telegramUserId, telegramUserId))
      .orderBy(asc(hubPendingUpdates.id))
      .for("update", { skipLocked: true });
    let delivered = 0;
    /* oxlint-disable eslint/no-await-in-loop -- Telegram updates must reach the agent in order. */
    for (const row of rows) {
      if (!(await deliver(row.update))) {
        await tx
          .update(hubPendingUpdates)
          .set({ attempts: sql`${hubPendingUpdates.attempts} + 1` })
          .where(eq(hubPendingUpdates.id, row.id));
        break;
      }
      await tx
        .delete(hubPendingUpdates)
        .where(and(eq(hubPendingUpdates.id, row.id)));
      delivered += 1;
    }
    /* oxlint-enable eslint/no-await-in-loop */
    return delivered;
  });
}

export async function listUsersWithPendingUpdates() {
  const rows = await db
    .selectDistinct({ telegramUserId: hubPendingUpdates.telegramUserId })
    .from(hubPendingUpdates);
  return rows.map((row) => row.telegramUserId);
}
