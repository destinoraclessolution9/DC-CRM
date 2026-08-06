-- monthly_targets: the 8 metric columns the writer has always written and the
-- schema never had, plus the is_manual flag that makes a monthly target editable.
--
-- BACKGROUND
-- ----------
-- `monthly_targets` is not a new table. saveKPITargets() (chunks/script-features2.js)
-- has auto-generated 12 monthly rows on every "Save Yearly Targets" since the KPI
-- dashboard shipped, writing all TEN metrics per row:
--
--   cps_count_target, total_sales_target, pop_case_count_target, pop_sales_target,
--   epp_case_count_target, epp_sales_target, new_agents_target,
--   new_customers_target, total_meetings_target, activity_headcount_target
--
-- Only the first two exist. Probed live 2026-08-06 (anon PostgREST, 200 [] = the
-- column exists, 400/42703 = it does not):
--
--   monthly_targets    -> id, month, year, quarter, cps_count_target,
--                         total_sales_target, created_at, updated_at
--   quarterly_targets  -> all ten
--   yearly_targets     -> all ten
--
-- AppDataStore's unknown-column retry loop (data.js:2356 insert, data.js:2658
-- update) catches 42703, strips the offending column and retries, so the row saves
-- and the eight remaining metrics are discarded silently. Identical failure mode to
-- migrations/potential_opportunity_columns_2026-07-29.sql.
--
-- Second-order cost: the strip-retry burns one round-trip per missing column, so
-- each month row costs NINE requests instead of one — ~108 requests per "Save
-- Yearly Targets" against the NANO instance, for 12 rows nobody reads. Adding the
-- columns removes the storm as a side effect.
--
-- is_manual
-- ---------
-- Required by the new "Set Monthly Targets" modal, not cosmetic. saveKPITargets
-- rewrites all 12 monthly rows unconditionally; without a flag distinguishing a
-- hand-typed month from a derived one, every yearly save would wipe every manual
-- monthly target. FALSE (the default) means "derived from my quarter, regenerate
-- me"; TRUE means "a human set this, leave it alone". Backfilling the default
-- across existing rows is correct: every row that exists today was machine-derived.
--
-- meetup_existing_target / cf_headcount_target
-- --------------------------------------------
-- Added to BOTH tables. renderPerformanceTable (chunks/script-reporting.js:3806)
-- has read qTarget.meetup_existing_target and qTarget.cf_headcount_target since
-- those rows were added to the breakdown card, but neither column exists on
-- quarterly_targets and no form has ever written them — so "Meet Up (Existing
-- Customers)" and "CF Headcount" have rendered Target 0 / 0.0% for every user
-- since day one. Read-only ghosts; this is the write side they were missing.
--
-- TYPES
-- -----
-- NUMERIC across the board, matching quarterly_targets/yearly_targets. Count
-- metrics are conceptually integers but the derivation divides a quarter by three,
-- and the RM metrics are never guaranteed whole — NUMERIC avoids a silent
-- truncation at the boundary. Run the precheck below and match whatever
-- quarterly_targets actually uses if it differs.
--
-- PRECHECK (run first, separately — the unique index at the bottom FAILS if
-- duplicate (year, month) rows already exist, and saveKPITargets CAN produce them:
-- it takes one pre-loop snapshot at script-features2.js:806 and then does
-- find-then-create, so two concurrent saves race):
--
--   select table_name, column_name, data_type
--     from information_schema.columns
--    where table_name in ('quarterly_targets','monthly_targets')
--    order by table_name, column_name;
--
--   select year, month, count(*)
--     from monthly_targets group by 1,2 having count(*) > 1;
--
-- If the second query returns rows, keep the newest id per (year, month) and
-- delete the rest before running the CREATE UNIQUE INDEX at the bottom.


-- ---- monthly_targets: the 8 missing metrics --------------------------------
alter table monthly_targets
    add column if not exists pop_case_count_target      numeric,
    add column if not exists pop_sales_target           numeric,
    add column if not exists epp_case_count_target      numeric,
    add column if not exists epp_sales_target           numeric,
    add column if not exists new_agents_target          numeric,
    add column if not exists new_customers_target       numeric,
    add column if not exists total_meetings_target      numeric,
    add column if not exists activity_headcount_target  numeric;


-- ---- monthly_targets: manual-vs-derived flag -------------------------------
-- NOT NULL + default false so the read path never has to null-guard it: a row
-- without the flag is a derived row.
alter table monthly_targets
    add column if not exists is_manual boolean not null default false;


-- ---- both tables: the two columns the breakdown card already reads ----------
alter table monthly_targets
    add column if not exists meetup_existing_target numeric,
    add column if not exists cf_headcount_target    numeric;

alter table quarterly_targets
    add column if not exists meetup_existing_target numeric,
    add column if not exists cf_headcount_target    numeric;


-- ---- one row per (year, month) ---------------------------------------------
-- Run the duplicate precheck above FIRST. This is what stops the find-then-create
-- race from quietly producing two rows for the same month, one of which the
-- dashboard would read and the other of which the modal would edit.
create unique index if not exists monthly_targets_year_month_uidx
    on monthly_targets (year, month);


-- ---- VERIFY (anon PostgREST; 200 [] = present, 400/42703 = still missing) ----
--   K="sb_publishable_XVWyiw5j1lnEErQUTV4XWg_lQcCIAjX"
--   B="https://remuwhxvzkzjtgbzqjaa.supabase.co/rest/v1"
--   curl -s -H "apikey: $K" -H "Authorization: Bearer $K" \
--     "$B/monthly_targets?select=pop_case_count_target,pop_sales_target,epp_case_count_target,epp_sales_target,new_agents_target,new_customers_target,total_meetings_target,activity_headcount_target,meetup_existing_target,cf_headcount_target,is_manual&limit=1"
--   curl -s -H "apikey: $K" -H "Authorization: Bearer $K" \
--     "$B/quarterly_targets?select=meetup_existing_target,cf_headcount_target&limit=1"
--
-- The JS ships independently of this migration: openMonthlyTargetsModal probes
-- for is_manual and renders a "migration not applied" banner instead of pretending
-- the edits will stick, and every monthly READ falls back to quarter/3 for any
-- month with no stored row. Applying this file is what turns the feature on.
