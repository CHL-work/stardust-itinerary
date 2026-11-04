CREATE TABLE audit_events (
  trip_id uuid NOT NULL REFERENCES trips (id) ON DELETE CASCADE,
  id uuid NOT NULL,
  actor_member_id uuid,
  entity_type text NOT NULL CHECK (length(btrim(entity_type)) BETWEEN 1 AND 80),
  entity_id uuid,
  action text NOT NULL CHECK (length(btrim(action)) BETWEEN 1 AND 80),
  before_state jsonb CHECK (before_state IS NULL OR jsonb_typeof(before_state) = 'object'),
  after_state jsonb CHECK (after_state IS NULL OR jsonb_typeof(after_state) = 'object'),
  request_id text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (trip_id, id),
  FOREIGN KEY (trip_id, actor_member_id)
    REFERENCES trip_members (trip_id, id) ON DELETE SET NULL (actor_member_id)
);

CREATE INDEX audit_events_entity_idx
  ON audit_events (trip_id, entity_type, entity_id, created_at DESC);

CREATE TABLE outbox_events (
  trip_id uuid NOT NULL REFERENCES trips (id) ON DELETE CASCADE,
  id uuid NOT NULL,
  topic text NOT NULL CHECK (length(btrim(topic)) BETWEEN 1 AND 120),
  aggregate_type text NOT NULL CHECK (length(btrim(aggregate_type)) BETWEEN 1 AND 80),
  aggregate_id uuid NOT NULL,
  payload jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
  idempotency_key text NOT NULL CHECK (length(btrim(idempotency_key)) BETWEEN 1 AND 200),
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'processing', 'delivered', 'failed', 'cancelled')),
  available_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  delivered_at timestamptz,
  PRIMARY KEY (trip_id, id),
  UNIQUE (trip_id, idempotency_key),
  CHECK ((status = 'delivered') = (delivered_at IS NOT NULL))
);

CREATE INDEX outbox_events_pending_idx
  ON outbox_events (available_at, created_at)
  WHERE status IN ('pending', 'failed');

CREATE TABLE delivery_attempts (
  trip_id uuid NOT NULL,
  outbox_event_id uuid NOT NULL,
  attempt_number integer NOT NULL CHECK (attempt_number >= 1),
  provider text NOT NULL CHECK (length(btrim(provider)) BETWEEN 1 AND 80),
  status text NOT NULL CHECK (status IN ('started', 'succeeded', 'retryable', 'failed')),
  provider_request_id text,
  error_code text,
  response_metadata jsonb NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(response_metadata) = 'object'),
  started_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  finished_at timestamptz,
  PRIMARY KEY (trip_id, outbox_event_id, attempt_number),
  FOREIGN KEY (trip_id, outbox_event_id)
    REFERENCES outbox_events (trip_id, id) ON DELETE CASCADE,
  CHECK (finished_at IS NULL OR finished_at >= started_at)
);

CREATE FUNCTION app_reject_append_only_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION '% is append-only', TG_TABLE_NAME;
END;
$$;

CREATE TRIGGER audit_events_append_only
BEFORE UPDATE OR DELETE ON audit_events
FOR EACH ROW EXECUTE FUNCTION app_reject_append_only_mutation();

CREATE TRIGGER itinerary_revisions_append_only
BEFORE UPDATE OR DELETE ON itinerary_revisions
FOR EACH ROW EXECUTE FUNCTION app_reject_append_only_mutation();

CREATE TRIGGER preference_revisions_append_only
BEFORE UPDATE OR DELETE ON preference_revisions
FOR EACH ROW EXECUTE FUNCTION app_reject_append_only_mutation();

CREATE TRIGGER expense_revisions_append_only
BEFORE UPDATE OR DELETE ON expense_revisions
FOR EACH ROW EXECUTE FUNCTION app_reject_append_only_mutation();
