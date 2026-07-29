-- Backfill life_chart_type for prospects created while the column did not exist.
--
-- The "Use for life chart" checkboxes shipped 2026-04-08 (c6011bd) with the LUNAR
-- box checked by default for every new record, and DOB unchecked:
--
--   const useLunar = ['lunar','both'].includes(d.life_chart_type) || !data;
--
-- but public.prospects.life_chart_type only existed from 2026-07-24
-- (basic_info_missing_columns_2026-07-20.sql). For those ~3.5 months every intake
-- submitted a value and AppDataStore.add() silently stripped it (42703 →
-- strip-and-retry). 809 prospects therefore read back as "neither box ticked"
-- even though the form had shown a tick when they were keyed.
--
-- Evidence this restores the real intent, not a guess:
--   * Only 7 null rows predate 2026-04-08, i.e. were keyed before the checkbox
--     UI existed at all. Everything else was keyed WITH the tick on screen.
--   * Of the 47 prospects whose choice was actually captured (created after the
--     column existed), 45 are 'lunar' and 2 are 'solar' — and all 47 have BOTH
--     birth dates, so that 96/4 split is the real behaviour for the ambiguous
--     case. 'both' has never been chosen once.
--
-- Rule applied:
--   has a lunar_birth            → 'lunar'  (the form default; 698 rows)
--   solar date only, no lunar    → 'solar'  (21 rows — the Lunar box was still
--                                 pre-checked for these, but with no lunar date
--                                 stored 'lunar' would tick an empty row, and
--                                 the solar date is the only one that can drive
--                                 a chart)
--   no birth date at all         → left NULL (97 rows — nothing to tick)
--
-- Expected residual error: ~4% of the 698, i.e. roughly 28 prospects whose agent
-- had deliberately switched to solar. Those are corrected by one tick on the
-- profile, which now persists. That is strictly better than 809 blank rows.
--
-- Scoped to life_chart_type IS NULL so it can never overwrite a real choice, and
-- REVERT_life_chart_backfill_2026-07-29.sql holds the exact id list to undo it.

UPDATE public.prospects
   SET life_chart_type = 'lunar'
 WHERE life_chart_type IS NULL
   AND lunar_birth IS NOT NULL
   AND btrim(lunar_birth) <> '';

UPDATE public.prospects
   SET life_chart_type = 'solar'
 WHERE life_chart_type IS NULL
   AND date_of_birth IS NOT NULL;
