-- Keep migration 0016 immutable: it is already recorded on the local data-bearing
-- database. This migration validates any reviewed batch that 0016 certified,
-- performs the same upgrade only for an exact still-legacy batch, and installs
-- race-free staged-child guards.

DROP TRIGGER preference_import_rows_append_only ON preference_import_rows;
DROP TRIGGER preference_import_batches_immutable ON preference_import_batches;
DROP TRIGGER user_catalog_preference_evidence_staged_batch
  ON user_catalog_preference_evidence;

CREATE TEMP TABLE verified_reviewed_preference_batches (
  id uuid PRIMARY KEY,
  app_user_id uuid NOT NULL,
  prior_state text NOT NULL CHECK (prior_state IN ('legacy', 'current')),
  catalog_key text NOT NULL,
  source_sha256 bytea NOT NULL,
  target_catalog_sha256 bytea NOT NULL
) ON COMMIT DROP;

INSERT INTO verified_reviewed_preference_batches (
  id, app_user_id, prior_state, catalog_key, source_sha256,
  target_catalog_sha256
)
SELECT batch.id,
       batch.app_user_id,
       CASE WHEN batch.catalog_sha256 = batch.source_sha256
         THEN 'legacy' ELSE 'current'
       END,
       'owner-media-preferences-2026-09-02',
       decode('a9805d200d68e8780d6e8d5b05fad418ec9252ae725d2e543033992b8b2e76ce', 'hex'),
       decode('0e4f17d64f810a082c417f4ea3a16e99b5bc5bede332003085799261c8065bb1', 'hex')
  FROM preference_import_batches batch
 WHERE batch.source_sha256 = decode(
         'a9805d200d68e8780d6e8d5b05fad418ec9252ae725d2e543033992b8b2e76ce',
         'hex'
       )
   AND batch.catalog_sha256 IN (
         batch.source_sha256,
         decode('0e4f17d64f810a082c417f4ea3a16e99b5bc5bede332003085799261c8065bb1', 'hex')
       )
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
     SELECT count(*)
       FROM preference_import_rows row
      WHERE row.batch_id = batch.id
        AND row.app_user_id = batch.app_user_id
   ) = 903
   AND (
     SELECT bool_and(
       row.metadata = jsonb_build_object(
         'contentRating', row.metadata->>'contentRating'
       )
       AND row.metadata->>'contentRating' IN ('general', 'adult', 'mixed', 'unknown')
     )
       FROM preference_import_rows row
      WHERE row.batch_id = batch.id
        AND row.app_user_id = batch.app_user_id
   ) IS TRUE
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
      WHERE row.batch_id = batch.id
        AND row.app_user_id = batch.app_user_id
   ) = CASE WHEN batch.catalog_sha256 = batch.source_sha256
       THEN 'ee31ca27a413258365e45bec845afd71'
       ELSE '9c15efce8a09fb60df277ecf8fdea39b'
     END
   AND (
     SELECT count(*)
       FROM user_catalog_preferences preference
      WHERE preference.source_batch_id = batch.id
        AND preference.app_user_id = batch.app_user_id
   ) = 823
   AND (
     SELECT count(*)
       FROM user_catalog_preference_evidence evidence
      WHERE evidence.batch_id = batch.id
        AND evidence.app_user_id = batch.app_user_id
   ) = 851
   AND (
     SELECT bool_and(
       evidence.preference_id = row.user_preference_id
       AND evidence.evidence_type = row.evidence_type
       AND evidence.confidence = row.confidence
       AND evidence.observed_at = batch.created_at
       AND evidence.metadata = jsonb_build_object(
         'section', row.section_key,
         'privateContentExcluded', true
       )
     )
       FROM user_catalog_preference_evidence evidence
       JOIN preference_import_rows row
         ON row.batch_id = evidence.batch_id
        AND row.row_number = evidence.import_row_number
        AND row.app_user_id = evidence.app_user_id
      WHERE evidence.batch_id = batch.id
        AND evidence.app_user_id = batch.app_user_id
   ) IS TRUE
   AND (
     SELECT md5(string_agg(
       concat_ws(chr(31), row.row_number::text, row.section_key,
         entity.kind, entity.canonical_name, evidence.evidence_type,
         evidence.confidence::text),
       chr(30) ORDER BY row.row_number
     ))
       FROM user_catalog_preference_evidence evidence
       JOIN preference_import_rows row
         ON row.batch_id = evidence.batch_id
        AND row.row_number = evidence.import_row_number
        AND row.app_user_id = evidence.app_user_id
       JOIN preference_catalog_entities entity ON entity.id = row.catalog_entity_id
      WHERE evidence.batch_id = batch.id
        AND evidence.app_user_id = batch.app_user_id
   ) = '5246b750f2c281e64661b99755660e96'
   AND (
     SELECT count(*)
       FROM user_catalog_preference_revisions revision
       JOIN user_catalog_preferences preference
         ON preference.app_user_id = revision.app_user_id
        AND preference.id = revision.preference_id
      WHERE preference.source_batch_id = batch.id
        AND preference.app_user_id = batch.app_user_id
        AND revision.revision = 1
        AND revision.cause = 'imported'
   ) = 823
   AND (
     SELECT bool_and(
       revision.actor_user_id = batch.app_user_id
       AND revision.created_at = batch.created_at
       AND revision.snapshot = jsonb_build_object(
         'catalogEntityId', preference.catalog_entity_id,
         'familiarity', revision.snapshot->'familiarity',
         'affinity', revision.snapshot->'affinity',
         'affinityExplicit', revision.snapshot->'affinityExplicit',
         'status', revision.snapshot->'status',
         'sourceType', revision.snapshot->'sourceType',
         'confidence', revision.snapshot->'confidence'
       )
     )
       FROM user_catalog_preference_revisions revision
       JOIN user_catalog_preferences preference
         ON preference.app_user_id = revision.app_user_id
        AND preference.id = revision.preference_id
      WHERE preference.source_batch_id = batch.id
        AND preference.app_user_id = batch.app_user_id
        AND revision.revision = 1
        AND revision.cause = 'imported'
   ) IS TRUE
   AND (
     SELECT md5(string_agg(
       concat_ws(chr(31), entity.kind, entity.canonical_name,
         revision.revision::text, revision.cause,
         revision.snapshot->>'familiarity', revision.snapshot->>'affinity',
         revision.snapshot->>'affinityExplicit', revision.snapshot->>'sourceType',
         ((revision.snapshot->>'confidence')::numeric(4,3))::text,
         revision.snapshot->>'status'),
       chr(30) ORDER BY entity.kind COLLATE "C",
         entity.canonical_name COLLATE "C", entity.id
     ))
       FROM user_catalog_preference_revisions revision
       JOIN user_catalog_preferences preference
         ON preference.app_user_id = revision.app_user_id
        AND preference.id = revision.preference_id
       JOIN preference_catalog_entities entity
         ON entity.id = preference.catalog_entity_id
      WHERE preference.source_batch_id = batch.id
        AND preference.app_user_id = batch.app_user_id
        AND revision.revision = 1
        AND revision.cause = 'imported'
   ) = '650b8d2ec652014e1adbb5adc98d6f8d'
   AND (
     SELECT count(*)
       FROM preference_catalog_entities entity
      WHERE entity.metadata->>'catalogKey' =
            'owner-media-preferences-2026-09-02'
   ) = 876
   AND (
     SELECT bool_and(
       entity.metadata = '{"catalogKey":"owner-media-preferences-2026-09-02"}'::jsonb
     )
       FROM preference_catalog_entities entity
      WHERE entity.metadata->>'catalogKey' =
            'owner-media-preferences-2026-09-02'
   ) IS TRUE
   AND (
     SELECT md5(string_agg(
       concat_ws(chr(31), entity.kind, entity.canonical_name,
         entity.normalized_name, entity.content_rating, entity.status),
       chr(30) ORDER BY entity.kind COLLATE "C",
         entity.normalized_name COLLATE "C", entity.id
     ))
       FROM preference_catalog_entities entity
      WHERE entity.metadata->>'catalogKey' =
            'owner-media-preferences-2026-09-02'
   ) = CASE WHEN batch.catalog_sha256 = batch.source_sha256
       THEN 'f99131061d2a52adc8b905a36b86d745'
       ELSE 'c42bc98050c227a905ee06b7bc0f19cb'
     END
   AND (
     SELECT md5(string_agg(
       concat_ws(chr(31), entity.kind, entity.normalized_name, alias.alias,
         alias.normalized_alias, alias.locale, alias.alias_kind),
       chr(30) ORDER BY entity.kind COLLATE "C",
         entity.normalized_name COLLATE "C",
         alias.normalized_alias COLLATE "C", alias.locale COLLATE "C"
     ))
       FROM preference_catalog_aliases alias
       JOIN preference_catalog_entities entity ON entity.id = alias.entity_id
      WHERE entity.metadata->>'catalogKey' =
            'owner-media-preferences-2026-09-02'
   ) = 'fc42f28f98851d04c465cc6429a13dea'
   AND (
     SELECT md5(string_agg(
       concat_ws(chr(31), entity.kind, entity.normalized_name, category.category),
       chr(30) ORDER BY entity.kind COLLATE "C",
         entity.normalized_name COLLATE "C", category.category COLLATE "C"
     ))
       FROM preference_catalog_categories category
       JOIN preference_catalog_entities entity ON entity.id = category.entity_id
      WHERE entity.metadata->>'catalogKey' =
            'owner-media-preferences-2026-09-02'
   ) = '768785bffd2330ce5e78ff454382586d'
   AND (
     SELECT md5(string_agg(
       concat_ws(chr(31), child.kind, child.normalized_name, parent.kind,
         parent.normalized_name, relation.relation_type, relation.source_key),
       chr(30) ORDER BY child.kind COLLATE "C",
         child.normalized_name COLLATE "C", parent.kind COLLATE "C",
         parent.normalized_name COLLATE "C", relation.relation_type COLLATE "C"
     ))
       FROM preference_catalog_relations relation
       JOIN preference_catalog_entities child ON child.id = relation.child_entity_id
       JOIN preference_catalog_entities parent ON parent.id = relation.parent_entity_id
      WHERE child.metadata->>'catalogKey' =
            'owner-media-preferences-2026-09-02'
        AND parent.metadata->>'catalogKey' =
            'owner-media-preferences-2026-09-02'
   ) = 'e96b6e3fd82dc10fa98b4191f760d7be';

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM preference_import_batches batch
     WHERE batch.catalog_sha256 = decode(
             '0e4f17d64f810a082c417f4ea3a16e99b5bc5bede332003085799261c8065bb1',
             'hex'
           )
       AND batch.source_sha256 <> decode(
             'a9805d200d68e8780d6e8d5b05fad418ec9252ae725d2e543033992b8b2e76ce',
             'hex'
           )
  ) THEN
    RAISE EXCEPTION
      'target preference catalog digest is attached to an unrelated source';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM preference_import_batches batch
     WHERE batch.source_sha256 = decode(
             'a9805d200d68e8780d6e8d5b05fad418ec9252ae725d2e543033992b8b2e76ce',
             'hex'
           )
       AND batch.catalog_sha256 = decode(
             '0e4f17d64f810a082c417f4ea3a16e99b5bc5bede332003085799261c8065bb1',
             'hex'
           )
       AND NOT EXISTS (
         SELECT 1
           FROM verified_reviewed_preference_batches verified
          WHERE verified.id = batch.id
            AND verified.app_user_id = batch.app_user_id
       )
  ) THEN
    RAISE EXCEPTION
      'certified preference catalog batch failed exact integrity verification';
  END IF;
END;
$$;

UPDATE preference_import_batches batch
   SET catalog_sha256 = verified.target_catalog_sha256
  FROM verified_reviewed_preference_batches verified
 WHERE verified.prior_state = 'legacy'
   AND batch.id = verified.id
   AND batch.app_user_id = verified.app_user_id
   AND batch.source_sha256 = verified.source_sha256
   AND batch.catalog_sha256 = verified.source_sha256
   AND batch.metadata->>'catalogKey' = verified.catalog_key;

UPDATE preference_import_rows row
   SET metadata = jsonb_set(row.metadata, '{contentRating}', '"general"'::jsonb, true)
  FROM preference_import_batches batch
  JOIN verified_reviewed_preference_batches verified
    ON verified.id = batch.id
   AND verified.app_user_id = batch.app_user_id
   AND verified.prior_state = 'legacy'
   AND verified.source_sha256 = batch.source_sha256
   AND verified.target_catalog_sha256 = batch.catalog_sha256
 WHERE batch.id = row.batch_id
   AND batch.app_user_id = row.app_user_id
   AND batch.metadata->>'catalogKey' = verified.catalog_key
   AND (
     row.section_key = 'type_moon_catalog_expansion'
     OR row.source_label = 'TYPE-MOON'
   );

WITH rating_inputs AS (
  SELECT row.catalog_entity_id AS entity_id,
         CASE row.metadata->>'contentRating'
           WHEN 'adult' THEN 3
           WHEN 'mixed' THEN 2
           WHEN 'unknown' THEN 1
           ELSE 0
         END AS rating_rank
    FROM preference_import_rows row
    JOIN preference_import_batches batch
      ON batch.id = row.batch_id
     AND batch.app_user_id = row.app_user_id
    JOIN verified_reviewed_preference_batches verified
      ON verified.id = batch.id
     AND verified.app_user_id = batch.app_user_id
     AND verified.prior_state = 'legacy'
     AND verified.source_sha256 = batch.source_sha256
     AND verified.target_catalog_sha256 = batch.catalog_sha256
   WHERE batch.metadata->>'catalogKey' = verified.catalog_key
  UNION ALL
  SELECT entity.id, 0
    FROM preference_catalog_entities entity
    CROSS JOIN verified_reviewed_preference_batches verified
   WHERE verified.prior_state = 'legacy'
     AND entity.metadata = jsonb_build_object('catalogKey', verified.catalog_key)
     AND (entity.kind, entity.canonical_name) IN (
       ('brand', 'TYPE-MOON'),
       ('franchise', 'Fate'),
       ('franchise', '月姫')
     )
), resolved_ratings AS (
  SELECT entity_id,
         CASE max(rating_rank)
           WHEN 3 THEN 'adult'
           WHEN 2 THEN 'mixed'
           WHEN 1 THEN 'unknown'
           ELSE 'general'
         END AS content_rating
    FROM rating_inputs
   GROUP BY entity_id
)
UPDATE preference_catalog_entities entity
   SET content_rating = rating.content_rating,
       updated_at = CURRENT_TIMESTAMP
  FROM resolved_ratings rating
 WHERE entity.id = rating.entity_id;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM verified_reviewed_preference_batches verified
      JOIN preference_import_batches batch
        ON batch.id = verified.id
       AND batch.app_user_id = verified.app_user_id
     WHERE batch.source_sha256 <> verified.source_sha256
        OR batch.catalog_sha256 <> verified.target_catalog_sha256
        OR batch.metadata->>'catalogKey' <> verified.catalog_key
        OR (
          SELECT md5(string_agg(
            concat_ws(chr(31), row.row_number::text, row.section_key,
              row.source_label, row.normalized_label, row.inferred_category,
              row.evidence_type, row.confidence::text, row.resolution,
              entity.kind, entity.canonical_name,
              coalesce(row.metadata->>'contentRating', '')),
            chr(30) ORDER BY row.row_number
          ))
            FROM preference_import_rows row
            JOIN preference_catalog_entities entity
              ON entity.id = row.catalog_entity_id
           WHERE row.batch_id = batch.id
             AND row.app_user_id = batch.app_user_id
        ) <> '9c15efce8a09fb60df277ecf8fdea39b'
        OR (
          SELECT md5(string_agg(
            concat_ws(chr(31), entity.kind, entity.canonical_name,
              entity.normalized_name, entity.content_rating, entity.status),
            chr(30) ORDER BY entity.kind COLLATE "C",
              entity.normalized_name COLLATE "C", entity.id
          ))
            FROM preference_catalog_entities entity
           WHERE entity.metadata->>'catalogKey' = verified.catalog_key
        ) <> 'c42bc98050c227a905ee06b7bc0f19cb'
  ) THEN
    RAISE EXCEPTION
      'reviewed preference catalog did not reach the verified current state';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION app_preference_import_row_guard()
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

  IF TG_OP = 'INSERT' THEN
    PERFORM 1
      FROM preference_import_batches batch
     WHERE batch.id = NEW.batch_id
       AND batch.app_user_id = NEW.app_user_id
       AND batch.status = 'staged'
       FOR SHARE;
    IF FOUND THEN
      RETURN NEW;
    END IF;
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

CREATE OR REPLACE FUNCTION app_preference_evidence_insert_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.batch_id IS NULL THEN
    RETURN NEW;
  END IF;

  PERFORM 1
    FROM preference_import_batches batch
   WHERE batch.id = NEW.batch_id
     AND batch.app_user_id = NEW.app_user_id
     AND batch.status = 'staged'
     FOR SHARE;
  IF FOUND THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'batch-backed preference evidence requires a staged batch';
END;
$$;

CREATE TRIGGER preference_import_rows_append_only
BEFORE INSERT OR UPDATE OR DELETE ON preference_import_rows
FOR EACH ROW EXECUTE FUNCTION app_preference_import_row_guard();

CREATE TRIGGER preference_import_batches_immutable
BEFORE INSERT OR UPDATE OR DELETE ON preference_import_batches
FOR EACH ROW EXECUTE FUNCTION app_preference_import_batch_guard();

CREATE TRIGGER user_catalog_preference_evidence_staged_batch
BEFORE INSERT ON user_catalog_preference_evidence
FOR EACH ROW EXECUTE FUNCTION app_preference_evidence_insert_guard();

COMMENT ON FUNCTION app_preference_import_row_guard() IS
  'Serializes staged import-row inserts against batch finalization and keeps rows immutable afterward.';

COMMENT ON FUNCTION app_preference_evidence_insert_guard() IS
  'Serializes batch-backed evidence inserts against batch finalization.';
