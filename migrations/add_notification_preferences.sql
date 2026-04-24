-- Migration: notification_preferences + reminder_log
-- Run once against the Supabase project (SQL Editor or psql).

-- 1. User notification preferences (one row per user).
--    reminder_minutes: array of advance-notice values the user wants.
--      Allowed values: 1440 (1 day), 60 (1 hour), 15 (15 min), 10 (10 min)
--    daily_summary: send a "You have X events today" push at 10 AM MYT each day.
CREATE TABLE IF NOT EXISTS notification_preferences (
    user_id     bigint      PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    reminder_minutes  integer[]   NOT NULL DEFAULT ARRAY[15],
    daily_summary     boolean     NOT NULL DEFAULT true,
    updated_at        timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE notification_preferences ENABLE ROW LEVEL SECURITY;

-- Users can only read/write their own row.
CREATE POLICY "np_select_own" ON notification_preferences
    FOR SELECT USING (user_id = (SELECT id FROM users WHERE auth_id = auth.uid() LIMIT 1));
CREATE POLICY "np_upsert_own" ON notification_preferences
    FOR ALL USING (user_id = (SELECT id FROM users WHERE auth_id = auth.uid() LIMIT 1));

-- 2. Log sent reminders so we never send the same reminder twice.
CREATE TABLE IF NOT EXISTS notification_reminder_log (
    id              bigserial   PRIMARY KEY,
    activity_id     bigint      NOT NULL,
    user_id         bigint      NOT NULL,
    reminder_minutes integer    NOT NULL,  -- which slot (1440/60/15) was sent
    sent_at         timestamptz NOT NULL DEFAULT now(),
    UNIQUE (activity_id, user_id, reminder_minutes)
);

-- Keep only 7 days of log (auto-clean via a partial delete; or pg_cron below).
CREATE INDEX IF NOT EXISTS nrl_sent_at_idx ON notification_reminder_log (sent_at);

ALTER TABLE notification_reminder_log ENABLE ROW LEVEL SECURITY;
-- Service-role only; no direct browser access needed.
CREATE POLICY "nrl_service_only" ON notification_reminder_log
    FOR ALL USING (false);

-- 3. pg_cron job — calls the edge function every 5 minutes.
--    Requires the pg_cron + pg_net extensions (both enabled by default on Supabase).
--    Replace <SUPABASE_URL> and <SERVICE_ROLE_KEY> with your actual values, or
--    set them as Supabase secrets and reference them here.
--
--    Run this block AFTER deploying the edge function.

/*
SELECT cron.schedule(
    'activity-reminders',          -- job name (unique)
    '*/5 * * * *',                 -- every 5 minutes
    $$
    SELECT net.http_post(
        url     := 'https://<SUPABASE_URL>.supabase.co/functions/v1/send-activity-reminders',
        headers := '{"Content-Type":"application/json","Authorization":"Bearer <SERVICE_ROLE_KEY>"}'::jsonb,
        body    := '{}'::jsonb
    ) AS request_id;
    $$
);
*/

-- 4. pg_cron job — daily summary at 10:00 AM MYT = 02:00 UTC.
/*
SELECT cron.schedule(
    'activity-daily-summary',
    '0 2 * * *',
    $$
    SELECT net.http_post(
        url     := 'https://<SUPABASE_URL>.supabase.co/functions/v1/send-activity-reminders',
        headers := '{"Content-Type":"application/json","Authorization":"Bearer <SERVICE_ROLE_KEY>"}'::jsonb,
        body    := '{"mode":"daily_summary"}'::jsonb
    ) AS request_id;
    $$
);
*/

-- 5. Auto-cleanup old reminder logs (optional, run weekly).
/*
SELECT cron.schedule(
    'cleanup-reminder-log',
    '0 3 * * 0',   -- every Sunday 03:00 UTC
    $$DELETE FROM notification_reminder_log WHERE sent_at < NOW() - INTERVAL '7 days'$$
);
*/
