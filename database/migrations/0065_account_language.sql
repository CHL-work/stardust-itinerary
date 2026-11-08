-- A language is display preference only; it confers no trip, role or provider access.
-- NULL preserves existing accounts without pretending their old trip default was a personal choice.
ALTER TABLE app_users ADD COLUMN preferred_locale text;
ALTER TABLE app_users ADD CONSTRAINT app_users_preferred_locale_ck CHECK (
  preferred_locale IS NULL OR preferred_locale IN
    ('en','zh-HK','zh-HK-lihkg','ja-JP','zh-CN','zh-TW','es','pt-BR','fr','de','ru','id')
);
