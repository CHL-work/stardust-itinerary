ALTER FUNCTION app_member_can_view_change_request(uuid, uuid, uuid)
  RENAME TO app_member_can_view_change_request_v0013;

CREATE FUNCTION app_member_can_view_change_request(
  target_trip_id uuid,
  target_request_id uuid,
  target_member_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT CASE
    WHEN EXISTS (
      SELECT 1
        FROM change_requests cr
       WHERE cr.trip_id = target_trip_id
         AND cr.id = target_request_id
         AND cr.entity_type = 'itinerary_item'
         AND cr.operation = 'create'
         AND cr.entity_id IS NULL
         AND cr.status = 'pending'
    ) THEN EXISTS (
      SELECT 1
        FROM change_requests cr
        JOIN trip_members viewer
          ON viewer.trip_id = cr.trip_id
         AND viewer.id = target_member_id
         AND viewer.status = 'active'
       WHERE cr.trip_id = target_trip_id
         AND cr.id = target_request_id
         AND CASE COALESCE(NULLIF(cr.proposed_patch->>'visibility', ''), 'trip')
           WHEN 'trip' THEN true
           WHEN 'private' THEN
             cr.requested_by_member_id = target_member_id
             OR viewer.role = 'owner'
             OR (
               jsonb_typeof(cr.proposed_patch->'viewerMemberIds') = 'array'
               AND (cr.proposed_patch->'viewerMemberIds') ? target_member_id::text
             )
           ELSE false
         END
    )
    ELSE app_member_can_view_change_request_v0013(
      target_trip_id,
      target_request_id,
      target_member_id
    )
  END;
$$;

COMMENT ON FUNCTION app_member_can_view_change_request(uuid, uuid, uuid) IS
  'Shows trip-visible pending itinerary creates to every active trip member; private pending creates remain limited to the requester, selected active viewers, and active owner reviewer. Rejected and other requests retain the prior canonical/effective-audience rules.';

COMMENT ON FUNCTION app_member_can_view_change_request_v0013(uuid, uuid, uuid) IS
  '0013 requester-and-owner predicate retained for rejected AI itinerary creates and as the prior-rule fallback.';
