ALTER TABLE ai_requests
  ADD COLUMN image_context_text text,
  ADD CONSTRAINT ai_requests_image_context_text_ck CHECK (
    image_context_text IS NULL OR (
      initiator_kind = 'member' AND feature = 'planning'
      AND actor_member_id IS NOT NULL AND actor_user_id IS NOT NULL AND conversation_id IS NOT NULL
      AND length(image_context_text) BETWEEN 1 AND 12000 AND length(btrim(image_context_text)) > 0
    )
  );

CREATE TABLE ai_request_images (
  trip_id uuid NOT NULL,
  id uuid NOT NULL,
  ai_request_id uuid NOT NULL,
  ordinal smallint NOT NULL CHECK (ordinal BETWEEN 0 AND 2),
  media_type text NOT NULL CHECK (media_type = 'image/jpeg'),
  image_data bytea NOT NULL CHECK (
    octet_length(image_data) BETWEEN 4 AND 2097152
    AND substring(image_data FROM 1 FOR 2) = decode('ffd8', 'hex')
    AND substring(image_data FROM octet_length(image_data) - 1 FOR 2) = decode('ffd9', 'hex')
  ),
  sha256 text NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  width integer NOT NULL CHECK (width BETWEEN 1 AND 2048),
  height integer NOT NULL CHECK (height BETWEEN 1 AND 2048),
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (trip_id, id),
  UNIQUE (trip_id, ai_request_id, ordinal),
  FOREIGN KEY (trip_id, ai_request_id) REFERENCES ai_requests (trip_id, id) ON DELETE RESTRICT
);

CREATE TRIGGER ai_request_images_append_only
  BEFORE UPDATE OR DELETE ON ai_request_images
  FOR EACH ROW EXECUTE FUNCTION app_reject_append_only_mutation();

CREATE FUNCTION app_guard_ai_image_context()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.image_context_text IS NOT NULL AND NEW.image_context_text IS DISTINCT FROM OLD.image_context_text THEN
    RAISE EXCEPTION 'ai_requests image facts are immutable';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER ai_requests_image_context_guard
  BEFORE UPDATE ON ai_requests
  FOR EACH ROW EXECUTE FUNCTION app_guard_ai_image_context();

COMMENT ON TABLE ai_request_images IS
  'Private normalized JPEG attachments. Original metadata is stripped before admission; historical access follows the exact bound request actor and non-revoked conversation.';
COMMENT ON COLUMN ai_requests.image_context_text IS
  'Bounded sanitized visible-image facts for later context and clarification. Untrusted source data, not a replacement for the original submitted prompt or raw image replay.';
