-- ============================================================================
-- Normalize prospects.gender / customers.gender to a single canonical casing
-- 2026-08-05
--
-- WHY
--   Both columns are free text and had accumulated six spellings of two values,
--   inherited from CSV imports that wrote the spreadsheet cell through unchanged:
--
--     prospects  Female 284 | Male 226 | female 184 | male 163 | F 3 | M 2 | NULL 22
--     customers  Female  71 | Male  54 | female   2 | male   1 | F 3 | M 2 | NULL 15 | '' 1
--
--   Every code site that COMPARES this column expects the capitalized form:
--     • chunks/script-activities.js  buildBasicInfoBlock  <select> Male/Female/Other
--     • chunks/script-search.js      advanced-search gender filter (client + pushed-down)
--   No reader anywhere expects lowercase. The two lowercase-matching code sites in
--   the tree read DIFFERENT tables that are already internally consistent and are
--   deliberately NOT touched here:
--     • chunks/script-fude.js  → cps_analyses.gender  (111 rows, 100% lowercase)
--     • chunks/script-org.js   → org member records   (written lowercased on import)
--   So capitalized is the correct target and nothing renders the other way.
--
--   The bare 'F'/'M' rows matched NOTHING anywhere: not the form select, not the
--   search filter. They are the same 5 people in both tables (converted prospects
--   carried their casing across via approvals.js / pipeline.js).
--
-- PAIR WITH (already in the branch — apply the code first or together, not after)
--   chunks/script-activities.js  normalize on read + blank first option, so the
--                                save-the-whole-record form stops rewriting an
--                                unmatched value to 'Male'
--   chunks/script-import.js      normalize on write, so an import cannot
--                                re-introduce a casing the CHECK would reject
--   chunks/script-search.js      first-letter matching, client + server (ilike)
--   data.js                      queryAdvanced `ilike` option
--
-- NOTE ON CACHES
--   Neither table has an updated_at trigger — updated_at is set client-side by
--   AppDataStore.update, so a raw SQL UPDATE would NOT bump it and SWR/delta-sync
--   clients would keep serving the old casing until their cache expires. The
--   UPDATEs below bump updated_at explicitly, and only on rows that actually
--   change (~350 prospects, ~9 customers) so the delta-sync fetch stays small.
--   The paired code change makes a stale cached row harmless in the meantime:
--   _biGender normalizes on read, so a cached 'female' still renders and saves
--   as 'Female'.
--
-- SAFETY
--   Re-runnable. The UPDATEs are no-ops once applied; the constraint is guarded
--   by an IF NOT EXISTS-style DO block.
--   Triggers on prospects (prospects_approval_guard, prospects_score_audit) are
--   inert here: the guard short-circuits when auth.uid() is null (direct DB /
--   Management API), and score is untouched.
-- ============================================================================

begin;

-- ── 1. Census BEFORE ────────────────────────────────────────────────────────
select 'before' as phase, 'prospects' as tbl, coalesce(gender, '<NULL>') as g, count(*)
  from public.prospects group by 1, 2, 3
union all
select 'before', 'customers', coalesce(gender, '<NULL>'), count(*)
  from public.customers group by 1, 2, 3
order by 2, 4 desc;

-- ── 2. Normalize ────────────────────────────────────────────────────────────
-- '' is folded to NULL: it means "unset", exactly like NULL, and only one row
-- has it. Anything not recognizable as male/female/other is left ALONE rather
-- than guessed at — step 4 will surface it if it exists.
update public.prospects
   set gender     = case
                      when lower(btrim(gender)) like 'm%'     then 'Male'
                      when lower(btrim(gender)) like 'f%'     then 'Female'
                      when lower(btrim(gender)) = 'other'     then 'Other'
                      when btrim(gender) = ''                 then null
                      else gender
                    end,
       updated_at = now()
 where gender is not null
   and gender is distinct from case
                      when lower(btrim(gender)) like 'm%'     then 'Male'
                      when lower(btrim(gender)) like 'f%'     then 'Female'
                      when lower(btrim(gender)) = 'other'     then 'Other'
                      when btrim(gender) = ''                 then null
                      else gender
                    end;

update public.customers
   set gender     = case
                      when lower(btrim(gender)) like 'm%'     then 'Male'
                      when lower(btrim(gender)) like 'f%'     then 'Female'
                      when lower(btrim(gender)) = 'other'     then 'Other'
                      when btrim(gender) = ''                 then null
                      else gender
                    end,
       updated_at = now()
 where gender is not null
   and gender is distinct from case
                      when lower(btrim(gender)) like 'm%'     then 'Male'
                      when lower(btrim(gender)) like 'f%'     then 'Female'
                      when lower(btrim(gender)) = 'other'     then 'Other'
                      when btrim(gender) = ''                 then null
                      else gender
                    end;

-- ── 3. Constrain ────────────────────────────────────────────────────────────
-- NULL stays legal (22 prospects / 15 customers genuinely have no gender on file,
-- and the form's new blank option writes NULL rather than defaulting to Male).
-- '' stays legal because the CSV import path emits '' for every blank text field;
-- rejecting it would turn a blank cell into a hard import failure.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'prospects_gender_canonical') then
    alter table public.prospects
      add constraint prospects_gender_canonical
      check (gender is null or gender in ('Male', 'Female', 'Other', ''));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'customers_gender_canonical') then
    alter table public.customers
      add constraint customers_gender_canonical
      check (gender is null or gender in ('Male', 'Female', 'Other', ''));
  end if;
end $$;

-- ── 4. Census AFTER — expect only Male / Female / <NULL> ────────────────────
select 'after' as phase, 'prospects' as tbl, coalesce(gender, '<NULL>') as g, count(*)
  from public.prospects group by 1, 2, 3
union all
select 'after', 'customers', coalesce(gender, '<NULL>'), count(*)
  from public.customers group by 1, 2, 3
order by 2, 4 desc;

commit;

-- ── Rollback (casing only; the original per-row casing is NOT recoverable) ──
-- alter table public.prospects drop constraint if exists prospects_gender_canonical;
-- alter table public.customers drop constraint if exists customers_gender_canonical;
