-- event_roles_2026-07-06.sql
-- Adds a JSONB column to public.events holding the five named organiser roles
-- assigned from the agent/consultant roster in the EVENT activity detail modal:
--   主要负责人 main_organizer · 场地负责人 venue_lead · 报到负责人 registration_lead
--   主讲老师 speaker · 活动司仪 emcee
-- Shape: { "<role_key>": { "id": <user_id>, "name": "<snapshot>" } | null, ... }
-- Stored on the shared events row (not per-agent activities) so every agent's
-- activity row for the same event resolves the same assignments — mirrors how
-- event_attendees are keyed by event_id.
--
-- Additive + idempotent. `events` is read with select=* (no _lightSelects entry
-- in data.js), so reads pick up the new column with no client change. Without
-- this column the client write-path strips event_roles as an unknown column and
-- it survives only in the writer's localStorage (never syncs) — hence required.

ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS event_roles JSONB NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN public.events.event_roles IS
  'Named organiser roles for the event: {main_organizer,venue_lead,registration_lead,speaker,emcee} -> {id,name}|null. Assigned in the EVENT activity detail modal.';
