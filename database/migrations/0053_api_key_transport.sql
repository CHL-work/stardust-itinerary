-- Model calls authenticate with provider API keys instead of interactive subscription logins.
-- New rows record that; historical rows keep the mode and billing basis they ran under.
ALTER TABLE ai_requests ALTER COLUMN authentication_mode SET DEFAULT 'api_key';
ALTER TABLE ai_requests ALTER COLUMN billing_basis SET DEFAULT 'api';

DO $$
DECLARE
  item record;
  found integer := 0;
BEGIN
  FOR item IN
    SELECT conname FROM pg_constraint
     WHERE conrelid = 'account_ai_lookups'::regclass AND contype = 'c'
       AND pg_get_constraintdef(oid) LIKE '%authentication_mode%'
  LOOP
    EXECUTE format('ALTER TABLE account_ai_lookups DROP CONSTRAINT %I', item.conname);
    found := found + 1;
  END LOOP;
  IF found <> 1 THEN
    RAISE EXCEPTION 'expected exactly one authentication_mode check on account_ai_lookups, found %', found;
  END IF;
END $$;

ALTER TABLE account_ai_lookups
  ADD CONSTRAINT account_ai_lookups_authentication_mode_ck
    CHECK (authentication_mode IN ('chatgpt_subscription', 'api_key')),
  ALTER COLUMN authentication_mode SET DEFAULT 'api_key';
