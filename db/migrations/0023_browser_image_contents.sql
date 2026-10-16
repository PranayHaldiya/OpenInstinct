CREATE TABLE "browser_image_contents" (
	"storage_pathname" text PRIMARY KEY NOT NULL,
	"artifact_id" uuid NOT NULL,
	"content_hash" text NOT NULL,
	"content" "bytea" NOT NULL,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "browser_image_contents" ADD CONSTRAINT "browser_image_contents_artifact_fkey" FOREIGN KEY ("artifact_id") REFERENCES "public"."browser_image_artifacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "browser_image_contents_artifact_idx" ON "browser_image_contents" USING btree ("artifact_id");