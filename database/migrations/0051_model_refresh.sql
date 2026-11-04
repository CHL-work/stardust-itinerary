-- JOB-053: move current selections to the newest provider models. Audit rows keep
-- the model that actually ran, so ai_requests is untouched and account lookups
-- continue to accept their historical identifier. The previous sealed release
-- still inserts the old literal, so the checks accept both during activation.
ALTER TABLE trip_ai_settings
  DROP CONSTRAINT trip_ai_settings_member_model_check,
  ADD CONSTRAINT trip_ai_settings_member_model_check
    CHECK (member_model IN ('gpt-5.6-sol', 'gpt-6.1-sol')),
  ALTER COLUMN owner_default_model SET DEFAULT 'gpt-6.1-sol',
  ALTER COLUMN member_model SET DEFAULT 'gpt-6.1-sol';

UPDATE trip_ai_settings
   SET member_model = 'gpt-6.1-sol',
       owner_default_model = CASE owner_default_model
         WHEN 'gpt-5.6-sol' THEN 'gpt-6.1-sol'
         WHEN 'gpt-5.6-terra' THEN 'gpt-6.1-terra'
         WHEN 'gpt-5.6-luna' THEN 'gpt-6-luna'
         WHEN 'claude-haiku-4-5' THEN 'claude-haiku-5-5'
         WHEN 'claude-sonnet-5' THEN 'claude-sonnet-5-5'
         WHEN 'claude-opus-5' THEN 'claude-opus-5-5'
         WHEN 'claude-fable-5' THEN 'claude-fable-5-1'
         ELSE owner_default_model
       END;

ALTER TABLE account_ai_lookups
  DROP CONSTRAINT account_ai_lookups_requested_model_check,
  DROP CONSTRAINT account_ai_lookups_effective_model_check,
  ADD CONSTRAINT account_ai_lookups_requested_model_check
    CHECK (requested_model IN ('gpt-5.6-sol', 'gpt-6.1-sol')),
  ADD CONSTRAINT account_ai_lookups_effective_model_check
    CHECK (effective_model IN ('gpt-5.6-sol', 'gpt-6.1-sol')),
  ALTER COLUMN requested_model SET DEFAULT 'gpt-6.1-sol';
