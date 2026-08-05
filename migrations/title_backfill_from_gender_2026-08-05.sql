-- ============================================================================
-- Backfill the blank `title` from `gender` — Male → 'Mr.', Female → 'Ms.'
-- 2026-08-05
--
-- WHY
--   Follows the title-vs-gender audit (title_gender fix, commit 9cde410), which
--   corrected 23 contradictions but deliberately left blanks alone. Owner asked
--   for the blanks to be filled too.
--
--   prospects: 300 Female + 271 Male have no title  (571 fillable)
--   customers:  45 Female +  35 Male have no title  ( 80 fillable)
--
-- RULES
--   • Only ever writes where title IS NULL or ''. An existing title is never
--     touched — the 14 + 4 'Mrs.' rows keep their marital information, and any
--     honorific (Dato', Datuk, Tan Sri) is left exactly as stored.
--   • Female → 'Ms.', NOT 'Mrs.'. 'Ms.' is the neutral female honorific
--     precisely because it asserts nothing about marital status, so it is the
--     safe default for a value we are deriving rather than being told.
--   • gender NULL is skipped, not guessed: 22 prospects and 16 customers keep a
--     blank title because there is nothing to derive it from.
--   • gender 'Other' would also be skipped by the CASE below (currently 0 rows).
--
-- REVERSIBILITY
--   These rows are exactly "title IS NULL before this ran". The rollback at the
--   bottom re-blanks precisely the derived set (Mr. where Male, Ms. where
--   Female) — it cannot touch Mrs./Dr./honorifics, and it cannot touch the 23
--   rows fixed by the earlier audit, because those were Mr./Female.
--   NOTE: run the rollback only if nothing has edited titles since.
--
-- Neither table has an updated_at trigger, so bump it explicitly or SWR-cached
-- clients keep serving the blank. Re-runnable: a no-op once applied.
-- ============================================================================

begin;

update public.prospects
   set title      = case when gender = 'Male' then 'Mr.'
                         when gender = 'Female' then 'Ms.' end,
       updated_at = now()
 where coalesce(title, '') = ''
   and gender in ('Male', 'Female');

update public.customers
   set title      = case when gender = 'Male' then 'Mr.'
                         when gender = 'Female' then 'Ms.' end,
       updated_at = now()
 where coalesce(title, '') = ''
   and gender in ('Male', 'Female');

-- Verify. Expect zero contradictions and blanks only where gender is unknown:
--   prospects  Ms./Female 458 · Mr./Male 389 · Mrs./Female 14 · blank/NULL 22
--   customers  Ms./Female  73 · Mr./Male  56 · Mrs./Female  4 · blank/NULL 16
select 'prospects' as t, coalesce(title, '<blank>') as title,
       coalesce(gender, '<NULL>') as gender, count(*)
  from public.prospects group by 1, 2, 3
union all
select 'customers', coalesce(title, '<blank>'), coalesce(gender, '<NULL>'), count(*)
  from public.customers group by 1, 2, 3
 order by 1, 4 desc;

commit;

-- ── Rollback ────────────────────────────────────────────────────────────────
-- update public.prospects set title = null, updated_at = now()
--  where (title = 'Mr.' and gender = 'Male') or (title = 'Ms.' and gender = 'Female');
-- update public.customers set title = null, updated_at = now()
--  where (title = 'Mr.' and gender = 'Male') or (title = 'Ms.' and gender = 'Female');
