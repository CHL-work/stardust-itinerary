-- Keep the current disruption projection attached to the same itinerary item
-- as its immutable source observation, and reject drift in copied evidence.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM event_disruption_current current_warning
      LEFT JOIN event_disruption_observations observation
        ON observation.trip_id = current_warning.trip_id
       AND observation.id = current_warning.observation_id
       AND observation.itinerary_item_id = current_warning.itinerary_item_id
     WHERE observation.id IS NULL
        OR current_warning.item_revision IS DISTINCT FROM observation.item_revision
        OR current_warning.state IS DISTINCT FROM observation.state
        OR current_warning.reason_code IS DISTINCT FROM observation.reason_code
        OR current_warning.severity IS DISTINCT FROM observation.severity
        OR current_warning.detail IS DISTINCT FROM observation.detail
        OR current_warning.source_urls IS DISTINCT FROM observation.source_urls
        OR current_warning.evidence_fingerprint IS DISTINCT FROM observation.evidence_fingerprint
  ) THEN
    RAISE EXCEPTION 'event_disruption_current contains a projection that does not match its source observation'
      USING ERRCODE = '23514';
  END IF;
END;
$$;

ALTER TABLE event_disruption_observations
  ADD CONSTRAINT event_disruption_observations_item_identity_uq
    UNIQUE (trip_id, id, itinerary_item_id);

ALTER TABLE event_disruption_current
  DROP CONSTRAINT event_disruption_current_trip_id_observation_id_fkey,
  ADD CONSTRAINT event_disruption_current_observation_item_fk
    FOREIGN KEY (trip_id, observation_id, itinerary_item_id)
    REFERENCES event_disruption_observations (trip_id, id, itinerary_item_id)
    ON DELETE CASCADE;

CREATE OR REPLACE FUNCTION app_validate_disruption_current_projection()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  observation event_disruption_observations%ROWTYPE;
BEGIN
  SELECT source.*
    INTO observation
    FROM event_disruption_observations source
   WHERE source.trip_id = NEW.trip_id
     AND source.id = NEW.observation_id
     AND source.itinerary_item_id = NEW.itinerary_item_id;

  IF NOT FOUND THEN
    RETURN NEW;
  END IF;

  IF NEW.item_revision IS DISTINCT FROM observation.item_revision
     OR NEW.state IS DISTINCT FROM observation.state
     OR NEW.reason_code IS DISTINCT FROM observation.reason_code
     OR NEW.severity IS DISTINCT FROM observation.severity
     OR NEW.detail IS DISTINCT FROM observation.detail
     OR NEW.source_urls IS DISTINCT FROM observation.source_urls
     OR NEW.evidence_fingerprint IS DISTINCT FROM observation.evidence_fingerprint THEN
    RAISE EXCEPTION 'event_disruption_current must match its source observation'
      USING ERRCODE = '23514',
            CONSTRAINT = 'event_disruption_current_observation_shape_ck';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER event_disruption_current_projection_guard
BEFORE INSERT OR UPDATE ON event_disruption_current
FOR EACH ROW EXECUTE FUNCTION app_validate_disruption_current_projection();
