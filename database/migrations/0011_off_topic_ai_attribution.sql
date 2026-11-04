ALTER TABLE ai_requests
  DROP CONSTRAINT ai_requests_conversation_columns_ck,
  ADD CONSTRAINT ai_requests_conversation_identity_ck
    CHECK (conversation_id IS NULL OR actor_user_id IS NOT NULL),
  ADD CONSTRAINT ai_requests_actor_user_fk
    FOREIGN KEY (actor_user_id) REFERENCES app_users (id) ON DELETE RESTRICT;

COMMENT ON CONSTRAINT ai_requests_conversation_identity_ck ON ai_requests IS
  'Conversation-backed requests require an exact user identity; non-conversation audit features may retain actor_user_id without creating memory.';
