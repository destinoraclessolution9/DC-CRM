-- event_target_attendance_2026-07-06.sql
-- 出席人数目标 · target headcount for an EVENT. Event-level integer shown (and
-- inline-edited by managers/marketing/admin or the creator) in the EVENT activity
-- detail modal's Event Details section, and surfaced in the Attendees count header
-- as "(actual / 目标 N)". Additive + idempotent. `events` reads with select=* so
-- the column flows into reads with no client change.

ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS target_attendance INTEGER;

COMMENT ON COLUMN public.events.target_attendance IS
  '出席人数目标 — target headcount for the event; edited inline in the EVENT activity detail modal.';
