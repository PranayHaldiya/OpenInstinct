CREATE TABLE "telegram_links" (
	"user_id" text PRIMARY KEY NOT NULL,
	"telegram_user_id" text,
	"link_code_hash" text,
	"link_code_expires_at" timestamp (3) with time zone,
	"linked_at" timestamp (3) with time zone,
	CONSTRAINT "telegram_links_telegram_user_id_unique" UNIQUE("telegram_user_id"),
	CONSTRAINT "telegram_links_link_code_hash_unique" UNIQUE("link_code_hash")
);
--> statement-breakpoint
ALTER TABLE "telegram_links" ADD CONSTRAINT "telegram_links_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;