import { z } from "zod";
import {
  cacheJobPostings,
  listCandidateJobPostings,
} from "@db/services/jobs/postings";
import { env } from "@shared/environment";
import { jobScreenSchema, jobSources } from "@shared/jobs/schema";

const date = z.iso
  .datetime({ offset: true })
  .transform((value) => new Date(value));

const hubPostingSchema = z.object({
  applyUrl: z.string().nullable(),
  closedAt: date.nullable(),
  company: z.string(),
  companyKey: z.string(),
  description: z.string(),
  externalId: z.string(),
  firstSeenAt: date,
  id: z.uuid(),
  lastSeenAt: date,
  location: z.string(),
  pay: z.string().nullable(),
  postedAt: date.nullable(),
  screen: jobScreenSchema.nullable(),
  screenedAt: date.nullable(),
  source: z.enum(jobSources),
  title: z.string(),
  url: z.string(),
  workplaceType: z.string().nullable(),
});

/**
 * Screened postings for matching. A per-user VM reads the shared hub index
 * and caches it locally; anything else reads its own database.
 */
export async function loadCandidatePostings(input: {
  readonly remoteScopes: readonly string[];
  readonly since: Date;
}) {
  if (env.OI_HUB_URL && env.OI_HUB_TOKEN && env.OWNER_TELEGRAM_USER_ID) {
    const url = new URL(
      "internal/hub/jobs",
      `${env.OI_HUB_URL.replace(/\/$/, "")}/`
    );
    url.searchParams.set("scopes", input.remoteScopes.join(","));
    url.searchParams.set("since", input.since.toISOString());
    const response = await fetch(url, {
      headers: {
        authorization: `Bearer ${env.OI_HUB_TOKEN}`,
        "x-oi-user": env.OWNER_TELEGRAM_USER_ID,
      },
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) {
      throw new Error(`The job index answered ${String(response.status)}.`);
    }
    const body = z
      .object({ postings: z.array(hubPostingSchema) })
      .parse(await response.json());
    await cacheJobPostings(body.postings);
  }
  return listCandidateJobPostings(input);
}
