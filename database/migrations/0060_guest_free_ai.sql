-- Free guest AI (JOB-071, D-086): a request paid by nobody, on a keyless free model, is recorded
-- with credential_source 'free'. 0054 created the check without a name, so it is found and replaced.
DO $$
DECLARE
  item record;
  found integer := 0;
BEGIN
  FOR item IN
    SELECT con.conname FROM pg_catalog.pg_constraint con
     WHERE con.conrelid = 'public.ai_requests'::regclass AND con.contype = 'c'
       AND pg_catalog.pg_get_constraintdef(con.oid) LIKE '%credential_source%'
       AND pg_catalog.pg_get_constraintdef(con.oid) NOT LIKE '%credential_sponsor_member_id%'
  LOOP
    EXECUTE format('ALTER TABLE public.ai_requests DROP CONSTRAINT %I', item.conname);
    found := found + 1;
  END LOOP;
  IF found <> 1 THEN
    RAISE EXCEPTION 'expected exactly one credential_source check on ai_requests, found %', found;
  END IF;
END $$;

ALTER TABLE ai_requests
  ADD CONSTRAINT ai_requests_credential_source_ck
    CHECK (credential_source IN ('operator', 'own', 'shared', 'free'));

-- Free requests are counted per guest and for the whole instance.
CREATE INDEX ai_requests_free_created_idx ON ai_requests (created_at) WHERE credential_source = 'free';
