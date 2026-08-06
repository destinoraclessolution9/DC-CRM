-- ⚠ RUN AGAINST THE PRIMARY, NOT A READ REPLICA — check first:
--     select pg_is_in_recovery() as on_read_replica;   -- must be FALSE
--   A replica is read-only; DDL reports success and commits nothing. See the header of
--   monthly_targets_full_metrics_2026-08-06.sql for the full story.
--
-- monthly_targets: one row per (year, month).
--
-- RUN THIS SECOND, after migrations/monthly_targets_full_metrics_2026-08-06.sql.
--
-- Split out of that file on purpose. The Supabase SQL editor runs a submitted
-- script as ONE transaction, so when this index failed on pre-existing duplicate
-- rows it rolled back every ALTER above it — the schema came out completely
-- unchanged and it looked like nothing had run at all.
--
-- WHY THE INDEX: saveKPITargets and saveQuarterlyTargets take ONE snapshot of
-- monthly_targets before their quarter loop (chunks/script-features2.js) and then
-- do find-then-create per month. Two saves running concurrently both miss the same
-- row and both insert it. The dashboard would then read one copy while the Set
-- Monthly Targets modal edits the other, and the number on screen would never
-- match the number in the form.


-- ---- STEP 1: look before deleting ------------------------------------------
-- Run this alone first. If it returns no rows, skip straight to step 3.
--
--   select year, month, count(*) as copies, array_agg(id order by id) as ids
--     from public.monthly_targets
--    group by year, month
--   having count(*) > 1
--    order by year, month;


-- ---- STEP 2: keep the newest row per (year, month) --------------------------
-- Only needed if step 1 returned rows. Highest id wins — these rows are written by
-- the derivation loop, so the newest is the one the most recent save produced.
--
-- A hand-set row (is_manual = true) is preferred over a derived one regardless of
-- id: it holds a human's numbers, and the derived twin can be regenerated from its
-- quarter at any time. Losing it silently is the one outcome worth guarding.
--
-- delete from public.monthly_targets t
--  using public.monthly_targets keep
--  where t.year = keep.year
--    and t.month = keep.month
--    and t.id <> keep.id
--    and (keep.is_manual, keep.id) > (t.is_manual, t.id);


-- ---- STEP 3: the constraint -------------------------------------------------
create unique index if not exists monthly_targets_year_month_uidx
    on public.monthly_targets (year, month);


-- ---- VERIFY -----------------------------------------------------------------
--   select indexname, indexdef
--     from pg_indexes
--    where tablename = 'monthly_targets'
--      and indexname = 'monthly_targets_year_month_uidx';


-- ---- make PostgREST see the change ------------------------------------------
-- See the note in monthly_targets_full_metrics_2026-08-06.sql: this project does
-- not appear to auto-refresh PostgREST every schema change.
notify pgrst, 'reload schema';
