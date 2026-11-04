-- Migration 0018 preserved every legacy transport location as a destination.
-- Split legacy route labels such as "Origin → Destination" into the explicit
-- endpoints. Their old map URL targets the combined label, so clear it and let
-- the application create an endpoint-specific Google Maps search for each stop.

WITH legacy_routes AS (
  SELECT trip_id,
         id,
         btrim(split_part(destination_location_name, '→', 1)) AS departure_name,
         btrim(substr(
           destination_location_name,
           strpos(destination_location_name, '→') + char_length('→')
         )) AS destination_name
    FROM itinerary_items
   WHERE item_type = 'transport'
     AND departure_location_name IS NULL
     AND destination_location_name LIKE '%→%'
)
UPDATE itinerary_items item
   SET departure_location_name = route.departure_name,
       departure_map_url = NULL,
       destination_location_name = route.destination_name,
       destination_map_url = NULL
  FROM legacy_routes route
 WHERE item.trip_id = route.trip_id
   AND item.id = route.id
   AND route.departure_name <> ''
   AND route.destination_name <> '';
