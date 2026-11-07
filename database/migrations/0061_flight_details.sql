-- JOB-082: optional flight details on a transport event, as one JSON object: the flight number
-- (required), and the airline, departure terminal, departure gate and arrival terminal when known.
-- The departure and destination location names keep the airports; the app shows the gate, else the
-- terminal, else the airline beside the departure airport (D-094). Application code validates the
-- object's shape; this check keeps it on transport events, small and keyed by a flight number.

ALTER TABLE itinerary_items
  ADD COLUMN IF NOT EXISTS flight jsonb;

ALTER TABLE itinerary_items
  ADD CONSTRAINT itinerary_items_flight_ck CHECK (
    flight IS NULL OR (
      item_type = 'transport'
      AND jsonb_typeof(flight) = 'object'
      AND octet_length(flight::text) <= 1000
      AND (flight->>'flightNumber') ~ '^(?:[A-Z][A-Z0-9]|[0-9][A-Z])[A-Z]?[0-9]{1,4}[A-Z]?$'
    )
  );
