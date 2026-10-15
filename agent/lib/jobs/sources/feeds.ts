import { z } from "zod";
import type { NewJobPosting } from "@db/services/jobs/postings";
import { companyKey } from "@shared/jobs/schema";
import {
  decodeEntities,
  findBoardLinks,
  htmlToText,
  isSoftwareTitle,
  truncate,
} from "../text";
import { fetchJson, fetchPublic } from "./http";
import type { JobBoardRef } from "./boards";

const descriptionLimit = 12_000;

export interface FeedResult {
  readonly boards: readonly JobBoardRef[];
  readonly postings: readonly NewJobPosting[];
}

function posting(
  input: Omit<NewJobPosting, "companyKey" | "description"> & {
    readonly description: string;
  }
): NewJobPosting {
  return {
    ...input,
    company: input.company.trim(),
    companyKey: companyKey(input.company),
    description: truncate(input.description, descriptionLimit),
    title: truncate(input.title.trim(), 300),
  };
}

// Hacker News "Who is hiring?": one top-level comment per company.

const hnStorySearchSchema = z.object({
  hits: z.array(z.object({ objectID: z.string(), title: z.string() })),
});
interface HnItem {
  readonly author?: string | null;
  readonly children?: readonly HnItem[];
  readonly created_at_i?: number;
  readonly id: number;
  readonly text?: string | null;
}
const hnItemSchema: z.ZodType<HnItem> = z.lazy(() =>
  z.object({
    author: z.string().nullish(),
    children: z.array(hnItemSchema).optional(),
    created_at_i: z.number().optional(),
    id: z.number(),
    text: z.string().nullish(),
  })
);

/** The latest two monthly threads, so early-month runs still see last month. */
export async function fetchHackerNewsHiring(): Promise<FeedResult> {
  const stories = hnStorySearchSchema.parse(
    await fetchJson(
      "https://hn.algolia.com/api/v1/search_by_date?tags=story,author_whoishiring&query=hiring&hitsPerPage=10"
    )
  );
  const threads = stories.hits
    .filter((hit) => /who is hiring/i.test(hit.title))
    .slice(0, 2);
  const items = await Promise.all(
    threads.map(async (thread) =>
      hnItemSchema.parse(
        await fetchJson(
          `https://hn.algolia.com/api/v1/items/${thread.objectID}`,
          60_000
        )
      )
    )
  );
  const parsed = items
    .flatMap((item) => item.children ?? [])
    .map(parseHackerNewsComment)
    .filter((comment) => comment !== undefined);
  return {
    boards: parsed.flatMap((comment) => comment.boards),
    postings: parsed.map((comment) => comment.posting),
  };
}

export function parseHackerNewsComment(comment: HnItem) {
  if (!comment.text) return undefined;
  const html = comment.text;
  const firstLine = htmlToText(html.split(/<p>/i)[0] ?? "");
  const description = htmlToText(html);
  if (!firstLine || !isSoftwareTitle(description.slice(0, 1500))) {
    return undefined;
  }
  const segments = firstLine
    .split(/\s+[|•·–—]\s+|\s+-\s+/)
    .map((segment) => segment.trim())
    .filter(Boolean);
  const name = segments[0]?.replace(/\s*\(.*?\)\s*$/, "");
  const company = name ? truncate(name, 120) : "Unknown";
  const role =
    segments.slice(1).find((segment) => isSoftwareTitle(segment)) ??
    truncate(firstLine, 200);
  const links = [...decodeEntities(html).matchAll(/href="([^"]+)"/g)].map(
    (match) => match[1] ?? ""
  );
  return {
    boards: findBoardLinks(links.join(" "), company),
    posting: posting({
      applyUrl:
        links.find((link) => findBoardLinks(link, company).length > 0) ?? null,
      company,
      description,
      externalId: String(comment.id),
      location: truncate(firstLine, 500),
      pay: null,
      postedAt: comment.created_at_i
        ? new Date(comment.created_at_i * 1000)
        : null,
      source: "hn",
      title: role,
      url: `https://news.ycombinator.com/item?id=${String(comment.id)}`,
      workplaceType: null,
    }),
  };
}

// RemoteOK: the public API's first element is its terms notice.

const remoteOkSchema = z.array(
  z.object({
    id: z.union([z.string(), z.number()]).optional(),
    company: z.string().optional(),
    position: z.string().optional(),
    location: z.string().nullish(),
    tags: z.array(z.string()).nullish(),
    description: z.string().nullish(),
    epoch: z.number().nullish(),
    salary_min: z.number().nullish(),
    salary_max: z.number().nullish(),
    url: z.string().optional(),
    apply_url: z.string().nullish(),
  })
);

export async function fetchRemoteOk(): Promise<FeedResult> {
  const rows = remoteOkSchema.parse(
    await fetchJson("https://remoteok.com/api")
  );
  const postings = rows.flatMap((row) => {
    if (!row.id || !row.company || !row.position || !row.url) return [];
    if (!isSoftwareTitle(row.position)) return [];
    return [
      posting({
        applyUrl: row.apply_url ?? row.url,
        company: row.company,
        description: [
          row.tags?.length ? `Tags: ${row.tags.join(", ")}` : "",
          htmlToText(row.description ?? ""),
        ]
          .filter(Boolean)
          .join("\n\n"),
        externalId: String(row.id),
        location: row.location?.trim()
          ? row.location.trim()
          : "Remote (no region stated)",
        pay:
          row.salary_min && row.salary_max
            ? `USD ${String(row.salary_min)}–${String(row.salary_max)} per year`
            : null,
        postedAt: row.epoch ? new Date(row.epoch * 1000) : null,
        source: "remoteok",
        title: row.position,
        url: row.url,
        workplaceType: "remote",
      }),
    ];
  });
  return {
    boards: postings.flatMap((p) =>
      findBoardLinks(p.applyUrl ?? "", p.company)
    ),
    postings,
  };
}

// Himalayas: remote jobs open to India, newest first.

const himalayasSchema = z.object({
  jobs: z.array(
    z.object({
      guid: z.string(),
      title: z.string(),
      companyName: z.string(),
      description: z.string().nullish(),
      excerpt: z.string().nullish(),
      locationRestrictions: z.array(z.string()).nullish(),
      timezoneRestrictions: z.array(z.number()).nullish(),
      minSalary: z.number().nullish(),
      maxSalary: z.number().nullish(),
      currency: z.string().nullish(),
      salaryPeriod: z.string().nullish(),
      seniority: z.array(z.string()).nullish(),
      pubDate: z.number().nullish(),
      applicationLink: z.string().nullish(),
    })
  ),
});

const himalayasPages = [1, 2, 3, 4, 5];

type HimalayasJob = z.infer<typeof himalayasSchema>["jobs"][number];

export async function fetchHimalayas(): Promise<FeedResult> {
  const pages = await Promise.all(
    himalayasPages.map(async (page) =>
      himalayasSchema.parse(
        await fetchJson(
          `https://himalayas.app/jobs/api/search?q=engineer&country=India&sort=recent&page=${String(page)}`
        )
      )
    )
  );
  const postings = pages
    .flatMap((page) => page.jobs)
    .filter((job) => isSoftwareTitle(job.title))
    .map(himalayasPosting);
  return {
    boards: postings.flatMap((p) =>
      findBoardLinks(p.applyUrl ?? "", p.company)
    ),
    postings,
  };
}

function himalayasPosting(job: HimalayasJob) {
  const restrictions = job.locationRestrictions ?? [];
  return posting({
    applyUrl: job.applicationLink ?? job.guid,
    company: job.companyName,
    description: [
      job.seniority?.length ? `Seniority: ${job.seniority.join(", ")}` : "",
      htmlToText(job.description ?? job.excerpt ?? ""),
    ]
      .filter(Boolean)
      .join("\n\n"),
    externalId: job.guid,
    location:
      restrictions.length > 0
        ? `Remote: ${restrictions.join(", ")}`
        : "Remote: worldwide (no country restriction)",
    pay:
      job.minSalary && job.maxSalary
        ? `${job.currency ?? ""} ${String(job.minSalary)}–${String(job.maxSalary)} ${job.salaryPeriod ?? ""}`.trim()
        : null,
    postedAt: job.pubDate ? new Date(job.pubDate * 1000) : null,
    source: "himalayas",
    title: job.title,
    url: job.guid,
    workplaceType: "remote",
  });
}

// Remotive, Jobicy and We Work Remotely: public remote-job feeds that state
// which regions a role is open to.

const remotiveSchema = z.object({
  jobs: z.array(
    z.object({
      id: z.number(),
      url: z.string(),
      title: z.string(),
      company_name: z.string(),
      publication_date: z.string().nullish(),
      candidate_required_location: z.string().nullish(),
      salary: z.string().nullish(),
      description: z.string().nullish(),
    })
  ),
});

export async function fetchRemotive(): Promise<FeedResult> {
  const body = remotiveSchema.parse(
    await fetchJson(
      "https://remotive.com/api/remote-jobs?category=software-dev&limit=300"
    )
  );
  return {
    boards: [],
    postings: body.jobs
      .filter((job) => isSoftwareTitle(job.title))
      .map((job) =>
        posting({
          applyUrl: job.url,
          company: job.company_name,
          description: htmlToText(job.description ?? ""),
          externalId: String(job.id),
          location: `Remote: ${job.candidate_required_location ?? "not stated"}`,
          pay: job.salary === "" ? null : (job.salary ?? null),
          postedAt: job.publication_date
            ? new Date(`${job.publication_date}Z`)
            : null,
          source: "remotive",
          title: job.title,
          url: job.url,
          workplaceType: "remote",
        })
      ),
  };
}

const jobicySchema = z.object({
  jobs: z
    .array(
      z.object({
        id: z.number(),
        url: z.string(),
        jobTitle: z.string(),
        companyName: z.string(),
        jobGeo: z.string().nullish(),
        jobLevel: z.string().nullish(),
        jobDescription: z.string().nullish(),
        pubDate: z.string().nullish(),
      })
    )
    .default([]),
});

export async function fetchJobicy(): Promise<FeedResult> {
  const pages = await Promise.all(
    ["", "&geo=apac"].map(async (filter) =>
      jobicySchema.parse(
        await fetchJson(
          `https://jobicy.com/api/v2/remote-jobs?count=100&industry=dev${filter}`
        )
      )
    )
  );
  return {
    boards: [],
    postings: pages
      .flatMap((page) => page.jobs)
      .filter((job) => isSoftwareTitle(job.jobTitle))
      .map((job) =>
        posting({
          applyUrl: job.url,
          company: decodeEntities(job.companyName),
          description: [
            job.jobLevel ? `Level: ${job.jobLevel}` : "",
            htmlToText(job.jobDescription ?? ""),
          ]
            .filter(Boolean)
            .join("\n\n"),
          externalId: String(job.id),
          location: `Remote: ${job.jobGeo?.replaceAll(/\s{2,}/g, " ") ?? "not stated"}`,
          pay: null,
          postedAt: job.pubDate
            ? new Date(job.pubDate.replace(" ", "T"))
            : null,
          source: "jobicy",
          title: decodeEntities(job.jobTitle),
          url: job.url,
          workplaceType: "remote",
        })
      ),
  };
}

function rssField(item: string, name: string) {
  const value = new RegExp(`<${name}>([\\s\\S]*?)</${name}>`).exec(item)?.[1];
  return value
    ? decodeEntities(value.replace(/^<!\[CDATA\[|\]\]>$/g, "")).trim()
    : undefined;
}

export async function fetchWeWorkRemotely(): Promise<FeedResult> {
  const rss = await (
    await fetchPublic(
      "https://weworkremotely.com/categories/remote-programming-jobs.rss"
    )
  ).text();
  const postings = rss
    .split("<item>")
    .slice(1)
    .flatMap((item) => {
      const heading = rssField(item, "title") ?? "";
      const link = rssField(item, "link");
      const split = heading.indexOf(": ");
      const company = split > 0 ? heading.slice(0, split) : undefined;
      const title = split > 0 ? heading.slice(split + 2) : heading;
      if (!link || !company || !isSoftwareTitle(title)) return [];
      const pubDate = rssField(item, "pubDate");
      return [
        posting({
          applyUrl: link,
          company,
          description: htmlToText(rssField(item, "description") ?? ""),
          externalId: link,
          location: `Remote: ${rssField(item, "region") ?? "not stated"}`,
          pay: null,
          postedAt: pubDate ? new Date(pubDate) : null,
          source: "wwr",
          title,
          url: link,
          workplaceType: "remote",
        }),
      ];
    });
  return {
    boards: postings.flatMap((p) => findBoardLinks(p.description, p.company)),
    postings,
  };
}

// YC's public job pages embed their listings as JSON in a data-page attribute.

const ycPageSchema = z.object({
  props: z.object({
    jobPostings: z
      .array(
        z.object({
          id: z.number(),
          title: z.string(),
          url: z.string(),
          location: z.string().nullish(),
          salaryRange: z.string().nullish(),
          minExperience: z.string().nullish(),
          visa: z.string().nullish(),
          skills: z.array(z.string()).nullish(),
          roleSpecificType: z.string().nullish(),
          companyName: z.string(),
          companyBatchName: z.string().nullish(),
          companyOneLiner: z.string().nullish(),
          createdAt: z.string().nullish(),
        })
      )
      .nullish(),
  }),
});

const ycPages = ["location/remote", "role/software-engineer/remote"];

type YcJob = NonNullable<
  z.infer<typeof ycPageSchema>["props"]["jobPostings"]
>[number];

export async function fetchYcJobs(now = new Date()): Promise<FeedResult> {
  const pages = await Promise.all(
    ycPages.map(async (page) => {
      const response = await fetchPublic(
        `https://www.ycombinator.com/jobs/${page}`
      );
      const dataPage = /data-page="([^"]*)"/.exec(await response.text())?.[1];
      if (!dataPage) throw new Error(`YC ${page} has no data-page payload.`);
      return ycPageSchema.parse(JSON.parse(decodeEntities(dataPage)));
    })
  );
  const postings = pages
    .flatMap((page) => page.props.jobPostings ?? [])
    .filter((job) => isSoftwareTitle(job.title))
    .map((job) => ycPosting(job, now));
  return { boards: [], postings };
}

function ycPosting(job: YcJob, now: Date) {
  const url = new URL(job.url, "https://www.ycombinator.com").toString();
  return posting({
    applyUrl: url,
    company: job.companyName,
    description: [
      job.companyOneLiner,
      job.companyBatchName ? `YC batch: ${job.companyBatchName}` : "",
      job.roleSpecificType ? `Role type: ${job.roleSpecificType}` : "",
      job.minExperience ? `Experience: ${job.minExperience}` : "",
      job.visa ? `Visa: ${job.visa}` : "",
      job.skills?.length ? `Skills: ${job.skills.join(", ")}` : "",
    ]
      .filter(Boolean)
      .join("\n"),
    externalId: String(job.id),
    location: [job.location, job.visa].filter(Boolean).join(" · "),
    pay: job.salaryRange === "" ? null : (job.salaryRange ?? null),
    postedAt: relativeAge(job.createdAt, now),
    source: "yc",
    title: job.title,
    url,
    workplaceType: null,
  });
}

const ageUnitMs = new Map([
  ["minute", 60_000],
  ["hour", 3_600_000],
  ["day", 86_400_000],
  ["week", 7 * 86_400_000],
  ["month", 30 * 86_400_000],
  ["year", 365 * 86_400_000],
]);

/** Parses YC's "30 days" or "about 1 month" ages into an approximate date. */
export function relativeAge(age: string | null | undefined, now: Date) {
  const match = /(\d+|an?)\s+(minute|hour|day|week|month|year)s?\b/i.exec(
    age ?? ""
  );
  const unitMs = ageUnitMs.get(match?.[2]?.toLowerCase() ?? "");
  if (!match?.[1] || !unitMs) return null;
  const count = /^\d+$/.test(match[1]) ? Number(match[1]) : 1;
  return new Date(now.getTime() - count * unitMs);
}
