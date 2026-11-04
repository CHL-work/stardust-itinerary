-- A transport can have materially different weather at departure and arrival.
-- Preserve the existing primary forecast as the role it represented, then allow
-- one disposable cache row for each deterministic endpoint target.
ALTER TABLE event_weather_forecasts
  ADD COLUMN target_role text;

UPDATE event_weather_forecasts forecast
   SET target_role = CASE
     WHEN item.item_type = 'transport'
          AND NULLIF(btrim(item.destination_location_name), '') IS NOT NULL
       THEN 'destination'
     WHEN item.item_type = 'transport'
       THEN 'departure'
     ELSE 'location'
   END
  FROM itinerary_items item
 WHERE item.trip_id = forecast.trip_id
   AND item.id = forecast.itinerary_item_id;

ALTER TABLE event_weather_forecasts
  ALTER COLUMN target_role SET NOT NULL,
  ADD CONSTRAINT event_weather_forecasts_target_role_check
    CHECK (target_role IN ('location', 'departure', 'destination')),
  DROP CONSTRAINT event_weather_forecasts_pkey,
  ADD CONSTRAINT event_weather_forecasts_pkey
    PRIMARY KEY (trip_id, itinerary_item_id, target_role);
