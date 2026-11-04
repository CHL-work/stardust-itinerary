-- Guest accounts (JOB-064, D-077): a try-it-now account with one synthetic demo trip, deleted for
-- good once it expires (24 hours). Guests and other trips never mix: a guest belongs only to its
-- own guest trips, and nobody else can join them.
ALTER TABLE app_users ADD COLUMN guest_expires_at timestamptz;
ALTER TABLE trips ADD COLUMN guest_expires_at timestamptz;

CREATE INDEX app_users_guest_expiry_idx ON app_users (guest_expires_at) WHERE guest_expires_at IS NOT NULL;

COMMENT ON COLUMN app_users.guest_expires_at IS
  'Set only for guest accounts: when the account and its guest trips are permanently deleted.';
COMMENT ON COLUMN trips.guest_expires_at IS
  'Set only for a guest''s demo trip: when it is permanently deleted with its guest.';

CREATE FUNCTION app_guard_guest_isolation()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  guest_trip boolean;
  guest_user boolean;
BEGIN
  IF TG_TABLE_NAME = 'app_users' THEN
    -- An account is a guest from creation to deletion; neither direction can change.
    IF (OLD.guest_expires_at IS NULL) <> (NEW.guest_expires_at IS NULL) THEN
      RAISE EXCEPTION 'an account cannot become or stop being a guest' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;
  IF TG_TABLE_NAME = 'trips' THEN
    SELECT guest_expires_at IS NOT NULL INTO guest_user FROM app_users WHERE id = NEW.owner_user_id;
    IF coalesce(guest_user, false) <> (NEW.guest_expires_at IS NOT NULL) THEN
      RAISE EXCEPTION 'guest trips belong only to guests, and guests own only guest trips' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;
  SELECT guest_expires_at IS NOT NULL INTO guest_trip FROM trips WHERE id = NEW.trip_id;
  IF TG_TABLE_NAME = 'trip_members' THEN
    IF NEW.user_id IS NULL THEN
      guest_user := false;
    ELSE
      SELECT guest_expires_at IS NOT NULL INTO guest_user FROM app_users WHERE id = NEW.user_id;
    END IF;
    IF coalesce(guest_trip, false) AND NEW.user_id IS NULL THEN
      RAISE EXCEPTION 'guest trips have no invited members' USING ERRCODE = 'check_violation';
    END IF;
    IF coalesce(guest_user, false) <> coalesce(guest_trip, false) THEN
      RAISE EXCEPTION 'guests and other trips never mix' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;
  -- Invitations and feedback: a guest trip cannot invite anyone or send reports.
  IF coalesce(guest_trip, false) THEN
    RAISE EXCEPTION 'guest trips cannot invite people or send feedback' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER app_users_guest_isolation BEFORE UPDATE OF guest_expires_at ON app_users
  FOR EACH ROW EXECUTE FUNCTION app_guard_guest_isolation();
CREATE TRIGGER trips_guest_isolation BEFORE INSERT OR UPDATE OF owner_user_id, guest_expires_at ON trips
  FOR EACH ROW EXECUTE FUNCTION app_guard_guest_isolation();
CREATE TRIGGER trip_members_guest_isolation BEFORE INSERT OR UPDATE OF user_id, trip_id ON trip_members
  FOR EACH ROW EXECUTE FUNCTION app_guard_guest_isolation();
CREATE TRIGGER trip_join_links_guest_isolation BEFORE INSERT ON trip_join_links
  FOR EACH ROW EXECUTE FUNCTION app_guard_guest_isolation();
CREATE TRIGGER member_claim_links_guest_isolation BEFORE INSERT ON member_claim_links
  FOR EACH ROW EXECUTE FUNCTION app_guard_guest_isolation();
CREATE TRIGGER feedback_reports_guest_isolation BEFORE INSERT ON feedback_reports
  FOR EACH ROW EXECUTE FUNCTION app_guard_guest_isolation();

-- Permanently delete one expired guest: the account, its guest trips and every row that belongs
-- to them. Real trips protect their history with append-only triggers and RESTRICT foreign keys,
-- which a deletion cannot satisfy in any order, so this function suspends triggers for its own
-- deletes only. What keeps it to the guest's rows:
--   * it acts only on an expired guest whose trips are all guest trips with no other member;
--   * it deletes by the guest's trip ids, and by the guest's user id only in tables without trip_id;
--   * with triggers back on, it proves no row anywhere still references the deleted trips or account,
--     and otherwise raises, which rolls everything back.
-- Returns false when there is nothing to purge (not a guest, or not expired yet).
CREATE FUNCTION app_purge_expired_guest(p_user_id uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  guest_trips uuid[];
  rel record;
  remaining boolean;
BEGIN
  PERFORM 1 FROM public.app_users
    WHERE id = p_user_id AND guest_expires_at IS NOT NULL AND guest_expires_at <= CURRENT_TIMESTAMP
    FOR UPDATE;
  IF NOT FOUND THEN
    RETURN false;
  END IF;
  SELECT coalesce(array_agg(id), ARRAY[]::uuid[]) INTO guest_trips FROM public.trips WHERE owner_user_id = p_user_id;
  PERFORM 1 FROM public.trips WHERE id = ANY (guest_trips) FOR UPDATE;
  IF EXISTS (SELECT 1 FROM public.trips WHERE id = ANY (guest_trips) AND guest_expires_at IS NULL)
     OR EXISTS (SELECT 1 FROM public.trip_members WHERE user_id = p_user_id AND NOT (trip_id = ANY (guest_trips)))
     OR EXISTS (SELECT 1 FROM public.trip_members WHERE trip_id = ANY (guest_trips) AND user_id IS DISTINCT FROM p_user_id)
     OR EXISTS (SELECT 1 FROM public.feedback_reports WHERE trip_id = ANY (guest_trips)) THEN
    RAISE EXCEPTION 'guest account is not isolated; refusing to purge it' USING ERRCODE = 'check_violation';
  END IF;

  PERFORM set_config('session_replication_role', 'replica', true);
  FOR rel IN
    SELECT c.table_name FROM information_schema.columns c
      JOIN information_schema.tables t ON t.table_schema = c.table_schema AND t.table_name = c.table_name
     WHERE c.table_schema = 'public' AND c.column_name = 'trip_id' AND t.table_type = 'BASE TABLE'
  LOOP
    EXECUTE format('DELETE FROM public.%I WHERE trip_id = ANY ($1)', rel.table_name) USING guest_trips;
  END LOOP;
  DELETE FROM public.trips WHERE id = ANY (guest_trips);
  FOR rel IN
    SELECT con.conrelid::regclass AS table_ref, att.attname AS column_name
      FROM pg_constraint con
      JOIN pg_attribute att ON att.attrelid = con.conrelid AND att.attnum = con.conkey[1]
     WHERE con.contype = 'f' AND con.confrelid = 'public.app_users'::regclass AND cardinality(con.conkey) = 1
       AND NOT EXISTS (SELECT 1 FROM pg_attribute trip_column
                        WHERE trip_column.attrelid = con.conrelid AND trip_column.attname = 'trip_id' AND NOT trip_column.attisdropped)
  LOOP
    EXECUTE format('DELETE FROM %s WHERE %I = $1', rel.table_ref, rel.column_name) USING p_user_id;
  END LOOP;
  DELETE FROM public.app_users WHERE id = p_user_id;
  PERFORM set_config('session_replication_role', 'origin', true);

  FOR rel IN
    SELECT con.conrelid::regclass AS table_ref, att.attname AS column_name, con.confrelid AS target
      FROM pg_constraint con
      JOIN pg_attribute att ON att.attrelid = con.conrelid AND att.attnum = con.conkey[1]
     WHERE con.contype = 'f' AND cardinality(con.conkey) = 1
       AND con.confrelid IN ('public.trips'::regclass, 'public.app_users'::regclass)
  LOOP
    IF rel.target = 'public.trips'::regclass THEN
      EXECUTE format('SELECT EXISTS (SELECT 1 FROM %s WHERE %I = ANY ($1))', rel.table_ref, rel.column_name)
        INTO remaining USING guest_trips;
    ELSE
      EXECUTE format('SELECT EXISTS (SELECT 1 FROM %s WHERE %I = $1)', rel.table_ref, rel.column_name)
        INTO remaining USING p_user_id;
    END IF;
    IF remaining THEN
      RAISE EXCEPTION 'guest purge would leave a reference in %.%', rel.table_ref, rel.column_name;
    END IF;
  END LOOP;
  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION app_purge_expired_guest(uuid) FROM PUBLIC;

COMMENT ON FUNCTION app_purge_expired_guest(uuid) IS
  'Permanently deletes one expired, isolated guest account and its guest trips (JOB-064). The runtime role is granted EXECUTE by scripts/db/runtime-role.mjs.';
