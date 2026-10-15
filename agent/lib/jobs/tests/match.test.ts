import { describe, expect, it } from "vitest";
import type { jobPostings } from "@db/schema";
import { jobPreferencesSchema, type JobScreen } from "@shared/jobs/schema";
import { matchJobs } from "../match";

const now = new Date("2026-10-15T00:00:00Z");
const preferences = jobPreferencesSchema.parse({
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
      redFlags: [],
      remote: "anywhere",
      remoteEvidence: "Remote, worldwide",
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
        posting("us", { screen: { remote: "other_region" } }),
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
});
