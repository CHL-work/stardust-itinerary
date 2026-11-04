CREATE TABLE preference_catalog_entities (
  id uuid PRIMARY KEY,
  kind text NOT NULL CHECK (kind IN (
    'media_work', 'franchise', 'universe', 'creator', 'brand', 'genre', 'activity', 'other'
  )),
  canonical_name text NOT NULL CHECK (length(btrim(canonical_name)) BETWEEN 1 AND 240),
  normalized_name text NOT NULL CHECK (length(btrim(normalized_name)) BETWEEN 1 AND 240),
  content_rating text NOT NULL DEFAULT 'unknown'
    CHECK (content_rating IN ('general', 'adult', 'mixed', 'unknown')),
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'deprecated', 'merged')),
  merged_into_id uuid REFERENCES preference_catalog_entities (id) ON DELETE RESTRICT,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (kind, normalized_name),
  CHECK (merged_into_id IS NULL OR merged_into_id <> id),
  CHECK ((status = 'merged') = (merged_into_id IS NOT NULL))
);

CREATE INDEX preference_catalog_entities_name_idx
  ON preference_catalog_entities (normalized_name, kind)
  WHERE status = 'active';

CREATE TABLE preference_catalog_aliases (
  entity_id uuid NOT NULL REFERENCES preference_catalog_entities (id) ON DELETE CASCADE,
  alias text NOT NULL CHECK (length(btrim(alias)) BETWEEN 1 AND 240),
  normalized_alias text NOT NULL CHECK (length(btrim(normalized_alias)) BETWEEN 1 AND 240),
  locale text NOT NULL DEFAULT 'und' CHECK (locale IN ('und', 'en', 'ja', 'zh-HK')),
  alias_kind text NOT NULL DEFAULT 'alternate'
    CHECK (alias_kind IN ('canonical', 'abbreviation', 'localized', 'romanized', 'alternate', 'legacy')),
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (entity_id, normalized_alias, locale)
);

CREATE INDEX preference_catalog_aliases_lookup_idx
  ON preference_catalog_aliases (normalized_alias, entity_id);

CREATE TABLE preference_catalog_categories (
  entity_id uuid NOT NULL REFERENCES preference_catalog_entities (id) ON DELETE CASCADE,
  category text NOT NULL CHECK (category IN (
    'anime', 'manga', 'novel', 'movie', 'tv', 'game', 'activity', 'food', 'shopping', 'other'
  )),
  PRIMARY KEY (entity_id, category)
);

CREATE INDEX preference_catalog_categories_category_idx
  ON preference_catalog_categories (category, entity_id);

CREATE TABLE preference_catalog_relations (
  child_entity_id uuid NOT NULL REFERENCES preference_catalog_entities (id) ON DELETE RESTRICT,
  parent_entity_id uuid NOT NULL REFERENCES preference_catalog_entities (id) ON DELETE RESTRICT,
  relation_type text NOT NULL CHECK (relation_type IN (
    'part_of', 'under_brand', 'adaptation_of', 'created_by', 'related_to'
  )),
  source_key text NOT NULL CHECK (length(btrim(source_key)) BETWEEN 1 AND 120),
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (child_entity_id, parent_entity_id, relation_type),
  CHECK (child_entity_id <> parent_entity_id)
);

CREATE INDEX preference_catalog_relations_parent_idx
  ON preference_catalog_relations (parent_entity_id, relation_type, child_entity_id);

CREATE FUNCTION app_preference_relation_reject_group_cycle()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.relation_type NOT IN ('part_of', 'under_brand') THEN
    RETURN NEW;
  END IF;

  IF EXISTS (
    WITH RECURSIVE ancestors(entity_id) AS (
      SELECT NEW.parent_entity_id
      UNION
      SELECT relation.parent_entity_id
        FROM preference_catalog_relations relation
        JOIN ancestors ON ancestors.entity_id = relation.child_entity_id
       WHERE relation.relation_type IN ('part_of', 'under_brand')
    )
    SELECT 1 FROM ancestors WHERE entity_id = NEW.child_entity_id
  ) THEN
    RAISE EXCEPTION 'preference catalog grouping relation would create a cycle';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER preference_catalog_relations_no_group_cycle
BEFORE INSERT OR UPDATE ON preference_catalog_relations
FOR EACH ROW EXECUTE FUNCTION app_preference_relation_reject_group_cycle();

CREATE TABLE preference_import_batches (
  id uuid PRIMARY KEY,
  app_user_id uuid NOT NULL REFERENCES app_users (id) ON DELETE RESTRICT,
  source_sha256 bytea NOT NULL CHECK (octet_length(source_sha256) = 32),
  source_label text NOT NULL CHECK (length(btrim(source_label)) BETWEEN 1 AND 160),
  source_created_on date,
  parser_version integer NOT NULL CHECK (parser_version >= 1),
  schema_version integer NOT NULL CHECK (schema_version >= 1),
  status text NOT NULL CHECK (status IN ('staged', 'applied', 'failed')),
  row_count integer NOT NULL DEFAULT 0 CHECK (row_count >= 0),
  unique_entity_count integer NOT NULL DEFAULT 0 CHECK (unique_entity_count >= 0),
  preference_count integer NOT NULL DEFAULT 0 CHECK (preference_count >= 0),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at timestamptz,
  UNIQUE (app_user_id, source_sha256),
  UNIQUE (id, app_user_id),
  CHECK ((status = 'staged') = (completed_at IS NULL))
);

CREATE TABLE user_catalog_preferences (
  id uuid PRIMARY KEY,
  app_user_id uuid NOT NULL REFERENCES app_users (id) ON DELETE CASCADE,
  catalog_entity_id uuid NOT NULL REFERENCES preference_catalog_entities (id) ON DELETE RESTRICT,
  familiarity text NOT NULL DEFAULT 'likely_known' CHECK (familiarity IN (
    'unknown', 'likely_known', 'known', 'started', 'completed', 'interested'
  )),
  affinity text NOT NULL DEFAULT 'unspecified' CHECK (affinity IN (
    'unspecified', 'favorite', 'like', 'neutral', 'dislike', 'avoid'
  )),
  affinity_explicit boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'forgotten')),
  source_type text NOT NULL CHECK (source_type IN (
    'user_stated', 'filesystem_presence', 'manual', 'ai_explicit', 'ai_inferred'
  )),
  confidence numeric(4,3) NOT NULL CHECK (confidence BETWEEN 0 AND 1),
  source_batch_id uuid,
  current_revision integer NOT NULL DEFAULT 1 CHECK (current_revision >= 1),
  last_retrieved_at timestamptz,
  forgotten_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (app_user_id, catalog_entity_id),
  UNIQUE (app_user_id, id),
  FOREIGN KEY (source_batch_id, app_user_id)
    REFERENCES preference_import_batches (id, app_user_id) ON DELETE RESTRICT,
  CHECK (affinity_explicit OR affinity = 'unspecified'),
  CHECK ((status = 'forgotten') = (forgotten_at IS NOT NULL))
);

CREATE INDEX user_catalog_preferences_user_idx
  ON user_catalog_preferences (app_user_id, status, affinity_explicit DESC, updated_at DESC, id);

CREATE INDEX user_catalog_preferences_entity_idx
  ON user_catalog_preferences (catalog_entity_id, app_user_id)
  WHERE status = 'active';

CREATE TABLE preference_import_rows (
  batch_id uuid NOT NULL,
  app_user_id uuid NOT NULL,
  row_number integer NOT NULL CHECK (row_number >= 1),
  section_key text NOT NULL CHECK (length(btrim(section_key)) BETWEEN 1 AND 80),
  source_label text NOT NULL CHECK (length(btrim(source_label)) BETWEEN 1 AND 240),
  normalized_label text NOT NULL CHECK (length(btrim(normalized_label)) BETWEEN 1 AND 240),
  inferred_category text NOT NULL CHECK (inferred_category IN (
    'anime', 'manga', 'novel', 'movie', 'tv', 'game', 'activity', 'food', 'shopping', 'other'
  )),
  evidence_type text NOT NULL CHECK (evidence_type IN (
    'user_stated', 'filesystem_presence', 'catalog_expansion'
  )),
  confidence numeric(4,3) NOT NULL CHECK (confidence BETWEEN 0 AND 1),
  resolution text NOT NULL CHECK (resolution IN ('matched', 'created', 'ambiguous', 'ignored')),
  catalog_entity_id uuid REFERENCES preference_catalog_entities (id) ON DELETE RESTRICT,
  user_preference_id uuid,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(metadata) = 'object'),
  PRIMARY KEY (batch_id, row_number),
  UNIQUE (batch_id, row_number, app_user_id),
  FOREIGN KEY (batch_id, app_user_id)
    REFERENCES preference_import_batches (id, app_user_id) ON DELETE CASCADE,
  FOREIGN KEY (app_user_id, user_preference_id)
    REFERENCES user_catalog_preferences (app_user_id, id) ON DELETE RESTRICT,
  CHECK ((resolution IN ('matched', 'created')) = (catalog_entity_id IS NOT NULL)),
  CHECK (evidence_type <> 'catalog_expansion' OR user_preference_id IS NULL)
);

CREATE INDEX preference_import_rows_entity_idx
  ON preference_import_rows (catalog_entity_id, batch_id, row_number);

CREATE TABLE user_catalog_preference_evidence (
  app_user_id uuid NOT NULL,
  id uuid NOT NULL,
  preference_id uuid NOT NULL,
  batch_id uuid,
  import_row_number integer,
  evidence_type text NOT NULL CHECK (evidence_type IN (
    'user_stated', 'filesystem_presence', 'manual', 'ai_explicit', 'ai_inferred'
  )),
  confidence numeric(4,3) NOT NULL CHECK (confidence BETWEEN 0 AND 1),
  observed_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(metadata) = 'object'),
  PRIMARY KEY (app_user_id, id),
  FOREIGN KEY (app_user_id, preference_id)
    REFERENCES user_catalog_preferences (app_user_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (batch_id, import_row_number, app_user_id)
    REFERENCES preference_import_rows (batch_id, row_number, app_user_id) ON DELETE RESTRICT,
  CHECK ((batch_id IS NULL) = (import_row_number IS NULL))
);

CREATE INDEX user_catalog_preference_evidence_preference_idx
  ON user_catalog_preference_evidence (app_user_id, preference_id, observed_at DESC);

CREATE TABLE user_catalog_preference_revisions (
  app_user_id uuid NOT NULL,
  preference_id uuid NOT NULL,
  revision integer NOT NULL CHECK (revision >= 1),
  actor_user_id uuid NOT NULL REFERENCES app_users (id) ON DELETE RESTRICT,
  snapshot jsonb NOT NULL CHECK (jsonb_typeof(snapshot) = 'object'),
  cause text NOT NULL CHECK (cause IN ('imported', 'edited', 'forgotten', 'restored')),
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (app_user_id, preference_id, revision),
  FOREIGN KEY (app_user_id, preference_id)
    REFERENCES user_catalog_preferences (app_user_id, id) ON DELETE RESTRICT
);

CREATE TRIGGER ai_personal_memory_revisions_append_only
BEFORE UPDATE OR DELETE ON ai_personal_memory_revisions
FOR EACH ROW EXECUTE FUNCTION app_reject_append_only_mutation();

CREATE TRIGGER user_catalog_preference_evidence_append_only
BEFORE UPDATE OR DELETE ON user_catalog_preference_evidence
FOR EACH ROW EXECUTE FUNCTION app_reject_append_only_mutation();

CREATE TRIGGER user_catalog_preference_revisions_append_only
BEFORE UPDATE OR DELETE ON user_catalog_preference_revisions
FOR EACH ROW EXECUTE FUNCTION app_reject_append_only_mutation();

COMMENT ON TABLE preference_catalog_entities IS
  'Provider-neutral canonical works, franchises, brands, creators, genres, and activities shared across users.';

COMMENT ON TABLE preference_catalog_relations IS
  'Directed catalog graph; grouping traversal uses part_of and under_brand without propagating user affinity.';

COMMENT ON TABLE user_catalog_preferences IS
  'Private app-user assertions separated into familiarity and explicit affinity so likely-known never means watched or liked.';

COMMENT ON TABLE preference_import_rows IS
  'Sanitized row-level provenance. Absolute paths and source-document prose are intentionally not stored.';

COMMENT ON TABLE user_catalog_preference_evidence IS
  'Append-only evidence for each private preference assertion; metadata must not contain local paths or account identifiers.';
