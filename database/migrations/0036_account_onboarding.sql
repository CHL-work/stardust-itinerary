ALTER TABLE trip_ai_settings
  ADD COLUMN host_subscription_enabled boolean NOT NULL DEFAULT false;

-- Existing local trips retain the operator-authorized workflow. Future rows do
-- not inherit entitlement merely because their creator has a trip-owner role.
UPDATE trip_ai_settings SET host_subscription_enabled = true;

CREATE TABLE auth_account_sessions (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES app_users (id) ON DELETE RESTRICT,
  issuer text NOT NULL,
  subject text NOT NULL,
  token_hash bytea NOT NULL UNIQUE CHECK (octet_length(token_hash) = 32),
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  FOREIGN KEY (issuer,subject) REFERENCES oidc_identities (issuer,subject) ON DELETE RESTRICT,
  CHECK (expires_at > created_at AND expires_at <= created_at + interval '15 minutes'),
  CHECK (consumed_at IS NULL OR consumed_at >= created_at)
);

CREATE INDEX auth_account_sessions_user_idx ON auth_account_sessions (user_id,created_at DESC);

CREATE TABLE account_trip_creations (
  user_id uuid NOT NULL REFERENCES app_users (id) ON DELETE RESTRICT,
  trip_id uuid PRIMARY KEY REFERENCES trips (id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX account_trip_creations_user_day_idx ON account_trip_creations (user_id,created_at DESC);
CREATE TRIGGER account_trip_creations_append_only
  BEFORE UPDATE OR DELETE ON account_trip_creations
  FOR EACH ROW EXECUTE FUNCTION app_reject_append_only_mutation();

COMMENT ON TABLE auth_account_sessions IS
  'Single-use Google-bound onboarding grants. They authorize explicit trip creation only and are never accepted by trip-scoped endpoints.';
COMMENT ON COLUMN trip_ai_settings.host_subscription_enabled IS
  'Operator-controlled local host entitlement, independent of trip-owner role and the trip user-facing AI enabled setting.';
