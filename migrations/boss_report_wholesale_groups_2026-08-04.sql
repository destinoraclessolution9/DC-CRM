-- Boss Report — admin-managed wholesale groups + monthly targets (2026-08-04)
--
-- Companion to boss_report_catalog_2026-08-04.sql, applying the same treatment to
-- Section 3 (Monthly Targets) and the Wholesales block of the report. The five
-- groups were hardcoded in FOUR places: the chunk's tgtGroups (form render), the
-- `groups` array in brSaveTargets, the chunk's wsGroups (report generate, which
-- also carries the source_keys mapping), and the React island's TGT_GROUPS.
--
-- `source_keys` is the extra wrinkle Section 2 does not have: each reported line
-- sums one or more keys out of the committed egg run's `totals.by_group`, e.g.
-- 'KL Kepong + SG Puchong & Sunway' = ['KL Kepong', 'SG Puchong & Sunway']. A key
-- present in the run but listed under NO group was silently omitted from the
-- report; the client now warns about those rather than dropping them.
--
-- Additive DDL (pre-authorized). No DROP of any pre-existing object. The app
-- falls back to the previously hardcoded list + localStorage targets when these
-- tables are absent, so code and SQL can deploy in any order.

-- ---------------------------------------------------------------------------
-- Wholesale groups (one line each in the report's Wholesales block)
-- ---------------------------------------------------------------------------
create table if not exists public.br_wholesale_group (
    key         text primary key,            -- stable id; the br-tgt-* DOM id + target key
    label       text not null,               -- printed verbatim in the report line
    source_keys text[] not null default '{}',-- keys summed out of egg_run_history.totals.by_group
    sort_order  integer not null default 0,
    active      boolean not null default true,
    updated_at  timestamptz not null default now(),
    updated_by  bigint
);

-- ---------------------------------------------------------------------------
-- Monthly carton targets. Previously localStorage `br_targets_<YYYY_MM>` only,
-- so a target set on the desktop read back as N/A when the report was generated
-- on the phone. The client still mirrors to localStorage as an offline fallback.
-- ---------------------------------------------------------------------------
create table if not exists public.br_wholesale_target (
    group_key  text not null references public.br_wholesale_group(key) on update cascade on delete cascade,
    month_key  text not null,                -- 'YYYY_MM', matching the client's _brMonthKey()
    target     integer not null default 0 check (target >= 0),
    updated_at timestamptz not null default now(),
    updated_by bigint,
    primary key (group_key, month_key)
);
create index if not exists br_wholesale_target_month_idx on public.br_wholesale_target (month_key);

-- ---------------------------------------------------------------------------
-- Seed: the five groups exactly as hardcoded, with their existing keys (which
-- are the `br_targets_*` localStorage keys and the `br-tgt-*` DOM ids) and
-- labels (which print in the report). Byte-identical output after migrating.
-- ---------------------------------------------------------------------------
insert into public.br_wholesale_group (key, label, source_keys, sort_order) values
    ('klKepong',   'KL Kepong + SG Puchong & Sunway', array['KL Kepong','SG Puchong & Sunway'], 10),
    ('klCheras',   'KL Cheras',                       array['KL Cheras'],                       20),
    ('pgCenter',   'PG Center',                       array['PG Center'],                       30),
    ('pgMainland', 'PG Mainland',                     array['PG Mainland'],                     40),
    ('pgSouth',    'PG South',                        array['PG South'],                        50)
on conflict (key) do nothing;

-- ---------------------------------------------------------------------------
-- Grants + RLS — identical policy shape to br_product_group/br_product_sku:
--   READ  : level <= 2 (matches the chunk's exactLevels [1,2])
--   WRITE : level  = 1 (Super Admin only, mirroring the Boss Report view gate)
-- ---------------------------------------------------------------------------
grant select, insert, update, delete on public.br_wholesale_group  to authenticated;
grant select, insert, update, delete on public.br_wholesale_target to authenticated;

alter table public.br_wholesale_group  enable row level security;
alter table public.br_wholesale_target enable row level security;

drop policy if exists br_wholesale_group_sel on public.br_wholesale_group;
create policy br_wholesale_group_sel on public.br_wholesale_group
    for select to authenticated
    using (coalesce(public.current_user_level(), 99) <= 2);

drop policy if exists br_wholesale_group_write on public.br_wholesale_group;
create policy br_wholesale_group_write on public.br_wholesale_group
    for all to authenticated
    using (coalesce(public.current_user_level(), 99) = 1)
    with check (coalesce(public.current_user_level(), 99) = 1);

drop policy if exists br_wholesale_target_sel on public.br_wholesale_target;
create policy br_wholesale_target_sel on public.br_wholesale_target
    for select to authenticated
    using (coalesce(public.current_user_level(), 99) <= 2);

drop policy if exists br_wholesale_target_write on public.br_wholesale_target;
create policy br_wholesale_target_write on public.br_wholesale_target
    for all to authenticated
    using (coalesce(public.current_user_level(), 99) = 1)
    with check (coalesce(public.current_user_level(), 99) = 1);
