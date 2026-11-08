-- JOB-093 and JOB-094 (D-105, D-106): account AI preferences, routine checks paid by a trip member's own
-- key, web search counts for usage estimates, and destination lookups on the user's key or a free model.

-- One row per account. Effort values are the levels every registered paid model accepts. Routine checks
-- are on only after the chosen model passed a web search check on the account's key; the application
-- validates model IDs against its registry, so the database bounds only their shape.
CREATE TABLE account_ai_preferences (
  user_id uuid PRIMARY KEY REFERENCES app_users (id) ON DELETE CASCADE,
  chat_effort text CHECK (chat_effort IS NULL OR chat_effort IN ('low', 'medium', 'high')),
  routine_enabled boolean NOT NULL DEFAULT false,
  routine_model text CHECK (routine_model IS NULL OR length(btrim(routine_model)) BETWEEN 1 AND 160),
  routine_effort text NOT NULL DEFAULT 'medium' CHECK (routine_effort IN ('low', 'medium', 'high')),
  routine_verified_model text CHECK (routine_verified_model IS NULL OR length(btrim(routine_verified_model)) BETWEEN 1 AND 160),
  routine_verified_at timestamptz,
  routine_enabled_at timestamptz,
  revision integer NOT NULL DEFAULT 1 CHECK (revision >= 1),
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT account_ai_preferences_routine_ck CHECK (
    NOT routine_enabled OR (routine_model IS NOT NULL AND routine_verified_model = routine_model
      AND routine_verified_at IS NOT NULL AND routine_enabled_at IS NOT NULL))
);

COMMENT ON TABLE account_ai_preferences IS
  'Per-account AI effort and routine-check choices (JOB-094). Holds no keys; keys stay in user_ai_credentials.';

-- A routine check is a system request with no member or user actor. When a member's own key pays for
-- it, the paying member is recorded here, so usage and audits can name whose key was used.
ALTER TABLE ai_requests
  ADD COLUMN credential_member_id uuid,
  ADD COLUMN web_search_count integer CHECK (web_search_count IS NULL OR web_search_count BETWEEN 0 AND 10000),
  ADD CONSTRAINT ai_requests_credential_member_fk
    FOREIGN KEY (trip_id, credential_member_id) REFERENCES trip_members (trip_id, id),
  ADD CONSTRAINT ai_requests_credential_member_ck
    CHECK ((credential_member_id IS NOT NULL) = (initiator_kind = 'system' AND credential_source IS NOT DISTINCT FROM 'own'));

CREATE INDEX ai_requests_credential_member_idx
  ON ai_requests (trip_id, credential_member_id, created_at) WHERE credential_member_id IS NOT NULL;

-- Destination lookups may run on the requester's own key or a free model instead of only the operator's
-- OpenAI key. Existing rows keep NULL, which means the operator paid.
ALTER TABLE account_ai_lookups
  DROP CONSTRAINT account_ai_lookups_requested_model_check,
  DROP CONSTRAINT account_ai_lookups_effective_model_check,
  DROP CONSTRAINT account_ai_lookups_provider_check,
  DROP CONSTRAINT account_ai_lookups_transport_check,
  DROP CONSTRAINT account_ai_lookups_authentication_mode_ck,
  ADD COLUMN credential_source text CHECK (credential_source IS NULL OR credential_source IN ('operator', 'own', 'free')),
  ADD CONSTRAINT account_ai_lookups_requested_model_check
    CHECK (length(btrim(requested_model)) BETWEEN 1 AND 160),
  ADD CONSTRAINT account_ai_lookups_effective_model_check
    CHECK (effective_model IS NULL OR length(btrim(effective_model)) BETWEEN 1 AND 160),
  ADD CONSTRAINT account_ai_lookups_provider_check
    CHECK (provider IN ('openai', 'anthropic', 'google', 'kilo')),
  ADD CONSTRAINT account_ai_lookups_transport_check
    CHECK (transport IN ('codex_sdk', 'claude_agent_sdk', 'gemini_api', 'kilo_gateway')),
  ADD CONSTRAINT account_ai_lookups_authentication_mode_ck
    CHECK (authentication_mode IN ('chatgpt_subscription', 'api_key', 'anonymous'));

CREATE INDEX account_ai_lookups_free_created_idx ON account_ai_lookups (created_at) WHERE credential_source = 'free';
