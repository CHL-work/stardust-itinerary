ALTER TABLE preference_import_batches
  ADD COLUMN catalog_sha256 bytea;

UPDATE preference_import_batches
   SET catalog_sha256 = source_sha256
 WHERE catalog_sha256 IS NULL;

ALTER TABLE preference_import_batches
  ALTER COLUMN catalog_sha256 SET NOT NULL,
  ADD CHECK (octet_length(catalog_sha256) = 32);

COMMENT ON COLUMN preference_import_batches.catalog_sha256 IS
  'SHA-256 of the validated normalized catalog payload. One immutable normalized payload is bound to each user/source digest.';

-- Migration 0015 was exercised locally before payload hashes existed. Upgrade only
-- the exact reviewed owner catalog; any altered legacy batch keeps the source-hash
-- sentinel and is rejected by the importer for manual investigation.
WITH verified_legacy_batch AS (
  SELECT batch.id
    FROM preference_import_batches batch
   WHERE encode(batch.source_sha256, 'hex') =
         'a9805d200d68e8780d6e8d5b05fad418ec9252ae725d2e543033992b8b2e76ce'
     AND batch.catalog_sha256 = batch.source_sha256
     AND batch.status = 'applied'
     AND batch.row_count = 903
     AND batch.unique_entity_count = 876
     AND batch.preference_count = 823
     AND batch.source_label = 'reviewed-owner-media-library-2026-09-02'
     AND batch.source_created_on = DATE '2026-09-02'
     AND batch.parser_version = 1
     AND batch.schema_version = 1
     AND batch.metadata = '{
       "adultRows": 73,
       "semantics": {
         "explicitRows": "owner_stated",
         "typeMoonExpansion": "catalog_only",
         "filesystemPresence": "likely_known_only",
         "localPathsExcluded": true,
         "accountIdentifiersExcluded": true
       },
       "catalogKey": "owner-media-preferences-2026-09-02",
       "evidenceCount": 851
     }'::jsonb
     AND (
       SELECT count(*) FROM preference_import_rows row
        WHERE row.batch_id = batch.id AND row.app_user_id = batch.app_user_id
     ) = 903
     AND (
       SELECT count(*) FROM user_catalog_preference_evidence evidence
        WHERE evidence.batch_id = batch.id AND evidence.app_user_id = batch.app_user_id
     ) = 851
     AND (
       SELECT md5(string_agg(
         concat_ws(chr(31), row.row_number::text, row.section_key, row.source_label,
           row.normalized_label, row.inferred_category, row.evidence_type,
           row.confidence::text, row.resolution, entity.kind, entity.canonical_name,
           coalesce(row.metadata->>'contentRating', '')),
         chr(30) ORDER BY row.row_number
       ))
         FROM preference_import_rows row
         JOIN preference_catalog_entities entity ON entity.id = row.catalog_entity_id
        WHERE row.batch_id = batch.id AND row.app_user_id = batch.app_user_id
     ) = 'ee31ca27a413258365e45bec845afd71'
     AND (
       SELECT md5(string_agg(
         concat_ws(chr(31), entity.kind, entity.canonical_name, preference.familiarity,
           preference.affinity, preference.affinity_explicit::text,
           preference.source_type, preference.confidence::text, preference.status),
         chr(30) ORDER BY entity.kind, entity.canonical_name, entity.id
       ))
         FROM user_catalog_preferences preference
         JOIN preference_catalog_entities entity ON entity.id = preference.catalog_entity_id
        WHERE preference.source_batch_id = batch.id
          AND preference.app_user_id = batch.app_user_id
     ) = 'cbd6f2eccb23059b25fb731d777e9506'
     AND (
       SELECT md5(string_agg(
         concat_ws(chr(31), entity.kind, entity.canonical_name, entity.normalized_name,
           entity.content_rating, entity.status),
         chr(30) ORDER BY entity.kind, entity.normalized_name, entity.id
       ))
         FROM preference_catalog_entities entity
        WHERE entity.metadata->>'catalogKey' = 'owner-media-preferences-2026-09-02'
     ) = 'f99131061d2a52adc8b905a36b86d745'
     AND (
       SELECT md5(string_agg(
         concat_ws(chr(31), entity.kind, entity.normalized_name, alias.alias,
           alias.normalized_alias, alias.locale, alias.alias_kind),
         chr(30) ORDER BY entity.kind, entity.normalized_name,
           alias.normalized_alias, alias.locale
       ))
         FROM preference_catalog_aliases alias
         JOIN preference_catalog_entities entity ON entity.id = alias.entity_id
        WHERE entity.metadata->>'catalogKey' = 'owner-media-preferences-2026-09-02'
     ) = 'fc42f28f98851d04c465cc6429a13dea'
     AND (
       SELECT md5(string_agg(
         concat_ws(chr(31), entity.kind, entity.normalized_name, category.category),
         chr(30) ORDER BY entity.kind, entity.normalized_name, category.category
       ))
         FROM preference_catalog_categories category
         JOIN preference_catalog_entities entity ON entity.id = category.entity_id
        WHERE entity.metadata->>'catalogKey' = 'owner-media-preferences-2026-09-02'
     ) = '768785bffd2330ce5e78ff454382586d'
     AND (
       SELECT md5(string_agg(
         concat_ws(chr(31), child.kind, child.normalized_name, parent.kind,
           parent.normalized_name, relation.relation_type, relation.source_key),
         chr(30) ORDER BY child.kind, child.normalized_name, parent.kind,
           parent.normalized_name, relation.relation_type
       ))
         FROM preference_catalog_relations relation
         JOIN preference_catalog_entities child ON child.id = relation.child_entity_id
         JOIN preference_catalog_entities parent ON parent.id = relation.parent_entity_id
        WHERE child.metadata->>'catalogKey' = 'owner-media-preferences-2026-09-02'
          AND parent.metadata->>'catalogKey' = 'owner-media-preferences-2026-09-02'
     ) = 'e96b6e3fd82dc10fa98b4191f760d7be'
)
UPDATE preference_import_batches batch
   SET catalog_sha256 = decode(
     '0e4f17d64f810a082c417f4ea3a16e99b5bc5bede332003085799261c8065bb1',
     'hex'
   )
  FROM verified_legacy_batch verified
 WHERE batch.id = verified.id;

UPDATE preference_import_rows row
   SET metadata = jsonb_set(row.metadata, '{contentRating}', '"general"'::jsonb, true)
  FROM preference_import_batches batch
 WHERE batch.id = row.batch_id
   AND batch.app_user_id = row.app_user_id
   AND encode(batch.catalog_sha256, 'hex') =
       '0e4f17d64f810a082c417f4ea3a16e99b5bc5bede332003085799261c8065bb1'
   AND (row.section_key = 'type_moon_catalog_expansion' OR row.source_label = 'TYPE-MOON');

WITH rating_inputs AS (
  SELECT row.catalog_entity_id AS entity_id,
         CASE row.metadata->>'contentRating'
           WHEN 'adult' THEN 3 WHEN 'mixed' THEN 2 WHEN 'unknown' THEN 1 ELSE 0
         END AS rating_rank
    FROM preference_import_rows row
    JOIN preference_import_batches batch
      ON batch.id = row.batch_id AND batch.app_user_id = row.app_user_id
   WHERE encode(batch.catalog_sha256, 'hex') =
         '0e4f17d64f810a082c417f4ea3a16e99b5bc5bede332003085799261c8065bb1'
  UNION ALL
  SELECT entity.id, 0
    FROM preference_catalog_entities entity
   WHERE entity.metadata->>'catalogKey' = 'owner-media-preferences-2026-09-02'
     AND (entity.kind, entity.canonical_name) IN (
     ('brand', 'TYPE-MOON'), ('franchise', 'Fate'), ('franchise', '月姫')
   )
     AND EXISTS (
       SELECT 1 FROM preference_import_batches batch
        WHERE encode(batch.catalog_sha256, 'hex') =
              '0e4f17d64f810a082c417f4ea3a16e99b5bc5bede332003085799261c8065bb1'
     )
), resolved_ratings AS (
  SELECT entity_id,
         CASE max(rating_rank)
           WHEN 3 THEN 'adult' WHEN 2 THEN 'mixed' WHEN 1 THEN 'unknown' ELSE 'general'
         END AS content_rating
    FROM rating_inputs
   GROUP BY entity_id
)
UPDATE preference_catalog_entities entity
   SET content_rating = rating.content_rating,
       updated_at = CURRENT_TIMESTAMP
  FROM resolved_ratings rating
 WHERE entity.id = rating.entity_id;

CREATE OR REPLACE FUNCTION app_preference_relation_reject_group_cycle()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.relation_type NOT IN ('part_of', 'under_brand') THEN
    RETURN NEW;
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('stardust-preference-catalog-graph', 0));
  IF TG_OP = 'UPDATE' THEN
    IF EXISTS (
      WITH RECURSIVE ancestors(entity_id) AS (
        SELECT NEW.parent_entity_id
        UNION
        SELECT relation.parent_entity_id
          FROM preference_catalog_relations relation
          JOIN ancestors ON ancestors.entity_id = relation.child_entity_id
         WHERE relation.relation_type IN ('part_of', 'under_brand')
           AND (relation.child_entity_id, relation.parent_entity_id, relation.relation_type)
               <> (OLD.child_entity_id, OLD.parent_entity_id, OLD.relation_type)
      )
      SELECT 1 FROM ancestors WHERE entity_id = NEW.child_entity_id
    ) THEN
      RAISE EXCEPTION 'preference catalog grouping relation would create a cycle';
    END IF;
  ELSE
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
  END IF;
  RETURN NEW;
END;
$$;

ALTER TABLE user_catalog_preferences
  ADD CONSTRAINT user_catalog_preferences_owner_entity_ref_uk
  UNIQUE (app_user_id, id, catalog_entity_id);

ALTER TABLE preference_import_rows
  ADD CONSTRAINT preference_import_rows_preference_entity_fk
  FOREIGN KEY (app_user_id, user_preference_id, catalog_entity_id)
  REFERENCES user_catalog_preferences (app_user_id, id, catalog_entity_id)
  ON DELETE RESTRICT,
  ADD CONSTRAINT preference_import_rows_evidence_ref_uk
  UNIQUE (batch_id, row_number, app_user_id, user_preference_id);

ALTER TABLE user_catalog_preference_evidence
  ADD CONSTRAINT user_catalog_preference_evidence_import_preference_fk
  FOREIGN KEY (batch_id, import_row_number, app_user_id, preference_id)
  REFERENCES preference_import_rows (batch_id, row_number, app_user_id, user_preference_id)
  ON DELETE RESTRICT;

ALTER TABLE user_catalog_preference_revisions
  ADD CONSTRAINT user_catalog_preference_revisions_self_actor_ck
  CHECK (actor_user_id = app_user_id);

CREATE FUNCTION app_reject_preference_history_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  purge_owner name;
BEGIN
  SELECT role.rolname
    INTO purge_owner
    FROM pg_proc procedure
    JOIN pg_roles role ON role.oid = procedure.proowner
   WHERE procedure.oid = to_regprocedure('app_purge_user_preference_data(uuid)');

  IF current_setting('app.preference_erasure', true) = 'on'
     AND purge_owner IS NOT NULL
     AND current_user = purge_owner THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION '% is append-only', TG_TABLE_NAME;
END;
$$;

CREATE FUNCTION app_preference_import_batch_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  purge_owner name;
BEGIN
  SELECT role.rolname
    INTO purge_owner
    FROM pg_proc procedure
    JOIN pg_roles role ON role.oid = procedure.proowner
   WHERE procedure.oid = to_regprocedure('app_purge_user_preference_data(uuid)');

  IF TG_OP <> 'INSERT'
     AND current_setting('app.preference_erasure', true) = 'on'
     AND purge_owner IS NOT NULL
     AND current_user = purge_owner THEN
    RETURN OLD;
  END IF;

  IF TG_OP = 'INSERT'
     AND NEW.status = 'staged'
     AND NEW.row_count = 0
     AND NEW.unique_entity_count = 0
     AND NEW.preference_count = 0
     AND NEW.completed_at IS NULL THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE'
     AND OLD.status = 'staged'
     AND NEW.status IN ('applied', 'failed')
     AND NEW.id = OLD.id
     AND NEW.app_user_id = OLD.app_user_id
     AND NEW.source_sha256 = OLD.source_sha256
     AND NEW.catalog_sha256 = OLD.catalog_sha256
     AND NEW.source_label = OLD.source_label
     AND NEW.source_created_on IS NOT DISTINCT FROM OLD.source_created_on
     AND NEW.parser_version = OLD.parser_version
     AND NEW.schema_version = OLD.schema_version
     AND NEW.created_at = OLD.created_at
     AND (
       NEW.status = 'failed'
       OR (
         NEW.row_count = (
           SELECT count(*) FROM preference_import_rows row
            WHERE row.batch_id = NEW.id AND row.app_user_id = NEW.app_user_id
         )
         AND NEW.preference_count = (
           SELECT count(DISTINCT row.user_preference_id)
             FROM preference_import_rows row
            WHERE row.batch_id = NEW.id AND row.app_user_id = NEW.app_user_id
         )
         AND NEW.unique_entity_count = (
           SELECT count(*) FROM preference_catalog_entities entity
            WHERE entity.metadata->>'catalogKey' = NEW.metadata->>'catalogKey'
         )
         AND (NEW.metadata->>'evidenceCount')::integer = (
           SELECT count(*) FROM user_catalog_preference_evidence evidence
            WHERE evidence.batch_id = NEW.id AND evidence.app_user_id = NEW.app_user_id
         )
       )
     ) THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'applied preference import batches are immutable';
END;
$$;

CREATE FUNCTION app_preference_import_row_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  purge_owner name;
BEGIN
  SELECT role.rolname
    INTO purge_owner
    FROM pg_proc procedure
    JOIN pg_roles role ON role.oid = procedure.proowner
   WHERE procedure.oid = to_regprocedure('app_purge_user_preference_data(uuid)');

  IF TG_OP = 'INSERT' AND EXISTS (
    SELECT 1 FROM preference_import_batches batch
     WHERE batch.id = NEW.batch_id
       AND batch.app_user_id = NEW.app_user_id
       AND batch.status = 'staged'
  ) THEN
    RETURN NEW;
  END IF;
  IF TG_OP <> 'INSERT'
     AND current_setting('app.preference_erasure', true) = 'on'
     AND purge_owner IS NOT NULL
     AND current_user = purge_owner THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'preference import rows require a staged batch and are immutable';
END;
$$;

CREATE FUNCTION app_preference_evidence_insert_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.batch_id IS NULL OR EXISTS (
    SELECT 1 FROM preference_import_batches batch
     WHERE batch.id = NEW.batch_id
       AND batch.app_user_id = NEW.app_user_id
       AND batch.status = 'staged'
  ) THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'batch-backed preference evidence requires a staged batch';
END;
$$;

DROP TRIGGER ai_personal_memory_revisions_append_only ON ai_personal_memory_revisions;
DROP TRIGGER user_catalog_preference_evidence_append_only ON user_catalog_preference_evidence;
DROP TRIGGER user_catalog_preference_revisions_append_only ON user_catalog_preference_revisions;

CREATE TRIGGER ai_personal_memory_revisions_append_only
BEFORE UPDATE OR DELETE ON ai_personal_memory_revisions
FOR EACH ROW EXECUTE FUNCTION app_reject_preference_history_mutation();

CREATE TRIGGER user_catalog_preference_evidence_append_only
BEFORE UPDATE OR DELETE ON user_catalog_preference_evidence
FOR EACH ROW EXECUTE FUNCTION app_reject_preference_history_mutation();

CREATE TRIGGER user_catalog_preference_revisions_append_only
BEFORE UPDATE OR DELETE ON user_catalog_preference_revisions
FOR EACH ROW EXECUTE FUNCTION app_reject_preference_history_mutation();

CREATE TRIGGER preference_import_rows_append_only
BEFORE INSERT OR UPDATE OR DELETE ON preference_import_rows
FOR EACH ROW EXECUTE FUNCTION app_preference_import_row_guard();

CREATE TRIGGER preference_import_batches_immutable
BEFORE INSERT OR UPDATE OR DELETE ON preference_import_batches
FOR EACH ROW EXECUTE FUNCTION app_preference_import_batch_guard();

CREATE TRIGGER user_catalog_preference_evidence_staged_batch
BEFORE INSERT ON user_catalog_preference_evidence
FOR EACH ROW EXECUTE FUNCTION app_preference_evidence_insert_guard();

CREATE FUNCTION app_purge_user_preference_data(target_user_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(target_user_id::text || ':preference-data', 0));
  PERFORM set_config('app.preference_erasure', 'on', true);

  DELETE FROM public.user_catalog_preference_evidence WHERE app_user_id = target_user_id;
  DELETE FROM public.user_catalog_preference_revisions WHERE app_user_id = target_user_id;
  DELETE FROM public.preference_import_rows WHERE app_user_id = target_user_id;
  DELETE FROM public.user_catalog_preferences WHERE app_user_id = target_user_id;
  DELETE FROM public.preference_import_batches WHERE app_user_id = target_user_id;
  DELETE FROM public.ai_personal_memory_revisions revision
   USING public.ai_personal_memories memory
   WHERE revision.memory_id = memory.id AND memory.app_user_id = target_user_id;
  DELETE FROM public.ai_personal_memories WHERE app_user_id = target_user_id;
END;
$$;

REVOKE ALL ON FUNCTION app_purge_user_preference_data(uuid) FROM PUBLIC;

COMMENT ON FUNCTION app_purge_user_preference_data(uuid) IS
  'Migration-owner-only privacy erasure for one app user; ordinary history mutations remain rejected.';
