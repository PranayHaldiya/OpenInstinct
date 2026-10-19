import { describe, expect, it } from "vitest";
import type { jobPostings } from "@db/schema";
import { jobPreferencesSchema, type JobScreen } from "@shared/jobs/schema";
import { fitLocation, matchJobs } from "../match";

const now = new Date("2026-10-15T00:00:00Z");
const preferences = jobPreferencesSchema.parse({
  country: "IN",
  excludeCompanies: ["Blocked Co"],
  excludeTitleKeywords: ["qa", "ios"],
  stackKeywords: ["typescript", "agents"],
  titleKeywords: ["founding"],
});

function posting(
  id: string,
  overrides: Omit<Partial<typeof jobPostings.$inferSelect>, "screen"> & {
    readonly screen?: Partial<JobScreen>;
  } = {}
): typeof jobPostings.$inferSelect {
  const { screen, ...rest } = overrides;
  return {
    applyUrl: null,
    closedAt: null,
    company: `Company ${id}`,
    companyKey: `company${id}`,
    description: "",
    externalId: id,
    firstSeenAt: now,
    id,
    lastSeenAt: now,
    location: "Remote",
    pay: null,
    postedAt: new Date("2026-10-12T00:00:00Z"),
    screen: {
      method: "model",
      minYears: null,
      employerType: "product",
      languages: ["en"],
      locationEvidence: "Remote, worldwide",
      redFlags: [],
      regions: ["worldwide"],
      workplace: "remote",
      roleFamily: "product",
      seniority: "unknown",
      stack: [],
      summary: null,
      ...screen,
    },
    screenedAt: now,
    source: "ashby",
    title: "Software Engineer",
    url: `https://example.com/${id}`,
    workplaceType: null,
    ...rest,
  };
}

const context = {
  loggedCompanies: new Set<string>(),
  now,
  recommended: new Set<string>(),
};

describe("matchJobs", () => {
  it("drops postings that fail the user's filters", () => {
    const matches = matchJobs(
      [
        posting("ok"),
        posting("us", { screen: { regions: ["US"] } }),
        posting("agency", { screen: { employerType: "agency" } }),
        posting("portuguese", { screen: { languages: ["pt"] } }),
        posting("german", { screen: { languages: ["en", "de"] } }),
        posting("senior", { screen: { seniority: "senior" } }),
        posting("years", { screen: { minYears: 6 } }),
        posting("blocked", { company: "Blocked Co", companyKey: "blocked" }),
        posting("qa", { title: "QA Engineer" }),
        posting("unpaid", { screen: { redFlags: ["unpaid internship"] } }),
        posting("support", { screen: { roleFamily: "support" } }),
        posting("studios", { title: "Engineer, Studios Platform" }),
        posting("closed", { closedAt: now }),
        { ...posting("unscreened"), screen: null },
      ],
      preferences,
      context
    );
    expect(matches.map((match) => match.posting.id)).toEqual(["ok", "studios"]);
  });

  it("skips logged companies and shown postings unless asked", () => {
    const rows = [posting("a"), posting("b")];
    expect(
      matchJobs(rows, preferences, {
        ...context,
        loggedCompanies: new Set(["companya"]),
        recommended: new Set(["b"]),
      })
    ).toEqual([]);
    expect(
      matchJobs(rows, preferences, {
        ...context,
        includeShown: true,
        recommended: new Set(["b"]),
      }).map((match) => match.posting.id)
    ).toEqual(expect.arrayContaining(["a", "b"]));
  });

  it("ranks keyword fit first and marks stretch asks", () => {
    const matches = matchJobs(
      [
        posting("plain"),
        posting("fit", {
          description: "TypeScript agents all day",
          title: "Founding Engineer",
        }),
        posting("stretch", { screen: { minYears: 4 } }),
      ],
      preferences,
      context
    );
    expect(matches.map((match) => match.posting.id)).toEqual([
      "fit",
      "plain",
      "stretch",
    ]);
    expect(matches[0]?.reasons).toEqual([
      "title: founding",
      "stack: typescript, agents",
    ]);
    expect(matches[2]?.stretch).toBe(true);
  });

  it("ranks employer postings above aggregator reposts", () => {
    expect(
      matchJobs(
        [posting("repost", { source: "himalayas" }), posting("direct")],
        preferences,
        context
      ).map((match) => match.posting.id)
    ).toEqual(["direct", "repost"]);
  });

  it("keeps one posting per company and honors the query", () => {
    const rows = ["1", "2", "3"].map((id) =>
      posting(id, { companyKey: "same", description: id === "3" ? "rust" : "" })
    );
    expect(matchJobs(rows, preferences, context)).toHaveLength(1);
    expect(
      matchJobs(rows, preferences, { ...context, query: "RUST" }).map(
        (match) => match.posting.id
      )
    ).toEqual(["3"]);
  });

  it("ranks down titles that ask only for stacks the user doesn't list", () => {
    const matches = matchJobs(
      [
        posting("php", { title: "Full-Stack Developer – PHP / AWS / GCP" }),
        posting("nest", { title: "Backend Engineer (NestJS / Go)" }),
        posting("plain"),
      ],
      jobPreferencesSchema.parse({ country: "IN", stackKeywords: ["node"] }),
      context
    );
    expect(matches.map((match) => match.posting.id)).toEqual([
      "nest",
      "plain",
      "php",
    ]);
    expect(matches[2]?.reasons).toContain("title asks for php");
  });
});

describe("fitLocation", () => {
  const screen = posting("x").screen;
  if (!screen) throw new Error("fixture has a screen");
  const india = jobPreferencesSchema.parse({ country: "IN" });

  it.each([
    [["worldwide"], "remote", "worldwide"],
    [["IN"], "remote", "country"],
    [["apac"], "remote", "region"],
    [["US", "IN"], "remote", "country"],
    [["US"], "remote", null],
    [["europe"], "remote", null],
    [[], "remote", null],
    [["IN"], "onsite", null],
  ] as const)(
    "fits %j %s as %s for someone in India",
    (regions, workplace, fit) => {
      expect(
        fitLocation({ ...screen, regions: [...regions], workplace }, india)
      ).toBe(fit);
    }
  );

  it("matches offices in the user's country when they accept onsite", () => {
    const onsite = jobPreferencesSchema.parse({
      country: "IN",
      workplaces: ["remote", "onsite"],
    });
    expect(
      fitLocation({ ...screen, regions: ["IN"], workplace: "onsite" }, onsite)
    ).toBe("country");
    expect(
      fitLocation({ ...screen, regions: ["US"], workplace: "onsite" }, onsite)
    ).toBeNull();
  });

  it("shows only worldwide remote roles until the country is known", () => {
    const unknown = jobPreferencesSchema.parse({});
    expect(fitLocation(screen, unknown)).toBe("worldwide");
    expect(fitLocation({ ...screen, regions: ["IN"] }, unknown)).toBeNull();
  });

  it("treats a remote role limited to some states as unstated", () => {
    const states = { ...screen, regions: ["IN"], localities: ["Kerala"] };
    expect(fitLocation(states, india)).toBeNull();
    expect(
      fitLocation(states, { ...india, includeUnclearLocation: true })
    ).toBe("unstated");
    expect(fitLocation({ ...states, localities: [] }, india)).toBe("country");
  });

  it("keeps unstated locations only when asked", () => {
    const unclear = { ...screen, regions: [], workplace: "unclear" as const };
    expect(fitLocation(unclear, india)).toBeNull();
    expect(
      fitLocation(unclear, { ...india, includeUnclearLocation: true })
    ).toBe("unstated");
  });
});
