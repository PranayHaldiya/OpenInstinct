import {
  and,
  desc,
  eq,
  gte,
  isNull,
  like,
  lt,
  notInArray,
  or,
  sql,
} from "drizzle-orm";
import { db, jobBoards, jobPostings } from "@db";
import { companyKey, type JobScreen } from "@shared/jobs/schema";

export type NewJobPosting = Omit<
  typeof jobPostings.$inferInsert,
  "closedAt" | "firstSeenAt" | "id" | "lastSeenAt" | "screen" | "screenedAt"
>;

type JobBoard = Pick<
  typeof jobBoards.$inferSelect,
  "company" | "provider" | "slug"
>;

const upsertChunkSize = 200;
const boardFailureLimit = 3;

/**
 * Inserts new postings and refreshes known ones. A posting whose title,
 * location or description changed loses its screen so it is read again.
 * Hacker News comments are free text, so the model's reading of their
 * company and title replaces the parsed one and survives refreshes until
 * the comment itself changes. Returns how many rows were new.
 */
export async function upsertJobPostings(
  postings: readonly NewJobPosting[],
  now = new Date()
) {
  let inserted = 0;
  /* oxlint-disable eslint/no-await-in-loop -- Chunks are written one at a time to bound statement size. */
  for (let start = 0; start < postings.length; start += upsertChunkSize) {
    const chunk = dedupeByExternalId(
      postings.slice(start, start + upsertChunkSize)
    );
    const sameContent = sql`${jobPostings.location} = excluded.location AND ${jobPostings.description} = excluded.description`;
    const keepIdentity = sql`${jobPostings.source} = 'hn' AND ${jobPostings.screen}->>'method' = 'model' AND ${sameContent}`;
    const unchanged = sql`${sameContent} AND (${jobPostings.title} = excluded.title OR ${keepIdentity})`;
    const rows = await db
      .insert(jobPostings)
      .values(chunk)
      .onConflictDoUpdate({
        target: [jobPostings.source, jobPostings.externalId],
        set: {
          applyUrl: sql`excluded.apply_url`,
          closedAt: null,
          company: sql`CASE WHEN ${keepIdentity} THEN ${jobPostings.company} ELSE excluded.company END`,
          companyKey: sql`CASE WHEN ${keepIdentity} THEN ${jobPostings.companyKey} ELSE excluded.company_key END`,
          description: sql`excluded.description`,
          lastSeenAt: now,
          location: sql`excluded.location`,
          pay: sql`excluded.pay`,
          postedAt: sql`excluded.posted_at`,
          screen: sql`CASE WHEN ${unchanged} THEN ${jobPostings.screen} END`,
          screenedAt: sql`CASE WHEN ${unchanged} THEN ${jobPostings.screenedAt} END`,
          title: sql`CASE WHEN ${keepIdentity} THEN ${jobPostings.title} ELSE excluded.title END`,
          url: sql`excluded.url`,
          workplaceType: sql`excluded.workplace_type`,
        },
      })
      .returning({ inserted: sql<boolean>`xmax = 0` });
    inserted += rows.filter((row) => row.inserted).length;
  }
  /* oxlint-enable eslint/no-await-in-loop */
  return inserted;
}

function dedupeByExternalId(postings: readonly NewJobPosting[]) {
  const byKey = new Map(
    postings.map((posting) => [
      `${posting.source}:${posting.externalId}`,
      posting,
    ])
  );
  return [...byKey.values()];
}

/** Closes a board's postings that its latest listing no longer includes. */
export async function closeMissingBoardPostings(
  board: Omit<JobBoard, "company">,
  openExternalIds: readonly string[],
  now = new Date()
) {
  await db
    .update(jobPostings)
    .set({ closedAt: now })
    .where(
      and(
        eq(jobPostings.source, board.provider),
        like(jobPostings.externalId, `${board.slug}:%`),
        isNull(jobPostings.closedAt),
        openExternalIds.length > 0
          ? notInArray(jobPostings.externalId, [...openExternalIds])
          : undefined
      )
    );
}

export async function listUnscreenedJobPostings(limit: number) {
  return db
    .select()
    .from(jobPostings)
    .where(and(isNull(jobPostings.screenedAt), isNull(jobPostings.closedAt)))
    .orderBy(
      desc(sql`coalesce(${jobPostings.postedAt}, ${jobPostings.firstSeenAt})`)
    )
    .limit(limit);
}

/** Saves a screen, and for free-text sources the company and title it read. */
export async function saveJobScreen(
  id: string,
  screen: JobScreen,
  identity?: { readonly company: string; readonly title: string }
) {
  const key = identity ? companyKey(identity.company) : "";
  await db
    .update(jobPostings)
    .set(
      identity && key && identity.title
        ? {
            company: identity.company,
            companyKey: key,
            screen,
            screenedAt: new Date(),
            title: identity.title,
          }
        : { screen, screenedAt: new Date() }
    )
    .where(eq(jobPostings.id, id));
}

/**
 * Open, screened postings first seen or posted since `since` that are worked
 * in one of `workplaces` and list one of `regions`. With `includeUnclear`,
 * postings that don't say how or where they are worked come too.
 */
export async function listCandidateJobPostings(input: {
  readonly includeUnclear: boolean;
  readonly regions: readonly string[];
  readonly since: Date;
  readonly workplaces: readonly string[];
}) {
  const regions = sql`array[${sql.join(
    input.regions.map((code) => sql`${code}`),
    sql`, `
  )}]::text[]`;
  const located = and(
    sql`${jobPostings.screen}->>'workplace' IN ${input.workplaces}`,
    sql`${jobPostings.screen}->'regions' ?| ${regions}`
  );
  const unclear = or(
    sql`${jobPostings.screen}->>'workplace' = 'unclear'`,
    sql`jsonb_array_length(${jobPostings.screen}->'regions') = 0`
  );
  return db
    .select()
    .from(jobPostings)
    .where(
      and(
        isNull(jobPostings.closedAt),
        input.includeUnclear ? or(located, unclear) : located,
        or(
          gte(jobPostings.postedAt, input.since),
          and(
            isNull(jobPostings.postedAt),
            gte(jobPostings.firstSeenAt, input.since)
          )
        )
      )
    );
}

/** Adds boards that aren't known yet; existing boards keep their history. */
export async function addJobBoards(
  boards: readonly JobBoard[],
  discoveredFrom: string
) {
  if (boards.length === 0) return 0;
  const rows = await db
    .insert(jobBoards)
    .values(boards.map((board) => ({ ...board, discoveredFrom })))
    .onConflictDoNothing()
    .returning({ slug: jobBoards.slug });
  return rows.length;
}

/** Boards not fetched since `fetchedBefore`, least recently fetched first. */
export async function listDueJobBoards(fetchedBefore: Date, limit: number) {
  return db
    .select({
      company: jobBoards.company,
      provider: jobBoards.provider,
      slug: jobBoards.slug,
    })
    .from(jobBoards)
    .where(
      and(
        lt(jobBoards.failures, boardFailureLimit),
        or(
          isNull(jobBoards.lastFetchedAt),
          lt(jobBoards.lastFetchedAt, fetchedBefore)
        )
      )
    )
    .orderBy(sql`${jobBoards.lastFetchedAt} ASC NULLS FIRST`)
    .limit(limit);
}

export async function markJobBoardFetched(
  board: Omit<JobBoard, "company">,
  error?: string,
  now = new Date()
) {
  await db
    .update(jobBoards)
    .set(
      error
        ? {
            failures: sql`${jobBoards.failures} + 1`,
            lastError: error.slice(0, 500),
            lastFetchedAt: now,
          }
        : { failures: 0, lastError: null, lastFetchedAt: now }
    )
    .where(
      and(
        eq(jobBoards.provider, board.provider),
        eq(jobBoards.slug, board.slug)
      )
    );
}

/**
 * Stores postings read from another deployment's index under their original
 * ids, so recommendations and the application log can reference them.
 */
export async function cacheJobPostings(
  postings: readonly (typeof jobPostings.$inferInsert)[]
) {
  /* oxlint-disable eslint/no-await-in-loop -- Chunks are written one at a time to bound statement size. */
  for (let start = 0; start < postings.length; start += upsertChunkSize) {
    await db
      .insert(jobPostings)
      .values(postings.slice(start, start + upsertChunkSize))
      .onConflictDoUpdate({
        target: jobPostings.id,
        set: {
          applyUrl: sql`excluded.apply_url`,
          closedAt: sql`excluded.closed_at`,
          company: sql`excluded.company`,
          companyKey: sql`excluded.company_key`,
          description: sql`excluded.description`,
          lastSeenAt: sql`excluded.last_seen_at`,
          location: sql`excluded.location`,
          pay: sql`excluded.pay`,
          postedAt: sql`excluded.posted_at`,
          screen: sql`excluded.screen`,
          screenedAt: sql`excluded.screened_at`,
          title: sql`excluded.title`,
          url: sql`excluded.url`,
          workplaceType: sql`excluded.workplace_type`,
        },
      });
  }
  /* oxlint-enable eslint/no-await-in-loop */
}
