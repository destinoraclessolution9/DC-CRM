-- daily_summary_log — one row per (user_id, summary_date) so the activity-reminder
-- edge function (send-activity-reminders, mode=daily_summary) sends AT MOST ONE
-- digest per user per day, even when two overlapping 5-min cron runs both fall in
-- the ±WINDOW_MIN window. Created 2026-06-20 (deep-audit remediation, finding
-- send-activity-reminders/index.ts:L339). Idempotent: safe to re-run.
--
-- NOTE: the edge function degrades gracefully if this table is absent (it sends
-- without the dedup guarantee), so applying this migration only TIGHTENS behavior.
CREATE TABLE IF NOT EXISTS public.daily_summary_log (
    id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id      BIGINT NOT NULL,
    summary_date DATE   NOT NULL,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT daily_summary_log_user_date_uniq UNIQUE (user_id, summary_date)
);

-- Written only by the reminder edge function (service role bypasses RLS); no
-- anon/authenticated access is granted.
ALTER TABLE public.daily_summary_log ENABLE ROW LEVEL SECURITY;
