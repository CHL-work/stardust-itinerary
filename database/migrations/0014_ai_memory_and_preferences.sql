CREATE TABLE ai_conversation_checkpoints (
  trip_id uuid NOT NULL,
  id uuid NOT NULL,
  conversation_id uuid NOT NULL,
  actor_member_id uuid NOT NULL,
  actor_user_id uuid NOT NULL REFERENCES app_users (id) ON DELETE RESTRICT,
  version integer NOT NULL CHECK (version >= 1),
  through_request_id uuid NOT NULL,
  through_completed_at timestamptz NOT NULL,
  summary_text text NOT NULL CHECK (length(summary_text) <= 8000),
  summary_json jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(summary_json) = 'object'),
  token_estimate integer NOT NULL CHECK (token_estimate >= 0),
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (trip_id, id),
  UNIQUE (trip_id, conversation_id, version),
  FOREIGN KEY (trip_id, conversation_id, actor_member_id, actor_user_id)
    REFERENCES ai_conversations (trip_id, id, actor_member_id, actor_user_id)
    ON DELETE RESTRICT,
  FOREIGN KEY (trip_id, through_request_id)
    REFERENCES ai_requests (trip_id, id) ON DELETE RESTRICT
);

CREATE INDEX ai_conversation_checkpoints_latest_idx
  ON ai_conversation_checkpoints (trip_id, conversation_id, version DESC);

CREATE TABLE ai_personal_memories (
  id uuid PRIMARY KEY,
  app_user_id uuid NOT NULL REFERENCES app_users (id) ON DELETE CASCADE,
  category text NOT NULL CHECK (category IN (
    'anime', 'manga', 'novel', 'movie', 'tv', 'game', 'activity', 'food', 'shopping', 'other'
  )),
  subject text NOT NULL CHECK (length(btrim(subject)) BETWEEN 1 AND 240),
  normalized_subject text NOT NULL CHECK (length(btrim(normalized_subject)) BETWEEN 1 AND 240),
  experience text NOT NULL DEFAULT 'unspecified' CHECK (experience IN (
    'unspecified', 'watched', 'watching', 'read', 'reading', 'played', 'playing',
    'visited', 'wants_to_try'
  )),
  affinity text NOT NULL DEFAULT 'like' CHECK (affinity IN (
    'favorite', 'like', 'neutral', 'dislike', 'avoid'
  )),
  notes text CHECK (notes IS NULL OR length(notes) <= 2000),
  status text NOT NULL DEFAULT 'confirmed' CHECK (status IN ('suggested', 'confirmed', 'forgotten')),
  source text NOT NULL DEFAULT 'user' CHECK (source IN ('user', 'ai_explicit', 'ai_inferred')),
  source_trip_id uuid,
  source_request_id uuid,
  current_revision integer NOT NULL DEFAULT 1 CHECK (current_revision >= 1),
  last_retrieved_at timestamptz,
  forgotten_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (source_trip_id, source_request_id)
    REFERENCES ai_requests (trip_id, id) ON DELETE SET NULL (source_trip_id, source_request_id),
  CHECK ((source_trip_id IS NULL) = (source_request_id IS NULL)),
  CHECK ((status = 'forgotten') = (forgotten_at IS NOT NULL))
);

CREATE UNIQUE INDEX ai_personal_memories_active_subject_idx
  ON ai_personal_memories (app_user_id, category, normalized_subject)
  WHERE status <> 'forgotten';

CREATE INDEX ai_personal_memories_user_status_idx
  ON ai_personal_memories (app_user_id, status, updated_at DESC, id);

CREATE INDEX ai_personal_memories_search_idx
  ON ai_personal_memories USING gin (
    to_tsvector(
      'simple',
      category || ' ' || subject || ' ' || coalesce(notes, '') || ' ' || experience || ' ' || affinity
    )
  )
  WHERE status = 'confirmed';

CREATE TABLE ai_personal_memory_revisions (
  memory_id uuid NOT NULL REFERENCES ai_personal_memories (id) ON DELETE CASCADE,
  revision integer NOT NULL CHECK (revision >= 1),
  actor_user_id uuid NOT NULL REFERENCES app_users (id) ON DELETE RESTRICT,
  snapshot jsonb NOT NULL CHECK (jsonb_typeof(snapshot) = 'object'),
  cause text NOT NULL CHECK (cause IN ('created', 'edited', 'confirmed', 'forgotten', 'ai_suggested')),
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (memory_id, revision)
);

COMMENT ON TABLE ai_conversation_checkpoints IS
  'Versioned provider-neutral summaries of conversation text through one successful request.';

COMMENT ON TABLE ai_personal_memories IS
  'Private app-user preferences reused across trips; only confirmed active rows enter AI planning context.';

COMMENT ON INDEX ai_personal_memories_search_idx IS
  'PostgreSQL full-text index used for prompt-relevant preference retrieval without an embedding service.';
