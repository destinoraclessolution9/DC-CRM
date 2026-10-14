-- Phase 3 notifications: reminder times chosen per activity.
-- NULL / empty = each participant's own Settings → Reminder Timing (default 30 min).
-- Non-empty (e.g. {1440,60}) = these lead times for every participant.
-- Additive + idempotent. Applied live 2026-10-14.
ALTER TABLE public.activities ADD COLUMN IF NOT EXISTS reminder_minutes integer[];
COMMENT ON COLUMN public.activities.reminder_minutes IS
  'Per-activity reminder lead times in minutes (e.g. {1440,60}); NULL = each participant''s own preference. Read by send-activity-reminders.';
