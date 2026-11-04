-- Feedback issues go to a private repository whose name is configured (JOB-066), not the public
-- source repository that migration 0044 wrote into its checks. A receipt must still be a GitHub
-- issue URL whose number matches the stored issue number. The publisher confirms with GitHub that
-- the repository is private before it delivers anything.
DO $$
DECLARE
  check_name text;
BEGIN
  FOR check_name IN
    SELECT con.conname
      FROM pg_catalog.pg_constraint con
     WHERE con.conrelid = 'public.feedback_issue_outbox'::regclass
       AND con.contype = 'c'
       AND pg_catalog.pg_get_constraintdef(con.oid) LIKE '%CHL-work/stardust-itinerary%'
  LOOP
    EXECUTE format('ALTER TABLE public.feedback_issue_outbox DROP CONSTRAINT %I', check_name);
  END LOOP;
END
$$;

ALTER TABLE feedback_issue_outbox
  ADD CONSTRAINT feedback_issue_outbox_issue_url_format
    CHECK (issue_url ~ '^https://github[.]com/[A-Za-z0-9][A-Za-z0-9-]{0,38}/[A-Za-z0-9._-]{1,100}/issues/[1-9][0-9]*$'),
  ADD CONSTRAINT feedback_issue_outbox_published_receipt
    CHECK (state <> 'published'
      OR (issue_number IS NOT NULL AND issue_url IS NOT NULL AND issue_url LIKE ('%/issues/' || issue_number::text)));
