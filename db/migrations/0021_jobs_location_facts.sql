-- Job screens now record facts (workplace, regions, employer type) instead of
-- a verdict for a candidate in India. Old screens are cleared so the next
-- ingest screens those postings again; a user VM's cache refills from the hub.
UPDATE "job_postings" SET "screen" = NULL, "screened_at" = NULL
WHERE "screen" IS NOT NULL AND NOT ("screen" ? 'workplace');
--> statement-breakpoint
-- Saved remote scopes become a home country and workplace choices.
UPDATE "job_preferences" SET "preferences" = ("preferences" - 'remoteScopes')
  || CASE WHEN "preferences"->'remoteScopes' ?| array['india', 'apac']
       THEN '{"country": "IN"}'::jsonb ELSE '{}'::jsonb END
  || CASE WHEN "preferences"->'remoteScopes' ? 'unclear'
       THEN '{"includeUnclearLocation": true}'::jsonb ELSE '{}'::jsonb END
  || CASE WHEN "preferences"->'remoteScopes' ? 'onsite'
       THEN '{"workplaces": ["remote", "hybrid", "onsite"]}'::jsonb ELSE '{}'::jsonb END
WHERE "preferences" ? 'remoteScopes';
