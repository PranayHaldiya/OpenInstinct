import type { JobScreen } from "@shared/jobs/schema";

interface ScreenInput {
  readonly description: string;
  readonly location: string;
  readonly title: string;
  readonly workplaceType: string | null;
}

const indiaPattern =
  /\b(india|indian|bengaluru|bangalore|mumbai|delhi|ncr|gurgaon|gurugram|noida|hyderabad|pune|chennai|jaipur|kolkata|ahmedabad|kochi|chandigarh|indore)\b/i;
const remotePattern =
  /\b(remote|anywhere|worldwide|distributed|work from home|wfh|fully[- ]remote)\b/i;
const anywherePattern =
  /\b(worldwide|anywhere|global(ly)?|any (country|location)|no (country|location) restriction|anywhere in the world)\b/i;
const apacPattern = /\b(apac|asia|asia[- ]pacific|south asia)\b/i;
const regionPattern =
  /\b(us|usa|u\.s\.?|united states|north america|americas|canada|canadian|europe|european|eu|emea|uk|united kingdom|england|london|latam|latin america|mexico|brazil|argentina|germany|france|spain|portugal|netherlands|poland|ireland|switzerland|sweden|australia|new zealand|singapore|japan|philippines|vietnam|indonesia|israel|est|pst|cet|gmt|[a-z]+, (ca|ny|wa|tx|ma|il|co)\b|san francisco|new york|nyc|seattle|austin|boston|toronto|berlin|paris|amsterdam)\b/i;
const onsitePattern =
  /\b(on[- ]?site|in[- ]office|hybrid|office[- ]based|in person)\b/i;

/** Reads where a role can be worked from its location fields alone. */
export function classifyLocation(
  location: string,
  workplaceType: string | null
): Pick<JobScreen, "remote" | "remoteEvidence"> {
  const text = `${location} ${workplaceType ?? ""}`.trim();
  const remote =
    remotePattern.test(text) || /^remote$/i.test(workplaceType ?? "");
  const hybridOrOnsite =
    onsitePattern.test(text) ||
    /^(hybrid|on-?site)$/i.test(workplaceType ?? "");
  const evidence = location.slice(0, 300);
  if (indiaPattern.test(text)) {
    return {
      remote: remote && !hybridOrOnsite ? "india" : "onsite",
      remoteEvidence: evidence,
    };
  }
  if (!remote) {
    return {
      remote:
        location.trim() && !/not stated/i.test(location) ? "onsite" : "unclear",
      remoteEvidence: evidence,
    };
  }
  if (anywherePattern.test(text)) {
    return { remote: "anywhere", remoteEvidence: evidence };
  }
  if (apacPattern.test(text))
    return { remote: "apac", remoteEvidence: evidence };
  if (regionPattern.test(text)) {
    return { remote: "other_region", remoteEvidence: evidence };
  }
  return { remote: "unclear", remoteEvidence: evidence };
}

export function classifySeniority(title: string): JobScreen["seniority"] {
  if (/\b(intern|internship|co-?op)\b/i.test(title)) return "intern";
  if (
    /\b(staff|principal|distinguished|director|head of|vp|vice president|chief|cto|architect)\b/i.test(
      title
    )
  ) {
    return "staff_plus";
  }
  if (/\b(senior|sr\.?|lead|manager|iii|iv)\b/i.test(title)) return "senior";
  if (
    /\b(junior|jr\.?|entry[- ]level|graduate|new grad|associate)\b/i.test(
      title
    ) ||
    /\b(Engineer|Developer) I\b/.test(title)
  ) {
    return "junior";
  }
  return "unknown";
}

const roleFamilyPatterns: readonly [JobScreen["roleFamily"], RegExp][] = [
  ["qa", /\b(qa|quality|test|tester|testing|sdet)\b/i],
  ["security", /\b(security|appsec|secops|soc|penetration)\b/i],
  [
    "support",
    /\b(support|it|helpdesk|solutions?|sales|customer|implementation|integrations? specialist|people systems)\b/i,
  ],
  ["mobile", /\b(ios|android|mobile|react native|flutter)\b/i],
  ["ai", /\b(ai|llm|agents?|agentic|genai|generative)\b/i],
  [
    "data_ml",
    /\b(data|machine learning|ml|mlops|research|analytics|scientist)\b/i,
  ],
  [
    "infrastructure",
    /\b(devops|sre|site reliability|platform|infrastructure|cloud|systems|network|database|dba|kubernetes)\b/i,
  ],
  [
    "product",
    /\b(full[- ]?stack|front[- ]?end|back[- ]?end|product|software|web|founding|developer|engineer)\b/i,
  ],
];

export function classifyRoleFamily(title: string): JobScreen["roleFamily"] {
  return (
    roleFamilyPatterns.find(([, pattern]) => pattern.test(title))?.[0] ??
    "other"
  );
}

const yearsPattern =
  /(\d{1,2})\s*(?:\+|plus)?\s*(?:(?:-|–|to)\s*\d{1,2}\s*)?(?:\+\s*)?(?:years?|yrs?)(?:\s+of)?(?:\s+[\w/&.+-]+){0,5}?\s+(?:experience|exp\b)/gi;

/** The largest "N+ years of experience" a posting asks for, if any. */
export function extractMinYears(description: string) {
  const years = [...description.matchAll(yearsPattern)]
    .map((match) => Number(match[1]))
    .filter((value) => value >= 1 && value <= 15);
  return years.length > 0 ? Math.max(...years) : null;
}

const stackTerms: readonly [string, RegExp][] = [
  ["typescript", /\btypescript\b/i],
  ["javascript", /\bjavascript\b/i],
  ["react", /\breact(\.js)?\b/i],
  ["next.js", /\bnext\.?js\b/i],
  ["node", /\bnode(\.js)?\b/i],
  ["python", /\bpython\b/i],
  ["go", /\bgolang\b|\b(in|with|and|or) Go\b|\bGo,/],
  ["rust", /\brust\b/i],
  ["postgres", /\bpostgres(ql)?\b/i],
  ["llm", /\bllms?\b|large language model/i],
  ["agents", /\bai agents?\b|\bagentic\b|\bagents\b/i],
  ["mcp", /\bmcp\b|model context protocol/i],
  ["ai sdk", /\bai sdk\b|vercel ai/i],
  ["evals", /\bevals?\b|evaluation/i],
  ["rag", /\brag\b|retrieval[- ]augmented/i],
  ["solana", /\bsolana\b|\banchor\b/i],
  ["web3", /\bweb3\b|\bblockchain\b|\bcrypto\b|\bsmart contracts?\b/i],
  ["aws", /\baws\b/i],
  ["kubernetes", /\bkubernetes\b|\bk8s\b/i],
  ["java", /\bjava\b/i],
  ["c++", /\bc\+\+/i],
  ["mobile", /\breact native\b|\bswift\b|\bkotlin\b|\bflutter\b/i],
  ["voice", /\bvoice\b|\bspeech\b/i],
];

function extractStack(text: string) {
  return stackTerms
    .filter(([, pattern]) => pattern.test(text))
    .map(([name]) => name);
}

const redFlagTerms: readonly [string, RegExp][] = [
  [
    "equity-only or unpaid",
    /\b(equity[- ]only|unpaid|no salary|commission[- ]only)\b/i,
  ],
  [
    "recruiter posting for a client",
    /\b(on behalf of (our|a) client|our client is|recruitment agency|staffing agency)\b/i,
  ],
  ["unpaid trial", /\bunpaid (trial|test|assignment)\b/i],
];

function extractRedFlags(text: string) {
  return redFlagTerms
    .filter(([, pattern]) => pattern.test(text))
    .map(([name]) => name);
}

/** The cheap, deterministic screen every posting gets. */
export function screenWithRules(input: ScreenInput): JobScreen {
  const text = `${input.title}\n${input.description}`;
  return {
    method: "rules",
    ...classifyLocation(input.location, input.workplaceType),
    minYears: extractMinYears(input.description),
    redFlags: extractRedFlags(text),
    roleFamily: classifyRoleFamily(input.title),
    seniority: classifySeniority(input.title),
    stack: extractStack(text),
    summary: null,
  };
}

/**
 * Whether a posting could fit someone working remotely from India and so
 * deserves a model read of the full description: location fields often say
 * "Remote" while the description limits it to one country or timezone.
 * Senior and staff titles keep the rules screen to hold model spend down.
 */
export function needsModelScreen(screen: JobScreen) {
  return (
    screen.seniority !== "senior" &&
    screen.seniority !== "staff_plus" &&
    (screen.remote === "anywhere" ||
      screen.remote === "india" ||
      screen.remote === "apac" ||
      screen.remote === "unclear")
  );
}
