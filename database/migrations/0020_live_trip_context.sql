-- Cached deterministic weather and source-backed disruption monitoring.

CREATE TABLE event_weather_forecasts (
  trip_id uuid NOT NULL,
  itinerary_item_id uuid NOT NULL,
  item_revision integer NOT NULL CHECK (item_revision >= 1),
  forecast_at timestamptz NOT NULL,
  location_key text NOT NULL CHECK (length(location_key) BETWEEN 1 AND 300),
  location_label text NOT NULL CHECK (length(btrim(location_label)) BETWEEN 1 AND 300),
  location_precision text NOT NULL
    CHECK (location_precision IN ('event', 'trip_destination')),
  latitude double precision NOT NULL CHECK (latitude BETWEEN -90 AND 90),
  longitude double precision NOT NULL CHECK (longitude BETWEEN -180 AND 180),
  provider_location_id bigint,
  provider_location_name text,
  provider text NOT NULL CHECK (provider = 'open-meteo'),
  weather_code integer NOT NULL CHECK (weather_code BETWEEN 0 AND 999),
  condition_key text NOT NULL CHECK (length(btrim(condition_key)) BETWEEN 1 AND 80),
  icon_key text NOT NULL CHECK (length(btrim(icon_key)) BETWEEN 1 AND 80),
  is_day boolean NOT NULL,
  temperature_celsius numeric(6,2),
  apparent_temperature_celsius numeric(6,2),
  precipitation_probability_percent integer
    CHECK (precipitation_probability_percent BETWEEN 0 AND 100),
  sampled_at timestamptz NOT NULL,
  fetched_at timestamptz NOT NULL,
  stale_after timestamptz NOT NULL,
  PRIMARY KEY (trip_id, itinerary_item_id),
  FOREIGN KEY (trip_id, itinerary_item_id)
    REFERENCES itinerary_items (trip_id, id) ON DELETE CASCADE,
  CHECK (stale_after > fetched_at)
);

CREATE INDEX event_weather_forecasts_freshness_idx
  ON event_weather_forecasts (trip_id, stale_after, forecast_at);

CREATE TABLE weather_refresh_runs (
  trip_id uuid NOT NULL REFERENCES trips (id) ON DELETE CASCADE,
  id uuid NOT NULL,
  requested_by_member_id uuid,
  status text NOT NULL CHECK (status IN ('succeeded', 'partial', 'failed')),
  candidate_count integer NOT NULL DEFAULT 0 CHECK (candidate_count >= 0),
  cache_hit_count integer NOT NULL DEFAULT 0 CHECK (cache_hit_count >= 0),
  refreshed_count integer NOT NULL DEFAULT 0 CHECK (refreshed_count >= 0),
  destination_fallback_count integer NOT NULL DEFAULT 0 CHECK (destination_fallback_count >= 0),
  failed_count integer NOT NULL DEFAULT 0 CHECK (failed_count >= 0),
  error_code text,
  started_at timestamptz NOT NULL,
  completed_at timestamptz NOT NULL,
  PRIMARY KEY (trip_id, id),
  FOREIGN KEY (trip_id, requested_by_member_id)
    REFERENCES trip_members (trip_id, id) ON DELETE SET NULL (requested_by_member_id),
  CHECK (completed_at >= started_at)
);

CREATE INDEX weather_refresh_runs_trip_time_idx
  ON weather_refresh_runs (trip_id, started_at DESC);

CREATE TRIGGER weather_refresh_runs_append_only
BEFORE UPDATE OR DELETE ON weather_refresh_runs
FOR EACH ROW EXECUTE FUNCTION app_reject_append_only_mutation();

ALTER TABLE ai_requests
  ADD COLUMN initiator_kind text NOT NULL DEFAULT 'member'
    CHECK (initiator_kind IN ('member', 'system'));

ALTER TABLE ai_requests
  DROP CONSTRAINT ai_requests_actor_role_check,
  ALTER COLUMN actor_member_id DROP NOT NULL,
  ADD CONSTRAINT ai_requests_actor_role_check
    CHECK (actor_role IN ('owner', 'editor', 'viewer', 'system')),
  ADD CONSTRAINT ai_requests_initiator_shape_ck
    CHECK (
      (initiator_kind = 'member'
        AND actor_member_id IS NOT NULL
        AND actor_role IN ('owner', 'editor', 'viewer'))
      OR
      (initiator_kind = 'system'
        AND actor_member_id IS NULL
        AND actor_user_id IS NULL
        AND conversation_id IS NULL
        AND actor_role = 'system')
    );

CREATE TABLE trip_disruption_settings (
  trip_id uuid PRIMARY KEY REFERENCES trips (id) ON DELETE CASCADE,
  enabled boolean NOT NULL DEFAULT true,
  interval_minutes integer NOT NULL DEFAULT 30
    CHECK (interval_minutes BETWEEN 15 AND 1440),
  lookahead_hours integer NOT NULL DEFAULT 168
    CHECK (lookahead_hours BETWEEN 1 AND 168),
  next_due_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_attempt_at timestamptz,
  last_success_at timestamptz,
  last_error_code text,
  updated_by_member_id uuid NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (trip_id, updated_by_member_id)
    REFERENCES trip_members (trip_id, id) ON DELETE RESTRICT
);

INSERT INTO trip_disruption_settings (trip_id, updated_by_member_id)
SELECT t.id, tm.id
  FROM trips t
  JOIN trip_members tm
    ON tm.trip_id = t.id
   AND tm.user_id = t.owner_user_id
   AND tm.role = 'owner'
ON CONFLICT (trip_id) DO NOTHING;

CREATE INDEX trip_disruption_settings_due_idx
  ON trip_disruption_settings (next_due_at, trip_id)
  WHERE enabled;

CREATE TABLE disruption_monitor_runs (
  trip_id uuid NOT NULL REFERENCES trips (id) ON DELETE CASCADE,
  id uuid NOT NULL,
  scheduled_for timestamptz NOT NULL,
  status text NOT NULL
    CHECK (status IN ('running', 'succeeded', 'failed', 'skipped')),
  candidate_count integer NOT NULL DEFAULT 0 CHECK (candidate_count >= 0),
  web_search_count integer NOT NULL DEFAULT 0 CHECK (web_search_count >= 0),
  ai_request_id uuid,
  error_code text,
  started_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at timestamptz,
  PRIMARY KEY (trip_id, id),
  UNIQUE (trip_id, scheduled_for),
  FOREIGN KEY (trip_id, ai_request_id)
    REFERENCES ai_requests (trip_id, id) ON DELETE SET NULL (ai_request_id),
  CHECK (completed_at IS NULL OR completed_at >= started_at),
  CHECK ((status = 'running') = (completed_at IS NULL))
);

CREATE INDEX disruption_monitor_runs_trip_time_idx
  ON disruption_monitor_runs (trip_id, scheduled_for DESC);

CREATE TABLE event_disruption_observations (
  trip_id uuid NOT NULL,
  id uuid NOT NULL,
  itinerary_item_id uuid NOT NULL,
  monitor_run_id uuid NOT NULL,
  item_revision integer NOT NULL CHECK (item_revision >= 1),
  state text NOT NULL CHECK (state IN ('possible', 'confirmed', 'resolved')),
  reason_code text NOT NULL CHECK (reason_code IN (
    'cancellation', 'closure', 'delay', 'transit_disruption',
    'road_disruption', 'weather', 'hours_change', 'strike',
    'access_change', 'other'
  )),
  severity text NOT NULL CHECK (severity IN ('info', 'warning', 'critical')),
  detail text NOT NULL CHECK (length(btrim(detail)) BETWEEN 1 AND 2000),
  source_urls jsonb NOT NULL DEFAULT '[]'::jsonb
    CHECK (jsonb_typeof(source_urls) = 'array'),
  evidence_fingerprint text NOT NULL CHECK (evidence_fingerprint ~ '^[0-9a-f]{64}$'),
  affected_from timestamptz,
  affected_until timestamptz,
  observed_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  valid_until timestamptz NOT NULL,
  PRIMARY KEY (trip_id, id),
  FOREIGN KEY (trip_id, itinerary_item_id)
    REFERENCES itinerary_items (trip_id, id) ON DELETE CASCADE,
  FOREIGN KEY (trip_id, monitor_run_id)
    REFERENCES disruption_monitor_runs (trip_id, id) ON DELETE CASCADE,
  CHECK (affected_until IS NULL OR affected_from IS NULL OR affected_until >= affected_from),
  CHECK (valid_until > observed_at)
);

CREATE INDEX event_disruption_observations_item_idx
  ON event_disruption_observations (trip_id, itinerary_item_id, observed_at DESC);

CREATE TRIGGER event_disruption_observations_append_only
BEFORE UPDATE OR DELETE ON event_disruption_observations
FOR EACH ROW EXECUTE FUNCTION app_reject_append_only_mutation();

CREATE TABLE event_disruption_current (
  trip_id uuid NOT NULL,
  itinerary_item_id uuid NOT NULL,
  observation_id uuid NOT NULL,
  item_revision integer NOT NULL CHECK (item_revision >= 1),
  state text NOT NULL CHECK (state IN ('possible', 'confirmed', 'resolved')),
  reason_code text NOT NULL CHECK (reason_code IN (
    'cancellation', 'closure', 'delay', 'transit_disruption',
    'road_disruption', 'weather', 'hours_change', 'strike',
    'access_change', 'other'
  )),
  severity text NOT NULL CHECK (severity IN ('info', 'warning', 'critical')),
  detail text NOT NULL CHECK (length(btrim(detail)) BETWEEN 1 AND 2000),
  source_urls jsonb NOT NULL DEFAULT '[]'::jsonb
    CHECK (jsonb_typeof(source_urls) = 'array'),
  evidence_fingerprint text NOT NULL CHECK (evidence_fingerprint ~ '^[0-9a-f]{64}$'),
  first_seen_at timestamptz NOT NULL,
  last_seen_at timestamptz NOT NULL,
  checked_at timestamptz NOT NULL,
  stale_after timestamptz NOT NULL,
  PRIMARY KEY (trip_id, itinerary_item_id),
  FOREIGN KEY (trip_id, itinerary_item_id)
    REFERENCES itinerary_items (trip_id, id) ON DELETE CASCADE,
  FOREIGN KEY (trip_id, observation_id)
    REFERENCES event_disruption_observations (trip_id, id) ON DELETE CASCADE,
  CHECK (last_seen_at >= first_seen_at),
  CHECK (stale_after > checked_at)
);

CREATE INDEX event_disruption_current_active_idx
  ON event_disruption_current (trip_id, stale_after, severity)
  WHERE state IN ('possible', 'confirmed');
