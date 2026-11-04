-- Record repayments made outside the app, separately from trip spending.
CREATE TABLE member_payments (
  trip_id uuid NOT NULL REFERENCES trips (id) ON DELETE RESTRICT,
  id uuid NOT NULL,
  from_member_id uuid NOT NULL,
  to_member_id uuid NOT NULL,
  accounting_from_member_id uuid NOT NULL,
  accounting_to_member_id uuid NOT NULL,
  currency text NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  amount_minor bigint NOT NULL CHECK (amount_minor BETWEEN 1 AND 9007199254740991),
  occurred_at timestamptz NOT NULL CHECK (isfinite(occurred_at)),
  note text CHECK (note IS NULL OR length(note) <= 1000),
  status text NOT NULL CHECK (status IN ('pending', 'posted', 'rejected', 'void')),
  current_revision integer NOT NULL DEFAULT 1 CHECK (current_revision >= 1),
  created_by_member_id uuid NOT NULL,
  created_by_user_id uuid NOT NULL REFERENCES app_users (id) ON DELETE RESTRICT,
  client_request_id uuid NOT NULL,
  request_hash text NOT NULL CHECK (request_hash ~ '^[a-f0-9]{64}$'),
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (trip_id, id),
  UNIQUE (trip_id, created_by_member_id, client_request_id),
  CHECK (from_member_id <> to_member_id),
  FOREIGN KEY (trip_id, from_member_id) REFERENCES trip_members (trip_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (trip_id, to_member_id) REFERENCES trip_members (trip_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (trip_id, accounting_from_member_id) REFERENCES trip_members (trip_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (trip_id, accounting_to_member_id) REFERENCES trip_members (trip_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (trip_id, created_by_member_id) REFERENCES trip_members (trip_id, id) ON DELETE RESTRICT
);

CREATE INDEX member_payments_history_idx ON member_payments (trip_id, occurred_at DESC, id);

CREATE TABLE member_payment_revisions (
  trip_id uuid NOT NULL,
  payment_id uuid NOT NULL,
  revision integer NOT NULL CHECK (revision >= 1),
  changed_by_member_id uuid NOT NULL,
  changed_by_user_id uuid REFERENCES app_users (id) ON DELETE RESTRICT,
  snapshot jsonb NOT NULL CHECK (jsonb_typeof(snapshot) = 'object'),
  action text NOT NULL CHECK (action IN ('create', 'approve', 'reject', 'void', 'member_reassigned')),
  reason text CHECK (reason IS NULL OR length(reason) <= 500),
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (trip_id, payment_id, revision),
  FOREIGN KEY (trip_id, payment_id) REFERENCES member_payments (trip_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (trip_id, changed_by_member_id) REFERENCES trip_members (trip_id, id) ON DELETE RESTRICT
);

CREATE TABLE member_payment_actions (
  trip_id uuid NOT NULL,
  id uuid NOT NULL,
  actor_member_id uuid NOT NULL,
  client_request_id uuid NOT NULL,
  request_hash text NOT NULL CHECK (request_hash ~ '^[a-f0-9]{64}$'),
  payment_id uuid NOT NULL,
  result_revision integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (trip_id, id),
  UNIQUE (trip_id, actor_member_id, client_request_id),
  FOREIGN KEY (trip_id, actor_member_id) REFERENCES trip_members (trip_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (trip_id, payment_id, result_revision)
    REFERENCES member_payment_revisions (trip_id, payment_id, revision) ON DELETE RESTRICT
    DEFERRABLE INITIALLY DEFERRED
);

CREATE TRIGGER member_payment_revisions_append_only BEFORE UPDATE OR DELETE ON member_payment_revisions
FOR EACH ROW EXECUTE FUNCTION app_reject_append_only_mutation();
CREATE TRIGGER member_payment_actions_append_only BEFORE UPDATE OR DELETE ON member_payment_actions
FOR EACH ROW EXECUTE FUNCTION app_reject_append_only_mutation();
CREATE TRIGGER member_payments_no_delete BEFORE DELETE ON member_payments
FOR EACH ROW EXECUTE FUNCTION app_reject_append_only_mutation();

CREATE FUNCTION app_guard_member_payment_insert() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.current_revision <> 1 OR NEW.status NOT IN ('pending', 'posted')
    OR NEW.accounting_from_member_id <> NEW.from_member_id
    OR NEW.accounting_to_member_id <> NEW.to_member_id THEN
    RAISE EXCEPTION 'member payment must start with its original accounting attribution';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER member_payments_guard_insert BEFORE INSERT ON member_payments
FOR EACH ROW EXECUTE FUNCTION app_guard_member_payment_insert();

CREATE FUNCTION app_guard_member_payment_update() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF ROW(NEW.trip_id, NEW.id, NEW.from_member_id, NEW.to_member_id, NEW.currency,
      NEW.amount_minor, NEW.occurred_at, NEW.note, NEW.created_by_member_id,
      NEW.created_by_user_id, NEW.client_request_id, NEW.request_hash, NEW.created_at)
    IS DISTINCT FROM ROW(OLD.trip_id, OLD.id, OLD.from_member_id, OLD.to_member_id, OLD.currency,
      OLD.amount_minor, OLD.occurred_at, OLD.note, OLD.created_by_member_id,
      OLD.created_by_user_id, OLD.client_request_id, OLD.request_hash, OLD.created_at) THEN
    RAISE EXCEPTION 'member payment original facts are immutable';
  END IF;
  IF OLD.status = 'void' OR NOT (
    (OLD.status = 'pending' AND NEW.status IN ('posted', 'rejected', 'void')) OR
    (OLD.status = 'rejected' AND NEW.status IN ('posted', 'void')) OR
    (OLD.status = 'posted' AND NEW.status = 'void') OR
    (OLD.status = 'posted' AND NEW.status = 'posted' AND
      ROW(NEW.accounting_from_member_id, NEW.accounting_to_member_id)
        IS DISTINCT FROM ROW(OLD.accounting_from_member_id, OLD.accounting_to_member_id))
  ) THEN
    RAISE EXCEPTION 'invalid member payment status transition';
  END IF;
  NEW.current_revision := OLD.current_revision + 1;
  NEW.updated_at := CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$;
CREATE TRIGGER member_payments_guard_update BEFORE UPDATE ON member_payments
FOR EACH ROW EXECUTE FUNCTION app_guard_member_payment_update();

-- Every committed version needs its exact immutable financial snapshot. Timestamp
-- fields compare as instants so JavaScript ISO serialization remains portable.
CREATE FUNCTION app_validate_member_payment_revision() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE saved jsonb; saved_action text; expected_action text;
BEGIN
  SELECT snapshot, action INTO saved, saved_action FROM member_payment_revisions
    WHERE trip_id = NEW.trip_id AND payment_id = NEW.id AND revision = NEW.current_revision;
  expected_action := CASE WHEN TG_OP = 'INSERT' THEN 'create'
    WHEN NEW.status = OLD.status THEN 'member_reassigned'
    WHEN NEW.status = 'posted' THEN 'approve' WHEN NEW.status = 'rejected' THEN 'reject' ELSE 'void' END;
  IF saved IS NULL OR saved - 'occurredAt' IS DISTINCT FROM jsonb_build_object(
    'id', NEW.id, 'fromMemberId', NEW.from_member_id, 'toMemberId', NEW.to_member_id,
    'accountingFromMemberId', NEW.accounting_from_member_id, 'accountingToMemberId', NEW.accounting_to_member_id,
    'currency', NEW.currency, 'amountMinor', NEW.amount_minor, 'note', NEW.note,
    'status', NEW.status, 'currentRevision', NEW.current_revision,
    'createdByMemberId', NEW.created_by_member_id, 'createdByUserId', NEW.created_by_user_id
  ) OR (saved->>'occurredAt')::timestamptz IS DISTINCT FROM NEW.occurred_at
    OR saved_action IS DISTINCT FROM expected_action THEN
    RAISE EXCEPTION 'member payment revision snapshot is missing or inconsistent';
  END IF;
  RETURN NULL;
END;
$$;
CREATE CONSTRAINT TRIGGER member_payments_revision_required AFTER INSERT OR UPDATE ON member_payments
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION app_validate_member_payment_revision();

-- Bound gross financial inputs, not merely the final net: any authorized subset
-- and individual sent/received total must remain exactly representable in the UI.
-- Include later expense edits too. Existing expense-only currencies are unchanged.
CREATE FUNCTION app_check_member_payment_capacity(target_trip_id uuid, target_currency text)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE payment_total numeric; expense_total numeric;
BEGIN
  -- Application mutations acquire this same lock before touching financial rows.
  -- At READ COMMITTED the subsequent sums see the preceding committer's results.
  PERFORM 1 FROM trips WHERE id = target_trip_id FOR UPDATE;
  SELECT sum(amount_minor) INTO payment_total FROM member_payments
    WHERE trip_id = target_trip_id AND currency = target_currency AND status = 'posted';
  IF payment_total IS NULL THEN RETURN; END IF;
  SELECT COALESCE(sum(amount_minor), 0) INTO expense_total FROM expenses
    WHERE trip_id = target_trip_id AND currency = target_currency AND status = 'posted';
  IF payment_total + expense_total > 9007199254740991 THEN
    RAISE EXCEPTION 'This record exceeds the supported financial range.'
      USING ERRCODE = '23514', CONSTRAINT = 'member_payment_financial_capacity_ck';
  END IF;
END;
$$;

CREATE FUNCTION app_validate_member_payment_capacity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP <> 'DELETE' THEN
    PERFORM app_check_member_payment_capacity(NEW.trip_id, NEW.currency);
  END IF;
  IF TG_OP = 'DELETE' THEN
    PERFORM app_check_member_payment_capacity(OLD.trip_id, OLD.currency);
  ELSIF TG_OP = 'UPDATE' AND ROW(OLD.trip_id, OLD.currency) IS DISTINCT FROM ROW(NEW.trip_id, NEW.currency) THEN
    PERFORM app_check_member_payment_capacity(OLD.trip_id, OLD.currency);
  END IF;
  RETURN NULL;
END;
$$;
CREATE CONSTRAINT TRIGGER member_payments_financial_capacity AFTER INSERT OR UPDATE OR DELETE ON member_payments
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION app_validate_member_payment_capacity();
CREATE CONSTRAINT TRIGGER expenses_member_payment_capacity AFTER INSERT OR UPDATE OR DELETE ON expenses
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION app_validate_member_payment_capacity();
