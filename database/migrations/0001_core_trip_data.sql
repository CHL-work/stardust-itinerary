CREATE TABLE app_users (
  id uuid PRIMARY KEY,
  display_name text NOT NULL CHECK (length(btrim(display_name)) BETWEEN 1 AND 120),
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE oidc_identities (
  issuer text NOT NULL CHECK (length(btrim(issuer)) > 0),
  subject text NOT NULL CHECK (length(btrim(subject)) > 0),
  user_id uuid NOT NULL REFERENCES app_users (id) ON DELETE CASCADE,
  email_hint text,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (issuer, subject)
);

CREATE INDEX oidc_identities_user_idx ON oidc_identities (user_id);

CREATE TABLE trips (
  id uuid PRIMARY KEY,
  owner_user_id uuid NOT NULL REFERENCES app_users (id) ON DELETE RESTRICT,
  name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 160),
  time_zone text NOT NULL CHECK (length(btrim(time_zone)) BETWEEN 1 AND 80),
  default_locale text NOT NULL DEFAULT 'en'
    CHECK (default_locale IN ('en', 'zh-HK', 'zh-HK-lihkg', 'ja-JP')),
  default_currency text NOT NULL CHECK (default_currency ~ '^[A-Z]{3}$'),
  starts_on date NOT NULL,
  ends_on date NOT NULL,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (ends_on >= starts_on)
);

CREATE TABLE trip_members (
  trip_id uuid NOT NULL REFERENCES trips (id) ON DELETE CASCADE,
  id uuid NOT NULL,
  user_id uuid REFERENCES app_users (id) ON DELETE SET NULL,
  display_name text NOT NULL CHECK (length(btrim(display_name)) BETWEEN 1 AND 120),
  role text NOT NULL CHECK (role IN ('owner', 'editor', 'viewer')),
  status text NOT NULL DEFAULT 'invited'
    CHECK (status IN ('invited', 'active', 'revoked')),
  current_revision integer NOT NULL DEFAULT 1 CHECK (current_revision >= 1),
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (trip_id, id),
  UNIQUE (trip_id, user_id)
);

CREATE INDEX trip_members_user_idx ON trip_members (user_id) WHERE user_id IS NOT NULL;

CREATE TABLE trip_days (
  trip_id uuid NOT NULL REFERENCES trips (id) ON DELETE CASCADE,
  id uuid NOT NULL,
  day_date date NOT NULL,
  label text,
  PRIMARY KEY (trip_id, id),
  UNIQUE (trip_id, day_date)
);

CREATE TABLE itinerary_items (
  trip_id uuid NOT NULL REFERENCES trips (id) ON DELETE CASCADE,
  id uuid NOT NULL,
  trip_day_id uuid NOT NULL,
  created_by_member_id uuid NOT NULL,
  title text NOT NULL CHECK (length(btrim(title)) BETWEEN 1 AND 240),
  item_type text NOT NULL DEFAULT 'activity'
    CHECK (item_type IN ('activity', 'meal', 'transport', 'lodging', 'note')),
  starts_at timestamptz,
  ends_at timestamptz,
  location_name text,
  map_url text,
  status text NOT NULL DEFAULT 'planned'
    CHECK (status IN ('draft', 'planned', 'cancelled', 'completed')),
  is_locked boolean NOT NULL DEFAULT false,
  current_revision integer NOT NULL DEFAULT 1 CHECK (current_revision >= 1),
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (trip_id, id),
  FOREIGN KEY (trip_id, trip_day_id)
    REFERENCES trip_days (trip_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (trip_id, created_by_member_id)
    REFERENCES trip_members (trip_id, id) ON DELETE RESTRICT,
  CHECK (ends_at IS NULL OR starts_at IS NULL OR ends_at > starts_at)
);

CREATE INDEX itinerary_items_day_idx
  ON itinerary_items (trip_id, trip_day_id, starts_at, id);

CREATE TABLE itinerary_revisions (
  trip_id uuid NOT NULL,
  itinerary_item_id uuid NOT NULL,
  revision integer NOT NULL CHECK (revision >= 1),
  changed_by_member_id uuid NOT NULL,
  snapshot jsonb NOT NULL CHECK (jsonb_typeof(snapshot) = 'object'),
  reason text,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (trip_id, itinerary_item_id, revision),
  FOREIGN KEY (trip_id, itinerary_item_id)
    REFERENCES itinerary_items (trip_id, id) ON DELETE CASCADE,
  FOREIGN KEY (trip_id, changed_by_member_id)
    REFERENCES trip_members (trip_id, id) ON DELETE RESTRICT
);

CREATE TABLE preferences (
  trip_id uuid NOT NULL,
  member_id uuid NOT NULL,
  profile jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(profile) = 'object'),
  visibility text NOT NULL DEFAULT 'trip'
    CHECK (visibility IN ('private', 'owner', 'trip')),
  current_revision integer NOT NULL DEFAULT 1 CHECK (current_revision >= 1),
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (trip_id, member_id),
  FOREIGN KEY (trip_id, member_id)
    REFERENCES trip_members (trip_id, id) ON DELETE CASCADE
);

CREATE TABLE preference_revisions (
  trip_id uuid NOT NULL,
  member_id uuid NOT NULL,
  revision integer NOT NULL CHECK (revision >= 1),
  changed_by_member_id uuid NOT NULL,
  snapshot jsonb NOT NULL CHECK (jsonb_typeof(snapshot) = 'object'),
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (trip_id, member_id, revision),
  FOREIGN KEY (trip_id, member_id)
    REFERENCES preferences (trip_id, member_id) ON DELETE CASCADE,
  FOREIGN KEY (trip_id, changed_by_member_id)
    REFERENCES trip_members (trip_id, id) ON DELETE RESTRICT
);

CREATE TABLE expenses (
  trip_id uuid NOT NULL REFERENCES trips (id) ON DELETE CASCADE,
  id uuid NOT NULL,
  payer_member_id uuid NOT NULL,
  itinerary_item_id uuid,
  description text NOT NULL CHECK (length(btrim(description)) BETWEEN 1 AND 240),
  amount_minor bigint NOT NULL CHECK (amount_minor > 0),
  currency text NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'posted', 'void')),
  occurred_at timestamptz NOT NULL,
  current_revision integer NOT NULL DEFAULT 1 CHECK (current_revision >= 1),
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (trip_id, id),
  FOREIGN KEY (trip_id, payer_member_id)
    REFERENCES trip_members (trip_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (trip_id, itinerary_item_id)
    REFERENCES itinerary_items (trip_id, id) ON DELETE SET NULL (itinerary_item_id)
);

CREATE INDEX expenses_occurred_idx ON expenses (trip_id, occurred_at, id);

CREATE TABLE expense_splits (
  trip_id uuid NOT NULL,
  expense_id uuid NOT NULL,
  member_id uuid NOT NULL,
  share_minor bigint NOT NULL CHECK (share_minor >= 0),
  PRIMARY KEY (trip_id, expense_id, member_id),
  FOREIGN KEY (trip_id, expense_id)
    REFERENCES expenses (trip_id, id) ON DELETE CASCADE,
  FOREIGN KEY (trip_id, member_id)
    REFERENCES trip_members (trip_id, id) ON DELETE RESTRICT
);

CREATE TABLE expense_revisions (
  trip_id uuid NOT NULL,
  expense_id uuid NOT NULL,
  revision integer NOT NULL CHECK (revision >= 1),
  changed_by_member_id uuid NOT NULL,
  snapshot jsonb NOT NULL CHECK (jsonb_typeof(snapshot) = 'object'),
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (trip_id, expense_id, revision),
  FOREIGN KEY (trip_id, expense_id)
    REFERENCES expenses (trip_id, id) ON DELETE CASCADE,
  FOREIGN KEY (trip_id, changed_by_member_id)
    REFERENCES trip_members (trip_id, id) ON DELETE RESTRICT
);

CREATE FUNCTION app_validate_itinerary_revision()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  stored_revision integer;
  has_history boolean;
BEGIN
  SELECT current_revision
    INTO stored_revision
    FROM itinerary_items
   WHERE trip_id = NEW.trip_id AND id = NEW.itinerary_item_id
   FOR UPDATE;

  SELECT EXISTS (
    SELECT 1 FROM itinerary_revisions
     WHERE trip_id = NEW.trip_id AND itinerary_item_id = NEW.itinerary_item_id
  ) INTO has_history;

  IF NOT has_history THEN
    IF NEW.revision <> 1 OR stored_revision <> 1 THEN
      RAISE EXCEPTION 'initial itinerary revision must be 1';
    END IF;
  ELSE
    IF NEW.revision <> stored_revision + 1 THEN
      RAISE EXCEPTION 'itinerary revision must follow current revision %', stored_revision;
    END IF;
    UPDATE itinerary_items
       SET current_revision = NEW.revision, updated_at = CURRENT_TIMESTAMP
     WHERE trip_id = NEW.trip_id AND id = NEW.itinerary_item_id;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER itinerary_revision_sequence
BEFORE INSERT ON itinerary_revisions
FOR EACH ROW EXECUTE FUNCTION app_validate_itinerary_revision();

CREATE FUNCTION app_validate_preference_revision()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  stored_revision integer;
  has_history boolean;
BEGIN
  SELECT current_revision
    INTO stored_revision
    FROM preferences
   WHERE trip_id = NEW.trip_id AND member_id = NEW.member_id
   FOR UPDATE;

  SELECT EXISTS (
    SELECT 1 FROM preference_revisions
     WHERE trip_id = NEW.trip_id AND member_id = NEW.member_id
  ) INTO has_history;

  IF NOT has_history THEN
    IF NEW.revision <> 1 OR stored_revision <> 1 THEN
      RAISE EXCEPTION 'initial preference revision must be 1';
    END IF;
  ELSE
    IF NEW.revision <> stored_revision + 1 THEN
      RAISE EXCEPTION 'preference revision must follow current revision %', stored_revision;
    END IF;
    UPDATE preferences
       SET current_revision = NEW.revision, updated_at = CURRENT_TIMESTAMP
     WHERE trip_id = NEW.trip_id AND member_id = NEW.member_id;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER preference_revision_sequence
BEFORE INSERT ON preference_revisions
FOR EACH ROW EXECUTE FUNCTION app_validate_preference_revision();

CREATE FUNCTION app_validate_expense_revision()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  stored_revision integer;
  has_history boolean;
BEGIN
  SELECT current_revision
    INTO stored_revision
    FROM expenses
   WHERE trip_id = NEW.trip_id AND id = NEW.expense_id
   FOR UPDATE;

  SELECT EXISTS (
    SELECT 1 FROM expense_revisions
     WHERE trip_id = NEW.trip_id AND expense_id = NEW.expense_id
  ) INTO has_history;

  IF NOT has_history THEN
    IF NEW.revision <> 1 OR stored_revision <> 1 THEN
      RAISE EXCEPTION 'initial expense revision must be 1';
    END IF;
  ELSE
    IF NEW.revision <> stored_revision + 1 THEN
      RAISE EXCEPTION 'expense revision must follow current revision %', stored_revision;
    END IF;
    UPDATE expenses
       SET current_revision = NEW.revision, updated_at = CURRENT_TIMESTAMP
     WHERE trip_id = NEW.trip_id AND id = NEW.expense_id;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER expense_revision_sequence
BEFORE INSERT ON expense_revisions
FOR EACH ROW EXECUTE FUNCTION app_validate_expense_revision();

CREATE FUNCTION app_check_expense_allocation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  target_trip_id uuid;
  target_expense_id uuid;
  expense_amount bigint;
  expense_status text;
  allocated_amount bigint;
  positive_splits integer;
BEGIN
  IF TG_TABLE_NAME = 'expenses' THEN
    target_trip_id := COALESCE(NEW.trip_id, OLD.trip_id);
    target_expense_id := COALESCE(NEW.id, OLD.id);
  ELSE
    target_trip_id := COALESCE(NEW.trip_id, OLD.trip_id);
    target_expense_id := COALESCE(NEW.expense_id, OLD.expense_id);
  END IF;

  SELECT amount_minor, status
    INTO expense_amount, expense_status
    FROM expenses
   WHERE trip_id = target_trip_id AND id = target_expense_id;

  IF NOT FOUND OR expense_status <> 'posted' THEN
    RETURN NULL;
  END IF;

  SELECT COALESCE(sum(share_minor), 0), count(*) FILTER (WHERE share_minor > 0)
    INTO allocated_amount, positive_splits
    FROM expense_splits
   WHERE trip_id = target_trip_id AND expense_id = target_expense_id;

  IF allocated_amount <> expense_amount OR positive_splits < 1 THEN
    RAISE EXCEPTION 'posted expense allocation % does not equal amount %',
      allocated_amount, expense_amount;
  END IF;

  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER expense_allocation_from_expense
AFTER INSERT OR UPDATE OF amount_minor, status ON expenses
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION app_check_expense_allocation();

CREATE CONSTRAINT TRIGGER expense_allocation_from_split
AFTER INSERT OR UPDATE OR DELETE ON expense_splits
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION app_check_expense_allocation();
