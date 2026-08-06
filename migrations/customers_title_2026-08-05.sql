-- ============================================================================
-- customers.title — add the column the conversion path has always written
-- 2026-08-05
--
-- WHY
--   chunks/script-approvals.js:753 copies `title: prospect.title || ''` into the
--   new customer on every prospect→customer conversion, but `customers` has no
--   `title` column, so that value has been silently dropped since the feature
--   shipped. Same class as the potential_opportunity_columns_2026-07-29 fix:
--   written client-side, invisible server-side, no error anywhere.
--
--   Found while auditing title-vs-gender consistency (Male→Mr., Female→Ms.).
--   Prospects had 23 rows titled 'Mr.' with gender 'Female' — all fixed, and the
--   root cause (a <select> with no blank option, so option 0 'Mr.' was written
--   for every title-less prospect that got saved) is fixed in script-activities.js.
--   The customers side had no contradictions to fix because it had no titles at all.
--
-- BACKFILL
--   All 149 customers carry `converted_from_prospect_id`, and 53 of those source
--   prospects have a title — so the backfill is exact, not inferred. The other 96
--   stay NULL rather than being guessed at from gender: 'Mrs.' and 'Dr.' cannot be
--   derived, and a blanket Female→'Ms.' would overwrite real marital information.
--
-- NOTE
--   No CHECK constraint here, deliberately. Malaysian honorifics (Dato', Datuk,
--   Tan Sri, Puan Sri) are legitimate values, so the column stays open; the form
--   and the CSV import canonicalize the four common ones and pass the rest through.
--   `customers` has no updated_at trigger, so the backfill bumps it explicitly.
--
-- SAFETY: additive + re-runnable. The UPDATE is a no-op once applied.
-- ============================================================================

begin;

alter table public.customers add column if not exists title text;

update public.customers c
   set title      = p.title,
       updated_at = now()
  from public.prospects p
 where p.id = c.converted_from_prospect_id
   and p.title is not null
   and c.title is distinct from p.title;

-- Verify: expect 53 titled, all drawn from the source prospect, none invented.
select coalesce(c.title, '<NULL>') as title, count(*)
  from public.customers c
 group by 1
 order by 2 desc;

commit;

-- Rollback:
-- alter table public.customers drop column if exists title;
