CREATE TABLE "job_applications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" text NOT NULL,
	"user_id" text NOT NULL,
	"posting_id" uuid,
	"company" text NOT NULL,
	"company_key" text NOT NULL,
	"role" text,
	"status" text NOT NULL,
	"channel" text,
	"url" text,
	"notes" text,
	"applied_at" timestamp (3) with time zone,
	"follow_up_at" timestamp (3) with time zone,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "job_applications_company_check" CHECK ("job_applications"."company_key" <> '')
);
--> statement-breakpoint
CREATE TABLE "job_boards" (
	"provider" text NOT NULL,
	"slug" text NOT NULL,
	"company" text,
	"discovered_from" text NOT NULL,
	"last_fetched_at" timestamp (3) with time zone,
	"last_error" text,
	"failures" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "job_boards_provider_slug_pk" PRIMARY KEY("provider","slug")
);
--> statement-breakpoint
CREATE TABLE "job_postings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source" text NOT NULL,
	"external_id" text NOT NULL,
	"company" text NOT NULL,
	"company_key" text NOT NULL,
	"title" text NOT NULL,
	"url" text NOT NULL,
	"apply_url" text,
	"location" text NOT NULL,
	"workplace_type" text,
	"description" text NOT NULL,
	"pay" text,
	"posted_at" timestamp (3) with time zone,
	"first_seen_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"closed_at" timestamp (3) with time zone,
	"screen" jsonb,
	"screened_at" timestamp (3) with time zone
);
--> statement-breakpoint
CREATE TABLE "job_preferences" (
	"workspace_id" text NOT NULL,
	"user_id" text NOT NULL,
	"preferences" jsonb NOT NULL,
	"updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "job_preferences_workspace_id_user_id_pk" PRIMARY KEY("workspace_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "job_recommendations" (
	"workspace_id" text NOT NULL,
	"user_id" text NOT NULL,
	"posting_id" uuid NOT NULL,
	"recommended_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "job_recommendations_workspace_id_user_id_posting_id_pk" PRIMARY KEY("workspace_id","user_id","posting_id")
);
--> statement-breakpoint
ALTER TABLE "job_applications" ADD CONSTRAINT "job_applications_posting_id_job_postings_id_fk" FOREIGN KEY ("posting_id") REFERENCES "public"."job_postings"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_applications" ADD CONSTRAINT "job_applications_membership_fkey" FOREIGN KEY ("workspace_id","user_id") REFERENCES "public"."workspace_memberships"("workspace_id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_preferences" ADD CONSTRAINT "job_preferences_membership_fkey" FOREIGN KEY ("workspace_id","user_id") REFERENCES "public"."workspace_memberships"("workspace_id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_recommendations" ADD CONSTRAINT "job_recommendations_posting_id_job_postings_id_fk" FOREIGN KEY ("posting_id") REFERENCES "public"."job_postings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_recommendations" ADD CONSTRAINT "job_recommendations_membership_fkey" FOREIGN KEY ("workspace_id","user_id") REFERENCES "public"."workspace_memberships"("workspace_id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "job_applications_owner_idx" ON "job_applications" USING btree ("workspace_id","user_id","company_key");--> statement-breakpoint
CREATE UNIQUE INDEX "job_applications_posting_idx" ON "job_applications" USING btree ("workspace_id","user_id","posting_id") WHERE "job_applications"."posting_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "job_boards_due_idx" ON "job_boards" USING btree ("last_fetched_at");--> statement-breakpoint
CREATE UNIQUE INDEX "job_postings_source_external_idx" ON "job_postings" USING btree ("source","external_id");--> statement-breakpoint
CREATE INDEX "job_postings_open_idx" ON "job_postings" USING btree ("closed_at","first_seen_at");--> statement-breakpoint
CREATE INDEX "job_postings_unscreened_idx" ON "job_postings" USING btree ("screened_at");