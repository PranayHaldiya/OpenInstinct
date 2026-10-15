import { defineDynamic, defineTool, type ToolContext } from "eve/tools";
import { z } from "zod";
import { matchJobs } from "@agent/lib/jobs/match";
import { resolveModeValue } from "@agent/lib/mode";
import { scopeFromPrincipal } from "@agent/lib/principal-scope";
import {
  listJobApplications,
  listLoggedCompanyKeys,
  listRecommendedPostingIds,
  recordJobApplication,
  recordJobRecommendations,
} from "@db/services/jobs/applications";
import { listCandidateJobPostings } from "@db/services/jobs/postings";
import {
  getJobPreferences,
  updateJobPreferences,
} from "@db/services/jobs/preferences";
import {
  companyKey,
  jobApplicationStatuses,
  jobPreferencesSchema,
} from "@shared/jobs/schema";

const dayMs = 86_400_000;

function callerScope(context: ToolContext) {
  const caller = context.session.auth.current ?? context.session.auth.initiator;
  if (caller?.principalType !== "user") {
    throw new Error("Job search needs an authenticated user.");
  }
  return scopeFromPrincipal(caller);
}

function isoDate(date: Date | null) {
  return date ? date.toISOString().slice(0, 10) : null;
}

export const findJobs = defineTool({
  description:
    "Find open job postings that match the user's saved job preferences, ranked best first. Postings come from Ashby, Greenhouse and Lever boards, Hacker News Who's Hiring, RemoteOK, Himalayas and YC, and are already screened for remote scope, seniority, years asked and red flags. Companies the user applied to, messaged, skipped or excluded never appear, and postings already shown are skipped unless includeShown is true. Returned postings are recorded as shown. Use query to narrow by keywords that must all appear. Each result's id works with jobs-log.",
  inputSchema: z.object({
    includeShown: z.boolean().default(false),
    limit: z.number().int().min(1).max(20).optional(),
    query: z.string().trim().max(200).optional(),
  }),
  async execute(input, context) {
    const scope = callerScope(context);
    const now = new Date();
    const preferences = await getJobPreferences(scope);
    const [postings, loggedCompanies, recommended] = await Promise.all([
      listCandidateJobPostings({
        remoteScopes: preferences.remoteScopes,
        since: new Date(now.getTime() - preferences.maxAgeDays * dayMs),
      }),
      listLoggedCompanyKeys(scope),
      listRecommendedPostingIds(scope),
    ]);
    const matches = matchJobs(postings, preferences, {
      includeShown: input.includeShown,
      loggedCompanies,
      now,
      query: input.query,
      recommended,
    });
    const picked = matches.slice(0, input.limit ?? preferences.digestSize);
    await recordJobRecommendations(
      scope,
      picked.map((match) => match.posting.id)
    );
    return {
      matchedTotal: matches.length,
      postings: picked.map(({ posting, reasons, stretch }) => ({
        applyUrl: posting.applyUrl,
        company: posting.company,
        flags: posting.screen?.redFlags ?? [],
        id: posting.id,
        location: posting.location.slice(0, 200),
        pay: posting.pay,
        postedOn: isoDate(posting.postedAt ?? posting.firstSeenAt),
        reasons,
        remote: posting.screen?.remote,
        remoteEvidence: posting.screen?.remoteEvidence,
        source: posting.source,
        stretch,
        summary: posting.screen?.summary ?? null,
        title: posting.title,
        url: posting.url,
        yearsAsked: posting.screen?.minYears ?? null,
      })),
    };
  },
});

export const logJob = defineTool({
  description:
    "Record or update one entry in the user's job application log: a role they applied to, a company they messaged, an interview, an outcome, or a company or posting to skip. Pass postingId for a posting from jobs-find, or company (and role when known) for anything else. Recording the same posting or company and role again updates that entry. This only writes the log; it never applies or sends anything.",
  inputSchema: z.object({
    channel: z
      .string()
      .trim()
      .max(60)
      .optional()
      .describe(
        "Where it happened: ashby, greenhouse, email, linkedin, x, referral."
      ),
    company: z.string().trim().min(1).max(120).optional(),
    followUpInDays: z.number().int().min(0).max(90).optional(),
    notes: z.string().trim().max(1_000).optional(),
    postingId: z.uuid().optional(),
    role: z.string().trim().max(200).optional(),
    status: z.enum(jobApplicationStatuses),
    url: z.url().optional(),
  }),
  async execute({ followUpInDays, ...input }, context) {
    if (!input.postingId && !input.company) {
      throw new Error("Pass postingId or company.");
    }
    const entry = await recordJobApplication(callerScope(context), {
      ...input,
      followUpAt:
        followUpInDays === undefined
          ? undefined
          : new Date(Date.now() + followUpInDays * dayMs),
    });
    return {
      company: entry?.company,
      followUpOn: isoDate(entry?.followUpAt ?? null),
      id: entry?.id,
      role: entry?.role,
      status: entry?.status,
    };
  },
});

export const listJobLog = defineTool({
  description:
    "List the user's job application log, newest first, optionally filtered by status. Use it to answer where they applied, what needs a follow-up, or before logging an update to an existing entry.",
  inputSchema: z.object({
    limit: z.number().int().min(1).max(100).default(30),
    statuses: z.array(z.enum(jobApplicationStatuses)).optional(),
  }),
  async execute(input, context) {
    const entries = await listJobApplications(callerScope(context), input);
    return entries.map((entry) => ({
      appliedOn: isoDate(entry.appliedAt),
      channel: entry.channel,
      company: entry.company,
      followUpOn: isoDate(entry.followUpAt),
      id: entry.id,
      notes: entry.notes,
      role: entry.role,
      status: entry.status,
      updatedOn: isoDate(entry.updatedAt),
      url: entry.url,
    }));
  },
});

const preferencesPatchSchema = jobPreferencesSchema
  .omit({ excludeCompanies: true })
  .partial()
  .extend({
    excludeCompaniesAdd: z
      .array(z.string().trim().min(1).max(120))
      .max(200)
      .optional(),
    excludeCompaniesRemove: z
      .array(z.string().trim().min(1).max(120))
      .max(200)
      .optional(),
  });

export const jobPreferencesTool = defineTool({
  description:
    "Read or change the user's job search preferences: acceptable remote scopes (anywhere, india, apac, other_region, onsite, unclear), role families to keep (product, ai, infrastructure, data_ml, mobile, qa, security, support, other), maxYears and stretchYears of experience asked, seniorities to exclude, stack and title keywords that rank postings higher, title keywords to exclude, companies to exclude, how many days old a posting may be, and the daily digest size. Call with no fields to read. Save only what the user states; lists replace the saved list except excludeCompaniesAdd and excludeCompaniesRemove, which edit the exclude list.",
  inputSchema: preferencesPatchSchema,
  async execute(
    { excludeCompaniesAdd, excludeCompaniesRemove, ...patch },
    context
  ) {
    const scope = callerScope(context);
    const hasChange =
      Object.keys(patch).length > 0 ||
      excludeCompaniesAdd !== undefined ||
      excludeCompaniesRemove !== undefined;
    const current = await getJobPreferences(scope);
    if (!hasChange) return summarizePreferences(current);
    const removed = new Set((excludeCompaniesRemove ?? []).map(companyKey));
    const excludeCompanies = [
      ...current.excludeCompanies,
      ...(excludeCompaniesAdd ?? []),
    ].filter((name) => !removed.has(companyKey(name)));
    return summarizePreferences(
      await updateJobPreferences(scope, {
        ...patch,
        excludeCompanies: [
          ...new Map(
            excludeCompanies.map((name) => [companyKey(name), name])
          ).values(),
        ],
      })
    );
  },
});

function summarizePreferences(
  preferences: z.infer<typeof jobPreferencesSchema>
) {
  const { excludeCompanies, ...rest } = preferences;
  return {
    ...rest,
    excludeCompaniesCount: excludeCompanies.length,
    excludeCompaniesRecent: excludeCompanies.slice(-20),
  };
}

export default defineDynamic({
  events: {
    "turn.started": (_event, context) =>
      resolveModeValue(context, {
        interactive: {
          "jobs-find": findJobs,
          "jobs-log": logJob,
          "jobs-log-list": listJobLog,
          "jobs-preferences": jobPreferencesTool,
        },
        "scheduled-worker": {
          "jobs-find": findJobs,
          "jobs-log-list": listJobLog,
        },
      }),
  },
});
