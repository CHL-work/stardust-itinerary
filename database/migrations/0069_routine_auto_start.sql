-- JOB-096 (D-108): routine checks turn on by themselves when a member saves a key that passes the web search
-- check, unless the member turned them off. The latest automatic check is recorded so the AI tab can show it
-- running or failed, two web servers never run it twice, and a failed key is not retried until it is saved again.
ALTER TABLE account_ai_preferences
  ADD COLUMN routine_opted_out boolean NOT NULL DEFAULT false,
  ADD COLUMN routine_check_model text
    CHECK (routine_check_model IS NULL OR length(btrim(routine_check_model)) BETWEEN 1 AND 160),
  ADD COLUMN routine_check_at timestamptz,
  ADD COLUMN routine_check_result text
    CHECK (routine_check_result IS NULL OR routine_check_result IN ('ok', 'no_search', 'auth', 'provider')),
  ADD CONSTRAINT account_ai_preferences_check_ck CHECK (
    (routine_check_model IS NULL) = (routine_check_at IS NULL)
    AND (routine_check_result IS NULL OR routine_check_at IS NOT NULL));

COMMENT ON COLUMN account_ai_preferences.routine_opted_out IS
  'The member turned routine checks off; saving a key then leaves them off (JOB-096).';
COMMENT ON COLUMN account_ai_preferences.routine_check_at IS
  'When the latest web search check of routine_check_model started; routine_check_result is NULL while it runs.';
