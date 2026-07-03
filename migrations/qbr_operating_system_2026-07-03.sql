-- ============================================================================
-- QBR Operating System — saved quarterly-review snapshots, 90-day action plans,
-- and base/best/worst forecasts.
-- Date: 2026-07-03
-- ----------------------------------------------------------------------------
-- Backs the L1-only Quarter Review chunk (chunks/script-quarter-review.js),
-- whose client-side gate is isSystemAdmin() — Level 1 / Super Admin only.
-- These three tables persist what today is computed-and-discarded on each
-- render: the QBR snapshot, its action plan, and the forecasts graded next
-- quarter.
--
-- HOW TO APPLY (per the project security rule — never put the Supabase PAT on a
-- CLI/file): paste this whole file into Supabase dashboard -> SQL Editor -> Run
-- on project remuwhxvzkzjtgbzqjaa. Fully idempotent (IF NOT EXISTS / DROP
-- POLICY IF EXISTS) — safe to run more than once. Additive only; drops nothing.
--
-- RLS predicate: Super Admin (Level 1) only. current_user_level() is the
-- established SECURITY DEFINER helper (see rls_helpers.sql); the same helper
-- used by evoucher/redemption/stock_take. We use `= 1` (not the `<= 2`
-- admin-band variant) to match the chunk's isSystemAdmin() gate exactly, and
-- coalesce(..., 99) to FAIL CLOSED when the caller is unlinked/unknown.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. qbr_reviews — one saved QBR snapshot per quarter.
-- ---------------------------------------------------------------------------
create table if not exists public.qbr_reviews (
    id          uuid primary key default gen_random_uuid(),
    quarter     text        not null,                       -- e.g. '2026-Q2'
    created_by  uuid,                                       -- auth.uid() of the saver
    context     text,                                       -- free-text framing / notes
    snapshot    jsonb       not null default '{}'::jsonb,   -- the captured metrics blob
    narrative   jsonb,                                      -- generated/edited narrative sections
    created_at  timestamptz not null default now(),
    updated_at  timestamptz not null default now()
);

comment on table public.qbr_reviews is
    'One saved Quarterly Business Review snapshot per quarter (L1/Super Admin only).';

-- One canonical saved review per quarter.
create unique index if not exists qbr_reviews_quarter_uidx
    on public.qbr_reviews (quarter);

-- ---------------------------------------------------------------------------
-- 2. qbr_actions — 90-day action-plan items + accountability.
-- ---------------------------------------------------------------------------
create table if not exists public.qbr_actions (
    id          uuid primary key default gen_random_uuid(),
    quarter     text        not null,                       -- quarter the action was SET in
    priority    text,                                       -- e.g. 'P1' / 'high'
    initiative  text        not null,                       -- what to do
    owner       text,                                       -- accountable person (free text)
    kpi_target  text,                                       -- measurable target
    deadline    date,
    status      text        not null default 'open',        -- open / in_progress / done / dropped
    result      text,                                       -- outcome once graded
    created_by  uuid,
    created_at  timestamptz not null default now(),
    updated_at  timestamptz not null default now()
);

comment on table public.qbr_actions is
    'QBR 90-day action-plan items with owner/KPI/deadline/status (L1/Super Admin only).';

create index if not exists qbr_actions_quarter_idx
    on public.qbr_actions (quarter, status);

-- ---------------------------------------------------------------------------
-- 3. qbr_forecasts — base/best/worst per KPI, graded against actuals.
-- ---------------------------------------------------------------------------
create table if not exists public.qbr_forecasts (
    id          uuid primary key default gen_random_uuid(),
    quarter     text        not null,                       -- the quarter being forecast
    kpi         text        not null,                       -- which KPI
    base        numeric,                                    -- base-case forecast
    best        numeric,                                    -- best-case forecast
    worst       numeric,                                    -- worst-case forecast
    actual      numeric,                                    -- graded next quarter
    assumptions text,
    created_by  uuid,
    created_at  timestamptz not null default now(),
    updated_at  timestamptz not null default now()
);

comment on table public.qbr_forecasts is
    'QBR base/best/worst forecast per KPI, graded against actuals (L1/Super Admin only).';

create index if not exists qbr_forecasts_quarter_kpi_idx
    on public.qbr_forecasts (quarter, kpi);

-- ---------------------------------------------------------------------------
-- 4. GRANTs — same shape as sibling admin tables (e.g. evoucher_config).
-- ---------------------------------------------------------------------------
grant select, insert, update, delete on public.qbr_reviews   to authenticated;
grant select, insert, update, delete on public.qbr_actions   to authenticated;
grant select, insert, update, delete on public.qbr_forecasts to authenticated;

-- ---------------------------------------------------------------------------
-- 5. RLS — Super Admin (Level 1) ONLY, fail-closed. All four verbs gated.
-- ---------------------------------------------------------------------------
alter table public.qbr_reviews   enable row level security;
alter table public.qbr_actions   enable row level security;
alter table public.qbr_forecasts enable row level security;

-- qbr_reviews
drop policy if exists qbr_reviews_select on public.qbr_reviews;
create policy qbr_reviews_select on public.qbr_reviews
    for select to authenticated
    using (coalesce(current_user_level(), 99) = 1);

drop policy if exists qbr_reviews_insert on public.qbr_reviews;
create policy qbr_reviews_insert on public.qbr_reviews
    for insert to authenticated
    with check (coalesce(current_user_level(), 99) = 1);

drop policy if exists qbr_reviews_update on public.qbr_reviews;
create policy qbr_reviews_update on public.qbr_reviews
    for update to authenticated
    using      (coalesce(current_user_level(), 99) = 1)
    with check (coalesce(current_user_level(), 99) = 1);

drop policy if exists qbr_reviews_delete on public.qbr_reviews;
create policy qbr_reviews_delete on public.qbr_reviews
    for delete to authenticated
    using (coalesce(current_user_level(), 99) = 1);

-- qbr_actions
drop policy if exists qbr_actions_select on public.qbr_actions;
create policy qbr_actions_select on public.qbr_actions
    for select to authenticated
    using (coalesce(current_user_level(), 99) = 1);

drop policy if exists qbr_actions_insert on public.qbr_actions;
create policy qbr_actions_insert on public.qbr_actions
    for insert to authenticated
    with check (coalesce(current_user_level(), 99) = 1);

drop policy if exists qbr_actions_update on public.qbr_actions;
create policy qbr_actions_update on public.qbr_actions
    for update to authenticated
    using      (coalesce(current_user_level(), 99) = 1)
    with check (coalesce(current_user_level(), 99) = 1);

drop policy if exists qbr_actions_delete on public.qbr_actions;
create policy qbr_actions_delete on public.qbr_actions
    for delete to authenticated
    using (coalesce(current_user_level(), 99) = 1);

-- qbr_forecasts
drop policy if exists qbr_forecasts_select on public.qbr_forecasts;
create policy qbr_forecasts_select on public.qbr_forecasts
    for select to authenticated
    using (coalesce(current_user_level(), 99) = 1);

drop policy if exists qbr_forecasts_insert on public.qbr_forecasts;
create policy qbr_forecasts_insert on public.qbr_forecasts
    for insert to authenticated
    with check (coalesce(current_user_level(), 99) = 1);

drop policy if exists qbr_forecasts_update on public.qbr_forecasts;
create policy qbr_forecasts_update on public.qbr_forecasts
    for update to authenticated
    using      (coalesce(current_user_level(), 99) = 1)
    with check (coalesce(current_user_level(), 99) = 1);

drop policy if exists qbr_forecasts_delete on public.qbr_forecasts;
create policy qbr_forecasts_delete on public.qbr_forecasts
    for delete to authenticated
    using (coalesce(current_user_level(), 99) = 1);

-- ---------------------------------------------------------------------------
-- 6. Verification (run manually after applying)
-- ---------------------------------------------------------------------------
-- select tablename, policyname, cmd from pg_policies
--   where schemaname = 'public' and tablename like 'qbr_%' order by 1, 3;
-- -- expect 4 policies (select/insert/update/delete) on each of the 3 tables.
-- select indexname from pg_indexes
--   where schemaname = 'public' and tablename = 'qbr_reviews';
-- -- expect qbr_reviews_quarter_uidx (unique on quarter).
