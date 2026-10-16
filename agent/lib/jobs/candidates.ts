import { z } from "zod";
import {
  cacheJobPostings,
  listCandidateJobPostings,
} from "@db/services/jobs/postings";
import { env } from "@shared/environment";
import {
  jobScreenSchema,
  jobSources,
  type JobPreferences,
} from "@shared/jobs/schema";
import { locationCodesFor } from "./regions";

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
export async function loadCandidatePostings(
  preferences: JobPreferences,
  since: Date
) {
  const input = {
    includeUnclear: preferences.includeUnclearLocation,
    regions: locationCodesFor(preferences.country),
    since,
    workplaces: preferences.workplaces,
  };
  if (env.OI_HUB_URL && env.OI_HUB_TOKEN && env.OWNER_TELEGRAM_USER_ID) {
    const url = new URL(
      "eve/v1/hub/jobs",
      `${env.OI_HUB_URL.replace(/\/$/, "")}/`
    );
    url.searchParams.set("regions", input.regions.join(","));
    url.searchParams.set("workplaces", input.workplaces.join(","));
    url.searchParams.set("unclear", input.includeUnclear ? "1" : "0");
    url.searchParams.set("since", since.toISOString());
    const response = await fetch(url, {
      headers: {
        "x-oi-hub-token": env.OI_HUB_TOKEN,
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
