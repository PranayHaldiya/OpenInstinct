import { z } from "zod";
import type { NewJobPosting } from "@db/services/jobs/postings";
import { companyKey, type jobBoardProviders } from "@shared/jobs/schema";
import { htmlToText, isSoftwareTitle, truncate } from "../text";
import { fetchJson } from "./http";

const descriptionLimit = 12_000;

export interface JobBoardRef {
  readonly company: string | null;
  readonly provider: (typeof jobBoardProviders)[number];
  readonly slug: string;
}

const ashbyBoardSchema = z.object({
  jobs: z.array(
    z.object({
      id: z.string(),
      title: z.string(),
      location: z.string().nullish(),
      secondaryLocations: z
        .array(z.object({ location: z.string().nullish() }))
        .nullish(),
      isListed: z.boolean().nullish(),
      isRemote: z.boolean().nullish(),
      workplaceType: z.string().nullish(),
      address: z
        .object({
          postalAddress: z
            .object({ addressCountry: z.string().nullish() })
            .nullish(),
        })
        .nullish(),
      publishedAt: z.string().nullish(),
      jobUrl: z.string(),
      applyUrl: z.string().nullish(),
      descriptionPlain: z.string().nullish(),
      compensation: z
        .object({
          compensationTierSummary: z.string().nullish(),
          scrapeableCompensationSalarySummary: z.string().nullish(),
        })
        .nullish(),
    })
  ),
});

const greenhouseBoardSchema = z.object({
  jobs: z.array(
    z.object({
      id: z.number(),
      title: z.string(),
      absolute_url: z.string(),
      company_name: z.string().nullish(),
      content: z.string().nullish(),
      first_published: z.string().nullish(),
      updated_at: z.string().nullish(),
      location: z.object({ name: z.string().nullish() }).nullish(),
      offices: z
        .array(
          z.object({
            location: z.string().nullish(),
            name: z.string().nullish(),
          })
        )
        .nullish(),
    })
  ),
});

const leverBoardSchema = z.array(
  z.object({
    id: z.string(),
    text: z.string(),
    hostedUrl: z.string(),
    applyUrl: z.string().nullish(),
    createdAt: z.number().nullish(),
    country: z.string().nullish(),
    workplaceType: z.string().nullish(),
    categories: z
      .object({
        location: z.string().nullish(),
        allLocations: z.array(z.string()).nullish(),
      })
      .nullish(),
    descriptionPlain: z.string().nullish(),
    additionalPlain: z.string().nullish(),
    lists: z
      .array(z.object({ text: z.string(), content: z.string() }))
      .nullish(),
    salaryRange: z
      .object({
        currency: z.string().nullish(),
        interval: z.string().nullish(),
        max: z.number().nullish(),
        min: z.number().nullish(),
      })
      .nullish(),
  })
);

function boardCompany(board: JobBoardRef, fallback?: string | null) {
  return (
    board.company ??
    fallback ??
    board.slug
      .split(/[-_.]/)
      .filter(Boolean)
      .map((word) => `${word.charAt(0).toUpperCase()}${word.slice(1)}`)
      .join(" ")
  );
}

function joinLocations(...locations: (string | null | undefined)[]) {
  return [...new Set(locations.map((l) => l?.trim()).filter(Boolean))].join(
    "; "
  );
}

function parseDate(value: string | number | null | undefined) {
  if (value === null || value === undefined) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

async function fetchAshbyBoard(board: JobBoardRef) {
  const body = ashbyBoardSchema.parse(
    await fetchJson(
      `https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(board.slug)}?includeCompensation=true`
    )
  );
  const company = boardCompany(board);
  return body.jobs
    .filter((job) => job.isListed !== false)
    .map((job): NewJobPosting => ({
      applyUrl: job.applyUrl ?? job.jobUrl,
      company,
      companyKey: companyKey(company),
      description: truncate(job.descriptionPlain ?? "", descriptionLimit),
      externalId: `${board.slug}:${job.id}`,
      location:
        joinLocations(
          job.location,
          ...(job.secondaryLocations ?? []).map((l) => l.location),
          job.address?.postalAddress?.addressCountry
        ) || "Not stated",
      pay:
        job.compensation?.scrapeableCompensationSalarySummary ??
        job.compensation?.compensationTierSummary ??
        null,
      postedAt: parseDate(job.publishedAt),
      source: "ashby",
      title: job.title.trim(),
      url: job.jobUrl,
      workplaceType: job.isRemote ? "remote" : (job.workplaceType ?? null),
    }));
}

async function fetchGreenhouseBoard(board: JobBoardRef) {
  const body = greenhouseBoardSchema.parse(
    await fetchJson(
      `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(board.slug)}/jobs?content=true`
    )
  );
  return body.jobs.map((job): NewJobPosting => {
    const company = boardCompany(board, job.company_name);
    return {
      applyUrl: job.absolute_url,
      company,
      companyKey: companyKey(company),
      // Greenhouse escapes the posting HTML once more inside the JSON string.
      description: truncate(
        htmlToText(htmlToText(job.content ?? "")),
        descriptionLimit
      ),
      externalId: `${board.slug}:${String(job.id)}`,
      location:
        joinLocations(
          job.location?.name,
          ...(job.offices ?? []).map((office) => office.location)
        ) || "Not stated",
      pay: null,
      postedAt: parseDate(job.first_published ?? job.updated_at),
      source: "greenhouse",
      title: job.title.trim(),
      url: job.absolute_url,
      workplaceType: null,
    };
  });
}

async function fetchLeverBoard(board: JobBoardRef) {
  const body = leverBoardSchema.parse(
    await fetchJson(
      `https://api.lever.co/v0/postings/${encodeURIComponent(board.slug)}?mode=json`
    )
  );
  const company = boardCompany(board);
  return body.map((job): NewJobPosting => {
    const range = job.salaryRange;
    return {
      applyUrl: job.applyUrl ?? job.hostedUrl,
      company,
      companyKey: companyKey(company),
      description: truncate(
        [
          job.descriptionPlain,
          ...(job.lists ?? []).map(
            (list) => `${list.text}\n${htmlToText(list.content)}`
          ),
          job.additionalPlain,
        ]
          .filter(Boolean)
          .join("\n\n"),
        descriptionLimit
      ),
      externalId: `${board.slug}:${job.id}`,
      location:
        joinLocations(
          job.categories?.location,
          ...(job.categories?.allLocations ?? []),
          job.country
        ) || "Not stated",
      pay:
        range?.min && range.max
          ? `${range.currency ?? ""} ${String(range.min)}–${String(range.max)} ${range.interval ?? ""}`.trim()
          : null,
      postedAt: parseDate(job.createdAt),
      source: "lever",
      title: job.text.trim(),
      url: job.hostedUrl,
      workplaceType: job.workplaceType ?? null,
    };
  });
}

/** Every listed software posting on one company board. */
export async function fetchBoardPostings(board: JobBoardRef) {
  const postings =
    board.provider === "ashby"
      ? await fetchAshbyBoard(board)
      : board.provider === "greenhouse"
        ? await fetchGreenhouseBoard(board)
        : await fetchLeverBoard(board);
  return postings.filter((posting) => isSoftwareTitle(posting.title));
}
