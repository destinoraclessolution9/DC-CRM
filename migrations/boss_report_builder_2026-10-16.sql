-- Boss Report — Report Builder: the report FORMAT becomes admin-editable (2026-10-16)
--
-- Sections 2 and 3 (product lines, wholesale groups) were made editable on
-- 2026-08-04. Everything else about the report — the 老板好 greeting, the egg
-- block (regions, egg names, "carton", the Total lines), the section order, the
-- headings and the ____ divider — was still a template literal in brGenerate,
-- so every "boss wants one more line" request needed a code change.
--
-- br_report_section : one row per block of the report, in order. Types:
--     settings  (exactly one row, key '_settings': the divider line)
--     text      fixed text, e.g. the greeting
--     eggs      the committed egg run, per region × egg product + Total
--     wholesale the wholesale groups (br_wholesale_group) week / month / target
--     balance   the product lines (br_product_group) KL / PG / Balance
--     manual    fields the admin types in each week (new information for the boss)
-- br_report_history : every "Save Final" — the text, the closing balances and the
--     manual values. Closing balances were localStorage-only (`br_balances`), so
--     next week's opening balance was lost on another device or a cleared browser.
--
-- Also adds the Morning Poweer and Probiotic product lines + their codes, which
-- the boss's report now carries (codes + pack sizes from product_list_2026011).
--
-- Additive DDL only: new tables, new rows (ON CONFLICT DO NOTHING), policies on
-- the new tables. Nothing pre-existing is altered or dropped. The app falls back
-- to its built-in layout (identical to the pre-builder report) while
-- br_report_section is absent or empty, so code and SQL deploy in any order.

-- ---------------------------------------------------------------------------
-- Report sections
-- ---------------------------------------------------------------------------
create table if not exists public.br_report_section (
    key        text primary key,                 -- stable id; manual values are keyed by it
    type       text not null check (type in ('settings','text','eggs','wholesale','balance','manual')),
    title      text not null default '',         -- editor name (headings printed come from config)
    sort_order integer not null default 0,
    active     boolean not null default true,
    config     jsonb not null default '{}'::jsonb,
    updated_at timestamptz not null default now(),
    updated_by bigint
);

-- ---------------------------------------------------------------------------
-- Saved final reports (history + cross-device carry-forward)
-- ---------------------------------------------------------------------------
create table if not exists public.br_report_history (
    id          bigint generated always as identity primary key,
    report_date date not null default current_date,
    run_id      bigint,                          -- egg_run_history.id the report was generated from
    report_text text not null,
    balances    jsonb not null default '{}'::jsonb,  -- { product-line key: closing balance }
    manual      jsonb not null default '{}'::jsonb,  -- { section key: { field key: value } }
    saved_at    timestamptz not null default now(),
    saved_by    bigint
);
create index if not exists br_report_history_saved_idx on public.br_report_history (saved_at desc);

-- ---------------------------------------------------------------------------
-- Seed: the layout the boss asked for on 2026-10-16 (14-underscore divider).
-- ---------------------------------------------------------------------------
insert into public.br_report_section (key, type, title, sort_order, config) values
    ('_settings', 'settings', 'Settings', 0,
        '{"divider":"______________"}'::jsonb),
    ('greeting', 'text', 'Greeting', 10,
        '{"divider_before":false,"text":"老板好，"}'::jsonb),
    ('eggs', 'eggs', 'Eggs', 20,
        '{"divider_before":false,"show_date":true,
          "regions":[{"key":"KL","label":"KL"},{"key":"PG","label":"PG"},{"key":"JB","label":"JB"}],
          "products":[{"key":"KING","line":"KINGEGGS 高鮮帝王蛋- {n} carton","total_line":"Kin-{n}"},
                      {"key":"GOLD","line":"GOLD FRESH HEALTH PLUS EGG 高鮮蛋 - {n} cartons","total_line":"Gold-{n}"}],
          "show_total":true,"total_title":"Total -"}'::jsonb),
    ('wholesale', 'wholesale', 'Wholesales', 30,
        '{"divider_before":true,"title":"Wholesales Week/ Month/ Target ({month})",
          "line":"{label} - {week} / {mtd} / {target}","no_target":"N/A"}'::jsonb),
    ('balance', 'balance', 'Product Balance', 40,
        '{"divider_before":true,"title":"Product Balance","show_date":true,
          "block":"{label}\nKL-{kl}\nPG-{pg}\nBalance - {balance}"}'::jsonb)
on conflict (key) do nothing;

-- Morning Poweer + Probiotic product lines. unit_qty = units one sale removes
-- from stock, same convention as the existing codes (x3 = 3, x12 FOC 3 = 15).
-- Morning Poweer counts a 600g and a 900g tin as one unit each.
insert into public.br_product_group (key, label, sort_order, is_egg, exclude_online_pattern) values
    ('morningPoweer', 'Morning Poweer', 50, false, null),
    ('probiotic',     'Probiotic',      60, false, null)
on conflict (key) do nothing;

insert into public.br_product_sku (code, name, attribute, group_key, unit_qty) values
    ('PWRMON001', 'MORNING POWEER',   '900g',                  'morningPoweer', 1),
    ('PWRMON002', 'MORNING POWEER',   '600g',                  'morningPoweer', 1),
    ('PWRMON003', 'MORNING POWEER',   'Hot Deals 900g x 3',    'morningPoweer', 3),
    ('PWRMON004', 'MORNING POWEER',   'Hot Deals 600g x 2',    'morningPoweer', 2),
    ('PWRMON005', 'MORNING POWEER',   'Hot Deals 900g x 2',    'morningPoweer', 2),
    ('PBTPWR001', 'PROBIOTIC POWEER', '20 Sachets',            'probiotic',     1),
    ('PBTPWR002', 'PROBIOTIC POWEER', '20 Sachets x 3',        'probiotic',     3),
    ('PBTPWR003', 'PROBIOTIC POWEER', '20 Sachets x 12 FOC 3', 'probiotic',    15),
    ('PBTPWR004', 'PROBIOTIC POWEER', '20 Sachets x 8',        'probiotic',     8),
    ('PBTPWR005', 'PROBIOTIC POWEER', '20 Sachets x 9',        'probiotic',     9)
on conflict (code) do nothing;

-- ---------------------------------------------------------------------------
-- Grants + RLS — same shape as the other br_* tables:
--   READ  : level <= 2      WRITE : level = 1 (Super Admin, the view gate)
-- ---------------------------------------------------------------------------
grant select, insert, update, delete on public.br_report_section to authenticated;
grant select, insert, update, delete on public.br_report_history to authenticated;

alter table public.br_report_section enable row level security;
alter table public.br_report_history enable row level security;

drop policy if exists br_report_section_sel on public.br_report_section;
create policy br_report_section_sel on public.br_report_section
    for select to authenticated
    using (coalesce(public.current_user_level(), 99) <= 2);

drop policy if exists br_report_section_write on public.br_report_section;
create policy br_report_section_write on public.br_report_section
    for all to authenticated
    using (coalesce(public.current_user_level(), 99) = 1)
    with check (coalesce(public.current_user_level(), 99) = 1);

drop policy if exists br_report_history_sel on public.br_report_history;
create policy br_report_history_sel on public.br_report_history
    for select to authenticated
    using (coalesce(public.current_user_level(), 99) <= 2);

drop policy if exists br_report_history_write on public.br_report_history;
create policy br_report_history_write on public.br_report_history
    for all to authenticated
    using (coalesce(public.current_user_level(), 99) = 1)
    with check (coalesce(public.current_user_level(), 99) = 1);
