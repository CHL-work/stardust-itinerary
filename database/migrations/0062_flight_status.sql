-- JOB-083: scheduled flight status checks (D-095). Before departure the worker looks up each
-- trip-visible flight; a confirmed time change or cancellation updates the event, and a new
-- terminal or gate updates its flight details.

-- An automatic flight status update records its source instead of a member.
ALTER TABLE itinerary_revisions
  ADD COLUMN IF NOT EXISTS changed_by_source text NOT NULL DEFAULT 'member';
ALTER TABLE itinerary_revisions
  ALTER COLUMN changed_by_member_id DROP NOT NULL;
ALTER TABLE itinerary_revisions
  ADD CONSTRAINT itinerary_revisions_changed_by_source_ck
    CHECK (changed_by_source IN ('member', 'flight_status')),
  ADD CONSTRAINT itinerary_revisions_changed_by_shape_ck
    CHECK ((changed_by_source = 'member') = (changed_by_member_id IS NOT NULL));

-- One row per check: the event, the departure time it was planned from and the slot (minutes before
-- departure). A changed departure gives new slots, so the checks follow it.
CREATE TABLE flight_status_checks (
  trip_id uuid NOT NULL,
  itinerary_item_id uuid NOT NULL,
  departure_at timestamptz NOT NULL,
  slot_minutes integer NOT NULL CHECK (slot_minutes IN (1440, 720, 360, 300, 240, 180, 120, 60)),
  status text NOT NULL CHECK (status IN ('running', 'succeeded', 'failed')),
  outcome text CHECK (outcome IS NULL OR outcome IN ('unchanged', 'details', 'schedule', 'cancelled', 'unverified', 'stale')),
  ai_request_id uuid,
  error_code text CHECK (error_code IS NULL OR length(btrim(error_code)) BETWEEN 1 AND 80),
  started_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  lease_expires_at timestamptz NOT NULL,
  completed_at timestamptz,
  PRIMARY KEY (trip_id, itinerary_item_id, departure_at, slot_minutes),
  FOREIGN KEY (trip_id, itinerary_item_id) REFERENCES itinerary_items (trip_id, id) ON DELETE CASCADE,
  FOREIGN KEY (trip_id, ai_request_id) REFERENCES ai_requests (trip_id, id) ON DELETE SET NULL (ai_request_id),
  CHECK ((status = 'running') = (completed_at IS NULL)),
  CHECK (status <> 'succeeded' OR outcome IS NOT NULL)
);

CREATE INDEX flight_status_checks_running_idx
  ON flight_status_checks (lease_expires_at) WHERE status = 'running';

-- What an automatic update changed, append-only; event cards show the latest time change or
-- cancellation while the event still reflects it.
CREATE TABLE flight_status_changes (
  trip_id uuid NOT NULL,
  id uuid NOT NULL,
  itinerary_item_id uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN ('schedule', 'cancelled', 'details')),
  previous jsonb NOT NULL CHECK (jsonb_typeof(previous) = 'object'),
  current jsonb NOT NULL CHECK (jsonb_typeof(current) = 'object'),
  source_urls text[] NOT NULL DEFAULT '{}' CHECK (cardinality(source_urls) <= 5),
  applied_revision integer NOT NULL CHECK (applied_revision >= 1),
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (trip_id, id),
  FOREIGN KEY (trip_id, itinerary_item_id) REFERENCES itinerary_items (trip_id, id) ON DELETE CASCADE
);

CREATE INDEX flight_status_changes_item_idx
  ON flight_status_changes (trip_id, itinerary_item_id, created_at DESC);

CREATE TRIGGER flight_status_changes_append_only
BEFORE UPDATE OR DELETE ON flight_status_changes
FOR EACH ROW EXECUTE FUNCTION app_reject_append_only_mutation();
