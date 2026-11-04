WITH normalized AS (
  SELECT cr.trip_id,
         cr.id,
         CASE
           WHEN cr.proposed_patch->>'visibility' IN ('trip', 'private') THEN
             cr.proposed_patch->>'visibility'
           WHEN cr.operation = 'create' THEN 'trip'
           WHEN ir.snapshot->>'visibility' IN ('trip', 'private') THEN
             ir.snapshot->>'visibility'
           WHEN i.visibility IN ('trip', 'private') THEN i.visibility
           ELSE 'private'
         END AS effective_visibility,
         CASE
           WHEN jsonb_typeof(cr.proposed_patch->'viewerMemberIds') = 'array' THEN
             cr.proposed_patch->'viewerMemberIds'
           WHEN cr.operation <> 'create'
             AND jsonb_typeof(ir.snapshot->'viewerMemberIds') = 'array' THEN
             ir.snapshot->'viewerMemberIds'
           WHEN cr.operation <> 'create' THEN COALESCE((
             SELECT jsonb_agg(iv.member_id::text ORDER BY iv.member_id)
               FROM itinerary_item_viewers iv
              WHERE iv.trip_id = cr.trip_id
                AND iv.itinerary_item_id = cr.entity_id
           ), '[]'::jsonb)
           ELSE '[]'::jsonb
         END AS effective_viewer_member_ids
    FROM change_requests cr
    LEFT JOIN itinerary_items i
      ON i.trip_id = cr.trip_id AND i.id = cr.entity_id
    LEFT JOIN itinerary_revisions ir
      ON ir.trip_id = cr.trip_id
     AND ir.itinerary_item_id = cr.entity_id
     AND ir.revision = cr.base_revision
   WHERE cr.entity_type = 'itinerary_item'
)
UPDATE change_requests cr
   SET proposed_patch = cr.proposed_patch || jsonb_build_object(
     'visibility', normalized.effective_visibility,
     'viewerMemberIds', CASE
       WHEN normalized.effective_visibility = 'private' THEN
         normalized.effective_viewer_member_ids
       ELSE '[]'::jsonb
     END
   )
  FROM normalized
 WHERE cr.trip_id = normalized.trip_id
   AND cr.id = normalized.id;

WITH expense_targets AS (
  SELECT cr.trip_id,
         cr.id,
         cr.requested_by_member_id,
         cr.created_at,
         cr.proposed_patch,
         CASE
           WHEN cr.proposed_patch ? 'itineraryItemId' THEN
             NULLIF(btrim(cr.proposed_patch->>'itineraryItemId'), '')
           WHEN cr.operation = 'create' THEN NULL
           ELSE COALESCE(
             NULLIF(btrim(er.snapshot->>'itineraryItemId'), ''),
             e.itinerary_item_id::text
           )
         END AS target_item_text
    FROM change_requests cr
    LEFT JOIN expenses e
      ON e.trip_id = cr.trip_id AND e.id = cr.entity_id
    LEFT JOIN expense_revisions er
      ON er.trip_id = cr.trip_id
     AND er.expense_id = cr.entity_id
     AND er.revision = cr.base_revision
   WHERE cr.entity_type = 'expense'
), targets AS (
  SELECT expense_targets.*,
         CASE
           WHEN target_item_text ~*
             '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
             target_item_text::uuid
           ELSE NULL
         END AS target_item_id
    FROM expense_targets
), audience_sources AS (
  SELECT targets.*,
         historical.snapshot AS historical_snapshot,
         i.created_by_member_id,
         i.visibility AS current_visibility,
         COALESCE((
           SELECT jsonb_agg(iv.member_id::text ORDER BY iv.member_id)
             FROM itinerary_item_viewers iv
            WHERE iv.trip_id = i.trip_id
              AND iv.itinerary_item_id = i.id
         ), '[]'::jsonb) AS current_viewer_member_ids
    FROM targets
    LEFT JOIN itinerary_items i
      ON i.trip_id = targets.trip_id AND i.id = targets.target_item_id
    LEFT JOIN LATERAL (
      SELECT ir.snapshot
        FROM itinerary_revisions ir
       WHERE ir.trip_id = targets.trip_id
         AND ir.itinerary_item_id = targets.target_item_id
         AND ir.created_at <= targets.created_at
       ORDER BY ir.created_at DESC, ir.revision DESC
       LIMIT 1
    ) historical ON true
), normalized AS (
  SELECT audience_sources.*,
         CASE
           WHEN historical_snapshot->>'visibility' IN ('trip', 'private') THEN
             historical_snapshot->>'visibility'
           WHEN current_visibility IN ('trip', 'private') THEN current_visibility
           ELSE 'private'
         END AS effective_visibility,
         COALESCE(
           NULLIF(historical_snapshot->>'createdByMemberId', ''),
           created_by_member_id::text,
           requested_by_member_id::text
         ) AS effective_creator_member_id,
         CASE
           WHEN jsonb_typeof(historical_snapshot->'viewerMemberIds') = 'array' THEN
             historical_snapshot->'viewerMemberIds'
           ELSE current_viewer_member_ids
         END AS effective_viewer_member_ids
    FROM audience_sources
)
UPDATE change_requests cr
   SET proposed_patch = cr.proposed_patch || jsonb_build_object(
     'itineraryItemId', normalized.target_item_text,
     'itineraryAudienceSnapshot', CASE
       WHEN normalized.target_item_text IS NULL THEN NULL
       ELSE jsonb_build_object(
         'itineraryItemId', normalized.target_item_text,
         'createdByMemberId', normalized.effective_creator_member_id,
         'visibility', normalized.effective_visibility,
         'viewerMemberIds', CASE
           WHEN normalized.effective_visibility = 'private' THEN
             normalized.effective_viewer_member_ids
           ELSE '[]'::jsonb
         END
       )
     END
   )
  FROM normalized
 WHERE cr.trip_id = normalized.trip_id
   AND cr.id = normalized.id;

CREATE OR REPLACE FUNCTION app_member_can_view_change_request(
  target_trip_id uuid,
  target_request_id uuid,
  target_member_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1
      FROM change_requests cr
     WHERE cr.trip_id = target_trip_id
       AND cr.id = target_request_id
       AND CASE
         WHEN cr.entity_type = 'itinerary_item' AND cr.entity_id IS NOT NULL THEN
           app_member_can_view_itinerary_item(cr.trip_id, cr.entity_id, target_member_id)
           AND EXISTS (
             SELECT 1
               FROM itinerary_items i
              WHERE i.trip_id = cr.trip_id
                AND i.id = cr.entity_id
                AND CASE COALESCE(
                  NULLIF(cr.proposed_patch->>'visibility', ''),
                  i.visibility
                )
                  WHEN 'trip' THEN true
                  WHEN 'private' THEN
                    i.created_by_member_id = target_member_id
                    OR CASE
                      WHEN cr.proposed_patch ? 'viewerMemberIds' THEN
                        jsonb_typeof(cr.proposed_patch->'viewerMemberIds') = 'array'
                        AND (cr.proposed_patch->'viewerMemberIds') ? target_member_id::text
                      WHEN i.visibility = 'private' THEN EXISTS (
                        SELECT 1
                          FROM itinerary_item_viewers iv
                         WHERE iv.trip_id = i.trip_id
                           AND iv.itinerary_item_id = i.id
                           AND iv.member_id = target_member_id
                      )
                      ELSE false
                    END
                  ELSE false
                END
           )
         WHEN cr.entity_type = 'itinerary_item' THEN
           CASE COALESCE(NULLIF(cr.proposed_patch->>'visibility', ''), 'trip')
             WHEN 'trip' THEN true
             WHEN 'private' THEN
               cr.requested_by_member_id = target_member_id
               OR (
                 jsonb_typeof(cr.proposed_patch->'viewerMemberIds') = 'array'
                 AND (cr.proposed_patch->'viewerMemberIds') ? target_member_id::text
               )
             ELSE false
           END
         WHEN cr.entity_type = 'expense' AND cr.entity_id IS NOT NULL THEN
           app_member_can_view_expense(cr.trip_id, cr.entity_id, target_member_id)
           AND CASE
             WHEN jsonb_typeof(cr.proposed_patch->'itineraryAudienceSnapshot') = 'object' THEN
               CASE
                 WHEN cr.proposed_patch->'itineraryAudienceSnapshot'->>'itineraryItemId' ~*
                   '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
                   app_member_can_view_itinerary_item(
                     cr.trip_id,
                     (cr.proposed_patch->'itineraryAudienceSnapshot'->>'itineraryItemId')::uuid,
                     target_member_id
                   )
                   AND CASE cr.proposed_patch->'itineraryAudienceSnapshot'->>'visibility'
                     WHEN 'trip' THEN true
                     WHEN 'private' THEN
                       cr.proposed_patch->'itineraryAudienceSnapshot'->>'createdByMemberId'
                         = target_member_id::text
                       OR (
                         jsonb_typeof(
                           cr.proposed_patch->'itineraryAudienceSnapshot'->'viewerMemberIds'
                         ) = 'array'
                         AND (
                           cr.proposed_patch->'itineraryAudienceSnapshot'->'viewerMemberIds'
                         ) ? target_member_id::text
                       )
                     ELSE false
                   END
                 ELSE false
               END
             WHEN NOT (cr.proposed_patch ? 'itineraryItemId')
               OR NULLIF(btrim(cr.proposed_patch->>'itineraryItemId'), '') IS NULL THEN true
             WHEN (cr.proposed_patch->>'itineraryItemId') ~*
               '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
               app_member_can_view_itinerary_item(
                 cr.trip_id,
                 (cr.proposed_patch->>'itineraryItemId')::uuid,
                 target_member_id
               )
             ELSE false
           END
         WHEN cr.entity_type = 'expense' THEN
           CASE
             WHEN jsonb_typeof(cr.proposed_patch->'itineraryAudienceSnapshot') = 'object' THEN
               CASE
                 WHEN cr.proposed_patch->'itineraryAudienceSnapshot'->>'itineraryItemId' ~*
                   '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
                   app_member_can_view_itinerary_item(
                     cr.trip_id,
                     (cr.proposed_patch->'itineraryAudienceSnapshot'->>'itineraryItemId')::uuid,
                     target_member_id
                   )
                   AND CASE cr.proposed_patch->'itineraryAudienceSnapshot'->>'visibility'
                     WHEN 'trip' THEN true
                     WHEN 'private' THEN
                       cr.proposed_patch->'itineraryAudienceSnapshot'->>'createdByMemberId'
                         = target_member_id::text
                       OR (
                         jsonb_typeof(
                           cr.proposed_patch->'itineraryAudienceSnapshot'->'viewerMemberIds'
                         ) = 'array'
                         AND (
                           cr.proposed_patch->'itineraryAudienceSnapshot'->'viewerMemberIds'
                         ) ? target_member_id::text
                       )
                     ELSE false
                   END
                 ELSE false
               END
             WHEN NOT (cr.proposed_patch ? 'itineraryItemId')
               OR NULLIF(btrim(cr.proposed_patch->>'itineraryItemId'), '') IS NULL THEN true
             WHEN (cr.proposed_patch->>'itineraryItemId') ~*
               '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
               app_member_can_view_itinerary_item(
                 cr.trip_id,
                 (cr.proposed_patch->>'itineraryItemId')::uuid,
                 target_member_id
               )
             ELSE false
           END
         ELSE false
       END
  );
$$;

COMMENT ON FUNCTION app_member_can_view_change_request(uuid, uuid, uuid) IS
  'Checks both the canonical and submit-time effective private audiences before exposing a change request.';
