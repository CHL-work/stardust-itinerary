ALTER TABLE app_users
  ADD COLUMN IF NOT EXISTS last_selected_trip_id uuid;

ALTER TABLE app_users
  ADD CONSTRAINT app_users_last_selected_trip_fk
  FOREIGN KEY (last_selected_trip_id)
  REFERENCES trips (id)
  ON DELETE SET NULL;

WITH latest_explicit_switch AS (
  SELECT DISTINCT ON (sessions.user_id)
         sessions.user_id,
         sessions.trip_id
    FROM audit_events events
    JOIN auth_sessions sessions
      ON sessions.trip_id = events.trip_id
     AND sessions.id = events.entity_id
   WHERE events.entity_type = 'auth_session'
     AND events.action = 'trip_switched_in'
   ORDER BY sessions.user_id, events.created_at DESC, events.id DESC
)
UPDATE app_users users
   SET last_selected_trip_id = latest_explicit_switch.trip_id
  FROM latest_explicit_switch
 WHERE users.id = latest_explicit_switch.user_id
   AND users.last_selected_trip_id IS NULL;

COMMENT ON COLUMN app_users.last_selected_trip_id IS
  'Last trip deliberately selected for this app user. Sign-in revalidates active membership and trip-session lifetime before using it.';
