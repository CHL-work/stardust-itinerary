ALTER TABLE calendar_connections
  ADD COLUMN account_subject text CHECK (account_subject IS NULL OR length(account_subject) BETWEEN 1 AND 255),
  ADD COLUMN connection_generation uuid;

-- Legacy connections have no verified identity. Existing reads/exports remain
-- available; a new explicit Calendar consent grants basic OIDC import identity.
ALTER TABLE calendar_event_links
  ADD COLUMN account_subject text CHECK (account_subject IS NULL OR length(account_subject) BETWEEN 1 AND 255);
-- Calendar event ids are only unique within an account. Keep the existing
-- per-item/member primary key, but never conflate two explicitly linked accounts.
DO $$
DECLARE constraint_name text;
BEGIN
  SELECT c.conname INTO constraint_name FROM pg_constraint c
   WHERE c.conrelid = 'calendar_event_links'::regclass AND c.contype = 'u'
     AND (SELECT array_agg(a.attname::text ORDER BY keys.ordinality)
            FROM unnest(c.conkey) WITH ORDINALITY keys(attnum, ordinality)
            JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = keys.attnum)
       = ARRAY['trip_id','member_id','provider','calendar_id','provider_event_id']::text[];
  IF constraint_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE calendar_event_links DROP CONSTRAINT %I', constraint_name);
  END IF;
END;
$$;
CREATE UNIQUE INDEX calendar_event_links_account_source_unique
  ON calendar_event_links(trip_id, member_id, provider, calendar_id, COALESCE(account_subject, ''), provider_event_id);

CREATE TABLE calendar_import_receipts (
  id uuid PRIMARY KEY,
  trip_id uuid NOT NULL,
  member_id uuid NOT NULL,
  app_user_id uuid NOT NULL REFERENCES app_users(id) ON DELETE RESTRICT,
  account_subject text NOT NULL CHECK (length(account_subject) BETWEEN 1 AND 255),
  calendar_id text NOT NULL DEFAULT 'primary' CHECK (calendar_id = 'primary'),
  provider_event_id text NOT NULL CHECK (length(provider_event_id) BETWEEN 5 AND 1024),
  connection_generation uuid NOT NULL,
  change_request_id uuid NOT NULL,
  itinerary_item_id uuid,
  source_etag text,
  source_digest text NOT NULL CHECK (source_digest ~ '^[0-9a-f]{64}$'),
  source_snapshot jsonb NOT NULL CHECK (jsonb_typeof(source_snapshot) = 'object'),
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (trip_id, member_id, app_user_id, account_subject, calendar_id, provider_event_id),
  UNIQUE (trip_id, change_request_id),
  FOREIGN KEY (trip_id, member_id) REFERENCES trip_members(trip_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (trip_id, change_request_id) REFERENCES change_requests(trip_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (trip_id, itinerary_item_id) REFERENCES itinerary_items(trip_id, id) ON DELETE RESTRICT
);
CREATE INDEX calendar_import_receipts_member_idx ON calendar_import_receipts(trip_id, member_id, app_user_id);

CREATE FUNCTION app_guard_calendar_import_receipt() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Calendar import source receipts are retained'; END IF;
  IF (to_jsonb(NEW) - 'itinerary_item_id') IS DISTINCT FROM (to_jsonb(OLD) - 'itinerary_item_id')
    OR (OLD.itinerary_item_id IS NOT NULL AND NEW.itinerary_item_id IS DISTINCT FROM OLD.itinerary_item_id)
  THEN RAISE EXCEPTION 'Calendar import source identity and history are immutable'; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER calendar_import_receipts_immutable BEFORE UPDATE OR DELETE ON calendar_import_receipts
FOR EACH ROW EXECUTE FUNCTION app_guard_calendar_import_receipt();

CREATE FUNCTION app_validate_calendar_import_request() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE receipt calendar_import_receipts; request change_requests;
BEGIN
  IF TG_TABLE_NAME = 'change_requests' THEN
    SELECT * INTO receipt FROM calendar_import_receipts WHERE trip_id = NEW.trip_id AND change_request_id = NEW.id;
  ELSE SELECT * INTO receipt FROM calendar_import_receipts WHERE id = NEW.id; END IF;
  IF NOT FOUND THEN RETURN NULL; END IF;
  SELECT * INTO request FROM change_requests WHERE trip_id = receipt.trip_id AND id = receipt.change_request_id;
  IF request.entity_type <> 'itinerary_item' OR request.operation <> 'create'
    OR request.requested_by_member_id <> receipt.member_id
    OR (request.status = 'approved' AND (receipt.itinerary_item_id IS NULL OR receipt.itinerary_item_id IS DISTINCT FROM request.entity_id))
    OR (request.status <> 'approved' AND receipt.itinerary_item_id IS NOT NULL)
  THEN RAISE EXCEPTION 'Calendar import must retain its exact create request and approved item'; END IF;
  RETURN NULL;
END;
$$;
CREATE CONSTRAINT TRIGGER calendar_import_request_guard AFTER INSERT OR UPDATE ON calendar_import_receipts
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION app_validate_calendar_import_request();
CREATE CONSTRAINT TRIGGER change_request_calendar_import_guard AFTER UPDATE ON change_requests
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION app_validate_calendar_import_request();
