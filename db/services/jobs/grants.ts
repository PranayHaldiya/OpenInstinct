import { and, eq, gt, isNull } from "drizzle-orm";
import { db, jobSubmissionGrants } from "@db";
import type { AccessScope } from "@shared/identity/access-scope";
import { ensureScope } from "../scope";

const grantLifetimeMs = 15 * 60_000;

/**
 * Creates a one-time grant to submit the application prefilled in one browser
 * session. Call only from a tool the user approved.
 */
export async function createJobSubmissionGrant(
  scope: AccessScope,
  input: {
    readonly browserSessionId: string;
    readonly company: string;
    readonly postingId?: string;
    readonly role?: string;
  }
) {
  await ensureScope(scope);
  const [grant] = await db
    .insert(jobSubmissionGrants)
    .values({
      browserSessionId: input.browserSessionId,
      company: input.company,
      expiresAt: new Date(Date.now() + grantLifetimeMs),
      postingId: input.postingId ?? null,
      role: input.role ?? null,
      userId: scope.userId,
      workspaceId: scope.workspaceId,
    })
    .returning();
  if (!grant) throw new Error("Could not create the submission grant.");
  return grant;
}

/**
 * Spends a grant for the browser session it was issued for. Returns undefined
 * when the token is unknown, belongs to someone else or another session, was
 * already used, or expired.
 */
export async function consumeJobSubmissionGrant(
  scope: AccessScope,
  token: string,
  browserSessionId: string
) {
  const [grant] = await db
    .update(jobSubmissionGrants)
    .set({ usedAt: new Date() })
    .where(
      and(
        eq(jobSubmissionGrants.token, token),
        eq(jobSubmissionGrants.workspaceId, scope.workspaceId),
        eq(jobSubmissionGrants.userId, scope.userId),
        eq(jobSubmissionGrants.browserSessionId, browserSessionId),
        isNull(jobSubmissionGrants.usedAt),
        gt(jobSubmissionGrants.expiresAt, new Date())
      )
    )
    .returning();
  return grant;
}
