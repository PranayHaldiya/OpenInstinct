import { readFile, readdir } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as Database from "@db";
import type { NewJobPosting } from "@db/services/jobs/postings";
import type { JobScreen } from "@shared/jobs/schema";
import * as schema from "../schema";

const databases: PGlite[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  vi.resetModules();
  await Promise.all(databases.splice(0).map((database) => database.close()));
});

const screen: JobScreen = {
  employerType: "unclear",
  locationEvidence: "Remote",
  method: "rules",
  minYears: null,
  redFlags: [],
  regions: ["worldwide"],
  workplace: "remote",
  roleFamily: "product",
  seniority: "unknown",
  stack: [],
  summary: null,
};

function newPosting(externalId: string, title = "Engineer"): NewJobPosting {
  return {
    applyUrl: null,
    company: "Acme",
    companyKey: "acme",
    description: "Build things",
    externalId,
    location: "Remote",
    pay: null,
    postedAt: new Date(),
    source: "ashby",
    title,
    url: `https://jobs.ashbyhq.com/${externalId}`,
    workplaceType: "remote",
  };
}

describe("job search services", () => {
  it("ingests, screens, logs and recommends postings", async () => {
    const client = await migratedDatabase();
    const pgliteDatabase = drizzle(client, { schema });
    // SAFETY: PGlite implements the query-builder surface exercised by these services while retaining the shared Drizzle schema.
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- The focused test swaps only the database driver.
    vi.spyOn(Database, "db", "get").mockReturnValue(pgliteDatabase as never);
    const postings = await import("@db/services/jobs/postings");
    const applications = await import("@db/services/jobs/applications");
    const preferences = await import("@db/services/jobs/preferences");
    const alice = { userId: "better-auth:alice", workspaceId: "w:alice" };

    // New rows count once; repeats refresh in place.
    expect(
      await postings.upsertJobPostings([
        newPosting("acme:1"),
        newPosting("acme:2"),
        newPosting("acme:1"),
      ])
    ).toBe(2);
    expect(await postings.upsertJobPostings([newPosting("acme:1")])).toBe(0);

    const unscreened = await postings.listUnscreenedJobPostings(10);
    expect(unscreened).toHaveLength(2);
    for (const row of unscreened) {
      // oxlint-disable-next-line eslint/no-await-in-loop -- Two rows, saved in order.
      await postings.saveJobScreen(row.id, screen);
    }
    expect(await postings.listUnscreenedJobPostings(10)).toHaveLength(0);

    // An edited posting is screened again; an unchanged one keeps its screen.
    await postings.upsertJobPostings([
      newPosting("acme:1"),
      newPosting("acme:2", "Senior Engineer"),
    ]);
    expect(
      (await postings.listUnscreenedJobPostings(10)).map(
        (row) => row.externalId
      )
    ).toEqual(["acme:2"]);

    // A board's listing closes postings it no longer includes.
    await postings.closeMissingBoardPostings(
      { provider: "ashby", slug: "acme" },
      ["acme:1"]
    );
    const filter = {
      includeUnclear: false,
      regions: ["worldwide", "IN", "asia", "apac"],
      since: new Date(Date.now() - 86_400_000),
      workplaces: ["remote"],
    };
    const candidates = await postings.listCandidateJobPostings(filter);
    expect(candidates.map((row) => row.externalId)).toEqual(["acme:1"]);
    expect(
      await postings.listCandidateJobPostings({ ...filter, regions: ["US"] })
    ).toEqual([]);
    expect(
      await postings.listCandidateJobPostings({
        ...filter,
        workplaces: ["onsite"],
      })
    ).toEqual([]);
    const [open] = candidates;
    if (!open) throw new Error("Expected an open posting.");

    // Boards are added once and come due again after a fetch window.
    expect(
      await postings.addJobBoards(
        [
          { company: "Acme", provider: "ashby", slug: "acme" },
          { company: null, provider: "lever", slug: "kraken" },
        ],
        "seed"
      )
    ).toBe(2);
    expect(
      await postings.addJobBoards(
        [{ company: null, provider: "ashby", slug: "acme" }],
        "hn"
      )
    ).toBe(0);
    await postings.markJobBoardFetched({ provider: "ashby", slug: "acme" });
    expect(
      (await postings.listDueJobBoards(new Date(Date.now() - 1_000), 10)).map(
        (board) => board.slug
      )
    ).toEqual(["kraken"]);

    // The log keys entries by posting, or by company and role.
    const applied = await applications.recordJobApplication(alice, {
      postingId: open.id,
      status: "applied",
    });
    expect(applied).toMatchObject({
      channel: "ashby",
      company: "Acme",
      role: "Engineer",
      status: "applied",
    });
    expect(applied?.appliedAt).toBeInstanceOf(Date);
    const interviewing = await applications.recordJobApplication(alice, {
      notes: "Call on Friday",
      postingId: open.id,
      status: "interviewing",
    });
    expect(interviewing?.id).toBe(applied?.id);
    expect(interviewing?.appliedAt).toEqual(applied?.appliedAt);

    await applications.recordJobApplication(alice, {
      company: "Globex",
      status: "messaged",
    });
    await applications.recordJobApplication(alice, {
      company: "globex",
      notes: "Replied",
      status: "interviewing",
    });
    const log = await applications.listJobApplications(alice, { limit: 10 });
    expect(log).toHaveLength(2);
    expect(
      await applications.listJobApplications(alice, {
        limit: 10,
        statuses: ["interviewing"],
      })
    ).toHaveLength(2);
    expect(await applications.listLoggedCompanyKeys(alice)).toEqual(
      new Set(["acme", "globex"])
    );
    await expect(
      applications.recordJobApplication(alice, { status: "saved" })
    ).rejects.toThrow("company or a posting id");

    await applications.recordJobRecommendations(alice, [open.id, open.id]);
    expect(await applications.listRecommendedPostingIds(alice)).toEqual(
      new Set([open.id])
    );

    // Preferences start from defaults and merge updates.
    expect(await preferences.getJobPreferences(alice)).toMatchObject({
      digestSize: 5,
    });
    await preferences.updateJobPreferences(alice, {
      excludeCompanies: ["Blocked Co"],
      maxYears: 2,
    });
    expect(await preferences.getJobPreferences(alice)).toMatchObject({
      digestSize: 5,
      excludeCompanies: ["Blocked Co"],
      maxYears: 2,
    });
  }, 30_000);
});

async function migratedDatabase() {
  const client = new PGlite();
  databases.push(client);
  const migrations = (await readdir(new URL("../migrations/", import.meta.url)))
    .filter((filename) => filename.endsWith(".sql"))
    .toSorted();
  for (const migration of migrations) {
    // oxlint-disable-next-line eslint/no-await-in-loop -- Migrations must apply in order.
    await applyMigration(client, migration);
  }
  return client;
}

async function applyMigration(database: PGlite, filename: string) {
  const source = await readFile(
    new URL(`../migrations/${filename}`, import.meta.url),
    "utf8"
  );
  for (const statement of source.split("--> statement-breakpoint")) {
    // oxlint-disable-next-line eslint/no-await-in-loop -- Statements must apply in order.
    if (statement.trim()) await database.exec(statement);
  }
}
