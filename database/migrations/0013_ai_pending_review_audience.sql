ALTER FUNCTION app_member_can_view_change_request(uuid, uuid, uuid)
  RENAME TO app_member_can_view_change_request_v0012;

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
         AND cr.source = 'ai'
         AND cr.entity_type = 'itinerary_item'
         AND cr.operation = 'create'
         AND cr.entity_id IS NULL
         AND cr.status IN ('pending', 'rejected')
    ) THEN EXISTS (
      SELECT 1
        FROM change_requests cr
       WHERE cr.trip_id = target_trip_id
         AND cr.id = target_request_id
         AND (
           cr.requested_by_member_id = target_member_id
           OR EXISTS (
             SELECT 1
               FROM trip_members owner_member
              WHERE owner_member.trip_id = cr.trip_id
                AND owner_member.id = target_member_id
                AND owner_member.role = 'owner'
                AND owner_member.status = 'active'
           )
         )
    )
    ELSE app_member_can_view_change_request_v0012(
      target_trip_id,
      target_request_id,
      target_member_id
    )
  END;
$$;

COMMENT ON FUNCTION app_member_can_view_change_request(uuid, uuid, uuid) IS
  'Limits pending or rejected AI-created events to the requester and active owner for review, then applies the canonical/effective audience rules after approval.';

COMMENT ON FUNCTION app_member_can_view_change_request_v0012(uuid, uuid, uuid) IS
  '0012 effective-audience predicate retained as the canonical fallback for non-AI-create requests and approved items.';
