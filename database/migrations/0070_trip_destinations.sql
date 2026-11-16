-- JOB-098 (D-110): a trip visits one or more destinations, each with its own time zone and, optionally, the
-- dates the travellers are there. The first destination stays mirrored in trips.destination_name and
-- trips.time_zone, which older builds, trip-wide dates and single-zone trips keep using.
CREATE TABLE trip_destinations (
  trip_id uuid NOT NULL REFERENCES trips (id) ON DELETE CASCADE,
  id uuid NOT NULL,
  position smallint NOT NULL CHECK (position BETWEEN 0 AND 11),
  name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 160),
  time_zone text NOT NULL CHECK (length(btrim(time_zone)) BETWEEN 1 AND 80),
  starts_on date,
  ends_on date,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (trip_id, id),
  CONSTRAINT trip_destinations_position_key UNIQUE (trip_id, position),
  CONSTRAINT trip_destinations_dates_ck CHECK (
    (starts_on IS NULL) = (ends_on IS NULL) AND (ends_on IS NULL OR ends_on >= starts_on))
);

COMMENT ON TABLE trip_destinations IS
  'Where a trip goes, in order (JOB-098). Position 0 mirrors trips.destination_name and trips.time_zone; dates are optional.';

-- Every existing trip keeps its one destination, without dates.
INSERT INTO trip_destinations (trip_id, id, position, name, time_zone)
SELECT id, gen_random_uuid(), 0, destination_name, time_zone FROM trips;
