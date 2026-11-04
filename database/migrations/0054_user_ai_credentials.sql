-- Users' own AI provider API keys (JOB-061). Only ciphertext is stored: AES-256-GCM under the
-- application's CREDENTIAL_ENCRYPTION_KEY with the user and provider bound as authenticated data.
-- The last four characters are kept so the owner can tell which key is saved.
CREATE TABLE user_ai_credentials (
  user_id uuid NOT NULL REFERENCES app_users (id) ON DELETE CASCADE,
  provider text NOT NULL CHECK (provider IN ('openai', 'anthropic', 'google')),
  ciphertext bytea NOT NULL CHECK (octet_length(ciphertext) BETWEEN 17 AND 4096),
  nonce bytea NOT NULL CHECK (octet_length(nonce) = 12),
  key_version smallint NOT NULL CHECK (key_version >= 1),
  key_hint text NOT NULL CHECK (key_hint ~ '^([A-Za-z0-9_-]{1,4}|\*{4})$'),
  -- A Gemini key may be a Vertex AI key, which needs its project and location.
  vertex_project text CHECK (vertex_project ~ '^[a-z][a-z0-9-]{4,28}[a-z0-9]$'),
  vertex_location text CHECK (vertex_location ~ '^[a-z][a-z0-9-]{0,39}$'),
  validated_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, provider),
  CHECK ((vertex_project IS NULL) = (vertex_location IS NULL)),
  CHECK (provider = 'google' OR vertex_project IS NULL)
);

COMMENT ON TABLE user_ai_credentials IS
  'Per-user AI provider API keys, encrypted by the application. Never selected into API responses.';

-- Whose key paid for each request: the server operator's, the requester's own, or (JOB-063) a
-- trip owner's shared key. Historical rows stay NULL.
ALTER TABLE ai_requests
  ADD COLUMN credential_source text CHECK (credential_source IN ('operator', 'own', 'shared'));
