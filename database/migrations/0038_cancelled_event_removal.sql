-- Removal hides a cancelled itinerary item without deleting its financial,
-- audience, Calendar or append-only revision history.
ALTER TABLE itinerary_items
  ADD COLUMN removed_at timestamptz,
  ADD COLUMN removed_by_member_id uuid,
  ADD CONSTRAINT itinerary_removed_pair_ck CHECK (
    (removed_at IS NULL AND removed_by_member_id IS NULL)
    OR (removed_at IS NOT NULL AND removed_by_member_id IS NOT NULL AND status = 'cancelled')
  ),
  ADD CONSTRAINT itinerary_removed_actor_fk FOREIGN KEY (trip_id, removed_by_member_id)
    REFERENCES trip_members (trip_id, id) ON DELETE RESTRICT;

CREATE FUNCTION app_guard_removed_itinerary_item()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.removed_at IS NOT NULL THEN
      RAISE EXCEPTION 'removed itinerary items retain financial and audit history';
    END IF;
    RETURN OLD;
  END IF;
  IF OLD.removed_at IS NOT NULL AND
    (to_jsonb(NEW) - ARRAY['current_revision', 'updated_at']) IS DISTINCT FROM
    (to_jsonb(OLD) - ARRAY['current_revision', 'updated_at']) THEN
    RAISE EXCEPTION 'removed itinerary items cannot be restored or edited';
  END IF;
  IF OLD.removed_at IS NULL AND NEW.removed_at IS NOT NULL THEN
    IF OLD.status <> 'cancelled' OR NOT EXISTS (
      SELECT 1 FROM trip_members actor
       WHERE actor.trip_id = NEW.trip_id AND actor.id = NEW.removed_by_member_id
         AND actor.role = 'owner' AND actor.status = 'active' AND actor.user_id IS NOT NULL
    ) THEN
      RAISE EXCEPTION 'only an active owner may remove an already cancelled itinerary item';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER removed_itinerary_item_guard BEFORE UPDATE OR DELETE ON itinerary_items
FOR EACH ROW EXECUTE FUNCTION app_guard_removed_itinerary_item();

CREATE FUNCTION app_guard_new_expense_removed_event_link()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE target_removed_at timestamptz;
BEGIN
  -- An existing historical link must remain editable without losing privacy.
  IF TG_OP = 'UPDATE' AND NEW.itinerary_item_id IS NOT DISTINCT FROM OLD.itinerary_item_id THEN
    RETURN NEW;
  END IF;
  IF NEW.itinerary_item_id IS NOT NULL THEN
    SELECT item.removed_at INTO target_removed_at FROM itinerary_items item
     WHERE item.trip_id = NEW.trip_id AND item.id = NEW.itinerary_item_id
     FOR SHARE;
    IF target_removed_at IS NOT NULL THEN
      RAISE EXCEPTION 'new expenses cannot link to a removed itinerary item';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER expense_removed_event_link_guard
BEFORE INSERT OR UPDATE OF itinerary_item_id ON expenses
FOR EACH ROW EXECUTE FUNCTION app_guard_new_expense_removed_event_link();

COMMENT ON COLUMN itinerary_items.removed_at IS
  'Permanent active-view removal only; retain canonical audience and financial/audit foreign keys.';
