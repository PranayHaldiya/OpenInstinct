CREATE TABLE "hub_pending_updates" (
	"id" serial PRIMARY KEY NOT NULL,
	"telegram_user_id" text NOT NULL,
	"update" jsonb NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hub_users" (
	"telegram_user_id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"agent_id" text,
	"public_url" text,
	"forward_secret" text NOT NULL,
	"status" text NOT NULL,
	"last_error" text,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "hub_users_status_check" CHECK ("hub_users"."status" IN ('provisioning', 'ready', 'failed'))
);
--> statement-breakpoint
CREATE INDEX "hub_pending_updates_user_idx" ON "hub_pending_updates" USING btree ("telegram_user_id");--> statement-breakpoint
CREATE INDEX "hub_users_status_idx" ON "hub_users" USING btree ("status");