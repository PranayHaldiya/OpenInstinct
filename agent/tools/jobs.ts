import { defineDynamic, defineTool, type ToolContext } from "eve/tools";
import { always } from "eve/tools/approval";
import { z } from "zod";
import { loadCandidatePostings } from "@agent/lib/jobs/candidates";
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
import {
  deleteJobDocument,
  listJobDocuments,
  renameJobDocument,
} from "@db/services/jobs/documents";
import { createJobSubmissionGrant } from "@db/services/jobs/grants";
import {
  getJobProfileFacts,
  jobProfileFactsLimit,
  saveJobProfileFacts,
} from "@db/services/jobs/profile";
import {
  getJobPreferences,
  updateJobPreferences,
} from "@db/services/jobs/preferences";
import type { AccessScope } from "@shared/identity/access-scope";
import {
  companyKey,
  jobApplicationStatuses,
  jobPreferencesPatchSchema,
  jobPreferencesSchema,
  type JobPreferences,
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

/** Setup steps a user hasn't done yet, in the order to ask about them. */
async function setupGaps(scope: AccessScope, preferences: JobPreferences) {
  const [documents, facts] = await Promise.all([
    listJobDocuments(scope),
    getJobProfileFacts(scope),
  ]);
  return [
    preferences.country === null ? "country" : null,
    preferences.titleKeywords.length === 0 &&
    preferences.stackKeywords.length === 0
      ? "roles and stack"
      : null,
    documents.length === 0 ? "resume" : null,
    facts?.facts.trim() ? null : "profile facts",
  ].filter((gap) => gap !== null);
}

export const findJobs = defineTool({
  description:
    "Find open job postings that match the user's saved job preferences, ranked best first. Postings come from Ashby, Greenhouse and Lever boards, Hacker News Who's Hiring, RemoteOK, Himalayas and YC, and are already screened for workplace and regions, employer type, seniority, years asked and red flags. Only postings the user can work from their saved country appear; with no country saved, only remote worldwide ones do, and countryMissing is true. setupMissing lists setup steps the user hasn't done. Companies the user applied to, messaged, skipped or excluded never appear, and postings already shown are skipped unless includeShown is true. Returned postings are recorded as shown. Use query to narrow by keywords that must all appear. Each result's id works with jobs-log.",
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
      loadCandidatePostings(
        preferences,
        new Date(now.getTime() - preferences.maxAgeDays * dayMs)
      ),
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
      countryMissing: preferences.country === null,
      setupMissing: await setupGaps(scope, preferences),
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
        employerType: posting.screen?.employerType,
        languages: posting.screen?.languages,
        locationEvidence: posting.screen?.locationEvidence,
        openFrom: posting.screen?.regions,
        workplace: posting.screen?.workplace,
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
    "List the user's job application log, newest first, optionally filtered by status. Set followUpDue to list only entries whose follow-up date has arrived. Use it to answer where they applied, what needs a follow-up, or before logging an update to an existing entry.",
  inputSchema: z.object({
    followUpDue: z.boolean().default(false),
    limit: z.number().int().min(1).max(100).default(30),
    statuses: z.array(z.enum(jobApplicationStatuses)).optional(),
  }),
  async execute(input, context) {
    const entries = await listJobApplications(callerScope(context), {
      ...input,
      followUpDueBy: input.followUpDue ? new Date() : undefined,
    });
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

const preferencesPatchSchema = jobPreferencesPatchSchema
  .omit({ excludeCompanies: true })
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
    "Read or change the user's job search preferences: country they live in (ISO 3166-1 alpha-2 code such as IN, US or GB), workplaces they accept (remote, hybrid, onsite; hybrid and onsite match offices anywhere in their country), whether to include postings that don't say how or where they're worked, languages they work in (ISO 639-1 codes such as en, pt; postings needing any other are skipped), employer types to exclude (agency: recruiters hiring for a client; services: consultancies building for clients; product), role families to keep (product, ai, infrastructure, data_ml, mobile, qa, security, support, other), maxYears and stretchYears of experience asked, seniorities to exclude, stack and title keywords that rank postings higher, title keywords to exclude, companies to exclude, how many days old a posting may be, and the daily digest size. Call with no fields to read; the read also lists setupMissing, the setup steps the user hasn't done. Save only what the user states; lists replace the saved list except excludeCompaniesAdd and excludeCompaniesRemove, which edit the exclude list.",
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
    if (!hasChange) {
      return {
        ...summarizePreferences(current),
        setupMissing: await setupGaps(scope, current),
      };
    }
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

export const jobProfileTool = defineTool({
  description:
    "Read or change the facts the user has confirmed about themselves for applications and outreach: experience, projects, metrics, links, availability, and answers to common form questions. Drafts of notes, emails and form answers may use only these facts; never add a claim, number or skill that isn't here. Call with no fields to read. Pass append to add facts the user just stated, or facts to replace the whole text when they ask to rewrite it.",
  inputSchema: z.object({
    append: z.string().trim().min(1).max(4_000).optional(),
    facts: z.string().trim().min(1).max(jobProfileFactsLimit).optional(),
  }),
  async execute(input, context) {
    const scope = callerScope(context);
    const current = await getJobProfileFacts(scope);
    const next =
      input.facts ??
      (input.append
        ? [current?.facts, input.append].filter(Boolean).join("\n")
        : undefined);
    if (next !== undefined) await saveJobProfileFacts(scope, next);
    const facts = next ?? current?.facts ?? "";
    return {
      facts,
      saved: next !== undefined,
      updatedOn:
        next === undefined
          ? isoDate(current?.updatedAt ?? null)
          : isoDate(new Date()),
    };
  },
});

const documentLabelSchema = z
  .string()
  .trim()
  .regex(
    /^[a-z0-9][a-z0-9-]{0,39}$/,
    "Use lower-case letters, digits and dashes."
  );

export const listJobDocumentsTool = defineTool({
  description:
    "List the user's saved application documents, such as resume variants, by label, and rename or delete one. Documents the user sends in chat as PDF or Word files are saved automatically. Name a label in a browser assignment so the worker's stage_document can attach it to a form; the worker never sees the file's content. Rename or delete only when the user asks or agrees.",
  inputSchema: z.object({
    delete: documentLabelSchema.optional(),
    rename: z
      .object({ from: documentLabelSchema, to: documentLabelSchema })
      .optional(),
  }),
  async execute(input, context) {
    const scope = callerScope(context);
    const changes: string[] = [];
    if (input.rename) {
      const { from, to } = input.rename;
      changes.push(
        (await renameJobDocument(scope, from, to))
          ? `renamed ${from} to ${to}`
          : `could not rename ${from}: it doesn't exist or ${to} is taken`
      );
    }
    if (input.delete) {
      changes.push(
        (await deleteJobDocument(scope, input.delete))
          ? `deleted ${input.delete}`
          : `no document labeled ${input.delete}`
      );
    }
    return {
      changes,
      documents: (await listJobDocuments(scope)).map((document) => ({
        filename: document.filename,
        label: document.label,
        savedOn: isoDate(document.createdAt),
      })),
    };
  },
});

export const approveJobSubmission = defineTool({
  approval: always(),
  description:
    "Ask the user to approve submitting one prefilled job application, then return a one-time grant for it. Call only after a browser worker prefilled the form and stopped before the final submit, and after you sent the user what will be submitted: company, role, resume label and the answers the worker filled. The user approves or denies with a button. On approval, continue the same worker with its agentId, the grant token and the submit button selector so its submit_application tool can submit. The grant works once, for that browser session, for 15 minutes.",
  inputSchema: z.object({
    browserSessionId: z.string().trim().min(1).max(500),
    company: z.string().trim().min(1).max(120),
    postingId: z.uuid().optional(),
    role: z.string().trim().max(200).optional(),
    summary: z
      .string()
      .trim()
      .min(1)
      .max(1_500)
      .describe(
        "What will be submitted, as the user should see it in the approval prompt."
      ),
  }),
  async execute(input, context) {
    const grant = await createJobSubmissionGrant(callerScope(context), input);
    return {
      expiresAt: grant.expiresAt.toISOString(),
      grantToken: grant.token,
    };
  },
});

export default defineDynamic({
  events: {
    "turn.started": (_event, context) =>
      resolveModeValue(context, {
        interactive: {
          "jobs-approve-submit": approveJobSubmission,
          "jobs-documents": listJobDocumentsTool,
          "jobs-find": findJobs,
          "jobs-log": logJob,
          "jobs-log-list": listJobLog,
          "jobs-preferences": jobPreferencesTool,
          "jobs-profile": jobProfileTool,
        },
        "scheduled-worker": {
          "jobs-find": findJobs,
          "jobs-log-list": listJobLog,
        },
      }),
  },
});
