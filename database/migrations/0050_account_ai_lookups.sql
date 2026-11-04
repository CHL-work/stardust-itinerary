-- Pre-trip destination suggestions belong to the account, never to an existing
-- trip. In particular, another trip's owner must not see these in trip logs.
CREATE TABLE account_ai_lookups (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES app_users (id) ON DELETE RESTRICT,
  feature text NOT NULL DEFAULT 'trip_destination_defaults' CHECK (feature = 'trip_destination_defaults'),
  client_request_id uuid NOT NULL,
  request_payload_hash bytea NOT NULL CHECK (octet_length(request_payload_hash) = 32),
  input_hash bytea NOT NULL CHECK (octet_length(input_hash) = 32),
  destination_text text NOT NULL CHECK (char_length(btrim(destination_text)) BETWEEN 2 AND 160),
  display_locale text NOT NULL CHECK (display_locale IN ('en','zh-HK','zh-HK-lihkg','ja-JP')),
  prompt_version smallint NOT NULL CHECK (prompt_version >= 1),
  entitlement text NOT NULL CHECK (entitlement IN ('platform_operator','trip_creator')),
  requested_model text NOT NULL DEFAULT 'gpt-5.6-sol' CHECK (requested_model = 'gpt-5.6-sol'),
  effective_model text CHECK (effective_model = 'gpt-5.6-sol'),
  provider text NOT NULL DEFAULT 'openai' CHECK (provider = 'openai'),
  transport text NOT NULL DEFAULT 'codex_sdk' CHECK (transport = 'codex_sdk'),
  authentication_mode text NOT NULL DEFAULT 'chatgpt_subscription' CHECK (authentication_mode = 'chatgpt_subscription'),
  status text NOT NULL DEFAULT 'started' CHECK (status IN ('started','succeeded','failed')),
  -- Validated server labels and the complete country zone set are larger than
  -- the provider's separately enforced 4 KiB raw-response limit.
  response_json jsonb CHECK (jsonb_typeof(response_json) = 'object' AND octet_length(response_json::text) <= 16384),
  input_tokens integer CHECK (input_tokens >= 0),
  output_tokens integer CHECK (output_tokens >= 0),
  cached_input_tokens integer CHECK (cached_input_tokens >= 0),
  latency_ms integer CHECK (latency_ms >= 0),
  error_code text CHECK (error_code IN ('TIMEOUT','PROVIDER_UNAVAILABLE','INVALID_OUTPUT','TOOL_BLOCKED','AUTH_CHANGED')),
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at timestamptz,
  UNIQUE (user_id,client_request_id),
  CHECK ((status = 'started') = (completed_at IS NULL)),
  CHECK (completed_at IS NULL OR completed_at >= created_at),
  CHECK ((status = 'succeeded') = (response_json IS NOT NULL)),
  CHECK ((status = 'failed') = (error_code IS NOT NULL)),
  CHECK (status <> 'started' OR (effective_model IS NULL AND input_tokens IS NULL
    AND output_tokens IS NULL AND cached_input_tokens IS NULL AND latency_ms IS NULL))
);

CREATE INDEX account_ai_lookups_user_created_idx ON account_ai_lookups(user_id,created_at DESC);
CREATE INDEX account_ai_lookups_cache_idx ON account_ai_lookups(user_id,input_hash,prompt_version,created_at DESC)
  WHERE status = 'succeeded';

CREATE FUNCTION app_guard_account_ai_lookup() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Account AI lookup logs cannot be deleted' USING ERRCODE = '23514';
  END IF;
  IF OLD.status <> 'started' OR NEW.status NOT IN ('succeeded','failed') THEN
    RAISE EXCEPTION 'Account AI lookup can finish only once' USING ERRCODE = '23514';
  END IF;
  -- Compare every admission field, including future additions, rather than an
  -- easily incomplete hand-maintained list of identity and quota columns.
  IF (to_jsonb(NEW) - ARRAY['status','response_json','effective_model','input_tokens','output_tokens',
        'cached_input_tokens','latency_ms','error_code','completed_at'])
    IS DISTINCT FROM
     (to_jsonb(OLD) - ARRAY['status','response_json','effective_model','input_tokens','output_tokens',
        'cached_input_tokens','latency_ms','error_code','completed_at']) THEN
    RAISE EXCEPTION 'Account AI lookup admission fields are immutable' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER account_ai_lookups_finish_once BEFORE UPDATE OR DELETE ON account_ai_lookups
  FOR EACH ROW EXECUTE FUNCTION app_guard_account_ai_lookup();

COMMENT ON TABLE account_ai_lookups IS
  'Account-private, subscription-only destination lookup audit. No trip owner access, planning quota, or provider credentials. Started rows can be terminalized once; terminal rows are immutable.';
