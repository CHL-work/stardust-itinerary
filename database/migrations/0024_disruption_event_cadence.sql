-- Track successful disruption checks independently for each event. This lets
-- the background worker check today's events frequently without repeatedly
-- spending a provider call on every later event in the lookahead window.
CREATE TABLE event_disruption_check_state (
  trip_id uuid NOT NULL,
  itinerary_item_id uuid NOT NULL,
  item_revision integer NOT NULL CHECK (item_revision >= 1),
  check_scope text NOT NULL CHECK (check_scope IN ('current_day', 'future_day')),
  last_checked_at timestamptz NOT NULL,
  monitor_run_id uuid NOT NULL,
  PRIMARY KEY (trip_id, itinerary_item_id),
  FOREIGN KEY (trip_id, itinerary_item_id)
    REFERENCES itinerary_items (trip_id, id) ON DELETE CASCADE,
  FOREIGN KEY (trip_id, monitor_run_id)
    REFERENCES disruption_monitor_runs (trip_id, id) ON DELETE CASCADE
);

CREATE INDEX event_disruption_check_state_due_idx
  ON event_disruption_check_state (trip_id, last_checked_at, itinerary_item_id);
