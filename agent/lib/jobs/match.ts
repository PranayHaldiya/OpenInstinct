import type { jobPostings } from "@db/schema";
import {
  companyKey,
  type JobPreferences,
  type JobScreen,
} from "@shared/jobs/schema";
import { locationCodesFor } from "./regions";

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
// Postings straight from the employer beat aggregator reposts, which skew
// toward agencies and stale listings.
const directSources = new Set<Posting["source"]>([
  "ashby",
  "greenhouse",
  "lever",
  "hn",
  "yc",
]);
// Pay problems no ranking can make up for.
const disqualifyingFlag = /\bunpaid\b|equity[- ]only|commission[- ]only/i;

// Stacks a title can ask for, each with the keywords that count as knowing it.
// A title asking only for stacks the user doesn't list ranks lower.
const titleStacks: readonly [string, RegExp, readonly string[]][] = [
  [
    "php",
    /\b(php|laravel|wordpress|symfony|drupal|magento)\b/i,
    ["php", "laravel", "wordpress"],
  ],
  ["java", /\b(java|spring)\b(?!script)/i, ["java", "spring", "kotlin"]],
  [".net", /\.net\b|\bc#|\bdotnet\b/i, [".net", "c#", "dotnet"]],
  ["ruby", /\b(ruby|rails)\b/i, ["ruby", "rails"]],
  [
    "python",
    /\b(python|django|flask|fastapi)\b/i,
    ["python", "django", "fastapi", "flask"],
  ],
  ["go", /\bgolang\b|\bGo\b(?!-)/, ["go", "golang"]],
  ["rust", /\brust\b/i, ["rust"]],
  ["c++", /\bc\+\+/i, ["c++"]],
  ["elixir", /\belixir\b/i, ["elixir"]],
  [
    "node",
    /\b(node(\.js)?|nestjs|express|typescript|javascript)\b/i,
    ["node", "typescript", "javascript", "nestjs"],
  ],
  ["react", /\b(react|next\.?js)\b/i, ["react", "next.js", "nextjs"]],
  ["angular", /\bangular\b/i, ["angular"]],
  ["vue", /\bvue(\.js)?\b/i, ["vue"]],
];

/** Stacks the title names when none of them is among the user's keywords. */
function unfamiliarTitleStacks(
  title: string,
  stackKeywords: readonly string[]
) {
  if (stackKeywords.length === 0) return [];
  const known = new Set(stackKeywords.map((term) => term.toLowerCase()));
  const named = titleStacks.filter(([, pattern]) => pattern.test(title));
  return named.some(([, , keys]) => keys.some((key) => known.has(key)))
    ? []
    : named.map(([name]) => name);
}

type LocationFit = "country" | "region" | "worldwide" | "unstated";

/** How a posting's workplace and regions fit where the user lives, if at all. */
export function fitLocation(
  screen: JobScreen,
  preferences: Pick<
    JobPreferences,
    "country" | "includeUnclearLocation" | "workplaces"
  >
): LocationFit | null {
  if (screen.workplace === "unclear") {
    return preferences.includeUnclearLocation ? "unstated" : null;
  }
  if (!preferences.workplaces.includes(screen.workplace)) return null;
  if (screen.regions.length === 0) {
    return preferences.includeUnclearLocation ? "unstated" : null;
  }
  const { country } = preferences;
  if (country && screen.regions.includes(country)) return "country";
  // An office region or "worldwide" office says nothing about where the user is.
  if (screen.workplace !== "remote") return null;
  if (screen.regions.includes("worldwide")) return "worldwide";
  const open = new Set(locationCodesFor(country));
  return screen.regions.some((code) => open.has(code)) ? "region" : null;
}

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
    const locationFit = fitLocation(screen, preferences);
    if (!locationFit) continue;
    if (preferences.excludeEmployerTypes.includes(screen.employerType)) {
      continue;
    }
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
    if (locationFit === "country" || locationFit === "worldwide") score += 2;
    if (locationFit === "region") score += 1;
    const unfamiliar = unfamiliarTitleStacks(
      posting.title,
      preferences.stackKeywords
    );
    if (unfamiliar.length > 0) {
      score -= 3;
      reasons.push(`title asks for ${unfamiliar.join(", ")}`);
    }
    if (screen.method === "model") score += 1;
    if (directSources.has(posting.source)) score += 2;
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
