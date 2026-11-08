-- JOB-091: explicit location-local display/editing zones. UTC instants are unchanged.
-- Validation against named IANA zones is application-owned; the database bounds the JSON shape.
ALTER TABLE itinerary_items ADD COLUMN IF NOT EXISTS time_zones jsonb;

ALTER TABLE itinerary_items ADD CONSTRAINT itinerary_items_time_zones_ck CHECK (
  time_zones IS NULL OR (
    jsonb_typeof(time_zones) = 'object'
    AND octet_length(time_zones::text) <= 240
    AND (time_zones - 'start' - 'end') = '{}'::jsonb
    AND (NOT time_zones ? 'start' OR jsonb_typeof(time_zones->'start') = 'null'
      OR (jsonb_typeof(time_zones->'start') = 'string' AND length(time_zones->>'start') BETWEEN 1 AND 80))
    AND (NOT time_zones ? 'end' OR jsonb_typeof(time_zones->'end') = 'null'
      OR (jsonb_typeof(time_zones->'end') = 'string' AND length(time_zones->>'end') BETWEEN 1 AND 80))
  )
);
