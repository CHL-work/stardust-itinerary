-- JOB-055: an owner can delete a whole trip. Deletion removes the trip for every
-- member but erases nothing: audit, money, feedback and AI history stay append-only.
ALTER TABLE trips
  ADD COLUMN deleted_at timestamptz,
  ADD COLUMN deleted_by_member_id uuid,
  ADD CONSTRAINT trips_deletion_pair_ck CHECK ((deleted_at IS NULL) = (deleted_by_member_id IS NULL)),
  ADD CONSTRAINT trips_deleted_by_member_fk FOREIGN KEY (id, deleted_by_member_id)
    REFERENCES trip_members (trip_id, id) ON DELETE RESTRICT;

-- Every access path already requires status = 'active', so a terminal status fails
-- closed everywhere, including under an older build after a code rollback.
ALTER TABLE trip_members
  ADD COLUMN status_before_trip_deletion text,
  DROP CONSTRAINT trip_members_status_check,
  ADD CONSTRAINT trip_members_status_check
    CHECK (status IN ('invited', 'active', 'revoked', 'removed', 'trip_deleted')),
  ADD CONSTRAINT trip_members_trip_deletion_status_ck CHECK (
    (status = 'trip_deleted') = (status_before_trip_deletion IS NOT NULL)
    AND (status_before_trip_deletion IS NULL OR status_before_trip_deletion IN ('invited', 'active', 'revoked'))
  );

CREATE FUNCTION app_guard_deleted_trip_membership() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status IN ('invited', 'active', 'revoked')
    AND EXISTS (SELECT 1 FROM trips WHERE id = NEW.trip_id AND deleted_at IS NOT NULL) THEN
    RAISE EXCEPTION 'a deleted trip cannot have usable memberships'
      USING ERRCODE = '23514', CONSTRAINT = 'trip_members_deleted_trip_ck';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trip_members_deleted_trip_guard
BEFORE INSERT OR UPDATE OF status ON trip_members
FOR EACH ROW EXECUTE FUNCTION app_guard_deleted_trip_membership();
