-- Account-owned provider keys move to Secret Manager only when the backend is configured.
-- Legacy ciphertexts remain readable. Payloads in Secret Manager are still sealed with KMS.
CREATE TABLE ai_credential_secret_resources (
  secret_name text PRIMARY KEY CHECK (secret_name ~ '^projects/[a-z][a-z0-9-]{4,28}[a-z0-9]/secrets/stardust-user-key-[0-9a-f]{32}-[0-9a-f]{32}$'),
  publish_by timestamptz NOT NULL DEFAULT (CURRENT_TIMESTAMP + interval '10 minutes'),
  cleanup_after timestamptz NOT NULL DEFAULT (CURRENT_TIMESTAMP + interval '10 minutes')
);

ALTER TABLE user_ai_credentials
  DROP CONSTRAINT user_ai_credentials_sealed_with_check,
  DROP CONSTRAINT user_ai_credentials_sealing_check,
  ALTER COLUMN ciphertext DROP NOT NULL,
  ADD COLUMN secret_version text,
  ADD COLUMN secret_name text GENERATED ALWAYS AS (split_part(secret_version, '/versions/', 1)) STORED
    REFERENCES ai_credential_secret_resources(secret_name) ON DELETE RESTRICT,
  ADD CONSTRAINT user_ai_credentials_sealed_with_check CHECK (sealed_with IN ('local', 'kms', 'secret_manager')),
  ADD CONSTRAINT user_ai_credentials_sealing_check CHECK (
    (sealed_with = 'local' AND ciphertext IS NOT NULL AND nonce IS NOT NULL AND key_version IS NOT NULL AND secret_version IS NULL)
    OR (sealed_with = 'kms' AND ciphertext IS NOT NULL AND nonce IS NULL AND key_version IS NULL AND secret_version IS NULL)
    OR (sealed_with = 'secret_manager' AND ciphertext IS NULL AND nonce IS NULL AND key_version IS NULL
      AND secret_version IS NOT NULL AND secret_version ~ '^projects/[a-z][a-z0-9-]{4,28}[a-z0-9]/secrets/stardust-user-key-[0-9a-f]{32}-[0-9a-f]{32}/versions/[1-9][0-9]*$')
  );
CREATE UNIQUE INDEX user_ai_credentials_secret_version_idx ON user_ai_credentials(secret_version) WHERE secret_version IS NOT NULL;
CREATE INDEX user_ai_credentials_secret_name_idx ON user_ai_credentials(secret_name) WHERE secret_name IS NOT NULL;

-- Durable resource registry: register before cloud creation, retain while referenced. No user FK
-- or personal payload. This survives guest purge (which deliberately suspends triggers), failed
-- saves and process crashes. A delete-only worker removes unreferenced resources after the lease.
CREATE INDEX ai_credential_secret_resources_cleanup_idx ON ai_credential_secret_resources(cleanup_after);
COMMENT ON COLUMN user_ai_credentials.secret_version IS 'Pinned Secret Manager version containing KMS ciphertext; never returned to clients.';
COMMENT ON TABLE ai_credential_secret_resources IS 'Opaque cloud resource lifecycle registry; no key, account ID, email or trip content.';
