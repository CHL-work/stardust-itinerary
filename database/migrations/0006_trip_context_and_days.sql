ALTER TABLE trips
  ADD COLUMN destination_name text NOT NULL DEFAULT 'Japan'
    CHECK (length(btrim(destination_name)) BETWEEN 1 AND 160);

ALTER TABLE trips ALTER COLUMN default_locale SET DEFAULT 'zh-HK-lihkg';
UPDATE trips SET default_locale = 'zh-HK-lihkg' WHERE default_locale = 'en';

WITH missing_days AS (
  SELECT
    t.id AS trip_id,
    generated.day_date::date AS day_date,
    md5(t.id::text || ':' || generated.day_date::date::text) AS day_hash
  FROM trips t
  CROSS JOIN LATERAL generate_series(t.starts_on, t.ends_on, interval '1 day') AS generated(day_date)
  LEFT JOIN trip_days existing
    ON existing.trip_id = t.id AND existing.day_date = generated.day_date::date
  WHERE existing.id IS NULL
)
INSERT INTO trip_days (trip_id, id, day_date, label)
SELECT
  trip_id,
  (
    substr(day_hash, 1, 8) || '-' || substr(day_hash, 9, 4) || '-4' || substr(day_hash, 14, 3) ||
    '-8' || substr(day_hash, 18, 3) || '-' || substr(day_hash, 21, 12)
  )::uuid,
  day_date,
  NULL
FROM missing_days
ON CONFLICT (trip_id, day_date) DO NOTHING;
