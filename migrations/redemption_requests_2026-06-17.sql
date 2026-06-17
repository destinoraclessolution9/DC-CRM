-- ============================================================================
-- fude (福气) Points — redemption_requests queue
-- Date: 2026-06-17
-- ----------------------------------------------------------------------------
-- Unblocks OUTSTANDING.md §"fude Redeem Points → DB-backed request queue".
-- Today the redeem form (chunks/script-fude.js confirmRedeemPoints) does an
-- HONEST copy-to-leader flow because no server table exists (and
-- AppDataStore.create silently false-succeeds into localStorage on a missing
-- table). This migration creates that table + RLS so the form can submit a
-- real, server-persisted request and admins can process it.
--
-- HOW TO APPLY (per the project security rule — never put the Supabase PAT on a
-- CLI/file): paste this whole file into Supabase dashboard → SQL Editor → Run
-- on project remuwhxvzkzjtgbzqjaa. It is idempotent (IF NOT EXISTS / DROP
-- POLICY IF EXISTS) — safe to run more than once.
--
-- AFTER APPLYING: tell Claude "redemption table is live" and the client
-- (confirmRedeemPoints) will be wired to INSERT a real row (verified server
-- write) with the copy-to-leader path kept as the offline/failure fallback —
-- so it never shows a false "submitted" success.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Table
-- ---------------------------------------------------------------------------
create table if not exists public.redemption_requests (
    id                  bigserial primary key,
    user_id             bigint      not null,              -- CRM users.id of the requester
    requester_name      text,                              -- denormalized for the admin queue
    item                text        not null,              -- what they want to redeem
    points              integer     not null check (points > 0),
    balance_at_request  integer,                           -- 福气 balance when submitted (audit)
    note                text,                              -- delivery / contact / remarks
    status              text        not null default 'pending'
                        check (status in ('pending','approved','rejected','fulfilled','cancelled')),
    processed_by        bigint,                            -- admin users.id who actioned it
    processed_at        timestamptz,
    created_at          timestamptz not null default now()
);

create index if not exists redemption_requests_status_idx
    on public.redemption_requests (status, created_at desc);
create index if not exists redemption_requests_user_idx
    on public.redemption_requests (user_id, created_at desc);

-- ---------------------------------------------------------------------------
-- 2. RLS — matches the established convention (see score_history_2026-05-02.sql)
-- ---------------------------------------------------------------------------
alter table public.redemption_requests enable row level security;

-- SELECT/INSERT open to authenticated (the app scopes per-user lists client-side
-- and admins see the full queue), consistent with the app-wide auth_full_access
-- read model. NOTE: a future per-row SELECT hardening (own-or-admin) is the same
-- deferred item as the calendar/customers RLS scoping in OUTSTANDING.md §3.x —
-- do it as part of that pass, not piecemeal here.
drop policy if exists "redemption_requests_select" on public.redemption_requests;
create policy "redemption_requests_select"
    on public.redemption_requests
    for select to authenticated
    using (true);

drop policy if exists "redemption_requests_insert" on public.redemption_requests;
create policy "redemption_requests_insert"
    on public.redemption_requests
    for insert to authenticated
    with check (true);

-- Only Level 1-2 (Super Admin / Marketing Manager) can approve / reject /
-- fulfil / delete a request. current_user_level() is defined in rls_helpers.sql.
drop policy if exists "redemption_requests_update" on public.redemption_requests;
create policy "redemption_requests_update"
    on public.redemption_requests
    for update to authenticated
    using  (coalesce(current_user_level(), 99) <= 2)
    with check (coalesce(current_user_level(), 99) <= 2);

drop policy if exists "redemption_requests_delete" on public.redemption_requests;
create policy "redemption_requests_delete"
    on public.redemption_requests
    for delete to authenticated
    using (coalesce(current_user_level(), 99) <= 2);

-- ---------------------------------------------------------------------------
-- 3. Verification (run manually after applying)
-- ---------------------------------------------------------------------------
-- select * from pg_policies where tablename = 'redemption_requests';
-- insert into public.redemption_requests(user_id, requester_name, item, points, balance_at_request)
--   values (5, 'smoke-test', 'test gift', 10, 100);   -- should succeed for an authenticated session
-- select id, status, item, points from public.redemption_requests order by created_at desc limit 5;
