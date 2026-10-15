import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchBoardPostings } from "../sources/boards";
import {
  fetchJobicy,
  fetchRemotive,
  fetchWeWorkRemotely,
  parseHackerNewsComment,
  relativeAge,
} from "../sources/feeds";
import { findBoardLinks, htmlToText, isSoftwareTitle } from "../text";

afterEach(() => {
  vi.unstubAllGlobals();
});

function stubFetch(json: string) {
  const fetchMock = vi.fn<typeof fetch>(async () => new Response(json));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("text helpers", () => {
  it("turns posting HTML into readable text", () => {
    expect(
      htmlToText(
        "<p>Build &amp; ship</p><ul><li>TypeScript</li></ul>&#x27;ok&#39;"
      )
    ).toBe("Build & ship\nTypeScript\n'ok'");
  });

  it("finds Ashby, Greenhouse and Lever boards in links", () => {
    expect(
      findBoardLinks(
        "https://jobs.ashbyhq.com/Globex/123 https://job-boards.greenhouse.io/acme/jobs/1 https://boards.greenhouse.io/embed/job_board?for=widgets https://jobs.lever.co/kraken.",
        "Acme"
      )
    ).toEqual([
      { company: "Acme", provider: "ashby", slug: "globex" },
      { company: "Acme", provider: "greenhouse", slug: "acme" },
      { company: "Acme", provider: "greenhouse", slug: "widgets" },
      { company: "Acme", provider: "lever", slug: "kraken" },
    ]);
  });

  it("keeps software titles and drops other engineering", () => {
    expect(isSoftwareTitle("Founding Full-Stack Engineer")).toBe(true);
    expect(isSoftwareTitle("Developer Advocate")).toBe(true);
    expect(isSoftwareTitle("Mechanical Engineer")).toBe(false);
    expect(isSoftwareTitle("Sales Engineer")).toBe(false);
    expect(isSoftwareTitle("Account Executive")).toBe(false);
  });
});

describe("Hacker News comments", () => {
  it("parses the company, role, location line and board links", () => {
    const parsed = parseHackerNewsComment({
      created_at_i: 1_791_000_000,
      id: 42,
      text: 'Acme AI | Founding Engineer | REMOTE (Worldwide) | Full-time<p>We build agents. Apply: <a href="https:&#x2F;&#x2F;jobs.ashbyhq.com&#x2F;acme">jobs.ashbyhq.com/acme</a>',
    });
    expect(parsed?.posting).toMatchObject({
      applyUrl: "https://jobs.ashbyhq.com/acme",
      company: "Acme AI",
      companyKey: "acme",
      externalId: "42",
      location: "Acme AI | Founding Engineer | REMOTE (Worldwide) | Full-time",
      source: "hn",
      title: "Founding Engineer",
      url: "https://news.ycombinator.com/item?id=42",
    });
    expect(parsed?.boards).toEqual([
      { company: "Acme AI", provider: "ashby", slug: "acme" },
    ]);
  });

  it("skips comments that aren't about software roles", () => {
    expect(
      parseHackerNewsComment({ id: 1, text: "Acme | Sales Lead | NYC" })
    ).toBeUndefined();
    expect(parseHackerNewsComment({ id: 2, text: null })).toBeUndefined();
  });
});

describe("relativeAge", () => {
  const now = new Date("2026-10-15T00:00:00Z");
  it.each([
    ["30 days", "2026-09-15"],
    ["about 1 month", "2026-09-15"],
    ["a week", "2026-10-08"],
  ])("reads %s", (age, date) => {
    expect(relativeAge(age, now)?.toISOString().slice(0, 10)).toBe(date);
  });

  it("returns null when it can't tell", () => {
    expect(relativeAge("recently", now)).toBeNull();
    expect(relativeAge(null, now)).toBeNull();
  });
});

describe("fetchBoardPostings", () => {
  it("normalizes Ashby postings and keeps only software roles", async () => {
    const fetchMock = stubFetch(
      JSON.stringify({
        jobs: [
          {
            applyUrl: "https://jobs.ashbyhq.com/acme/1/application",
            compensation: { scrapeableCompensationSalarySummary: "$100K" },
            descriptionPlain: "Agents in TypeScript.",
            id: "1",
            isListed: true,
            isRemote: true,
            jobUrl: "https://jobs.ashbyhq.com/acme/1",
            location: "Remote",
            publishedAt: "2026-10-10T00:00:00Z",
            secondaryLocations: [{ location: "India" }],
            title: "AI Engineer",
          },
          { id: "2", jobUrl: "x", title: "Account Executive" },
          { id: "3", isListed: false, jobUrl: "y", title: "Backend Engineer" },
        ],
      })
    );
    const postings = await fetchBoardPostings({
      company: "Acme",
      provider: "ashby",
      slug: "acme",
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.ashbyhq.com/posting-api/job-board/acme?includeCompensation=true",
      expect.anything()
    );
    expect(postings).toEqual([
      expect.objectContaining({
        company: "Acme",
        externalId: "acme:1",
        location: "Remote; India",
        pay: "$100K",
        source: "ashby",
        workplaceType: "remote",
      }),
    ]);
  });

  it("unescapes Greenhouse content and names the company", async () => {
    stubFetch(
      JSON.stringify({
        jobs: [
          {
            absolute_url: "https://job-boards.greenhouse.io/acme/jobs/7",
            company_name: "Acme Inc",
            content: "&lt;p&gt;Ship &amp;amp; learn&lt;/p&gt;",
            first_published: "2026-10-01T00:00:00Z",
            id: 7,
            location: { name: "Remote - India" },
            title: "Software Engineer",
          },
        ],
      })
    );
    const [posting] = await fetchBoardPostings({
      company: null,
      provider: "greenhouse",
      slug: "acme",
    });
    expect(posting).toMatchObject({
      company: "Acme Inc",
      description: "Ship & learn",
      externalId: "acme:7",
      location: "Remote - India",
    });
  });

  it("reads Lever's locations, lists and pay range", async () => {
    stubFetch(
      JSON.stringify([
        {
          applyUrl: "https://jobs.lever.co/kraken/9/apply",
          categories: { allLocations: ["Remote"], location: "Remote" },
          createdAt: 1_791_000_000_000,
          descriptionPlain: "About the role",
          hostedUrl: "https://jobs.lever.co/kraken/9",
          id: "9",
          lists: [{ content: "<li>Go</li>", text: "Requirements" }],
          salaryRange: {
            currency: "USD",
            interval: "per-year",
            max: 2,
            min: 1,
          },
          text: "Backend Engineer",
          workplaceType: "remote",
        },
      ])
    );
    const [posting] = await fetchBoardPostings({
      company: null,
      provider: "lever",
      slug: "kraken",
    });
    expect(posting).toMatchObject({
      company: "Kraken",
      description: "About the role\n\nRequirements\nGo",
      location: "Remote",
      pay: "USD 1–2 per-year",
    });
  });
});

describe("remote job feeds", () => {
  it("reads Remotive's required location", async () => {
    stubFetch(
      JSON.stringify({
        jobs: [
          {
            candidate_required_location: "Worldwide",
            company_name: "Acme",
            description: "<p>Agents</p>",
            id: 5,
            publication_date: "2026-10-14T10:00:00",
            salary: "",
            title: "Full Stack Engineer",
            url: "https://remotive.com/remote-jobs/5",
          },
          { company_name: "Acme", id: 6, title: "Recruiter", url: "x" },
        ],
      })
    );
    const { postings } = await fetchRemotive();
    expect(postings).toEqual([
      expect.objectContaining({
        description: "Agents",
        externalId: "5",
        location: "Remote: Worldwide",
        pay: null,
        source: "remotive",
      }),
    ]);
  });

  it("reads Jobicy across its general and APAC lists", async () => {
    stubFetch(
      JSON.stringify({
        jobs: [
          {
            companyName: "Acme &amp; Co",
            id: 9,
            jobGeo: "APAC,  EMEA",
            jobLevel: "Midweight",
            jobTitle: "Backend Developer",
            pubDate: "2026-10-14 08:00:00",
            url: "https://jobicy.com/jobs/9",
          },
        ],
      })
    );
    const { postings } = await fetchJobicy();
    expect(postings[0]).toMatchObject({
      company: "Acme & Co",
      location: "Remote: APAC, EMEA",
      source: "jobicy",
    });
  });

  it("splits We Work Remotely titles into company and role", async () => {
    stubFetch(
      `<rss><channel><item><title>Acme: Senior Rust Engineer</title><region>Anywhere in the World</region><description>&lt;p&gt;Apply at https://jobs.lever.co/acme&lt;/p&gt;</description><pubDate>Wed, 30 Sep 2026 07:31:24 +0000</pubDate><link>https://weworkremotely.com/remote-jobs/acme-rust</link></item><item><title>No company here</title><link>https://weworkremotely.com/x</link></item></channel></rss>`
    );
    const { boards, postings } = await fetchWeWorkRemotely();
    expect(postings).toEqual([
      expect.objectContaining({
        company: "Acme",
        location: "Remote: Anywhere in the World",
        title: "Senior Rust Engineer",
      }),
    ]);
    expect(boards).toEqual([
      { company: "Acme", provider: "lever", slug: "acme" },
    ]);
  });
});
