ALTER TABLE itinerary_items
  ADD COLUMN visibility text NOT NULL DEFAULT 'trip'
    CHECK (visibility IN ('trip', 'private'));

CREATE TABLE itinerary_item_viewers (
  trip_id uuid NOT NULL,
  itinerary_item_id uuid NOT NULL,
  member_id uuid NOT NULL,
  added_by_member_id uuid,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (trip_id, itinerary_item_id, member_id),
  FOREIGN KEY (trip_id, itinerary_item_id)
    REFERENCES itinerary_items (trip_id, id) ON DELETE CASCADE,
  FOREIGN KEY (trip_id, member_id)
    REFERENCES trip_members (trip_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (trip_id, added_by_member_id)
    REFERENCES trip_members (trip_id, id) ON DELETE SET NULL (added_by_member_id)
);

CREATE INDEX itinerary_item_viewers_member_idx
  ON itinerary_item_viewers (trip_id, member_id, itinerary_item_id);

CREATE FUNCTION app_member_can_view_itinerary_item(
  target_trip_id uuid,
  target_item_id uuid,
  target_member_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1
      FROM itinerary_items i
     WHERE i.trip_id = target_trip_id
       AND i.id = target_item_id
       AND (
         i.visibility = 'trip'
         OR i.created_by_member_id = target_member_id
         OR EXISTS (
           SELECT 1
             FROM itinerary_item_viewers iv
            WHERE iv.trip_id = i.trip_id
              AND iv.itinerary_item_id = i.id
              AND iv.member_id = target_member_id
         )
       )
  );
$$;

CREATE FUNCTION app_member_can_view_expense(
  target_trip_id uuid,
  target_expense_id uuid,
  target_member_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1
      FROM expenses e
     WHERE e.trip_id = target_trip_id
       AND e.id = target_expense_id
       AND (
         e.itinerary_item_id IS NULL
         OR app_member_can_view_itinerary_item(e.trip_id, e.itinerary_item_id, target_member_id)
       )
  );
$$;

CREATE FUNCTION app_member_can_view_change_request(
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
         WHEN cr.entity_type = 'itinerary_item' THEN
           COALESCE(cr.proposed_patch->>'visibility', 'trip') <> 'private'
           OR cr.requested_by_member_id = target_member_id
           OR COALESCE(cr.proposed_patch->'viewerMemberIds', '[]'::jsonb)
                ? target_member_id::text
         WHEN cr.entity_type = 'expense' AND cr.entity_id IS NOT NULL THEN
           app_member_can_view_expense(cr.trip_id, cr.entity_id, target_member_id)
         WHEN cr.entity_type = 'expense'
              AND NULLIF(cr.proposed_patch->>'itineraryItemId', '') IS NOT NULL THEN
           app_member_can_view_itinerary_item(
             cr.trip_id,
             (cr.proposed_patch->>'itineraryItemId')::uuid,
             target_member_id
           )
         ELSE true
       END
  );
$$;

CREATE FUNCTION app_validate_private_expense_audience()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  target_trip_id uuid;
  target_item_id uuid;
  invalid_member_id uuid;
BEGIN
  IF TG_TABLE_NAME = 'itinerary_items' THEN
    target_trip_id := COALESCE(NEW.trip_id, OLD.trip_id);
    target_item_id := COALESCE(NEW.id, OLD.id);
  ELSIF TG_TABLE_NAME = 'itinerary_item_viewers' THEN
    target_trip_id := COALESCE(NEW.trip_id, OLD.trip_id);
    target_item_id := COALESCE(NEW.itinerary_item_id, OLD.itinerary_item_id);
  ELSIF TG_TABLE_NAME = 'expenses' THEN
    target_trip_id := COALESCE(NEW.trip_id, OLD.trip_id);
    target_item_id := COALESCE(NEW.itinerary_item_id, OLD.itinerary_item_id);
  ELSE
    target_trip_id := COALESCE(NEW.trip_id, OLD.trip_id);
    SELECT e.itinerary_item_id
      INTO target_item_id
      FROM expenses e
     WHERE e.trip_id = target_trip_id
       AND e.id = COALESCE(NEW.expense_id, OLD.expense_id);
  END IF;

  IF target_item_id IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT member_id
    INTO invalid_member_id
    FROM (
      SELECT e.payer_member_id AS member_id
        FROM expenses e
       WHERE e.trip_id = target_trip_id
         AND e.itinerary_item_id = target_item_id
      UNION
      SELECT es.member_id
        FROM expenses e
        JOIN expense_splits es
          ON es.trip_id = e.trip_id AND es.expense_id = e.id
       WHERE e.trip_id = target_trip_id
         AND e.itinerary_item_id = target_item_id
    ) involved
   WHERE NOT app_member_can_view_itinerary_item(
     target_trip_id,
     target_item_id,
     involved.member_id
   )
   LIMIT 1;

  IF invalid_member_id IS NOT NULL THEN
    RAISE EXCEPTION 'private event expense member % is outside the event audience', invalid_member_id;
  END IF;

  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER private_expense_from_item
AFTER INSERT OR UPDATE OF visibility, created_by_member_id ON itinerary_items
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION app_validate_private_expense_audience();

CREATE CONSTRAINT TRIGGER private_expense_from_viewer
AFTER INSERT OR UPDATE OR DELETE ON itinerary_item_viewers
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION app_validate_private_expense_audience();

CREATE CONSTRAINT TRIGGER private_expense_from_expense
AFTER INSERT OR UPDATE OF payer_member_id, itinerary_item_id ON expenses
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION app_validate_private_expense_audience();

CREATE CONSTRAINT TRIGGER private_expense_from_split
AFTER INSERT OR UPDATE OR DELETE ON expense_splits
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION app_validate_private_expense_audience();
