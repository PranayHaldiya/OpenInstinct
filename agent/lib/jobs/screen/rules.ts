import type { JobScreen } from "@shared/jobs/schema";
import { locationCodesFor } from "../regions";

interface ScreenInput {
  readonly company: string;
  readonly description: string;
  readonly location: string;
  readonly title: string;
  readonly workplaceType: string | null;
}

const remotePattern =
  /\b(remote|anywhere|worldwide|distributed|work from home|wfh|fully[- ]remote)\b/i;
const hybridPattern = /\bhybrid\b/i;
const onsitePattern =
  /\b(on[- ]?site|in[- ]office|office[- ]based|in person)\b/i;

// Names of places in location fields, mapped to the codes `regions` uses.
// Country codes in upper case only, so "us" in prose doesn't read as the US.
const locationTerms: readonly [string, RegExp][] = [
  [
    "worldwide",
    /\b(worldwide|anywhere|global(ly)?|any (country|location)|no (country|location) restriction)\b/i,
  ],
  ["apac", /\b(apac|asia[- ]pacific)\b/i],
  ["asia", /\b(asia|south asia)\b(?![- ]pacific)/i],
  ["emea", /\bemea\b/i],
  ["europe", /\b(europe|european|eu|eea)\b|\b(cet|cest)\b/i],
  ["americas", /\bamericas\b/i],
  ["north_america", /\bnorth america\b|\b(EST|EDT|PST|PDT|CST|MST|ET|PT)\b/],
  ["latam", /\b(latam|latin america|south america)\b/i],
  ["middle_east", /\bmiddle east\b|\bmena\b/i],
  ["africa", /\bafrica\b/i],
  ["oceania", /\boceania\b/i],
  [
    "IN",
    /\b(india|indian|bengaluru|bangalore|mumbai|delhi|ncr|gurgaon|gurugram|noida|hyderabad|pune|chennai|jaipur|kolkata|ahmedabad|kochi|chandigarh|indore)\b/i,
  ],
  [
    "US",
    /\b(usa|u\.s\.a?\.?|united states|san francisco|sf bay|bay area|new york|nyc|seattle|austin|boston|chicago|los angeles|denver|miami|atlanta)\b/i,
  ],
  [
    "US",
    /\bUS\b|, (AL|AK|AZ|AR|CA|CO|CT|DE|FL|GA|HI|ID|IL|IA|KS|KY|LA|ME|MD|MA|MI|MN|MS|MO|MT|NE|NV|NH|NJ|NM|NY|NC|ND|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VT|VA|WA|WV|WI|WY|DC)\b/,
  ],
  ["CA", /\b(canada|canadian|toronto|vancouver|montreal)\b/i],
  [
    "GB",
    /\b(united kingdom|england|scotland|britain|london|manchester)\b|\bUK\b/i,
  ],
  ["DE", /\b(germany|berlin|munich|hamburg)\b/i],
  ["FR", /\b(france|paris)\b/i],
  ["ES", /\b(spain|madrid|barcelona)\b/i],
  ["PT", /\b(portugal|lisbon)\b/i],
  ["NL", /\b(netherlands|amsterdam)\b/i],
  ["PL", /\b(poland|warsaw|krakow)\b/i],
  ["IE", /\b(ireland|dublin)\b/i],
  ["CH", /\b(switzerland|zurich)\b/i],
  ["SE", /\b(sweden|stockholm)\b/i],
  ["AU", /\b(australia|sydney|melbourne)\b/i],
  ["NZ", /\bnew zealand\b/i],
  ["SG", /\bsingapore\b/i],
  ["JP", /\b(japan|tokyo)\b/i],
  ["PH", /\b(philippines|manila)\b/i],
  ["VN", /\bvietnam\b/i],
  ["ID", /\bindonesia\b/i],
  ["PK", /\bpakistan\b/i],
  ["IL", /\b(israel|tel aviv)\b/i],
  ["AE", /\b(uae|dubai|united arab emirates)\b/i],
  ["MX", /\bmexico\b/i],
  ["BR", /\b(brazil|s[aã]o paulo)\b/i],
  ["AR", /\bargentina\b/i],
];

function readLocationCodes(text: string) {
  const codes = new Set(
    locationTerms
      .filter(([, pattern]) => pattern.test(text))
      .map(([code]) => code)
  );
  // "Anywhere in the US" limits the role; a specific place wins.
  if (codes.size > 1) codes.delete("worldwide");
  return [...codes];
}

/**
 * Reads how a role is worked and from where, from its location fields
 * alone. The description often narrows it further; the model screen reads that.
 */
export function classifyLocation(
  location: string,
  workplaceType: string | null
): Pick<JobScreen, "locationEvidence" | "regions" | "workplace"> {
  const type = (workplaceType ?? "").toLowerCase().replaceAll(/[^a-z]/g, "");
  const stated = location.trim() !== "" && !/not stated/i.test(location);
  const workplace: JobScreen["workplace"] =
    type === "remote"
      ? "remote"
      : type === "hybrid"
        ? "hybrid"
        : type === "onsite"
          ? "onsite"
          : remotePattern.test(location)
            ? "remote"
            : hybridPattern.test(location)
              ? "hybrid"
              : onsitePattern.test(location) || stated
                ? "onsite"
                : "unclear";
  return {
    locationEvidence: location.slice(0, 300),
    regions: readLocationCodes(location),
    workplace,
  };
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
  [
    "qa",
    /\b(qa|quality assurance|quality engineer|test|tester|testing|sdet)\b/i,
  ],
  ["security", /\b(security|appsec|secops|soc|penetration)\b/i],
  [
    "support",
    /\b(support|helpdesk|help desk|it (engineer|specialist|administrator|support|generalist)|customer (success|service|support)|solutions? (engineer|architect|consultant)|sales engineer|implementation (engineer|specialist|consultant)|integrations? specialist|people systems|hris|business systems|workday|netsuite|erp)\b/i,
  ],
  ["mobile", /\b(ios|android|mobile|react native|flutter)\b/i],
  ["ai", /\b(ai|llm|agents?|agentic|genai|generative)\b/i],
  [
    "data_ml",
    /\b(data|machine learning|ml|mlops|research|analytics|scientist|computer vision|vision|perception|robotics|nlp)\b/i,
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

/** Families a title names outright; a model read of the description doesn't override them. */
export const titleDecidedFamilies: ReadonlySet<JobScreen["roleFamily"]> =
  new Set(["qa", "security", "support"]);

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
  ["unpaid trial", /\bunpaid (trial|test|assignment)\b/i],
];

function extractRedFlags(text: string) {
  return redFlagTerms
    .filter(([, pattern]) => pattern.test(text))
    .map(([name]) => name);
}

// Words common in one language's postings and rare in the others'.
const languageMarkers: readonly [string, RegExp][] = [
  ["en", /\b(the|and|you|with|our|will|experience|team)\b/gi],
  [
    "pt",
    /\b(você|voce|para|com|uma|não|experiência|conhecimento|trabalho|nossa|vaga|desenvolvimento)\b/gi,
  ],
  [
    "es",
    /\b(con|una|experiencia|trabajo|nuestro|nuestra|puesto|conocimientos|desarrollo|usted)\b/gi,
  ],
  ["de", /\b(und|die|der|mit|für|wir|sie|erfahrung|unser|kenntnisse)\b/gi],
  [
    "fr",
    /\b(et|les|des|pour|avec|vous|nous|expérience|poste|connaissances)\b/gi,
  ],
];

/** The language a posting is written in, by marker words; English when unsure. */
export function detectLanguage(text: string) {
  const sample = text.slice(0, 4_000);
  const counts = languageMarkers.map(
    ([code, pattern]) => [code, sample.match(pattern)?.length ?? 0] as const
  );
  const english = counts[0]?.[1] ?? 0;
  const [code, count] = counts.reduce((best, entry) =>
    entry[1] > best[1] ? entry : best
  );
  return count >= 8 && count > english * 2 ? code : "en";
}

// Phrases only a recruiter hiring for someone else writes. "Not working with
// staffing agencies" is common in employer postings, so agency names alone
// don't count.
const agencyPhrase =
  /\b(on behalf of (our|a|an) client|our client(,| is| has| are)|for (a|our) client|client of ours)\b/i;
const agencyCompany =
  /\b(staffing|recruit(ing|ment|ers)|headhunt\w*|talent (partners|acquisition|solutions))\b/i;

export function classifyEmployer(
  company: string,
  description: string
): JobScreen["employerType"] {
  return agencyCompany.test(company) || agencyPhrase.test(description)
    ? "agency"
    : "unclear";
}

/** The cheap, deterministic screen every posting gets. */
export function screenWithRules(input: ScreenInput): JobScreen {
  const text = `${input.title}\n${input.description}`;
  return {
    method: "rules",
    ...classifyLocation(input.location, input.workplaceType),
    employerType: classifyEmployer(input.company, input.description),
    languages: [detectLanguage(`${input.title}\n${input.description}`)],
    minYears: extractMinYears(input.description),
    redFlags: extractRedFlags(text),
    roleFamily: classifyRoleFamily(input.title),
    seniority: classifySeniority(input.title),
    stack: extractStack(text),
    summary: null,
  };
}

/**
 * Whether a posting deserves a model read of the full description: location
 * fields often say "Remote" while the description limits it to one country
 * or timezone. Only remote or unstated postings that someone in one of
 * `countries` (the countries the hub's users live in) could take get a read,
 * and senior and staff titles keep the rules screen, to hold model spend down.
 */
export function needsModelScreen(
  screen: JobScreen,
  countries: readonly string[]
) {
  if (screen.seniority === "senior" || screen.seniority === "staff_plus") {
    return false;
  }
  if (screen.workplace !== "remote" && screen.workplace !== "unclear") {
    return false;
  }
  if (screen.regions.length === 0) return true;
  const open = new Set(countries.flatMap(locationCodesFor));
  return screen.regions.some((code) => open.has(code));
}
