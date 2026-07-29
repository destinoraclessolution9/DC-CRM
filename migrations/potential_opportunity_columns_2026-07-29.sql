-- "Edit Potential & Opportunities" columns that the modal writes but the schema never had.
--
-- `savePotential()` (chunks/script-features2.js) submits NINE fields. Only TWO of
-- them — potential_level and close_probability — exist on public.prospects. The
-- other seven hit 42703; AppDataStore.update() (data.js) catches the unknown-column
-- error, strips the offending field and retries, so the row saves, the
-- "Potential & Opportunities updated" toast fires, and the value is discarded:
--
--   GET /rest/v1/prospects?select=id,budget_range
--   → 42703 "column prospects.budget_range does not exist"
--
-- Symptom: an agent fills in Est. Value, Timeline, Pain Points, Interests,
-- Decision Maker and Budget, saves, re-opens the prospect — the Opportunity
-- section reads "-" / "Unknown" and the modal is blank again. Every prospect ever
-- assessed looks un-assessed. Identical failure mode to life_chart_type (see
-- migrations/basic_info_missing_columns_2026-07-20.sql).
--
-- Knock-on: chunks/script-pipeline.js:765 falls back to estimated_value_max /
-- estimated_value_min when a prospect has no proposed_solution row, so the
-- pipeline Amount column has always skipped straight past that fallback.
--
-- Types match what the client already writes/reads:
--   estimated_value_min/max — savePotential parseFloat()s the inputs and the
--                     pipeline renders them with toLocaleString(); NUMERIC, not
--                     INT (RM values are not guaranteed whole).
--   decision_timeline — free TEXT ("Within 1 month").
--   pain_points       — free TEXT (textarea).
--   interests         — free TEXT, comma-separated. Distinct from the existing
--                     cps_interest column, which is the single-select intake field.
--   decision_maker    — 'yes' | 'no' | 'unknown'. No CHECK constraint: a 23514
--                     violation is NOT an unknown-column error, so the
--                     strip-and-retry loop would not catch it and the whole
--                     update would fail instead of one field being dropped.
--   budget_range      — free TEXT ("RM 15k-20k/mo").
--
-- prospects only, deliberately. The Potential modal calls
-- AppDataStore.update('prospects', …) and nothing on the customer side reads or
-- writes these; the 2026-07-20 migration mirrored to customers because the shared
-- basic-info form renders for customers too, which is not the case here.

ALTER TABLE public.prospects ADD COLUMN IF NOT EXISTS estimated_value_min NUMERIC;
ALTER TABLE public.prospects ADD COLUMN IF NOT EXISTS estimated_value_max NUMERIC;
ALTER TABLE public.prospects ADD COLUMN IF NOT EXISTS decision_timeline   TEXT;
ALTER TABLE public.prospects ADD COLUMN IF NOT EXISTS pain_points         TEXT;
ALTER TABLE public.prospects ADD COLUMN IF NOT EXISTS interests           TEXT;
ALTER TABLE public.prospects ADD COLUMN IF NOT EXISTS decision_maker      TEXT;
ALTER TABLE public.prospects ADD COLUMN IF NOT EXISTS budget_range        TEXT;
