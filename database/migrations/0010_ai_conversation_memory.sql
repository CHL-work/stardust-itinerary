CREATE TABLE ai_conversations (
  trip_id uuid NOT NULL REFERENCES trips (id) ON DELETE CASCADE,
  id uuid NOT NULL,
  actor_member_id uuid NOT NULL,
  actor_user_id uuid NOT NULL REFERENCES app_users (id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_used_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  closed_at timestamptz,
  PRIMARY KEY (trip_id, id),
  UNIQUE (trip_id, id, actor_member_id, actor_user_id),
  FOREIGN KEY (trip_id, actor_member_id)
    REFERENCES trip_members (trip_id, id) ON DELETE RESTRICT,
  CHECK (last_used_at >= created_at),
  CHECK (closed_at IS NULL OR closed_at >= created_at)
);

CREATE UNIQUE INDEX ai_conversations_one_active_member_idx
  ON ai_conversations (trip_id, actor_member_id)
  WHERE closed_at IS NULL;

ALTER TABLE ai_requests
  ADD COLUMN actor_user_id uuid,
  ADD COLUMN conversation_id uuid,
  ADD CONSTRAINT ai_requests_conversation_columns_ck
    CHECK ((actor_user_id IS NULL) = (conversation_id IS NULL)),
  ADD CONSTRAINT ai_requests_conversation_fk
    FOREIGN KEY (trip_id, conversation_id, actor_member_id, actor_user_id)
    REFERENCES ai_conversations (trip_id, id, actor_member_id, actor_user_id)
    ON DELETE RESTRICT;

CREATE INDEX ai_requests_conversation_history_idx
  ON ai_requests (
    trip_id, conversation_id, completed_at DESC, created_at DESC, id DESC
  )
  WHERE feature = 'planning'
    AND status = 'succeeded'
    AND result_text IS NOT NULL
    AND btrim(result_text) <> ''
    AND completed_at IS NOT NULL;
