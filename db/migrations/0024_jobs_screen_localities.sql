-- Job screens now record the states or cities a remote role is limited to.
-- Screens of postings that seem to limit applicants are cleared so the next
-- ingest reads them again; a user VM's cache refills from the hub.
UPDATE "job_postings" SET "screen" = NULL, "screened_at" = NULL
WHERE "screen" IS NOT NULL
  AND "description" ~* '(candidates|residents|applicants) only|only (candidates|residents|applicants) (from|in|based)';
