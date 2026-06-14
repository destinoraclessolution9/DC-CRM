-- Phase 2 (#6) — authoritative numeric role. SCAFFOLD: review + apply when
-- Phase 2 starts. Replaces fragile client-side "Level N …" string parsing with
-- a server-truth column that RLS and the BFF can read directly.
--
-- Rollout is dual-read: add column + backfill now, flip the source of truth in
-- code last, drop the string-parse path only after the JWT claim is live.

begin;

-- 1) Numeric role column (1 = Super Admin … 15 = Stock-Take Staff). The display
--    string `role` stays for UI labels only.
alter table public.users
  add column if not exists role_level smallint;

-- 2) Backfill from the existing "Level N …" strings (one-time).
update public.users
set role_level = coalesce(
  nullif(substring(role from 'Level\s+(\d+)'), '')::smallint,
  case
    when role ilike '%超级管理%' or role ilike '%super admin%' then 1
    when role ilike '%传福大使%' then 12
    when role ilike '%改命客户%' then 13
    when role ilike '%推荐人%'   then 14
    else 12
  end
)
where role_level is null;

-- 3) Constrain + index for the hot authz lookups.
alter table public.users
  alter column role_level set not null;
alter table public.users
  add constraint users_role_level_range check (role_level between 1 and 15);
create index if not exists idx_users_role_level on public.users (role_level);

-- 4) (Phase 2 follow-up, separate migration) custom-access-token auth hook to
--    stamp role_level into the JWT so RLS policies read it without re-deriving:
--
--    create function public.custom_access_token_hook(event jsonb) returns jsonb ...
--    -> set claim 'role_level' from public.users.role_level
--    Then RLS: using ( (auth.jwt() ->> 'role_level')::int <= 2 OR responsible_agent_id = auth.uid() )

commit;
