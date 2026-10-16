ALTER TABLE "hub_users" ADD COLUMN "country" text;
--> statement-breakpoint
-- Job screens now record the languages the work needs. Screens without them
-- are cleared so the next ingest reads those postings again; a user VM's
-- cache refills from the hub.
UPDATE "job_postings" SET "screen" = NULL, "screened_at" = NULL
WHERE "screen" IS NOT NULL AND NOT ("screen" ? 'languages');
