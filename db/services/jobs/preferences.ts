import { and, eq } from "drizzle-orm";
import type { z } from "zod";
import { db, jobPreferences } from "@db";
import type { AccessScope } from "@shared/identity/access-scope";
import { jobPreferencesSchema } from "@shared/jobs/schema";
import { ensureScope } from "../scope";

export async function getJobPreferences(scope: AccessScope) {
  const [row] = await db
    .select({ preferences: jobPreferences.preferences })
    .from(jobPreferences)
    .where(
      and(
        eq(jobPreferences.workspaceId, scope.workspaceId),
        eq(jobPreferences.userId, scope.userId)
      )
    )
    .limit(1);
  return jobPreferencesSchema.parse(row?.preferences ?? {});
}

/** Merges a partial update into the saved preferences and returns the result. */
export async function updateJobPreferences(
  scope: AccessScope,
  patch: Partial<z.input<typeof jobPreferencesSchema>>
) {
  await ensureScope(scope);
  const preferences = jobPreferencesSchema.parse({
    ...(await getJobPreferences(scope)),
    ...patch,
  });
  const updatedAt = new Date();
  await db
    .insert(jobPreferences)
    .values({
      preferences,
      updatedAt,
      userId: scope.userId,
      workspaceId: scope.workspaceId,
    })
    .onConflictDoUpdate({
      target: [jobPreferences.workspaceId, jobPreferences.userId],
      set: { preferences, updatedAt },
    });
  return preferences;
}
