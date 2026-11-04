ALTER TABLE itinerary_items
  ADD COLUMN notes text,
  ADD COLUMN estimated_cost_minor bigint CHECK (estimated_cost_minor IS NULL OR estimated_cost_minor >= 0),
  ADD COLUMN cost_currency text CHECK (cost_currency IS NULL OR cost_currency ~ '^[A-Z]{3}$');

CREATE TABLE change_requests (
  trip_id uuid NOT NULL REFERENCES trips (id) ON DELETE CASCADE,
  id uuid NOT NULL,
  requested_by_member_id uuid NOT NULL,
  source text NOT NULL CHECK (source IN ('member', 'owner', 'ai', 'import')),
  entity_type text NOT NULL CHECK (entity_type IN ('itinerary_item', 'expense')),
  entity_id uuid,
  operation text NOT NULL CHECK (operation IN ('create', 'update', 'cancel', 'restore', 'void')),
  base_revision integer CHECK (base_revision IS NULL OR base_revision >= 1),
  proposed_patch jsonb NOT NULL CHECK (jsonb_typeof(proposed_patch) = 'object'),
  reason text NOT NULL CHECK (length(btrim(reason)) BETWEEN 1 AND 1000),
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'rejected', 'superseded')),
  reviewed_by_member_id uuid,
  review_note text,
  applied_revision integer CHECK (applied_revision IS NULL OR applied_revision >= 1),
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  reviewed_at timestamptz,
  PRIMARY KEY (trip_id, id),
  FOREIGN KEY (trip_id, requested_by_member_id)
    REFERENCES trip_members (trip_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (trip_id, reviewed_by_member_id)
    REFERENCES trip_members (trip_id, id) ON DELETE RESTRICT,
  CHECK (
    (status = 'pending' AND reviewed_by_member_id IS NULL AND reviewed_at IS NULL)
    OR
    (status <> 'pending' AND reviewed_by_member_id IS NOT NULL AND reviewed_at IS NOT NULL)
  )
);

CREATE INDEX change_requests_trip_status_idx
  ON change_requests (trip_id, status, created_at DESC);

CREATE TABLE trip_ai_settings (
  trip_id uuid PRIMARY KEY REFERENCES trips (id) ON DELETE CASCADE,
  enabled boolean NOT NULL DEFAULT true,
  owner_default_model text NOT NULL DEFAULT 'gpt-5.6-sol'
    CHECK (length(btrim(owner_default_model)) BETWEEN 1 AND 160),
  member_model text NOT NULL DEFAULT 'gpt-5.6-sol'
    CHECK (member_model = 'gpt-5.6-sol'),
  member_daily_limit integer NOT NULL DEFAULT 10 CHECK (member_daily_limit = 10),
  updated_by_member_id uuid NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (trip_id, updated_by_member_id)
    REFERENCES trip_members (trip_id, id) ON DELETE RESTRICT
);

CREATE TABLE ai_requests (
  trip_id uuid NOT NULL REFERENCES trips (id) ON DELETE CASCADE,
  id uuid NOT NULL,
  actor_member_id uuid NOT NULL,
  actor_role text NOT NULL CHECK (actor_role IN ('owner', 'editor', 'viewer')),
  feature text NOT NULL DEFAULT 'planning' CHECK (length(btrim(feature)) BETWEEN 1 AND 80),
  prompt_text text NOT NULL CHECK (length(btrim(prompt_text)) BETWEEN 1 AND 8000),
  result_text text,
  requested_model text NOT NULL CHECK (length(btrim(requested_model)) BETWEEN 1 AND 160),
  effective_model text,
  provider text NOT NULL DEFAULT 'openai',
  transport text NOT NULL DEFAULT 'codex_sdk',
  authentication_mode text NOT NULL DEFAULT 'chatgpt_subscription',
  billing_basis text NOT NULL DEFAULT 'subscription',
  status text NOT NULL DEFAULT 'started'
    CHECK (status IN ('started', 'succeeded', 'failed', 'rejected')),
  proposal_id uuid,
  input_tokens integer CHECK (input_tokens IS NULL OR input_tokens >= 0),
  output_tokens integer CHECK (output_tokens IS NULL OR output_tokens >= 0),
  cached_input_tokens integer CHECK (cached_input_tokens IS NULL OR cached_input_tokens >= 0),
  latency_ms integer CHECK (latency_ms IS NULL OR latency_ms >= 0),
  provider_request_id text,
  error_code text,
  error_message text,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at timestamptz,
  PRIMARY KEY (trip_id, id),
  FOREIGN KEY (trip_id, actor_member_id)
    REFERENCES trip_members (trip_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (trip_id, proposal_id)
    REFERENCES change_requests (trip_id, id) ON DELETE SET NULL (proposal_id),
  CHECK (completed_at IS NULL OR completed_at >= created_at)
);

CREATE INDEX ai_requests_actor_day_idx
  ON ai_requests (trip_id, actor_member_id, created_at DESC);

CREATE TABLE ai_request_events (
  trip_id uuid NOT NULL,
  ai_request_id uuid NOT NULL,
  sequence integer NOT NULL CHECK (sequence >= 1),
  event_type text NOT NULL CHECK (length(btrim(event_type)) BETWEEN 1 AND 120),
  payload jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(payload) = 'object'),
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (trip_id, ai_request_id, sequence),
  FOREIGN KEY (trip_id, ai_request_id)
    REFERENCES ai_requests (trip_id, id) ON DELETE CASCADE
);

CREATE TRIGGER ai_request_events_append_only
BEFORE UPDATE OR DELETE ON ai_request_events
FOR EACH ROW EXECUTE FUNCTION app_reject_append_only_mutation();

INSERT INTO trip_ai_settings (trip_id, updated_by_member_id)
SELECT t.id, tm.id
  FROM trips t
  JOIN trip_members tm
    ON tm.trip_id = t.id
   AND tm.user_id = t.owner_user_id
   AND tm.role = 'owner'
ON CONFLICT (trip_id) DO NOTHING;
