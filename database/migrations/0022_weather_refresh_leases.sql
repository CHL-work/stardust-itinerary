CREATE TABLE weather_refresh_leases (
  trip_id uuid PRIMARY KEY REFERENCES trips (id) ON DELETE CASCADE,
  lease_token uuid NOT NULL,
  acquired_at timestamptz NOT NULL,
  leased_until timestamptz NOT NULL,
  CHECK (
    leased_until > acquired_at
    AND leased_until <= acquired_at + interval '5 minutes'
  )
);

CREATE INDEX weather_refresh_leases_expiry_idx
  ON weather_refresh_leases (leased_until);
