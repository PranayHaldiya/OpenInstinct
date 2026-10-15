import type { jobPostings } from "@db/schema";
import { companyKey, type JobPreferences } from "@shared/jobs/schema";

type Posting = typeof jobPostings.$inferSelect;

export interface MatchContext {
  /** Company keys the user applied to, messaged or logged in any way. */
  readonly loggedCompanies: ReadonlySet<string>;
  readonly now: Date;
  readonly query?: string;
  /** Posting ids already shown to the user; skipped unless `includeShown`. */
  readonly recommended: ReadonlySet<string>;
  readonly includeShown?: boolean;
}

export interface JobMatch {
  readonly posting: Posting;
  readonly reasons: readonly string[];
  readonly score: number;
  readonly stretch: boolean;
}

const dayMs = 86_400_000;
// Pay problems no ranking can make up for.
const disqualifyingFlag = /\bunpaid\b|equity[- ]only|commission[- ]only/i;

// A term matches at the start of a word, so "agent" finds "agentic" but
// "ios" doesn't find "studios".
function includesTerm(text: string, term: string) {
  const escaped = term
    .trim()
    .replaceAll(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`);
  return new RegExp(`(?<![a-z0-9])${escaped}`, "i").test(text);
}

/**
 * Filters screened postings by one user's preferences and history, then
 * ranks them. Pure: callers load the postings and the user's state.
 */
export function matchJobs(
  postings: readonly Posting[],
  preferences: JobPreferences,
  context: MatchContext
): JobMatch[] {
  const excluded = new Set(preferences.excludeCompanies.map(companyKey));
  const queryTerms = (context.query ?? "")
    .split(/\s+/)
    .map((term) => term.trim())
    .filter(Boolean);
  const matches: JobMatch[] = [];

  for (const posting of postings) {
    const screen = posting.screen;
    if (!screen || posting.closedAt) continue;
    if (!preferences.remoteScopes.includes(screen.remote)) continue;
    if (preferences.excludeSeniorities.includes(screen.seniority)) continue;
    if (!preferences.roleFamilies.includes(screen.roleFamily)) continue;
    if (
      screen.minYears !== null &&
      screen.minYears > preferences.stretchYears
    ) {
      continue;
    }
    if (
      excluded.has(posting.companyKey) ||
      context.loggedCompanies.has(posting.companyKey)
    ) {
      continue;
    }
    if (!context.includeShown && context.recommended.has(posting.id)) continue;
    if (screen.redFlags.some((flag) => disqualifyingFlag.test(flag))) continue;
    if (
      preferences.excludeTitleKeywords.some((term) =>
        includesTerm(posting.title, term)
      )
    ) {
      continue;
    }
    const haystack = `${posting.title}\n${posting.company}\n${posting.description}`;
    if (!queryTerms.every((term) => includesTerm(haystack, term))) continue;

    const reasons: string[] = [];
    let score = 0;
    const titleHits = preferences.titleKeywords.filter((term) =>
      includesTerm(posting.title, term)
    );
    score += titleHits.length * 3;
    const stackHits = preferences.stackKeywords.filter((term) =>
      includesTerm(haystack, term)
    );
    score += Math.min(stackHits.length, 6);
    if (titleHits.length > 0) reasons.push(`title: ${titleHits.join(", ")}`);
    if (stackHits.length > 0) {
      reasons.push(`stack: ${stackHits.slice(0, 6).join(", ")}`);
    }
    if (screen.remote === "anywhere" || screen.remote === "india") score += 2;
    if (screen.remote === "apac") score += 1;
    if (screen.method === "model") score += 1;
    const ageDays =
      (context.now.getTime() -
        (posting.postedAt ?? posting.firstSeenAt).getTime()) /
      dayMs;
    if (ageDays <= 7) score += 2;
    else if (ageDays <= 21) score += 1;
    const stretch =
      screen.minYears !== null && screen.minYears > preferences.maxYears;
    if (stretch) {
      score -= 2;
      reasons.push(`asks ${String(screen.minYears)}+ years`);
    }
    if (screen.redFlags.length > 0) {
      score -= 3;
      reasons.push(`flags: ${screen.redFlags.join(", ")}`);
    }
    matches.push({ posting, reasons, score, stretch });
  }

  matches.sort(
    (a, b) =>
      b.score - a.score ||
      (b.posting.postedAt ?? b.posting.firstSeenAt).getTime() -
        (a.posting.postedAt ?? a.posting.firstSeenAt).getTime()
  );
  // One posting per company keeps a short digest varied.
  const seenCompanies = new Set<string>();
  return matches.filter((match) => {
    if (seenCompanies.has(match.posting.companyKey)) return false;
    seenCompanies.add(match.posting.companyKey);
    return true;
  });
}
