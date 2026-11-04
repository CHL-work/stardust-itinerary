-- Weather candidates are visibility-scoped, so coordination must not let one
-- member suppress another member's private-visible refresh. Existing rows are
-- ephemeral leases and cannot be attributed safely during this additive upgrade.
TRUNCATE TABLE weather_refresh_leases;

ALTER TABLE weather_refresh_leases
  DROP CONSTRAINT weather_refresh_leases_pkey,
  ADD COLUMN member_id uuid NOT NULL,
  ADD CONSTRAINT weather_refresh_leases_pkey PRIMARY KEY (trip_id, member_id),
  ADD CONSTRAINT weather_refresh_leases_member_fk
    FOREIGN KEY (trip_id, member_id)
    REFERENCES trip_members (trip_id, id) ON DELETE CASCADE;
