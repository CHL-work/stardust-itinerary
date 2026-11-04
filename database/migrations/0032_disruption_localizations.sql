-- Display translations belong to one immutable sourced observation. They do
-- not replace evidence or change warning freshness/notification identity.
CREATE TABLE event_disruption_localizations (
  trip_id uuid NOT NULL,
  observation_id uuid NOT NULL,
  itinerary_item_id uuid NOT NULL,
  details jsonb NOT NULL,
  origin text NOT NULL DEFAULT 'monitor'
    CHECK (origin IN ('monitor', 'maintenance')),
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (trip_id, observation_id),
  CONSTRAINT event_disruption_localizations_observation_item_fk
    FOREIGN KEY (trip_id, observation_id, itinerary_item_id)
    REFERENCES event_disruption_observations (trip_id, id, itinerary_item_id),
  CONSTRAINT event_disruption_localizations_details_ck CHECK (CASE
    WHEN jsonb_typeof(details) = 'object' THEN
    details ?& ARRAY['en', 'zh-HK', 'ja-JP']
    AND (details - ARRAY['en', 'zh-HK', 'ja-JP']::text[]) = '{}'::jsonb
    AND jsonb_typeof(details->'en') = 'string'
    AND jsonb_typeof(details->'zh-HK') = 'string'
    AND jsonb_typeof(details->'ja-JP') = 'string'
    AND length(details->>'en') BETWEEN 1 AND 800
    AND length(details->>'zh-HK') BETWEEN 1 AND 800
    AND length(details->>'ja-JP') BETWEEN 1 AND 800
    AND (details->>'en') ~ '[^[:space:]]'
    AND (details->>'zh-HK') ~ '[^[:space:]]'
    AND (details->>'ja-JP') ~ '[^[:space:]]'
    ELSE false
  END)
);

CREATE TRIGGER event_disruption_localizations_append_only
BEFORE UPDATE OR DELETE ON event_disruption_localizations
FOR EACH ROW EXECUTE FUNCTION app_reject_append_only_mutation();

COMMENT ON TABLE event_disruption_localizations IS
  'Append-only localized display text for an exact sourced observation; both Cantonese tone selections use neutral zh-HK safety copy. Original evidence, sources, fingerprint, and timestamps remain unchanged.';
