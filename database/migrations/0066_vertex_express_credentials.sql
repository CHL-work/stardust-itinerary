-- Vertex express keys use a projectless Google endpoint. Existing keys keep their current mode.
ALTER TABLE user_ai_credentials
  ADD COLUMN vertex_express boolean NOT NULL DEFAULT false,
  ADD CONSTRAINT user_ai_credentials_vertex_express_check
    CHECK (NOT vertex_express OR (provider = 'google' AND vertex_project IS NULL AND vertex_location IS NULL));

COMMENT ON COLUMN user_ai_credentials.vertex_express IS
  'Explicit Google Vertex express routing; never inferred from key contents or used as endpoint fallback.';
