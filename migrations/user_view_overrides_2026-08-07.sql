-- ============================================================================
-- user_view_overrides (2026-08-07) — per-user nav/tab access overrides
-- ============================================================================
-- Feature: Super Admin → Admin → Access Control. One row per user holding
-- navId lists applied ON TOP of the role-level defaults derived from the
-- VIEWS registry (script.js): `grants` adds tabs beyond the user's level,
-- `revokes` hides tabs the level normally shows. Client-side the resolver
-- (_applyNavOverrides / _isViewAllowed) enforces nav visibility + deep-link
-- bounce on desktop and mobile. Data-layer scoping is untouched — this table
-- curates NAVIGATION, it is not a data-security boundary.
--
-- Deliberately a SEPARATE table (not a users column): the users table's
-- guard trigger is its entire authz boundary (see AUTHZ_ESCALATION_FIX_RUNBOOK,
-- rev2 unapplied as of 2026-08-07) and a new writable users column would have
-- to be enumerated there. Here an L1-only write policy is self-contained:
-- no user can PATCH their own overrides (self-escalation of nav access).
--
-- `functions` is reserved for phase 2 (per-function ticks inside a view) so
-- that adding it later needs no schema change.
--
-- Additive only. Single transaction. users.id is BIGINT (see rls_helpers.sql
-- current_user_row_id() RETURNS bigint).

create table if not exists public.user_view_overrides (
  user_id    bigint primary key references public.users(id) on delete cascade,
  grants     text[]      not null default '{}',
  revokes    text[]      not null default '{}',
  functions  jsonb       not null default '{}'::jsonb,
  updated_by bigint,
  updated_at timestamptz not null default now()
);

alter table public.user_view_overrides enable row level security;

-- Table privileges: authenticated needs the verbs (RLS below scopes rows);
-- anon gets nothing (probe expectation: permission denied / 401-shape).
grant select, insert, update, delete on public.user_view_overrides to authenticated;
grant all on public.user_view_overrides to service_role;

-- Reads: own row (boot fetch), or the admin band L1/L2 (management UI lists).
-- current_user_level() is the ONE canonical role parser (rls_helper_gaps
-- 2026-07-14 version: case-insensitive, named + Chinese fallbacks, NULL when
-- unknown/unlinked — NULL fails both predicates, i.e. deny).
drop policy if exists uvo_select on public.user_view_overrides;
create policy uvo_select on public.user_view_overrides
  for select to authenticated
  using (user_id = public.current_user_row_id()
         or public.current_user_level() <= 2);

-- Writes: Super Admin ONLY. Equality against the canonical parser is safe
-- against out-of-range levels (0/NULL/99 are all <> 1 → denied).
drop policy if exists uvo_write on public.user_view_overrides;
create policy uvo_write on public.user_view_overrides
  for all to authenticated
  using (public.current_user_level() = 1)
  with check (public.current_user_level() = 1);

-- Make PostgREST pick up the new table without waiting for its cache TTL.
notify pgrst, 'reload schema';

-- Verification (run after; expectations):
--   select to_regclass('public.user_view_overrides');          -- not null
--   select policyname from pg_policies
--    where tablename = 'user_view_overrides';                  -- uvo_select, uvo_write
--   REST as anon:    GET /rest/v1/user_view_overrides  → 401/permission denied
--   REST as service: GET /rest/v1/user_view_overrides  → 200 []
