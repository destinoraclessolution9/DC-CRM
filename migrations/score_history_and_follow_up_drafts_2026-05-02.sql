-- ============================================================================
-- Score history table + follow_up_drafts RLS fix
-- Date: 2026-05-02
-- ----------------------------------------------------------------------------
-- Two issues from the 2026-05-02 bug screen:
--   1. script.js inserts into `score_history` (lines ~38839 / ~38860) but the
--      table was never created — every prospect/customer score change emits
--      a PGRST205 "table not found" warning. Falls back to localStorage so
--      the audit trail is never synced server-side.
--   2. Inserts into `follow_up_drafts` fail with 42501 (RLS policy violation)
--      for every authenticated user, including Super Admin. The table has
--      RLS enabled but no INSERT/UPDATE/DELETE policy, so writes are blocked.
--
-- Idempotent: tables/policies use IF NOT EXISTS / DROP IF EXISTS.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. score_history
-- ---------------------------------------------------------------------------
create table if not exists public.score_history (
    id              bigserial primary key,
    entity_type     text        not null check (entity_type in ('prospect','customer')),
    entity_id       bigint      not null,
    old_score       integer,
    new_score       integer,
    points_change   integer,
    reason          text,
    created_at      timestamptz not null default now()
);

create index if not exists score_history_entity_idx
    on public.score_history (entity_type, entity_id, created_at desc);

alter table public.score_history enable row level security;

-- Read access for any authenticated user (matches the convention used by
-- other audit tables like activities, follow_up_drafts).
drop policy if exists "score_history_select" on public.score_history;
create policy "score_history_select"
    on public.score_history
    for select to authenticated
    using (true);

drop policy if exists "score_history_insert" on public.score_history;
create policy "score_history_insert"
    on public.score_history
    for insert to authenticated
    with check (true);

-- Only Level 1-2 (admin) can edit/delete history rows.
drop policy if exists "score_history_update" on public.score_history;
create policy "score_history_update"
    on public.score_history
    for update to authenticated
    using  (coalesce(current_user_level(), 99) <= 2)
    with check (coalesce(current_user_level(), 99) <= 2);

drop policy if exists "score_history_delete" on public.score_history;
create policy "score_history_delete"
    on public.score_history
    for delete to authenticated
    using (coalesce(current_user_level(), 99) <= 2);

-- ---------------------------------------------------------------------------
-- 2. follow_up_drafts — restore INSERT/UPDATE/DELETE policies
-- ---------------------------------------------------------------------------
-- The table already exists (referenced by attachment_urls_to_paths_backfill_
-- 2026-04-24.sql). Make sure RLS is on and rebuild a sane policy set.
do $$
begin
    if exists (select 1 from information_schema.tables
               where table_schema = 'public' and table_name = 'follow_up_drafts') then
        execute 'alter table public.follow_up_drafts enable row level security';

        execute 'drop policy if exists "allow_all"            on public.follow_up_drafts';
        execute 'drop policy if exists "auth_full_access"     on public.follow_up_drafts';
        execute 'drop policy if exists "follow_up_drafts_select" on public.follow_up_drafts';
        execute 'drop policy if exists "follow_up_drafts_insert" on public.follow_up_drafts';
        execute 'drop policy if exists "follow_up_drafts_update" on public.follow_up_drafts';
        execute 'drop policy if exists "follow_up_drafts_delete" on public.follow_up_drafts';

        -- Drafts are a per-user scratchpad; everyone can read/write their own
        -- and managers can read across the team. To stay forward-compatible
        -- with the existing app (which doesn't yet send the owning user_id on
        -- every insert), we open SELECT/INSERT to all authenticated users
        -- and gate UPDATE/DELETE on level 1-10 (managers+).
        execute 'create policy "follow_up_drafts_select" on public.follow_up_drafts
                    for select to authenticated using (true)';
        execute 'create policy "follow_up_drafts_insert" on public.follow_up_drafts
                    for insert to authenticated with check (true)';
        execute 'create policy "follow_up_drafts_update" on public.follow_up_drafts
                    for update to authenticated
                    using  (coalesce(current_user_level(), 99) <= 10)
                    with check (coalesce(current_user_level(), 99) <= 10)';
        execute 'create policy "follow_up_drafts_delete" on public.follow_up_drafts
                    for delete to authenticated
                    using (coalesce(current_user_level(), 99) <= 10)';
    end if;
end $$;

-- ---------------------------------------------------------------------------
-- 3. Verification (run manually after applying)
-- ---------------------------------------------------------------------------
-- select * from pg_policies where tablename in ('score_history','follow_up_drafts');
-- insert into score_history(entity_type, entity_id, points_change, reason)
--   values ('prospect', 1, 5, 'smoke-test'); -- should succeed
