-- Raw feedback is private operational data, not a trip audit or public issue body.
CREATE FUNCTION app_valid_feedback_diagnostics(value jsonb) RETURNS boolean LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE breadcrumb jsonb;
BEGIN
  IF value IS NULL OR value='null'::jsonb THEN RETURN true; END IF;
  IF jsonb_typeof(value)<>'object' OR octet_length(value::text)>20000
    OR (SELECT count(*) FROM jsonb_object_keys(value))<>7
    OR NOT value ?& ARRAY['page','locale','formFactor','osFamily','browserFamily','online','breadcrumbs']
    OR (SELECT bool_and(jsonb_typeof(value->field)='string') FROM unnest(ARRAY['page','locale','formFactor','osFamily','browserFamily']) AS field) IS NOT TRUE
    OR value->>'page' NOT IN ('today','itinerary','expenses','ai','requests','settings','permissions','usage','activity','login','join','onboarding','privacy','terms','other')
    OR value->>'locale' NOT IN ('en','zh-HK','zh-HK-lihkg','ja-JP')
    OR value->>'formFactor' NOT IN ('phone','tablet','desktop','unknown')
    OR value->>'osFamily' NOT IN ('windows','macos','ios','android','linux','other')
    OR value->>'browserFamily' NOT IN ('chrome','edge','firefox','safari','other')
    OR jsonb_typeof(value->'online')<>'boolean' OR jsonb_typeof(value->'breadcrumbs')<>'array'
    OR jsonb_array_length(value->'breadcrumbs')>50 THEN RETURN false; END IF;
  FOR breadcrumb IN SELECT * FROM jsonb_array_elements(value->'breadcrumbs') LOOP
    IF jsonb_typeof(breadcrumb)<>'object' OR (SELECT count(*) FROM jsonb_object_keys(breadcrumb))<>3
      OR NOT breadcrumb ?& ARRAY['page','action','at']
      OR (SELECT bool_and(jsonb_typeof(breadcrumb->field)='string') FROM unnest(ARRAY['page','action','at']) AS field) IS NOT TRUE
      OR breadcrumb->>'page' NOT IN ('today','itinerary','expenses','ai','requests','settings','permissions','usage','activity','login','join','onboarding','privacy','terms','other')
      OR breadcrumb->>'action' NOT IN ('navigate','dialog_open','dialog_close','event_open','event_edit','event_save','event_cancel','event_remove','event_approve','event_reject','expense_open','expense_edit','expense_save','expense_review','expense_approve','expense_reject','repayment_submit','calendar_connect','calendar_sync','calendar_refresh','ai_submit','ai_complete','ai_error','ai_new','ai_resume','trip_switch','request_error','feedback_open','feedback_submit','login','logout','page_view','form_submit','client_error','locale_change','settings_save','member_invite','member_change','feedback_retry','button')
      OR jsonb_typeof(breadcrumb->'at')<>'string' OR length(breadcrumb->>'at')>40
      OR breadcrumb->>'at' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}([.][0-9]+)?(Z|[+-][0-9]{2}:[0-9]{2})$' THEN RETURN false; END IF;
    PERFORM (breadcrumb->>'at')::timestamptz;
  END LOOP;
  RETURN true;
EXCEPTION WHEN OTHERS THEN RETURN false;
END;
$$;

CREATE TABLE feedback_reports (
  id uuid PRIMARY KEY,
  trip_id uuid NOT NULL REFERENCES trips(id) ON DELETE RESTRICT,
  actor_member_id uuid NOT NULL,
  actor_user_id uuid NOT NULL REFERENCES app_users(id) ON DELETE RESTRICT,
  client_request_id uuid NOT NULL,
  payload_hash bytea NOT NULL CHECK(octet_length(payload_hash)=32),
  title text NOT NULL CHECK(length(btrim(title)) BETWEEN 1 AND 160),
  description text NOT NULL CHECK(length(btrim(description)) BETWEEN 1 AND 6000),
  kind text NOT NULL CHECK(kind IN ('bug','feedback')),
  allow_issue_publication boolean NOT NULL DEFAULT false,
  diagnostics jsonb CHECK(app_valid_feedback_diagnostics(diagnostics)),
  build_version text CHECK(build_version ~ '^[a-f0-9]{7,40}$'),
  status text NOT NULL DEFAULT 'queued' CHECK(status IN ('queued','triaged','ignored','published')),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  FOREIGN KEY(trip_id,actor_member_id) REFERENCES trip_members(trip_id,id) ON DELETE RESTRICT,
  UNIQUE(actor_user_id,client_request_id)
);
CREATE INDEX feedback_reports_admission_idx ON feedback_reports(actor_user_id,created_at DESC);
CREATE INDEX feedback_reports_self_idx ON feedback_reports(trip_id,actor_member_id,actor_user_id,created_at DESC,id);
CREATE INDEX feedback_reports_queued_idx ON feedback_reports(created_at,id) WHERE status='queued' AND allow_issue_publication;

CREATE FUNCTION app_preserve_feedback_report() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Private feedback history must be retained'; END IF;
  IF (to_jsonb(NEW)-'status') IS DISTINCT FROM (to_jsonb(OLD)-'status') THEN
    RAISE EXCEPTION 'Feedback original facts are immutable';
  END IF;
  IF OLD.status='published' AND NEW.status<>'published' THEN RAISE EXCEPTION 'Published feedback is terminal'; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER feedback_reports_immutable BEFORE UPDATE OR DELETE ON feedback_reports
FOR EACH ROW EXECUTE FUNCTION app_preserve_feedback_report();

CREATE TABLE feedback_triage_runs (
  id uuid PRIMARY KEY,
  run_date date NOT NULL UNIQUE,
  state text NOT NULL DEFAULT 'queued' CHECK(state IN ('queued','running','succeeded','failed')),
  lease_owner uuid,
  lease_until timestamptz,
  attempt_count integer NOT NULL DEFAULT 0 CHECK(attempt_count BETWEEN 0 AND 3),
  last_attempt_date date,
  started_at timestamptz,
  completed_at timestamptz,
  model text NOT NULL DEFAULT 'gpt-6-astra' CHECK(model='gpt-6-astra'),
  effort text NOT NULL DEFAULT 'medium' CHECK(effort='medium'),
  input_tokens bigint NOT NULL DEFAULT 0 CHECK(input_tokens BETWEEN 0 AND 9007199254740991),
  output_tokens bigint NOT NULL DEFAULT 0 CHECK(output_tokens BETWEEN 0 AND 9007199254740991),
  error_code text CHECK(error_code IN ('provider_unavailable','provider_rate_limited','provider_auth_required','output_invalid','lease_expired','worker_failed')),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK((lease_owner IS NULL)=(lease_until IS NULL)),
  CHECK(state<>'running' OR (lease_owner IS NOT NULL AND started_at IS NOT NULL))
);
CREATE TABLE feedback_triage_items (
  run_id uuid NOT NULL REFERENCES feedback_triage_runs(id) ON DELETE RESTRICT,
  report_id uuid PRIMARY KEY REFERENCES feedback_reports(id) ON DELETE RESTRICT,
  decision text CHECK(decision IN ('issue','duplicate','ignore')),
  structured_result jsonb NOT NULL DEFAULT '{}' CHECK(jsonb_typeof(structured_result)='object' AND octet_length(structured_result::text)<=40000),
  processed_at timestamptz,
  CHECK((decision IS NULL)=(processed_at IS NULL)),
  UNIQUE(run_id,report_id)
);
CREATE TABLE feedback_issue_outbox (
  id uuid PRIMARY KEY,
  run_id uuid NOT NULL REFERENCES feedback_triage_runs(id) ON DELETE RESTRICT,
  dedupe_key bytea NOT NULL UNIQUE CHECK(octet_length(dedupe_key)=32),
  report_ids uuid[] NOT NULL CHECK(cardinality(report_ids) BETWEEN 1 AND 20),
  title text NOT NULL CHECK(length(title) BETWEEN 1 AND 160),
  body text NOT NULL CHECK(length(body) BETWEEN 1 AND 12000),
  payload_hash bytea NOT NULL CHECK(octet_length(payload_hash)=32),
  state text NOT NULL DEFAULT 'queued' CHECK(state IN ('queued','claimed','uncertain','published','blocked')),
  lease_owner uuid,
  lease_until timestamptz,
  post_attempts integer NOT NULL DEFAULT 0 CHECK(post_attempts BETWEEN 0 AND 1),
  reconciliation_attempts integer NOT NULL DEFAULT 0 CHECK(reconciliation_attempts BETWEEN 0 AND 12),
  issue_number bigint CHECK(issue_number BETWEEN 1 AND 9007199254740991),
  issue_url text CHECK(issue_url ~ '^https://github[.]com/CHL-work/stardust-itinerary/issues/[1-9][0-9]*$'),
  error_code text CHECK(error_code IN ('token_missing','credential_rejected','permission_denied','rate_limited','delivery_uncertain','reconciliation_exhausted','response_invalid','payload_invalid','worker_failed')),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK((lease_owner IS NULL)=(lease_until IS NULL)),
  CHECK(state NOT IN ('uncertain','published') OR post_attempts=1),
  CHECK(state<>'published' OR (issue_number IS NOT NULL AND issue_url='https://github.com/CHL-work/stardust-itinerary/issues/'||issue_number::text))
);
CREATE FUNCTION app_guard_feedback_triage_item() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Feedback triage history must be retained'; END IF;
  IF TG_OP='INSERT' AND NOT EXISTS(SELECT 1 FROM feedback_reports WHERE id=NEW.report_id AND allow_issue_publication AND status='queued') THEN
    RAISE EXCEPTION 'Private opt-out feedback cannot enter external triage';
  END IF;
  IF TG_OP='UPDATE' AND (ROW(NEW.run_id,NEW.report_id) IS DISTINCT FROM ROW(OLD.run_id,OLD.report_id)
    OR (OLD.processed_at IS NOT NULL AND NEW IS DISTINCT FROM OLD)) THEN
    RAISE EXCEPTION 'Processed feedback triage is immutable';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER feedback_triage_items_guard BEFORE INSERT OR UPDATE OR DELETE ON feedback_triage_items
FOR EACH ROW EXECUTE FUNCTION app_guard_feedback_triage_item();
CREATE FUNCTION app_preserve_feedback_delivery() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Issue delivery history must be retained'; END IF;
  IF TG_OP='UPDATE' THEN
    IF ROW(NEW.id,NEW.run_id,NEW.dedupe_key,NEW.report_ids,NEW.title,NEW.body,NEW.payload_hash,NEW.created_at)
      IS DISTINCT FROM ROW(OLD.id,OLD.run_id,OLD.dedupe_key,OLD.report_ids,OLD.title,OLD.body,OLD.payload_hash,OLD.created_at)
      THEN RAISE EXCEPTION 'Issue delivery payload is immutable'; END IF;
    IF NEW.post_attempts<OLD.post_attempts OR NEW.reconciliation_attempts<OLD.reconciliation_attempts
      OR (OLD.post_attempts=1 AND NEW.state IN ('queued','claimed'))
      OR (OLD.state='published' AND NEW IS DISTINCT FROM OLD)
      THEN RAISE EXCEPTION 'Issue delivery cannot repeat or rewrite a published receipt'; END IF;
  ELSE
    IF cardinality(NEW.report_ids)<>(SELECT count(DISTINCT report_id) FROM unnest(NEW.report_ids) AS report_id)
      OR EXISTS (SELECT 1 FROM unnest(NEW.report_ids) AS source(report_id) LEFT JOIN feedback_reports report ON report.id=source.report_id
        LEFT JOIN feedback_triage_items item ON item.report_id=source.report_id AND item.run_id=NEW.run_id
        WHERE report.id IS NULL OR NOT report.allow_issue_publication OR item.decision IS DISTINCT FROM 'issue' OR item.processed_at IS NULL)
      THEN RAISE EXCEPTION 'Issue delivery must reference exact consented processed reports'; END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER feedback_issue_outbox_guard BEFORE INSERT OR UPDATE OR DELETE ON feedback_issue_outbox
FOR EACH ROW EXECUTE FUNCTION app_preserve_feedback_delivery();

CREATE TABLE feedback_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  report_id uuid REFERENCES feedback_reports(id) ON DELETE RESTRICT,
  run_id uuid REFERENCES feedback_triage_runs(id) ON DELETE RESTRICT,
  outbox_id uuid REFERENCES feedback_issue_outbox(id) ON DELETE RESTRICT,
  event_type text NOT NULL CHECK(event_type ~ '^[a-z][a-z0-9_.]{0,79}$'),
  metadata jsonb NOT NULL DEFAULT '{}' CHECK(jsonb_typeof(metadata)='object' AND octet_length(metadata::text)<=4096),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK(report_id IS NOT NULL OR run_id IS NOT NULL OR outbox_id IS NOT NULL)
);
CREATE TRIGGER feedback_events_append_only BEFORE UPDATE OR DELETE ON feedback_events
FOR EACH ROW EXECUTE FUNCTION app_reject_append_only_mutation();

COMMENT ON TABLE feedback_reports IS 'Private immutable feedback. Exact submitter and platform operator only; trip ownership grants no read access.';
COMMENT ON TABLE feedback_issue_outbox IS 'Sanitized consented issue-only delivery; one uncertain POST attempt, then read-only reconciliation. No code or deployment authority.';
