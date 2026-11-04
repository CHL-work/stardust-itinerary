ALTER TABLE oidc_identities
  ADD COLUMN display_name_hint text,
  ADD COLUMN last_authenticated_at timestamptz;

CREATE TABLE member_claim_links (
  id uuid PRIMARY KEY,
  trip_id uuid NOT NULL,
  member_id uuid NOT NULL,
  token_hash bytea NOT NULL UNIQUE CHECK (octet_length(token_hash) = 32),
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  revoked_at timestamptz,
  created_by_member_id uuid,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (trip_id, member_id)
    REFERENCES trip_members (trip_id, id) ON DELETE CASCADE,
  FOREIGN KEY (trip_id, created_by_member_id)
    REFERENCES trip_members (trip_id, id) ON DELETE SET NULL (created_by_member_id),
  CHECK (expires_at > created_at),
  CHECK (consumed_at IS NULL OR consumed_at >= created_at),
  CHECK (revoked_at IS NULL OR revoked_at >= created_at),
  CHECK (consumed_at IS NULL OR revoked_at IS NULL)
);

CREATE UNIQUE INDEX member_claim_links_one_active_idx
  ON member_claim_links (trip_id, member_id)
  WHERE consumed_at IS NULL AND revoked_at IS NULL;

CREATE INDEX member_claim_links_lookup_idx
  ON member_claim_links (token_hash, expires_at)
  WHERE consumed_at IS NULL AND revoked_at IS NULL;

CREATE TABLE auth_sessions (
  id uuid PRIMARY KEY,
  family_id uuid NOT NULL,
  trip_id uuid NOT NULL,
  member_id uuid NOT NULL,
  user_id uuid NOT NULL REFERENCES app_users (id) ON DELETE CASCADE,
  token_hash bytea NOT NULL UNIQUE CHECK (octet_length(token_hash) = 32),
  previous_token_hash bytea CHECK (
    previous_token_hash IS NULL OR octet_length(previous_token_hash) = 32
  ),
  generation integer NOT NULL DEFAULT 1 CHECK (generation >= 1),
  device_label text NOT NULL CHECK (length(btrim(device_label)) BETWEEN 1 AND 160),
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_seen_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  rotated_at timestamptz,
  expires_at timestamptz NOT NULL,
  absolute_expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  revoke_reason text,
  FOREIGN KEY (trip_id, member_id)
    REFERENCES trip_members (trip_id, id) ON DELETE CASCADE,
  CHECK (expires_at > created_at),
  CHECK (absolute_expires_at >= expires_at),
  CHECK (revoked_at IS NULL OR revoked_at >= created_at),
  CHECK ((revoked_at IS NULL) = (revoke_reason IS NULL))
);

CREATE UNIQUE INDEX auth_sessions_previous_token_idx
  ON auth_sessions (previous_token_hash)
  WHERE previous_token_hash IS NOT NULL;

CREATE INDEX auth_sessions_member_idx
  ON auth_sessions (trip_id, member_id, created_at DESC);

CREATE INDEX auth_sessions_user_idx
  ON auth_sessions (user_id, created_at DESC);

CREATE TABLE auth_rate_limits (
  scope text NOT NULL CHECK (length(btrim(scope)) BETWEEN 1 AND 80),
  key_hash bytea NOT NULL CHECK (octet_length(key_hash) = 32),
  window_started_at timestamptz NOT NULL,
  attempt_count integer NOT NULL CHECK (attempt_count >= 1),
  PRIMARY KEY (scope, key_hash)
);

CREATE INDEX auth_rate_limits_window_idx
  ON auth_rate_limits (window_started_at);
