-- JOB-101: only GPT-6.2 Sol/Astra remain selectable. Keep legacy member values
-- accepted for rolling deployment/rollback, but new rows default to 6.2.
-- Request, lookup and completed feedback history retain the model that ran.
ALTER TABLE trip_ai_settings
  DROP CONSTRAINT trip_ai_settings_member_model_check,
  ADD CONSTRAINT trip_ai_settings_member_model_check
    CHECK (member_model IN ('gpt-5.6-sol', 'gpt-6.1-sol', 'gpt-6.2-sol')),
  ALTER COLUMN owner_default_model SET DEFAULT 'gpt-6.2-sol',
  ALTER COLUMN member_model SET DEFAULT 'gpt-6.2-sol';

UPDATE trip_ai_settings
   SET member_model = 'gpt-6.2-sol',
       owner_default_model = CASE owner_default_model
         WHEN 'gpt-6.1-sol' THEN 'gpt-6.2-sol'
         WHEN 'gpt-6-astra' THEN 'gpt-6.2-astra'
         WHEN 'gpt-6.1-terra' THEN 'gpt-6.2-sol'
         WHEN 'gpt-6-luna' THEN 'gpt-6.2-sol'
         ELSE owner_default_model
       END;

ALTER TABLE account_ai_lookups
  ALTER COLUMN requested_model SET DEFAULT 'gpt-6.2-sol';

ALTER TABLE feedback_triage_runs
  DROP CONSTRAINT feedback_triage_runs_model_check,
  ADD CONSTRAINT feedback_triage_runs_model_check
    CHECK (model IN ('gpt-6-astra', 'gpt-6.2-astra')),
  ALTER COLUMN model SET DEFAULT 'gpt-6.2-astra';

-- Move the selected and verified IDs together, including an in-flight automatic
-- check's ID. Preserve enabled/opt-out flags, efforts and original check times.
-- Advance the revision so a pre-migration preferences form cannot overwrite it.
UPDATE account_ai_preferences
   SET routine_model = CASE routine_model
         WHEN 'gpt-6.1-sol' THEN 'gpt-6.2-sol'
         WHEN 'gpt-6-astra' THEN 'gpt-6.2-astra'
         WHEN 'gpt-6.1-terra' THEN 'gpt-6.2-sol'
         WHEN 'gpt-6-luna' THEN 'gpt-6.2-sol'
         ELSE routine_model
       END,
       routine_verified_model = CASE routine_verified_model
         WHEN 'gpt-6.1-sol' THEN 'gpt-6.2-sol'
         WHEN 'gpt-6-astra' THEN 'gpt-6.2-astra'
         WHEN 'gpt-6.1-terra' THEN 'gpt-6.2-sol'
         WHEN 'gpt-6-luna' THEN 'gpt-6.2-sol'
         ELSE routine_verified_model
       END,
       routine_check_model = CASE routine_check_model
         WHEN 'gpt-6.1-sol' THEN 'gpt-6.2-sol'
         WHEN 'gpt-6-astra' THEN 'gpt-6.2-astra'
         WHEN 'gpt-6.1-terra' THEN 'gpt-6.2-sol'
         WHEN 'gpt-6-luna' THEN 'gpt-6.2-sol'
         ELSE routine_check_model
       END,
       revision = revision + 1,
       updated_at = CURRENT_TIMESTAMP
 WHERE routine_model IN ('gpt-6.1-sol', 'gpt-6-astra', 'gpt-6.1-terra', 'gpt-6-luna')
    OR routine_verified_model IN ('gpt-6.1-sol', 'gpt-6-astra', 'gpt-6.1-terra', 'gpt-6-luna')
    OR routine_check_model IN ('gpt-6.1-sol', 'gpt-6-astra', 'gpt-6.1-terra', 'gpt-6-luna');
