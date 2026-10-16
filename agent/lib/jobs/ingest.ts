import {
  addJobBoards,
  closeMissingBoardPostings,
  listDueJobBoards,
  listUnscreenedJobPostings,
  markJobBoardFetched,
  saveJobScreen,
  upsertJobPostings,
} from "@db/services/jobs/postings";
import { fetchBoardPostings, type JobBoardRef } from "./sources/boards";
import {
  fetchHackerNewsHiring,
  fetchHimalayas,
  fetchJobicy,
  fetchRemoteOk,
  fetchRemotive,
  fetchWeWorkRemotely,
  fetchYcJobs,
  type FeedResult,
} from "./sources/feeds";
import { env } from "@shared/environment";
import { seedJobBoards } from "./seed-boards";
import { screenWithModel } from "./screen/model";
import { needsModelScreen, screenWithRules } from "./screen/rules";

const boardRefreshMs = 12 * 3_600_000;
// Older postings are past any user's freshness window; rules are enough.
const modelScreenMaxAgeMs = 60 * 86_400_000;
const concurrency = 4;

export interface IngestOptions {
  readonly boardLimit?: number;
  readonly modelScreenLimit?: number;
  readonly now?: Date;
}

/** Runs `work` over `items` with at most `limit` in flight. */
async function eachLimited<T>(
  items: readonly T[],
  limit: number,
  work: (item: T) => Promise<void>
) {
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      /* oxlint-disable eslint/no-await-in-loop -- Each lane works through the shared queue one item at a time to cap concurrency. */
      while (next < items.length) {
        const item = items[next];
        next += 1;
        if (item !== undefined) await work(item);
      }
      /* oxlint-enable eslint/no-await-in-loop */
    })
  );
}

/**
 * One ingest pass: read the feeds, refresh due company boards, then screen
 * what's new. Each source fails on its own; the pass reports what happened.
 */
export async function ingestJobs(options: IngestOptions = {}) {
  const now = options.now ?? new Date();
  const errors: string[] = [];
  const sources = new Map<string, number>();
  const report = {
    boardsAdded: 0,
    boardsFetched: 0,
    modelScreened: 0,
    newPostings: 0,
    rulesScreened: 0,
  };

  report.boardsAdded += await addJobBoards(seedJobBoards, "seed");

  const feeds: [string, () => Promise<FeedResult>][] = [
    ["hn", fetchHackerNewsHiring],
    ["remoteok", fetchRemoteOk],
    ["himalayas", fetchHimalayas],
    ["yc", () => fetchYcJobs(now)],
    ["remotive", fetchRemotive],
    ["jobicy", fetchJobicy],
    ["wwr", fetchWeWorkRemotely],
  ];
  await Promise.all(
    feeds.map(async ([name, fetchFeed]) => {
      try {
        const feed = await fetchFeed();
        sources.set(name, feed.postings.length);
        report.newPostings += await upsertJobPostings(feed.postings, now);
        report.boardsAdded += await addJobBoards(feed.boards, name);
      } catch (error) {
        errors.push(
          `${name}: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    })
  );

  const boards = await listDueJobBoards(
    new Date(now.getTime() - boardRefreshMs),
    options.boardLimit ?? 80
  );
  await eachLimited(boards, concurrency, async (board: JobBoardRef) => {
    try {
      const postings = await fetchBoardPostings(board);
      report.newPostings += await upsertJobPostings(postings, now);
      await closeMissingBoardPostings(
        board,
        postings.map((posting) => posting.externalId),
        now
      );
      await markJobBoardFetched(board, undefined, now);
      report.boardsFetched += 1;
      sources.set(
        board.provider,
        (sources.get(board.provider) ?? 0) + postings.length
      );
    } catch (error) {
      await markJobBoardFetched(
        board,
        error instanceof Error ? error.message : String(error),
        now
      );
      errors.push(
        `${board.provider}/${board.slug}: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  });

  let modelBudget = options.modelScreenLimit ?? 120;
  const unscreened = await listUnscreenedJobPostings(5_000);
  await eachLimited(unscreened, concurrency, async (posting) => {
    const rules = screenWithRules(posting);
    const postedAt = posting.postedAt ?? posting.firstSeenAt;
    if (
      !needsModelScreen(rules, env.OI_SCREEN_COUNTRIES) ||
      now.getTime() - postedAt.getTime() > modelScreenMaxAgeMs
    ) {
      await saveJobScreen(posting.id, rules);
      report.rulesScreened += 1;
      return;
    }
    // Over budget, the posting stays unscreened for the next pass.
    if (modelBudget <= 0) return;
    modelBudget -= 1;
    try {
      const read = await screenWithModel(posting, rules);
      await saveJobScreen(
        posting.id,
        read.screen,
        posting.source === "hn"
          ? { company: read.company, title: read.role }
          : undefined
      );
      report.modelScreened += 1;
    } catch (error) {
      errors.push(
        `screen ${posting.id}: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  });

  return { ...report, errors, sources: Object.fromEntries(sources) };
}
