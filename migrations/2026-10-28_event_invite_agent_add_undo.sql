-- Rollback for 2026-10-28_event_invite_agent_add.sql: back to the engine
-- migration's event_invite_add / list / results (re-run those three blocks of
-- 2026-10-28_event_invite_engine.sql after this), drop the profile RPC and the note.
drop function if exists public.event_invite_person(bigint, bigint);
drop function if exists public.event_invite_add(bigint, bigint, bigint, text, boolean);
alter table public.event_invites drop column if exists add_note;
