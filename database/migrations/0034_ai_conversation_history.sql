ALTER TABLE ai_conversations
  ADD COLUMN closed_reason text,
  ADD COLUMN history_revoked_at timestamptz;

-- Only an explicit ordinary close audit establishes a reusable legacy archive.
-- Missing or ambiguous evidence never grants access to an old identity's chat.
UPDATE ai_conversations conversation
   SET closed_reason = COALESCE((
     SELECT CASE
       WHEN event.action = 'reset' AND event.metadata->>'cause' = 'user_reset'
         THEN 'user_reset'
       WHEN event.action = 'closed' AND event.metadata->>'cause' IN (
         'user_switch', 'identity_mismatch', 'identity_unbound', 'owner_recovery'
       ) THEN event.metadata->>'cause'
       ELSE 'legacy_unknown'
     END
       FROM audit_events event
      WHERE event.trip_id = conversation.trip_id
        AND event.entity_type = 'ai_conversation'
        AND event.entity_id = conversation.id
        AND event.action IN ('reset', 'closed')
        AND event.created_at >= conversation.closed_at
      ORDER BY event.created_at DESC, event.id DESC
      LIMIT 1
   ), 'legacy_unknown')
 WHERE conversation.closed_at IS NOT NULL;

-- Identity changes invalidate every earlier archive for that membership, even
-- if there was no active conversation when the identity was disconnected.
UPDATE ai_conversations conversation
   SET history_revoked_at = GREATEST(CURRENT_TIMESTAMP, conversation.created_at),
       closed_at = COALESCE(conversation.closed_at, GREATEST(CURRENT_TIMESTAMP, conversation.created_at)),
       closed_reason = COALESCE(conversation.closed_reason, 'identity_mismatch')
 WHERE conversation.closed_reason IN (
         'identity_mismatch', 'identity_unbound', 'owner_recovery', 'legacy_unknown'
       )
    OR NOT EXISTS (
      SELECT 1 FROM trip_members member
       WHERE member.trip_id = conversation.trip_id
         AND member.id = conversation.actor_member_id
         AND member.user_id = conversation.actor_user_id
    )
    OR EXISTS (
      SELECT 1 FROM audit_events event
       WHERE event.trip_id = conversation.trip_id
         AND event.entity_type = 'trip_member'
         AND event.entity_id = conversation.actor_member_id
         AND event.action IN ('identity_unbound', 'owner_recovery_started')
         AND event.created_at >= conversation.created_at
    )
    OR EXISTS (
      SELECT 1 FROM audit_events event
      JOIN ai_conversations changed
        ON changed.trip_id = event.trip_id AND changed.id = event.entity_id
       WHERE event.trip_id = conversation.trip_id
         AND event.entity_type = 'ai_conversation'
         AND event.action = 'closed'
         AND event.metadata->>'cause' IN ('identity_mismatch', 'identity_unbound', 'owner_recovery')
         AND changed.actor_member_id = conversation.actor_member_id
         AND changed.actor_user_id = conversation.actor_user_id
         AND event.created_at >= conversation.created_at
    );

ALTER TABLE ai_conversations
  ADD CONSTRAINT ai_conversations_closed_reason_ck CHECK (
    closed_reason IS NULL OR closed_reason IN (
      'user_reset', 'user_switch', 'identity_mismatch', 'identity_unbound',
      'owner_recovery', 'legacy_unknown'
    )
  ),
  ADD CONSTRAINT ai_conversations_close_pair_ck CHECK (
    (closed_at IS NULL) = (closed_reason IS NULL)
  ),
  ADD CONSTRAINT ai_conversations_revoked_closed_ck CHECK (
    history_revoked_at IS NULL OR closed_at IS NOT NULL
  );

CREATE FUNCTION app_guard_ai_conversation_history()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF (NEW.trip_id, NEW.id, NEW.actor_member_id, NEW.actor_user_id)
     IS DISTINCT FROM (OLD.trip_id, OLD.id, OLD.actor_member_id, OLD.actor_user_id) THEN
    RAISE EXCEPTION 'ai_conversations identity is immutable';
  END IF;
  IF OLD.history_revoked_at IS NOT NULL
     AND NEW.history_revoked_at IS DISTINCT FROM OLD.history_revoked_at THEN
    RAISE EXCEPTION 'ai_conversations history revocation is permanent';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER ai_conversations_history_guard
  BEFORE UPDATE ON ai_conversations
  FOR EACH ROW EXECUTE FUNCTION app_guard_ai_conversation_history();

CREATE INDEX ai_conversations_private_history_idx
  ON ai_conversations (trip_id, actor_member_id, actor_user_id, created_at DESC, id DESC)
  WHERE history_revoked_at IS NULL;

CREATE INDEX ai_requests_private_conversation_history_idx
  ON ai_requests (trip_id, conversation_id, created_at DESC, id DESC)
  WHERE conversation_id IS NOT NULL;

COMMENT ON COLUMN ai_conversations.closed_reason IS
  'Ordinary user-reset/switch archives may resume; identity and unknown legacy closures never resume.';
COMMENT ON COLUMN ai_conversations.history_revoked_at IS
  'Permanent private-history revocation across a membership identity boundary, independent of archive state.';
