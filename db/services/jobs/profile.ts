import { and, eq } from "drizzle-orm";
import { db, jobProfiles } from "@db";
import type { AccessScope } from "@shared/identity/access-scope";
import { ensureScope } from "../scope";

export const jobProfileFactsLimit = 20_000;

export async function getJobProfileFacts(scope: AccessScope) {
  const [row] = await db
    .select({ facts: jobProfiles.facts, updatedAt: jobProfiles.updatedAt })
    .from(jobProfiles)
    .where(
      and(
        eq(jobProfiles.workspaceId, scope.workspaceId),
        eq(jobProfiles.userId, scope.userId)
      )
    )
    .limit(1);
  return row;
}

/** Replaces the user's confirmed facts. */
export async function saveJobProfileFacts(scope: AccessScope, facts: string) {
  if (facts.length > jobProfileFactsLimit) {
    throw new Error(
      `Facts are limited to ${String(jobProfileFactsLimit)} characters.`
    );
  }
  await ensureScope(scope);
  const updatedAt = new Date();
  await db
    .insert(jobProfiles)
    .values({
      facts,
      updatedAt,
      userId: scope.userId,
      workspaceId: scope.workspaceId,
    })
    .onConflictDoUpdate({
      target: [jobProfiles.workspaceId, jobProfiles.userId],
      set: { facts, updatedAt },
    });
}
