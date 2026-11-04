ALTER FUNCTION app_member_can_view_change_request(uuid, uuid, uuid)
  RENAME TO app_member_can_view_change_request_v0028;

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
         AND cr.entity_type = 'expense'
         AND cr.operation = 'create'
         AND cr.entity_id IS NULL
         AND cr.status IN ('pending', 'rejected')
    ) THEN EXISTS (
      SELECT 1
        FROM change_requests cr
        JOIN trip_members viewer
          ON viewer.trip_id = cr.trip_id
         AND viewer.id = target_member_id
         AND viewer.status = 'active'
       WHERE cr.trip_id = target_trip_id
         AND cr.id = target_request_id
         AND (
           viewer.role = 'owner'
           OR cr.requested_by_member_id = target_member_id
           OR cr.proposed_patch->>'payerMemberId' = target_member_id::text
           OR (
             jsonb_typeof(cr.proposed_patch->'splitMemberIds') = 'array'
             AND (cr.proposed_patch->'splitMemberIds') ? target_member_id::text
           )
         )
    )
    ELSE app_member_can_view_change_request_v0028(
      target_trip_id,
      target_request_id,
      target_member_id
    )
  END;
$$;

COMMENT ON FUNCTION app_member_can_view_change_request(uuid, uuid, uuid) IS
  'Shows pending or rejected expense creates only to the active requester, active payer/split participants, and the active owner reviewer, then retains the prior change-request audience rules.';

COMMENT ON FUNCTION app_member_can_view_change_request_v0028(uuid, uuid, uuid) IS
  '0028 change-request audience predicate retained as the fallback for non-expense-create requests and approved items.';
