ALTER FUNCTION app_member_can_view_change_request(uuid, uuid, uuid)
  RENAME TO app_member_can_view_change_request_v0029;

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
        JOIN trip_members reviewer
          ON reviewer.trip_id = cr.trip_id
         AND reviewer.id = target_member_id
         AND reviewer.role = 'owner'
         AND reviewer.status = 'active'
       WHERE cr.trip_id = target_trip_id
         AND cr.id = target_request_id
         AND cr.entity_type = 'itinerary_item'
         AND (
           (
             cr.status IN ('pending', 'rejected')
             AND cr.operation IN ('create', 'update')
           )
           OR (
             cr.status = 'approved'
             AND cr.reviewed_by_member_id = reviewer.id
           )
         )
    ) THEN true
    ELSE app_member_can_view_change_request_v0029(
      target_trip_id,
      target_request_id,
      target_member_id
    )
  END;
$$;

COMMENT ON FUNCTION app_member_can_view_change_request(uuid, uuid, uuid) IS
  'Gives the active trip owner proposal-only access to pending and rejected itinerary creates/updates plus requests that owner approved, without granting canonical private-event visibility; private cancel/restore remains governed by the prior audience rules.';

COMMENT ON FUNCTION app_member_can_view_change_request_v0029(uuid, uuid, uuid) IS
  '0029 change-request audience predicate retained for non-owner itinerary access and expense-request access.';
