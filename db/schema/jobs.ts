import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import {
  jobApplicationStatuses,
  jobBoardProviders,
  jobSources,
  type JobPreferences,
  type JobScreen,
} from "@shared/jobs/schema";
import { workspaceMemberships } from "./workspaces";

const timestampColumn = (name: string) =>
  timestamp(name, { mode: "date", precision: 3, withTimezone: true });

// Postings are shared by every user: each one is fetched and screened once.
export const jobPostings = pgTable(
  "job_postings",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    source: text("source", { enum: jobSources }).notNull(),
    externalId: text("external_id").notNull(),
    company: text("company").notNull(),
    companyKey: text("company_key").notNull(),
    title: text("title").notNull(),
    url: text("url").notNull(),
    applyUrl: text("apply_url"),
    location: text("location").notNull(),
    workplaceType: text("workplace_type"),
    description: text("description").notNull(),
    pay: text("pay"),
    postedAt: timestampColumn("posted_at"),
    firstSeenAt: timestampColumn("first_seen_at").defaultNow().notNull(),
    lastSeenAt: timestampColumn("last_seen_at").defaultNow().notNull(),
    closedAt: timestampColumn("closed_at"),
    screen: jsonb("screen").$type<JobScreen>(),
    screenedAt: timestampColumn("screened_at"),
  },
  (table) => [
    uniqueIndex("job_postings_source_external_idx").on(
      table.source,
      table.externalId
    ),
    index("job_postings_open_idx").on(table.closedAt, table.firstSeenAt),
    index("job_postings_unscreened_idx").on(table.screenedAt),
  ]
);

// Company job boards on Ashby, Greenhouse and Lever, seeded or discovered from
// links in other sources, polled through their public JSON APIs.
export const jobBoards = pgTable(
  "job_boards",
  {
    provider: text("provider", { enum: jobBoardProviders }).notNull(),
    slug: text("slug").notNull(),
    company: text("company"),
    discoveredFrom: text("discovered_from").notNull(),
    lastFetchedAt: timestampColumn("last_fetched_at"),
    lastError: text("last_error"),
    failures: integer("failures").notNull().default(0),
    createdAt: timestampColumn("created_at").defaultNow().notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.provider, table.slug] }),
    index("job_boards_due_idx").on(table.lastFetchedAt),
  ]
);

export const jobPreferences = pgTable(
  "job_preferences",
  {
    workspaceId: text("workspace_id").notNull(),
    userId: text("user_id").notNull(),
    preferences: jsonb("preferences").$type<JobPreferences>().notNull(),
    updatedAt: timestampColumn("updated_at").defaultNow().notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.workspaceId, table.userId] }),
    foreignKey({
      name: "job_preferences_membership_fkey",
      columns: [table.workspaceId, table.userId],
      foreignColumns: [
        workspaceMemberships.workspaceId,
        workspaceMemberships.userId,
      ],
    }).onDelete("cascade"),
  ]
);

// The user's application log: what they applied to or messaged, and what
// they skipped, so the agent never suggests the same company twice.
export const jobApplications = pgTable(
  "job_applications",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workspaceId: text("workspace_id").notNull(),
    userId: text("user_id").notNull(),
    postingId: uuid("posting_id").references(() => jobPostings.id, {
      onDelete: "set null",
    }),
    company: text("company").notNull(),
    companyKey: text("company_key").notNull(),
    role: text("role"),
    status: text("status", { enum: jobApplicationStatuses }).notNull(),
    channel: text("channel"),
    url: text("url"),
    notes: text("notes"),
    appliedAt: timestampColumn("applied_at"),
    followUpAt: timestampColumn("follow_up_at"),
    createdAt: timestampColumn("created_at").defaultNow().notNull(),
    updatedAt: timestampColumn("updated_at").defaultNow().notNull(),
  },
  (table) => [
    foreignKey({
      name: "job_applications_membership_fkey",
      columns: [table.workspaceId, table.userId],
      foreignColumns: [
        workspaceMemberships.workspaceId,
        workspaceMemberships.userId,
      ],
    }).onDelete("cascade"),
    index("job_applications_owner_idx").on(
      table.workspaceId,
      table.userId,
      table.companyKey
    ),
    uniqueIndex("job_applications_posting_idx")
      .on(table.workspaceId, table.userId, table.postingId)
      .where(sql`${table.postingId} IS NOT NULL`),
    check("job_applications_company_check", sql`${table.companyKey} <> ''`),
  ]
);

// Postings already put in front of a user, so digests don't repeat them.
export const jobRecommendations = pgTable(
  "job_recommendations",
  {
    workspaceId: text("workspace_id").notNull(),
    userId: text("user_id").notNull(),
    postingId: uuid("posting_id")
      .notNull()
      .references(() => jobPostings.id, { onDelete: "cascade" }),
    recommendedAt: timestampColumn("recommended_at").defaultNow().notNull(),
  },
  (table) => [
    primaryKey({
      columns: [table.workspaceId, table.userId, table.postingId],
    }),
    foreignKey({
      name: "job_recommendations_membership_fkey",
      columns: [table.workspaceId, table.userId],
      foreignColumns: [
        workspaceMemberships.workspaceId,
        workspaceMemberships.userId,
      ],
    }).onDelete("cascade"),
  ]
);
