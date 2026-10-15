import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { db, jobApplications, jobPostings, jobRecommendations } from "@db";
import type { AccessScope } from "@shared/identity/access-scope";
import { companyKey, type jobApplicationStatuses } from "@shared/jobs/schema";
import { ensureScope } from "../scope";

export interface RecordJobApplication {
  readonly appliedAt?: Date | null;
  readonly channel?: string | null;
  readonly company?: string;
  readonly followUpAt?: Date | null;
  readonly notes?: string | null;
  readonly postingId?: string;
  readonly role?: string | null;
  readonly status: (typeof jobApplicationStatuses)[number];
  readonly url?: string | null;
}

function owner(scope: AccessScope) {
  return and(
    eq(jobApplications.workspaceId, scope.workspaceId),
    eq(jobApplications.userId, scope.userId)
  );
}

/**
 * Records or updates one log entry. An entry for a known posting is keyed by
 * the posting; otherwise by company and role, so repeating a status update
 * edits the existing row instead of adding a duplicate.
 */
export async function recordJobApplication(
  scope: AccessScope,
  input: RecordJobApplication
) {
  await ensureScope(scope);
  const [posting] = input.postingId
    ? await db
        .select()
        .from(jobPostings)
        .where(eq(jobPostings.id, input.postingId))
        .limit(1)
    : [];
  if (input.postingId && !posting) throw new Error("Job posting not found.");
  const company = input.company ?? posting?.company;
  if (!company) throw new Error("A company or a posting id is required.");
  const key = companyKey(company);
  if (!key) throw new Error("The company name is empty.");
  const role = input.role === undefined ? (posting?.title ?? null) : input.role;
  const now = new Date();
  const values = {
    appliedAt:
      input.appliedAt === undefined
        ? input.status === "applied" || input.status === "messaged"
          ? now
          : undefined
        : input.appliedAt,
    channel: input.channel ?? (posting ? posting.source : undefined),
    followUpAt: input.followUpAt,
    notes: input.notes,
    status: input.status,
    updatedAt: now,
    url: input.url ?? posting?.applyUrl ?? posting?.url,
  };
  const defined = Object.fromEntries(
    Object.entries(values).filter(([, value]) => value !== undefined)
  );

  return db.transaction(async (tx) => {
    const [existing] = await tx
      .select({ id: jobApplications.id })
      .from(jobApplications)
      .where(
        and(
          owner(scope),
          posting
            ? eq(jobApplications.postingId, posting.id)
            : and(
                eq(jobApplications.companyKey, key),
                role === null
                  ? isNull(jobApplications.role)
                  : sql`lower(${jobApplications.role}) = lower(${role})`
              )
        )
      )
      .limit(1)
      .for("update");
    if (existing) {
      const [row] = await tx
        .update(jobApplications)
        .set(defined)
        .where(eq(jobApplications.id, existing.id))
        .returning();
      return row;
    }
    const [row] = await tx
      .insert(jobApplications)
      .values({
        ...defined,
        company,
        companyKey: key,
        createdAt: now,
        postingId: posting?.id ?? null,
        role,
        status: input.status,
        userId: scope.userId,
        workspaceId: scope.workspaceId,
      })
      .returning();
    return row;
  });
}

export async function listJobApplications(
  scope: AccessScope,
  input: {
    readonly limit: number;
    readonly statuses?: readonly (typeof jobApplicationStatuses)[number][];
  }
) {
  return db
    .select()
    .from(jobApplications)
    .where(
      and(
        owner(scope),
        input.statuses?.length
          ? inArray(jobApplications.status, [...input.statuses])
          : undefined
      )
    )
    .orderBy(desc(jobApplications.updatedAt))
    .limit(input.limit);
}

/** Company keys the user has applied to, messaged, or otherwise logged. */
export async function listLoggedCompanyKeys(scope: AccessScope) {
  const rows = await db
    .selectDistinct({ companyKey: jobApplications.companyKey })
    .from(jobApplications)
    .where(owner(scope));
  return new Set(rows.map((row) => row.companyKey));
}

export async function listRecommendedPostingIds(scope: AccessScope) {
  const rows = await db
    .select({ postingId: jobRecommendations.postingId })
    .from(jobRecommendations)
    .where(
      and(
        eq(jobRecommendations.workspaceId, scope.workspaceId),
        eq(jobRecommendations.userId, scope.userId)
      )
    );
  return new Set(rows.map((row) => row.postingId));
}

export async function recordJobRecommendations(
  scope: AccessScope,
  postingIds: readonly string[]
) {
  if (postingIds.length === 0) return;
  await ensureScope(scope);
  await db
    .insert(jobRecommendations)
    .values(
      postingIds.map((postingId) => ({
        postingId,
        userId: scope.userId,
        workspaceId: scope.workspaceId,
      }))
    )
    .onConflictDoNothing();
}
