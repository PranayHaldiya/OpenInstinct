import { z } from "zod";

export const jobSources = [
  "ashby",
  "greenhouse",
  "lever",
  "hn",
  "remoteok",
  "himalayas",
  "yc",
  "remotive",
  "jobicy",
  "wwr",
] as const;

/** When the shared job ingest runs (UTC). Hosts that sleep wake for it. */
export const jobsIngestCron = "17 */4 * * *";

export const jobBoardProviders = ["ashby", "greenhouse", "lever"] as const;

/** How a role is worked; where it may be worked from lives in `regions`. */
export const workplaces = ["remote", "hybrid", "onsite", "unclear"] as const;

/**
 * Named regions a posting can limit work to. Alongside them, `regions` holds
 * `worldwide` and ISO 3166-1 alpha-2 country codes such as `IN` or `US`.
 */
export const regionNames = [
  "americas",
  "north_america",
  "latam",
  "europe",
  "emea",
  "middle_east",
  "africa",
  "apac",
  "asia",
  "oceania",
] as const;

export const locationCodeSchema = z
  .string()
  .regex(new RegExp(`^(?:[A-Z]{2}|worldwide|${regionNames.join("|")})$`));

export const countryCodeSchema = z.string().regex(/^[A-Z]{2}$/);

/** ISO 639-1 language code, such as `en` or `pt`. */
const languageCodeSchema = z.string().regex(/^[a-z]{2}$/);

/** Who is hiring: the company itself, a recruiter for a client, or a firm that builds for clients. */
export const employerTypes = [
  "product",
  "agency",
  "services",
  "unclear",
] as const;

export const seniorities = [
  "intern",
  "junior",
  "mid",
  "senior",
  "staff_plus",
  "unknown",
] as const;

/** What kind of engineering a role is, so users can keep only the kinds they do. */
export const roleFamilies = [
  "product",
  "ai",
  "infrastructure",
  "data_ml",
  "mobile",
  "qa",
  "security",
  "support",
  "other",
] as const;

/** The user-independent read of one posting, made once when it is ingested. */
export const jobScreenSchema = z.strictObject({
  method: z.enum(["rules", "model"]),
  workplace: z.enum(workplaces),
  regions: z.array(locationCodeSchema).max(30),
  locationEvidence: z.string().max(300),
  employerType: z.enum(employerTypes),
  /** Languages the work needs: the posting's own plus any it requires. */
  languages: z.array(languageCodeSchema).min(1).max(5),
  minYears: z.number().int().min(0).max(30).nullable(),
  seniority: z.enum(seniorities),
  roleFamily: z.enum(roleFamilies),
  stack: z.array(z.string().max(40)).max(30),
  redFlags: z.array(z.string().max(120)).max(10),
  summary: z.string().max(300).nullable(),
});

export type JobScreen = z.infer<typeof jobScreenSchema>;

const companyNameSchema = z.string().trim().min(1).max(120);

/** What one user is looking for. Matching is per user; screening is shared. */
export const jobPreferencesSchema = z.strictObject({
  /** Where the user lives; null until they say. */
  country: countryCodeSchema.nullable().default(null),
  workplaces: z
    .array(z.enum(workplaces).exclude(["unclear"]))
    .min(1)
    .default(["remote"]),
  /** Keep postings that don't say how or where the role is worked. */
  includeUnclearLocation: z.boolean().default(false),
  /** Languages the user works in; postings needing another are skipped. */
  languages: z.array(languageCodeSchema).min(1).max(10).default(["en"]),
  excludeEmployerTypes: z.array(z.enum(employerTypes)).default(["agency"]),
  maxYears: z.number().int().min(0).max(30).default(3),
  stretchYears: z.number().int().min(0).max(30).default(4),
  excludeSeniorities: z
    .array(z.enum(seniorities))
    .default(["senior", "staff_plus"]),
  roleFamilies: z
    .array(z.enum(roleFamilies))
    .min(1)
    .default(["product", "ai", "infrastructure", "data_ml", "mobile"]),
  stackKeywords: z.array(z.string().trim().min(1).max(40)).max(60).default([]),
  titleKeywords: z.array(z.string().trim().min(1).max(40)).max(40).default([]),
  excludeTitleKeywords: z
    .array(z.string().trim().min(1).max(40))
    .max(40)
    .default([]),
  excludeCompanies: z.array(companyNameSchema).max(1000).default([]),
  maxAgeDays: z.number().int().min(1).max(365).default(45),
  digestSize: z.number().int().min(1).max(20).default(5),
});

export type JobPreferences = z.infer<typeof jobPreferencesSchema>;

export const jobApplicationStatuses = [
  "saved",
  "applied",
  "messaged",
  "interviewing",
  "offer",
  "rejected",
  "declined",
  "skipped",
] as const;

/** Lower-cases a company name and drops punctuation and legal suffixes. */
export function companyKey(name: string) {
  const plain = name
    .toLowerCase()
    .normalize("NFKD")
    .replaceAll(/[\u0300-\u036f]/g, "")
    .replaceAll(/\(.*?\)/g, " ")
    .replaceAll(/[^a-z0-9]+/g, " ");
  const core = plain.replaceAll(
    /\b(inc|llc|ltd|limited|corp|co|gmbh|pvt|private|labs?|ai|hq)\b/g,
    " "
  );
  return core.replaceAll(" ", "") || plain.replaceAll(" ", "");
}
