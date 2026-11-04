ALTER TABLE trips
  ADD COLUMN max_members smallint NOT NULL DEFAULT 20
    CHECK (max_members BETWEEN 1 AND 20);

CREATE TABLE trip_join_links (
  id uuid PRIMARY KEY,
  trip_id uuid NOT NULL REFERENCES trips (id) ON DELETE CASCADE,
  token_hash bytea NOT NULL UNIQUE CHECK (octet_length(token_hash) = 32),
  created_by_member_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  revoked_at timestamptz,
  exhausted_at timestamptz,
  FOREIGN KEY (trip_id, created_by_member_id)
    REFERENCES trip_members (trip_id, id) ON DELETE RESTRICT,
  CHECK (revoked_at IS NULL OR revoked_at >= created_at),
  CHECK (exhausted_at IS NULL OR exhausted_at >= created_at),
  CHECK (revoked_at IS NULL OR exhausted_at IS NULL)
);

CREATE UNIQUE INDEX trip_join_links_one_active_idx
  ON trip_join_links (trip_id)
  WHERE revoked_at IS NULL AND exhausted_at IS NULL;

CREATE INDEX trip_join_links_lookup_idx
  ON trip_join_links (token_hash)
  WHERE revoked_at IS NULL;

CREATE FUNCTION app_validate_trip_capacity()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  configured_max integer;
  occupied_members integer;
  projected_members integer;
BEGIN
  IF TG_TABLE_NAME = 'trips' THEN
    SELECT count(*)::integer
      INTO occupied_members
      FROM trip_members
     WHERE trip_id = NEW.id
       AND status <> 'removed';

    IF occupied_members > NEW.max_members THEN
      RAISE EXCEPTION 'trip member capacity % cannot be lower than occupied member count %',
        NEW.max_members, occupied_members;
    END IF;

    IF occupied_members >= NEW.max_members THEN
      UPDATE trip_join_links
         SET exhausted_at = CURRENT_TIMESTAMP
       WHERE trip_id = NEW.id
         AND revoked_at IS NULL
         AND exhausted_at IS NULL;
    END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE'
     AND NEW.trip_id = OLD.trip_id
     AND (NEW.status = 'removed') = (OLD.status = 'removed') THEN
    RETURN NEW;
  END IF;

  IF NEW.status = 'removed' THEN
    RETURN NEW;
  END IF;

  SELECT max_members
    INTO configured_max
    FROM trips
   WHERE id = NEW.trip_id
   FOR UPDATE;

  IF configured_max IS NULL THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    SELECT count(*)::integer
      INTO occupied_members
      FROM trip_members
     WHERE trip_id = NEW.trip_id
       AND status <> 'removed'
       AND NOT (trip_id = OLD.trip_id AND id = OLD.id);
  ELSE
    SELECT count(*)::integer
      INTO occupied_members
      FROM trip_members
     WHERE trip_id = NEW.trip_id
       AND status <> 'removed';
  END IF;

  projected_members := occupied_members + 1;
  IF projected_members > configured_max THEN
    RAISE EXCEPTION 'trip has reached its % member capacity', configured_max;
  END IF;

  IF projected_members >= configured_max THEN
    UPDATE trip_join_links
       SET exhausted_at = CURRENT_TIMESTAMP
     WHERE trip_id = NEW.trip_id
       AND revoked_at IS NULL
       AND exhausted_at IS NULL;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trip_capacity_from_trip
BEFORE UPDATE OF max_members ON trips
FOR EACH ROW EXECUTE FUNCTION app_validate_trip_capacity();

CREATE TRIGGER trip_capacity_from_member
BEFORE INSERT OR UPDATE OF trip_id, status ON trip_members
FOR EACH ROW EXECUTE FUNCTION app_validate_trip_capacity();

CREATE FUNCTION app_validate_trip_join_link()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  configured_max integer;
  occupied_members integer;
  creator_is_active_owner boolean;
BEGIN
  SELECT max_members
    INTO configured_max
    FROM trips
   WHERE id = NEW.trip_id
   FOR UPDATE;

  SELECT count(*)::integer
    INTO occupied_members
    FROM trip_members
   WHERE trip_id = NEW.trip_id
     AND status <> 'removed';

  SELECT EXISTS (
    SELECT 1
      FROM trip_members
     WHERE trip_id = NEW.trip_id
       AND id = NEW.created_by_member_id
       AND role = 'owner'
       AND status = 'active'
  ) INTO creator_is_active_owner;

  IF NOT creator_is_active_owner THEN
    RAISE EXCEPTION 'an active trip owner must create a reusable join link';
  END IF;

  IF occupied_members >= configured_max THEN
    RAISE EXCEPTION 'trip has reached its % member capacity', configured_max;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trip_join_link_owner_and_capacity
BEFORE INSERT ON trip_join_links
FOR EACH ROW EXECUTE FUNCTION app_validate_trip_join_link();
