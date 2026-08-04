-- Boss Report — admin-managed product catalog (2026-08-04)
--
-- Replaces two pieces of hardcoding in chunks/script-boss-report.js:
--   1. the four balance groups (Ocean sold / Yang power sold / D3k2 Sold / Eye+),
--      previously duplicated across 4 code sites (chunk render, chunk generate,
--      _brParseFinalBalances, and the React island's BAL_GROUPS);
--   2. the product-code → group + unit-quantity mapping, previously held ONLY in
--      localStorage `br_skus` (per-browser, per-device, no backup, wiped by a
--      cache purge) and refreshable only by re-uploading the SKUs xlsx.
--
-- With these tables a Super Admin adds a new product code, attribute or an
-- entire product line from the Boss Report UI — no code edit, no redeploy.
--
-- Additive DDL (pre-authorized). No DROP of any pre-existing object. The app
-- degrades to the previous hardcoded list + localStorage mapping if this
-- migration has not been applied yet, so deploy order does not matter.

-- ---------------------------------------------------------------------------
-- Product lines (one balance block each in the generated report)
-- ---------------------------------------------------------------------------
create table if not exists public.br_product_group (
    key                    text primary key,          -- stable id; used for DOM ids + br_balances keys
    label                  text not null,             -- printed verbatim as the report block header
    sort_order             integer not null default 0,
    is_egg                 boolean not null default false,  -- excluded from product balance (eggs come from the egg run)
    exclude_online_pattern text,                      -- JS regex, case-insensitive, tested against Order Tracking "Self Collection"
    active                 boolean not null default true,
    updated_at             timestamptz not null default now(),
    updated_by             bigint
);

-- ---------------------------------------------------------------------------
-- Product codes (the SKUs mapping)
-- ---------------------------------------------------------------------------
create table if not exists public.br_product_sku (
    code       text primary key,                      -- e.g. 'AGENTFMLYANG002'
    name       text default '',                       -- e.g. 'YANG POWER (AGENT PROMOTION)'
    attribute  text default '',                       -- e.g. 'Pre Buy 50 bottle'
    group_key  text references public.br_product_group(key) on update cascade on delete restrict,
    unit_qty   integer not null default 1 check (unit_qty > 0),  -- bottles per sold unit
    active     boolean not null default true,
    updated_at timestamptz not null default now(),
    updated_by bigint
);
create index if not exists br_product_sku_group_idx on public.br_product_sku (group_key);

-- ---------------------------------------------------------------------------
-- Seed: the four groups that were hardcoded, with their EXACT existing keys and
-- labels. The keys match the `br_balances` localStorage keys and the `br-bal-*`
-- DOM ids already in use, and the labels match what _brParseFinalBalances greps
-- out of a saved report — so carried-forward balances and previously saved
-- reports keep parsing byte-identically after this migration.
-- ---------------------------------------------------------------------------
insert into public.br_product_group (key, label, sort_order, is_egg, exclude_online_pattern) values
    ('oceanSold', 'Ocean sold',      10, false, 'formula2u|mbb'),
    ('yangPower', 'Yang power sold', 20, false, null),
    ('d3k2',      'D3k2 Sold',       30, false, null),
    ('eyePlus',   'Eye+',            40, false, null)
on conflict (key) do nothing;

-- The egg bucket. Previously a hardcoded prefix test (_brIsEgg: FMLEGG / FMLENX
-- / FWHEGG) that dropped egg codes from the product balance. Mapping an egg code
-- to this group has the same effect, but is now editable. The prefix test is
-- KEPT in the client as a fallback for codes not yet in the catalog, so nothing
-- changes for existing egg codes.
insert into public.br_product_group (key, label, sort_order, is_egg, active) values
    ('eggs', 'Eggs (excluded from product balance)', 900, true, true)
on conflict (key) do nothing;

-- ---------------------------------------------------------------------------
-- Grants + RLS
--   READ  : level <= 2 — matches the chunk's role gate (script.js exactLevels [1,2]).
--   WRITE : level  = 1 — Super Admin only, mirroring the Boss Report view gate
--           (script.js `boss_report` → isSystemAdmin). The DB must not be looser
--           than the UI: these functions are exported on window.app and could be
--           invoked directly.
-- ---------------------------------------------------------------------------
grant select, insert, update, delete on public.br_product_group to authenticated;
grant select, insert, update, delete on public.br_product_sku   to authenticated;

alter table public.br_product_group enable row level security;
alter table public.br_product_sku   enable row level security;

drop policy if exists br_product_group_sel on public.br_product_group;
create policy br_product_group_sel on public.br_product_group
    for select to authenticated
    using (coalesce(public.current_user_level(), 99) <= 2);

drop policy if exists br_product_group_write on public.br_product_group;
create policy br_product_group_write on public.br_product_group
    for all to authenticated
    using (coalesce(public.current_user_level(), 99) = 1)
    with check (coalesce(public.current_user_level(), 99) = 1);

drop policy if exists br_product_sku_sel on public.br_product_sku;
create policy br_product_sku_sel on public.br_product_sku
    for select to authenticated
    using (coalesce(public.current_user_level(), 99) <= 2);

drop policy if exists br_product_sku_write on public.br_product_sku;
create policy br_product_sku_write on public.br_product_sku
    for all to authenticated
    using (coalesce(public.current_user_level(), 99) = 1)
    with check (coalesce(public.current_user_level(), 99) = 1);
