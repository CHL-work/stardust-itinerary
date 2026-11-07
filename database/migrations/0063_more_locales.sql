-- JOB-084: eight more interface languages (D-096): Simplified Chinese (zh-CN), Traditional Chinese
-- (zh-TW), Spanish (es), Brazilian Portuguese (pt-BR), French (fr), German (de), Russian (ru) and
-- Indonesian (id). Widen every check that lists the interface locales. Widening never rejects an
-- existing row, and an older build simply never writes the new values.

ALTER TABLE trips DROP CONSTRAINT trips_default_locale_check;
ALTER TABLE trips
  ADD CONSTRAINT trips_default_locale_check
    CHECK (default_locale IN ('en', 'zh-HK', 'zh-HK-lihkg', 'ja-JP', 'zh-CN', 'zh-TW', 'es', 'pt-BR', 'fr', 'de', 'ru', 'id'));

ALTER TABLE account_ai_lookups DROP CONSTRAINT account_ai_lookups_display_locale_check;
ALTER TABLE account_ai_lookups
  ADD CONSTRAINT account_ai_lookups_display_locale_check
    CHECK (display_locale IN ('en', 'zh-HK', 'zh-HK-lihkg', 'ja-JP', 'zh-CN', 'zh-TW', 'es', 'pt-BR', 'fr', 'de', 'ru', 'id'));

-- Feedback diagnostics carry the reporter's interface locale; only the locale list changes.
CREATE OR REPLACE FUNCTION app_valid_feedback_diagnostics(value jsonb) RETURNS boolean LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE breadcrumb jsonb;
BEGIN
  IF value IS NULL OR value='null'::jsonb THEN RETURN true; END IF;
  IF jsonb_typeof(value)<>'object' OR octet_length(value::text)>20000
    OR (SELECT count(*) FROM jsonb_object_keys(value))<>7
    OR NOT value ?& ARRAY['page','locale','formFactor','osFamily','browserFamily','online','breadcrumbs']
    OR (SELECT bool_and(jsonb_typeof(value->field)='string') FROM unnest(ARRAY['page','locale','formFactor','osFamily','browserFamily']) AS field) IS NOT TRUE
    OR value->>'page' NOT IN ('today','itinerary','expenses','ai','requests','settings','permissions','usage','activity','login','join','onboarding','privacy','terms','other')
    OR value->>'locale' NOT IN ('en','zh-HK','zh-HK-lihkg','ja-JP','zh-CN','zh-TW','es','pt-BR','fr','de','ru','id')
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
