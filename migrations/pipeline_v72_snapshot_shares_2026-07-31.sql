-- =====================================================================
-- pipeline_v72_snapshot_shares_2026-07-31.sql — Pipeline v7.2
-- Additive only; pre-authorized class.
--
-- Two columns on pipeline_snapshots so calibration can later test
-- per-product prediction accuracy (PIPELINE_V72_PRODUCT_PROBABILITY.md §7):
--   top_share      — the winner category's share of product-SPECIFIC evidence
--                    (null when the prospect had no product signal)
--   top2_category  — the runner-up category id (null when none)
-- The purchases→category mapping needed to CONSUME these for validation is
-- fuzzy (purchases.item free text like 'WISDOM POWER RING', 'XING GUA JIE
-- YUN 2026') — validation UI deliberately deferred; columns recorded now so
-- the dataset accrues from day one.
-- =====================================================================

alter table public.pipeline_snapshots add column if not exists top_share integer;
alter table public.pipeline_snapshots add column if not exists top2_category text;

notify pgrst, 'reload schema';

-- Verify: GET /rest/v1/pipeline_snapshots?select=top_share,top2_category&limit=1 → 200
