-- Removal is a bookkeeping transfer, never deletion of an actual payment.
-- Deferred checks let the owner explicitly move the affected accounting legs
-- and invalidate unapproved payments in the same transaction as member removal.
CREATE FUNCTION app_validate_member_payment_removal() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE target_trip uuid := NEW.trip_id;
BEGIN
  -- A posted payment's bookkeeping may change only to finish member removal.
  -- 0040 independently requires a matching member_reassigned revision. Check
  -- the final member state here because its tombstone is written afterward.
  IF TG_TABLE_NAME = 'member_payments' AND TG_OP = 'UPDATE' THEN
    IF (NEW.accounting_from_member_id IS DISTINCT FROM OLD.accounting_from_member_id
        AND (NOT EXISTS (SELECT 1 FROM trip_members WHERE trip_id = target_trip
          AND id = OLD.accounting_from_member_id AND status = 'removed')
          OR NOT EXISTS (SELECT 1 FROM trip_members WHERE trip_id = target_trip
            AND id = NEW.accounting_from_member_id AND status = 'active')))
      OR (NEW.accounting_to_member_id IS DISTINCT FROM OLD.accounting_to_member_id
        AND (NOT EXISTS (SELECT 1 FROM trip_members WHERE trip_id = target_trip
          AND id = OLD.accounting_to_member_id AND status = 'removed')
          OR NOT EXISTS (SELECT 1 FROM trip_members WHERE trip_id = target_trip
            AND id = NEW.accounting_to_member_id AND status = 'active'))) THEN
      RAISE EXCEPTION 'repayment accounting reassignment requires member removal and an active replacement'
        USING ERRCODE = '23514', CONSTRAINT = 'member_payments_accounting_removal_only_ck';
    END IF;
  END IF;
  IF EXISTS (
    SELECT 1 FROM member_payments payment
    WHERE payment.trip_id = target_trip AND (
      (payment.status = 'posted' AND EXISTS (
        SELECT 1 FROM trip_members member WHERE member.trip_id = payment.trip_id
          AND member.status = 'removed'
          AND member.id IN (payment.accounting_from_member_id, payment.accounting_to_member_id)
      )) OR
      (payment.status IN ('pending', 'rejected') AND EXISTS (
        SELECT 1 FROM trip_members member WHERE member.trip_id = payment.trip_id
          AND member.status = 'removed'
          AND member.id IN (payment.from_member_id, payment.to_member_id,
            payment.accounting_from_member_id, payment.accounting_to_member_id, payment.created_by_member_id)
      ))
    )
  ) THEN
    RAISE EXCEPTION 'removed members cannot retain repayment obligations or approvable payments'
      USING ERRCODE = '23514', CONSTRAINT = 'member_payments_no_removed_obligations_ck';
  END IF;
  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER member_payments_removal_integrity
AFTER INSERT OR UPDATE ON member_payments DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION app_validate_member_payment_removal();

CREATE CONSTRAINT TRIGGER trip_members_payment_removal_integrity
AFTER UPDATE ON trip_members DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION app_validate_member_payment_removal();
