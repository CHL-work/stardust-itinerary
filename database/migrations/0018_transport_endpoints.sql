-- Give transport items explicit route endpoints while keeping the existing
-- single location fields for activities, meals, lodging, and notes.

ALTER TABLE itinerary_items
  ADD COLUMN IF NOT EXISTS departure_location_name text,
  ADD COLUMN IF NOT EXISTS departure_map_url text,
  ADD COLUMN IF NOT EXISTS destination_location_name text,
  ADD COLUMN IF NOT EXISTS destination_map_url text;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
     FROM itinerary_items
     WHERE item_type = 'transport'
       AND NULLIF(btrim(departure_location_name), '') IS NULL
       AND NULLIF(btrim(destination_location_name), '') IS NULL
       AND NULLIF(btrim(location_name), '') IS NULL
  ) THEN
    RAISE EXCEPTION
      'migration 0018 requires every legacy transport item to have a nonblank location_name';
  END IF;
END;
$$;

-- Existing transport items used the generic location as their destination.
UPDATE itinerary_items
   SET destination_location_name = COALESCE(destination_location_name, location_name),
       destination_map_url = COALESCE(destination_map_url, map_url),
       location_name = NULL,
       map_url = NULL
 WHERE item_type = 'transport';

ALTER TABLE itinerary_items
  ADD CONSTRAINT itinerary_items_departure_location_name_ck
    CHECK (departure_location_name IS NULL
      OR length(btrim(departure_location_name)) BETWEEN 1 AND 300),
  ADD CONSTRAINT itinerary_items_destination_location_name_ck
    CHECK (destination_location_name IS NULL
      OR length(btrim(destination_location_name)) BETWEEN 1 AND 300),
  ADD CONSTRAINT itinerary_items_departure_map_url_ck
    CHECK (departure_map_url IS NULL
      OR length(btrim(departure_map_url)) BETWEEN 1 AND 2000),
  ADD CONSTRAINT itinerary_items_destination_map_url_ck
    CHECK (destination_map_url IS NULL
      OR length(btrim(destination_map_url)) BETWEEN 1 AND 2000),
  ADD CONSTRAINT itinerary_items_departure_map_requires_name_ck
    CHECK (departure_map_url IS NULL
      OR NULLIF(btrim(departure_location_name), '') IS NOT NULL),
  ADD CONSTRAINT itinerary_items_destination_map_requires_name_ck
    CHECK (destination_map_url IS NULL
      OR NULLIF(btrim(destination_location_name), '') IS NOT NULL),
  ADD CONSTRAINT itinerary_items_transport_endpoint_ck
    CHECK (item_type <> 'transport'
      OR NULLIF(btrim(departure_location_name), '') IS NOT NULL
      OR NULLIF(btrim(destination_location_name), '') IS NOT NULL),
  ADD CONSTRAINT itinerary_items_location_shape_ck
    CHECK (
      (item_type = 'transport'
        AND location_name IS NULL
        AND map_url IS NULL)
      OR
      (item_type <> 'transport'
        AND departure_location_name IS NULL
        AND departure_map_url IS NULL
        AND destination_location_name IS NULL
        AND destination_map_url IS NULL)
    );
