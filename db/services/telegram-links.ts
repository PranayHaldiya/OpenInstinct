import { createHash, randomBytes } from "node:crypto";
import { and, eq, gt, ne } from "drizzle-orm";
import type { AccessScope } from "@shared/identity/access-scope";
import { db, telegramLinks, user } from "@db";

const betterAuthPrincipalPrefix = "better-auth:";
const linkCodeLifetimeMs = 15 * 60 * 1000;

// Telegram /start parameters allow up to 64 characters from [A-Za-z0-9_-].
export const telegramLinkCodePattern = /^[A-Za-z0-9_-]{22}$/;

function betterAuthUserId(scope: AccessScope) {
  if (!scope.userId.startsWith(betterAuthPrincipalPrefix)) {
    throw new Error("Telegram linking requires a signed-in user.");
  }
  return scope.userId.slice(betterAuthPrincipalPrefix.length);
}

function hashLinkCode(code: string) {
  return createHash("sha256").update(code).digest("hex");
}

/** Issues a fresh single-use link code, replacing any pending one. */
export async function createTelegramLinkCode(scope: AccessScope) {
  const code = randomBytes(16).toString("base64url");
  const linkCodeHash = hashLinkCode(code);
  const linkCodeExpiresAt = new Date(Date.now() + linkCodeLifetimeMs);
  await db
    .insert(telegramLinks)
    .values({
      linkCodeExpiresAt,
      linkCodeHash,
      userId: betterAuthUserId(scope),
    })
    .onConflictDoUpdate({
      target: telegramLinks.userId,
      set: { linkCodeExpiresAt, linkCodeHash },
    });
  return code;
}

/**
 * Redeems a link code for a Telegram user and returns the linked OpenInstinct
 * user id, or undefined when the code is unknown or expired. A Telegram account
 * links to one user at a time, so redeeming moves it off any previous user.
 */
export async function redeemTelegramLinkCode(
  code: string,
  telegramUserId: string
) {
  if (!telegramLinkCodePattern.test(code)) return undefined;
  return db.transaction(async (tx) => {
    const [pending] = await tx
      .select({ userId: telegramLinks.userId })
      .from(telegramLinks)
      .where(
        and(
          eq(telegramLinks.linkCodeHash, hashLinkCode(code)),
          gt(telegramLinks.linkCodeExpiresAt, new Date())
        )
      )
      .for("update")
      .limit(1);
    if (!pending) return undefined;
    await tx
      .update(telegramLinks)
      .set({ linkedAt: null, telegramUserId: null })
      .where(
        and(
          eq(telegramLinks.telegramUserId, telegramUserId),
          ne(telegramLinks.userId, pending.userId)
        )
      );
    await tx
      .update(telegramLinks)
      .set({
        linkCodeExpiresAt: null,
        linkCodeHash: null,
        linkedAt: new Date(),
        telegramUserId,
      })
      .where(eq(telegramLinks.userId, pending.userId));
    return pending.userId;
  });
}

export async function findUserIdByTelegramUserId(telegramUserId: string) {
  const [row] = await db
    .select({ userId: telegramLinks.userId })
    .from(telegramLinks)
    .where(eq(telegramLinks.telegramUserId, telegramUserId))
    .limit(1);
  return row?.userId;
}

export async function isTelegramLinked(scope: AccessScope) {
  const [row] = await db
    .select({ telegramUserId: telegramLinks.telegramUserId })
    .from(telegramLinks)
    .where(eq(telegramLinks.userId, betterAuthUserId(scope)))
    .limit(1);
  return Boolean(row?.telegramUserId);
}

/**
 * Creates the single owner of a per-user deployment and links their Telegram
 * account, so the first message needs no sign-in. Returns the owner's user id.
 */
export async function ensureTelegramOwner(input: {
  readonly name: string;
  readonly telegramUserId: string;
}) {
  const existing = await findUserIdByTelegramUserId(input.telegramUserId);
  if (existing) return existing;
  const userId = `telegram-${input.telegramUserId}`;
  await db.transaction(async (tx) => {
    await tx
      .insert(user)
      .values({
        email: `${userId}@users.openinstinct.invalid`,
        id: userId,
        name: input.name,
      })
      .onConflictDoNothing();
    await tx
      .insert(telegramLinks)
      .values({
        linkedAt: new Date(),
        telegramUserId: input.telegramUserId,
        userId,
      })
      .onConflictDoUpdate({
        target: telegramLinks.userId,
        set: { linkedAt: new Date(), telegramUserId: input.telegramUserId },
      });
  });
  return userId;
}
