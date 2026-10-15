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

export const jobBoardProviders = ["ashby", "greenhouse", "lever"] as const;

/**
 * Who may work a role from where. `anywhere`, `india` and `apac` are the scopes
 * a candidate in India can usually take; the rest exclude them or need a read.
 */
export const remoteScopes = [
  "anywhere",
  "india",
  "apac",
  "other_region",
  "onsite",
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
  remote: z.enum(remoteScopes),
  remoteEvidence: z.string().max(300),
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
  remoteScopes: z
    .array(z.enum(remoteScopes))
    .min(1)
    .default(["anywhere", "india", "apac"]),
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
