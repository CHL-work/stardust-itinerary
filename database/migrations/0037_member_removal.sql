ALTER TABLE change_requests
  ADD COLUMN invalidated_at timestamptz,
  ADD COLUMN invalidated_reason text CHECK (invalidated_reason = 'member_removed'),
  ADD COLUMN invalidated_by_member_id uuid,
  ADD COLUMN invalidated_member_id uuid,
  ADD CONSTRAINT change_requests_invalidation_pair_ck CHECK (
    (invalidated_at IS NULL AND invalidated_reason IS NULL AND invalidated_by_member_id IS NULL AND invalidated_member_id IS NULL)
    OR (invalidated_at IS NOT NULL AND invalidated_reason IS NOT NULL AND invalidated_by_member_id IS NOT NULL AND invalidated_member_id IS NOT NULL)
  ),
  ADD CONSTRAINT change_requests_invalidation_status_ck CHECK (invalidated_at IS NULL OR status IN ('pending','rejected')),
  ADD CONSTRAINT change_requests_invalidated_actor_fk FOREIGN KEY (trip_id, invalidated_by_member_id) REFERENCES trip_members (trip_id, id) ON DELETE RESTRICT,
  ADD CONSTRAINT change_requests_invalidated_member_fk FOREIGN KEY (trip_id, invalidated_member_id) REFERENCES trip_members (trip_id, id) ON DELETE RESTRICT;

CREATE FUNCTION app_guard_change_request_invalidation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.invalidated_at IS NOT NULL AND (
    (NEW.invalidated_at, NEW.invalidated_reason, NEW.invalidated_by_member_id, NEW.invalidated_member_id)
      IS DISTINCT FROM (OLD.invalidated_at, OLD.invalidated_reason, OLD.invalidated_by_member_id, OLD.invalidated_member_id)
    OR NEW.status IS DISTINCT FROM OLD.status OR NEW.proposed_patch IS DISTINCT FROM OLD.proposed_patch
    OR NEW.requested_by_member_id IS DISTINCT FROM OLD.requested_by_member_id
  ) THEN RAISE EXCEPTION 'invalidated change requests retain their original history and cannot be applied'; END IF;
  IF NEW.invalidated_at IS NOT NULL AND OLD.invalidated_at IS NULL AND (
    OLD.status NOT IN ('pending','rejected') OR NEW.status IS DISTINCT FROM OLD.status
    OR NEW.proposed_patch IS DISTINCT FROM OLD.proposed_patch
  ) THEN RAISE EXCEPTION 'only unchanged pending or rejected requests can be invalidated'; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER change_request_invalidation_guard BEFORE UPDATE ON change_requests
FOR EACH ROW EXECUTE FUNCTION app_guard_change_request_invalidation();

ALTER TABLE ai_conversations DROP CONSTRAINT ai_conversations_closed_reason_ck;
ALTER TABLE ai_conversations ADD CONSTRAINT ai_conversations_closed_reason_ck CHECK (
  closed_reason IS NULL OR closed_reason IN ('user_reset','user_switch','identity_mismatch','identity_unbound','owner_recovery','legacy_unknown','member_removed')
);

-- A void historical expense may still attribute money to a removed tombstone.
-- Only that exact combination is exempt: active expenses retain every privacy
-- constraint, and no removed member receives new read access.
CREATE OR REPLACE FUNCTION app_validate_private_expense_audience()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE target_trip_id uuid; target_item_id uuid; invalid_member_id uuid;
BEGIN
  IF TG_TABLE_NAME = 'itinerary_items' THEN
    target_trip_id := COALESCE(NEW.trip_id, OLD.trip_id); target_item_id := COALESCE(NEW.id, OLD.id);
  ELSIF TG_TABLE_NAME = 'itinerary_item_viewers' THEN
    target_trip_id := COALESCE(NEW.trip_id, OLD.trip_id); target_item_id := COALESCE(NEW.itinerary_item_id, OLD.itinerary_item_id);
  ELSIF TG_TABLE_NAME = 'expenses' THEN
    target_trip_id := COALESCE(NEW.trip_id, OLD.trip_id); target_item_id := COALESCE(NEW.itinerary_item_id, OLD.itinerary_item_id);
  ELSE
    target_trip_id := COALESCE(NEW.trip_id, OLD.trip_id);
    SELECT e.itinerary_item_id INTO target_item_id FROM expenses e
      WHERE e.trip_id = target_trip_id AND e.id = COALESCE(NEW.expense_id, OLD.expense_id);
  END IF;
  IF target_item_id IS NULL THEN RETURN NULL; END IF;
  SELECT involved.member_id INTO invalid_member_id FROM (
    SELECT e.payer_member_id AS member_id, e.status AS expense_status FROM expenses e
      WHERE e.trip_id = target_trip_id AND e.itinerary_item_id = target_item_id
    UNION
    SELECT es.member_id, e.status AS expense_status FROM expenses e
      JOIN expense_splits es ON es.trip_id = e.trip_id AND es.expense_id = e.id
      WHERE e.trip_id = target_trip_id AND e.itinerary_item_id = target_item_id
  ) involved
  WHERE NOT app_member_can_view_itinerary_item(target_trip_id, target_item_id, involved.member_id)
    AND NOT (involved.expense_status = 'void' AND EXISTS (
      SELECT 1 FROM trip_members member WHERE member.trip_id = target_trip_id
        AND member.id = involved.member_id AND member.status = 'removed'))
  LIMIT 1;
  IF invalid_member_id IS NOT NULL THEN
    RAISE EXCEPTION 'private event expense member % is outside the event audience', invalid_member_id;
  END IF;
  RETURN NULL;
END;
$$;

COMMENT ON COLUMN change_requests.invalidated_reason IS 'Permanent action block; original request status, patch and attribution remain owner-auditable.';
