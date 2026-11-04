ALTER TABLE trip_ai_settings
  DROP CONSTRAINT trip_ai_settings_member_daily_limit_check;

ALTER TABLE trip_ai_settings
  ALTER COLUMN member_daily_limit SET DEFAULT 20,
  ADD CONSTRAINT trip_ai_settings_member_daily_limit_check
    CHECK (member_daily_limit BETWEEN 1 AND 1000);

UPDATE trip_ai_settings
   SET member_daily_limit = 20
 WHERE member_daily_limit = 10;

ALTER TABLE trip_members
  DROP CONSTRAINT trip_members_status_check;

ALTER TABLE trip_members
  ADD CONSTRAINT trip_members_status_check
    CHECK (status IN ('invited', 'active', 'revoked', 'removed'));
