ALTER TABLE ai_conversations ADD COLUMN purpose text NOT NULL DEFAULT 'trip'
  CHECK (purpose IN ('trip', 'preferences'));

CREATE FUNCTION app_preserve_ai_conversation_purpose() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.purpose IS DISTINCT FROM OLD.purpose THEN
    RAISE EXCEPTION 'AI conversation purpose is immutable';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER ai_conversation_purpose_immutable BEFORE UPDATE ON ai_conversations
FOR EACH ROW EXECUTE FUNCTION app_preserve_ai_conversation_purpose();

CREATE FUNCTION app_valid_preference_details(value jsonb, depth integer DEFAULT 0)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE STRICT AS $$
DECLARE entry record; item jsonb;
BEGIN
  IF depth > 1 OR jsonb_typeof(value) <> 'object' OR length(value::text) > 8192
     OR (SELECT count(*) FROM jsonb_object_keys(value)) > 16 THEN RETURN false; END IF;
  FOR entry IN SELECT * FROM jsonb_each(value) LOOP
    IF length(btrim(entry.key)) NOT BETWEEN 1 AND 64 OR entry.key IN ('__proto__','constructor','prototype') THEN RETURN false; END IF;
    IF jsonb_typeof(entry.value) = 'object' THEN
      IF NOT app_valid_preference_details(entry.value, depth + 1) THEN RETURN false; END IF;
    ELSIF jsonb_typeof(entry.value) = 'array' THEN
      IF jsonb_array_length(entry.value) > 12 THEN RETURN false; END IF;
      FOR item IN SELECT * FROM jsonb_array_elements(entry.value) LOOP
        IF jsonb_typeof(item) NOT IN ('string','number','boolean','null') THEN RETURN false; END IF;
        IF jsonb_typeof(item) = 'string' AND length(item #>> '{}') > 512 THEN RETURN false; END IF;
        IF jsonb_typeof(item) = 'number' AND abs((item::text)::numeric) > 9007199254740991 THEN RETURN false; END IF;
      END LOOP;
    ELSE
      IF jsonb_typeof(entry.value) = 'string' AND length(entry.value #>> '{}') > 512 THEN RETURN false; END IF;
      IF jsonb_typeof(entry.value) = 'number' AND abs((entry.value::text)::numeric) > 9007199254740991 THEN RETURN false; END IF;
    END IF;
  END LOOP;
  RETURN true;
END;
$$;
ALTER TABLE ai_personal_memories ADD COLUMN details jsonb NOT NULL DEFAULT '{}'::jsonb
  CHECK (app_valid_preference_details(details));

COMMENT ON COLUMN ai_conversations.purpose IS 'Immutable server-owned capability boundary; preference chats cannot mutate trips or use search.';
COMMENT ON COLUMN ai_personal_memories.details IS 'Bounded generic structured self preferences; catalog entities and private import evidence remain separate.';
