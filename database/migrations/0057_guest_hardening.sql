-- Guest account hardening after an independent security review (JOB-064, JOB-065). 0056 is
-- public, so it is left as it is; this migration replaces its two functions.
--
-- 1. The purge function no longer runs with its owner's rights (it was SECURITY DEFINER). Only the
--    guest-purge job, which connects as the migration administrator, may call it. It reads only
--    schema-qualified catalogs, searches temporary schemas last, and touches only tables in public,
--    so a caller's temporary objects cannot stand in for catalogs or tables.
-- 2. Guest status is fixed for life:
--    * a trip cannot become or stop being a guest trip;
--    * a guest trip keeps its guest owner;
--    * that owner is its only member, and the member cannot be rebound to another account.
-- 3. The purge also requires the guest's synthetic identity, and proves afterwards that no row in
--    any trip table still belongs to the purged trips, which catches a write that raced the purge.
-- 4. Bookkeeping:
--    * a hash of the address a guest was created from, for a per-address cap;
--    * when a purge was last refused, so refused guests never hold back the others.

ALTER TABLE app_users
  ADD COLUMN guest_origin_hash bytea CHECK (guest_origin_hash IS NULL OR octet_length(guest_origin_hash) = 32),
  ADD COLUMN guest_purge_refused_at timestamptz;

CREATE INDEX app_users_guest_origin_idx ON app_users (guest_origin_hash, guest_expires_at)
  WHERE guest_origin_hash IS NOT NULL;

CREATE OR REPLACE FUNCTION app_guard_guest_isolation()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  guest_trip boolean;
  guest_user boolean;
  trip_owner uuid;
BEGIN
  IF TG_TABLE_NAME = 'app_users' THEN
    -- An account is a guest from creation to deletion; neither direction can change.
    IF (OLD.guest_expires_at IS NULL) <> (NEW.guest_expires_at IS NULL) THEN
      RAISE EXCEPTION 'an account cannot become or stop being a guest' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;
  IF TG_TABLE_NAME = 'trips' THEN
    IF TG_OP = 'UPDATE' THEN
      IF (OLD.guest_expires_at IS NULL) <> (NEW.guest_expires_at IS NULL) THEN
        RAISE EXCEPTION 'a trip cannot become or stop being a guest trip' USING ERRCODE = 'check_violation';
      END IF;
      IF OLD.guest_expires_at IS NOT NULL AND NEW.owner_user_id IS DISTINCT FROM OLD.owner_user_id THEN
        RAISE EXCEPTION 'a guest trip keeps its guest owner' USING ERRCODE = 'check_violation';
      END IF;
    END IF;
    SELECT guest_expires_at IS NOT NULL INTO guest_user FROM app_users WHERE id = NEW.owner_user_id;
    IF coalesce(guest_user, false) <> (NEW.guest_expires_at IS NOT NULL) THEN
      RAISE EXCEPTION 'guest trips belong only to guests, and guests own only guest trips' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;
  SELECT guest_expires_at IS NOT NULL, owner_user_id INTO guest_trip, trip_owner FROM trips WHERE id = NEW.trip_id;
  IF TG_TABLE_NAME = 'trip_members' THEN
    IF coalesce(guest_trip, false) THEN
      IF NEW.user_id IS NULL THEN
        RAISE EXCEPTION 'guest trips have no invited members' USING ERRCODE = 'check_violation';
      END IF;
      IF NEW.user_id IS DISTINCT FROM trip_owner
         OR (TG_OP = 'UPDATE' AND NEW.user_id IS DISTINCT FROM OLD.user_id) THEN
        RAISE EXCEPTION 'guests and other trips never mix: a guest trip''s only member is its guest' USING ERRCODE = 'check_violation';
      END IF;
      RETURN NEW;
    END IF;
    IF NEW.user_id IS NOT NULL THEN
      SELECT guest_expires_at IS NOT NULL INTO guest_user FROM app_users WHERE id = NEW.user_id;
      IF coalesce(guest_user, false) THEN
        RAISE EXCEPTION 'guests and other trips never mix' USING ERRCODE = 'check_violation';
      END IF;
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

-- Permanently delete one expired guest: the account, its guest trips and every row that belongs
-- to them. Real trips protect their history with append-only triggers and RESTRICT foreign keys,
-- which a deletion cannot satisfy in any order, so this function suspends triggers for its own
-- deletes only. That needs a superuser caller; the function runs with the caller's rights.
-- What keeps it to the guest's rows:
--   * it acts only on an expired account whose only identity is the synthetic guest issuer, and
--     whose trips are guest trips with no other member;
--   * it deletes only in public tables: by the guest's trip ids, and by the guest's user id only in
--     tables without trip_id;
--   * with triggers back on, it proves that no row in any trip table still belongs to the purged
--     trips and that no foreign key still points at them or the account; otherwise it raises,
--     which rolls everything back.
-- Returns false when there is nothing to purge (not a guest, or not expired yet).
CREATE OR REPLACE FUNCTION app_purge_expired_guest(p_user_id uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, public, pg_temp AS $$
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
  IF NOT EXISTS (SELECT 1 FROM public.oidc_identities WHERE user_id = p_user_id AND issuer = 'urn:stardust:guest')
     OR EXISTS (SELECT 1 FROM public.oidc_identities WHERE user_id = p_user_id AND issuer <> 'urn:stardust:guest') THEN
    RAISE EXCEPTION 'account has no guest identity; refusing to purge it' USING ERRCODE = 'check_violation';
  END IF;
  SELECT coalesce(array_agg(id), ARRAY[]::uuid[]) INTO guest_trips FROM public.trips WHERE owner_user_id = p_user_id;
  PERFORM 1 FROM public.trips WHERE id = ANY (guest_trips) FOR UPDATE;
  IF EXISTS (SELECT 1 FROM public.trips WHERE id = ANY (guest_trips) AND guest_expires_at IS NULL)
     OR EXISTS (SELECT 1 FROM public.trip_members WHERE user_id = p_user_id AND NOT (trip_id = ANY (guest_trips)))
     OR EXISTS (SELECT 1 FROM public.trip_members WHERE trip_id = ANY (guest_trips) AND user_id IS DISTINCT FROM p_user_id)
     OR EXISTS (SELECT 1 FROM public.feedback_reports WHERE trip_id = ANY (guest_trips)) THEN
    RAISE EXCEPTION 'guest account is not isolated; refusing to purge it' USING ERRCODE = 'check_violation';
  END IF;

  PERFORM pg_catalog.set_config('session_replication_role', 'replica', true);
  FOR rel IN
    SELECT class.relname FROM pg_catalog.pg_class class
      JOIN pg_catalog.pg_attribute att ON att.attrelid = class.oid
     WHERE class.relnamespace = 'public'::regnamespace AND class.relkind IN ('r', 'p')
       AND att.attname = 'trip_id' AND NOT att.attisdropped
  LOOP
    EXECUTE pg_catalog.format('DELETE FROM public.%I WHERE trip_id = ANY ($1)', rel.relname) USING guest_trips;
  END LOOP;
  DELETE FROM public.trips WHERE id = ANY (guest_trips);
  FOR rel IN
    SELECT child.relname AS table_name, att.attname AS column_name
      FROM pg_catalog.pg_constraint con
      JOIN pg_catalog.pg_class child ON child.oid = con.conrelid
      JOIN pg_catalog.pg_attribute att ON att.attrelid = con.conrelid AND att.attnum = con.conkey[1]
     WHERE con.contype = 'f' AND con.confrelid = 'public.app_users'::regclass
       AND pg_catalog.cardinality(con.conkey) = 1 AND child.relnamespace = 'public'::regnamespace
       AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_attribute trip_column
                        WHERE trip_column.attrelid = con.conrelid AND trip_column.attname = 'trip_id' AND NOT trip_column.attisdropped)
  LOOP
    EXECUTE pg_catalog.format('DELETE FROM public.%I WHERE %I = $1', rel.table_name, rel.column_name) USING p_user_id;
  END LOOP;
  DELETE FROM public.app_users WHERE id = p_user_id;
  PERFORM pg_catalog.set_config('session_replication_role', 'origin', true);

  FOR rel IN
    SELECT class.relname FROM pg_catalog.pg_class class
      JOIN pg_catalog.pg_attribute att ON att.attrelid = class.oid
     WHERE class.relnamespace = 'public'::regnamespace AND class.relkind IN ('r', 'p')
       AND att.attname = 'trip_id' AND NOT att.attisdropped
  LOOP
    EXECUTE pg_catalog.format('SELECT EXISTS (SELECT 1 FROM public.%I WHERE trip_id = ANY ($1))', rel.relname)
      INTO remaining USING guest_trips;
    IF remaining THEN
      RAISE EXCEPTION 'guest purge would leave rows in public.%', rel.relname;
    END IF;
  END LOOP;
  FOR rel IN
    SELECT child.relname AS table_name, att.attname AS column_name, con.confrelid AS target
      FROM pg_catalog.pg_constraint con
      JOIN pg_catalog.pg_class child ON child.oid = con.conrelid
      JOIN pg_catalog.pg_attribute att ON att.attrelid = con.conrelid AND att.attnum = con.conkey[1]
     WHERE con.contype = 'f' AND pg_catalog.cardinality(con.conkey) = 1 AND child.relnamespace = 'public'::regnamespace
       AND con.confrelid IN ('public.trips'::regclass, 'public.app_users'::regclass)
  LOOP
    IF rel.target = 'public.trips'::regclass THEN
      EXECUTE pg_catalog.format('SELECT EXISTS (SELECT 1 FROM public.%I WHERE %I = ANY ($1))', rel.table_name, rel.column_name)
        INTO remaining USING guest_trips;
    ELSE
      EXECUTE pg_catalog.format('SELECT EXISTS (SELECT 1 FROM public.%I WHERE %I = $1)', rel.table_name, rel.column_name)
        INTO remaining USING p_user_id;
    END IF;
    IF remaining THEN
      RAISE EXCEPTION 'guest purge would leave a reference in public.%.%', rel.table_name, rel.column_name;
    END IF;
  END LOOP;
  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION app_purge_expired_guest(uuid) FROM PUBLIC;

COMMENT ON FUNCTION app_purge_expired_guest(uuid) IS
  'Permanently deletes one expired, isolated guest account and its guest trips (JOB-064). Runs with the caller''s rights and needs a superuser caller: only the guest-purge job, connected as the migration administrator, calls it. scripts/db/runtime-role.mjs never grants it to the runtime role.';
