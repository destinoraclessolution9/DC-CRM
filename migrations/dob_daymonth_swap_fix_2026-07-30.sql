-- Fix 2 prospects whose date_of_birth had the day and month transposed.
--
-- Found while measuring IC-to-DOB derivation accuracy for the life_chart_type
-- backfill: 8 prospects have a stored date_of_birth that contradicts their own
-- IC number. Two of those are unambiguous dd/mm <-> mm/dd entry errors, and each
-- is corroborated TWICE over, so they are safe to correct without asking the
-- agent who keyed them:
--
--   Tan Hooi Shang (1776173439548)
--     stored  1975-11-05
--     IC      750511…      -> 1975-05-11
--     lunar   01/04/1975   -> 1st day, 4th lunar month 1975. CNY 1975 fell on
--                             11 Feb, so lunar month 4 opens ~11 May 1975.
--     => IC and the lunar date agree on 11 May; the stored date does not.
--
--   Kang ching Ru (1776173726995)
--     stored  1994-08-12
--     IC      941208…      -> 1994-12-08
--     lunar   06-11-1994   -> 6th day, 11th lunar month 1994. CNY 1994 fell on
--                             10 Feb, so lunar month 11 opens ~2 Dec 1994.
--     => IC and the lunar date agree on 8 Dec; the stored date does not.
--
-- ming_gua is NOT recalculated and does not need to be: it derives from the birth
-- YEAR (and gender), both swaps keep the year, and neither date crosses the
-- Chinese-New-Year boundary that would shift the feng-shui year. The stored
-- values are already correct and consistent with the 9-year cycle observable in
-- this table -- 1975 female -> MG8 (same cycle slot as 1966 female -> MG8), and
-- 1994 female -> MG9 (1995 MG1 … 1998 MG4, which matches 12 of 13 existing 1998
-- female rows). life_chart_type is 'lunar' for both and stays correct.
--
-- updated_at IS bumped deliberately. prospects has no updated_at trigger, so a
-- bulk UPDATE is invisible to the client delta-sync and every device would keep
-- serving the wrong date from its cached snapshot (the trap that forced the
-- _prospect_cols_purge_2026_07_29b re-key). At two rows there is no downside to
-- bumping it, and it makes the correction propagate on its own.
--
-- The remaining 6 IC-vs-DOB conflicts are NOT touched here -- which side is wrong
-- cannot be determined without the agent who keyed the record. They are exported
-- for review in DOB_IC_Conflicts_2026-07-30.xlsx.

UPDATE public.prospects
   SET date_of_birth = DATE '1975-05-11',
       updated_at    = now()
 WHERE id = 1776173439548
   AND date_of_birth = DATE '1975-11-05';   -- no-op if already corrected

UPDATE public.prospects
   SET date_of_birth = DATE '1994-12-08',
       updated_at    = now()
 WHERE id = 1776173726995
   AND date_of_birth = DATE '1994-08-12';   -- no-op if already corrected
