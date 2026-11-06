-- Platform administration and key protection (JOB-069, D-084).
--
-- 1. Suspension: a suspended account cannot sign in or use a session, and keys it shares stop paying.
-- 2. One row of platform settings, holding the daily cap on public sign-ups (default 50; NULL means
--    no cap, 0 pauses sign-ups).
-- 3. Daily counters for the operator's admin page: counts only, per UTC day and metric, optionally
--    per account. Rows naming an account go when the account goes, guests included, because the
--    guest purge deletes rows in every table with a foreign key to app_users.
-- 4. An append-only record of the operator's actions on accounts and settings.
-- 5. Users' AI keys may be sealed by Cloud KMS instead of the local key ring. A KMS ciphertext
--    carries its own key version and nonce, so those columns are empty for it.

ALTER TABLE app_users ADD COLUMN suspended_at timestamptz;

CREATE INDEX app_users_suspended_idx ON app_users (suspended_at) WHERE suspended_at IS NOT NULL;

CREATE TABLE platform_settings (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  signup_daily_limit integer CHECK (signup_daily_limit IS NULL OR signup_daily_limit BETWEEN 0 AND 100000),
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO platform_settings (singleton, signup_daily_limit) VALUES (true, 50);

COMMENT ON TABLE platform_settings IS
  'Instance-wide settings the operator changes on the admin page. Exactly one row.';

CREATE TABLE platform_daily_counts (
  day date NOT NULL,
  metric text NOT NULL CHECK (metric ~ '^[a-z][a-z0-9_.:-]{0,79}$'),
  user_id uuid REFERENCES app_users (id) ON DELETE CASCADE,
  count integer NOT NULL CHECK (count > 0),
  CONSTRAINT platform_daily_counts_key UNIQUE NULLS NOT DISTINCT (day, metric, user_id)
);

CREATE INDEX platform_daily_counts_user_idx ON platform_daily_counts (user_id, day) WHERE user_id IS NOT NULL;

COMMENT ON TABLE platform_daily_counts IS
  'Counts for the admin page, such as public sign-ups, guests started and refused attempts. No content, addresses or keys.';

CREATE TABLE operator_audit_events (
  id uuid PRIMARY KEY,
  action text NOT NULL CHECK (action IN ('account.suspended', 'account.unsuspended', 'signup_limit.changed')),
  target_user_id uuid REFERENCES app_users (id) ON DELETE CASCADE,
  details jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(details) = 'object'),
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK ((action LIKE 'account.%') = (target_user_id IS NOT NULL))
);

CREATE INDEX operator_audit_events_target_idx ON operator_audit_events (target_user_id, created_at DESC)
  WHERE target_user_id IS NOT NULL;

ALTER TABLE user_ai_credentials
  ADD COLUMN sealed_with text NOT NULL DEFAULT 'local' CHECK (sealed_with IN ('local', 'kms')),
  ALTER COLUMN nonce DROP NOT NULL,
  ALTER COLUMN key_version DROP NOT NULL,
  ADD CONSTRAINT user_ai_credentials_sealing_check CHECK (
    (sealed_with = 'local' AND nonce IS NOT NULL AND key_version IS NOT NULL)
    OR (sealed_with = 'kms' AND nonce IS NULL AND key_version IS NULL)
  );

COMMENT ON COLUMN user_ai_credentials.sealed_with IS
  'local: AES-256-GCM under the CREDENTIAL_ENCRYPTION_KEY ring. kms: Cloud KMS ciphertext under CREDENTIAL_KMS_KEY.';

-- The admin page counts requests per account over recent days.
CREATE INDEX ai_requests_actor_created_idx ON ai_requests (actor_user_id, created_at)
  WHERE actor_user_id IS NOT NULL;
