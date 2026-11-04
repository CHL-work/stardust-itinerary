-- JOB-045: retire structured preference storage without rewriting conversation
-- history, request receipts, ordinary checkpoints, or general audit records.
ALTER TABLE app_users
  ADD COLUMN ai_instructions text NOT NULL DEFAULT ''
    CONSTRAINT app_users_ai_instructions_length_ck CHECK (length(ai_instructions) <= 8000),
  ADD COLUMN ai_instructions_revision integer NOT NULL DEFAULT 1
    CONSTRAINT app_users_ai_instructions_revision_ck CHECK (ai_instructions_revision >= 1);

-- The existing history reader recognizes ordinary archives. The immutable
-- purpose marker continues to identify these archives as retired/read-only.
UPDATE ai_conversations
   SET closed_at = GREATEST(CURRENT_TIMESTAMP, created_at),
       closed_reason = 'user_switch'
 WHERE purpose = 'preferences' AND closed_at IS NULL;

ALTER TABLE ai_conversations
  ADD CONSTRAINT ai_conversations_retired_purpose_closed_ck
    CHECK (purpose = 'trip' OR closed_at IS NOT NULL);

CREATE OR REPLACE FUNCTION app_preserve_ai_conversation_purpose()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.purpose <> 'trip' THEN
      RAISE EXCEPTION 'Preference conversations are retired and read-only';
    END IF;
  ELSIF NEW.purpose IS DISTINCT FROM OLD.purpose THEN
    RAISE EXCEPTION 'AI conversation purpose is immutable';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER ai_conversation_retired_purpose_insert_guard
  BEFORE INSERT ON ai_conversations
  FOR EACH ROW EXECUTE FUNCTION app_preserve_ai_conversation_purpose();

-- Explicit leaf-first drops intentionally fail if an unexpected external
-- dependency exists. Do not use CASCADE or touch shared history guards.
DROP TABLE preference_revisions;
DROP TABLE preferences;
DROP TABLE ai_personal_memory_revisions;
DROP TABLE ai_personal_memories;
DROP TABLE user_catalog_preference_evidence;
DROP TABLE user_catalog_preference_revisions;
DROP TABLE preference_import_rows;
DROP TABLE user_catalog_preferences;
DROP TABLE preference_import_batches;
DROP TABLE preference_catalog_relations;
DROP TABLE preference_catalog_aliases;
DROP TABLE preference_catalog_categories;
DROP TABLE preference_catalog_entities;

DROP FUNCTION app_validate_preference_revision();
DROP FUNCTION app_purge_user_preference_data(uuid);
DROP FUNCTION app_reject_preference_history_mutation();
DROP FUNCTION app_preference_relation_reject_group_cycle();
DROP FUNCTION app_preference_import_batch_guard();
DROP FUNCTION app_preference_import_row_guard();
DROP FUNCTION app_preference_evidence_insert_guard();
DROP FUNCTION app_valid_preference_details(jsonb, integer);

COMMENT ON COLUMN app_users.ai_instructions IS
  'Explicitly user-authored private AI instructions; never inferred or imported from retired structured preferences.';
COMMENT ON COLUMN app_users.ai_instructions_revision IS
  'Optimistic revision for self-only instruction save/clear; no historical prompt snapshots are stored here.';
COMMENT ON COLUMN ai_conversations.purpose IS
  'Immutable historical capability marker; retired preference conversations remain readable but cannot be created or reopened.';
