CREATE TABLE "job_documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" text NOT NULL,
	"user_id" text NOT NULL,
	"label" text NOT NULL,
	"filename" text NOT NULL,
	"mime_type" text NOT NULL,
	"content" "bytea" NOT NULL,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "job_documents_size_check" CHECK (octet_length("job_documents"."content") <= 10485760)
);
--> statement-breakpoint
CREATE TABLE "job_profiles" (
	"workspace_id" text NOT NULL,
	"user_id" text NOT NULL,
	"facts" text NOT NULL,
	"updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "job_profiles_workspace_id_user_id_pk" PRIMARY KEY("workspace_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "job_submission_grants" (
	"token" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" text NOT NULL,
	"user_id" text NOT NULL,
	"browser_session_id" text NOT NULL,
	"posting_id" uuid,
	"company" text NOT NULL,
	"role" text,
	"expires_at" timestamp (3) with time zone NOT NULL,
	"used_at" timestamp (3) with time zone,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "job_documents" ADD CONSTRAINT "job_documents_membership_fkey" FOREIGN KEY ("workspace_id","user_id") REFERENCES "public"."workspace_memberships"("workspace_id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_profiles" ADD CONSTRAINT "job_profiles_membership_fkey" FOREIGN KEY ("workspace_id","user_id") REFERENCES "public"."workspace_memberships"("workspace_id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_submission_grants" ADD CONSTRAINT "job_submission_grants_posting_id_job_postings_id_fk" FOREIGN KEY ("posting_id") REFERENCES "public"."job_postings"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_submission_grants" ADD CONSTRAINT "job_submission_grants_membership_fkey" FOREIGN KEY ("workspace_id","user_id") REFERENCES "public"."workspace_memberships"("workspace_id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "job_documents_label_idx" ON "job_documents" USING btree ("workspace_id","user_id","label");