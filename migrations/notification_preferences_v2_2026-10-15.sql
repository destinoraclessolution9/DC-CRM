-- Phase 4 notifications: per-person delivery preferences.
-- Additive + idempotent. Applied live 2026-10-15.
--
--   quiet_start / quiet_end  — do-not-disturb window (MYT wall clock; NULL = off).
--                              Urgent alerts still push; others wait until it ends
--                              (or go to the bell only if they'd be too late).
--   muted_kinds              — notification kinds this person doesn't want pushed
--                              (they still appear in the 🔔 bell).
--   leader_rsvp_alerts       — team leaders (L3–L5): also tell me when a co-agent in
--                              my team accepts / rejects an invite. Off by default.
ALTER TABLE public.notification_preferences ADD COLUMN IF NOT EXISTS quiet_start time;
ALTER TABLE public.notification_preferences ADD COLUMN IF NOT EXISTS quiet_end time;
ALTER TABLE public.notification_preferences ADD COLUMN IF NOT EXISTS muted_kinds text[] NOT NULL DEFAULT '{}';
ALTER TABLE public.notification_preferences ADD COLUMN IF NOT EXISTS leader_rsvp_alerts boolean NOT NULL DEFAULT false;

-- 'muted' = kept in the bell, deliberately not pushed (muted kind, or a reminder
-- that would only arrive after quiet hours, i.e. too late to be useful).
ALTER TABLE public.notification_outbox DROP CONSTRAINT IF EXISTS notification_outbox_status_check;
ALTER TABLE public.notification_outbox ADD CONSTRAINT notification_outbox_status_check
    CHECK (status IN ('pending','sending','sent','no_device','failed','merged','muted'));
