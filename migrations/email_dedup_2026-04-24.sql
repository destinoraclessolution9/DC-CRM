-- ============================================================================
-- Email duplicate detection — RPC + partial unique index on prospects.email
-- 2026-04-24
--
-- Mirrors migrations/phone_unique_constraint.sql for the email field.
-- Existing app code already calls a fallback client-side grouper at
-- script.js:25336 (`_loadEmailDupes`); this adds the server-side RPC for
-- O(N) grouping at the DB layer (matches `_fs_phone_dupes`).
--
-- Rules:
--   * Email comparison is case-insensitive (lower(email)).
--   * Empty / NULL emails are NOT considered duplicates.
--   * Many prospects legitimately leave email blank — the partial unique
--     index excludes NULL/empty so blanks don't collide.
--
-- Apply order:
--   1. Run the RPC create (cheap, no lock).
--   2. Resolve duplicates via the existing UI (Settings → Data Quality →
--      Review Contact Duplicates → Email tab).
--   3. Verify dupe count is zero (query at the bottom).
--   4. THEN run the CREATE UNIQUE INDEX statement.
--
-- CONCURRENTLY → cannot live inside an explicit transaction. The Supabase
-- Management API runs each statement in its own tx, so this works there.
-- ============================================================================

-- ----- Server-side RPC (returns dupe groups) --------------------------------
create or replace function _fs_email_dupes()
returns table (email text, group_json jsonb)
language sql security definer set search_path = public as $$
    with grouped as (
        select lower(btrim(email)) as norm_email,
               jsonb_agg(jsonb_build_object(
                   'id', id,
                   'full_name', full_name,
                   'email', email,
                   'phone', phone,
                   'lead_agent_id', lead_agent_id,
                   'last_activity_date', last_activity_date
               ) order by id) as members,
               count(*) as cnt
        from prospects
        where email is not null and btrim(email) <> ''
        group by lower(btrim(email))
    )
    select norm_email as email, members as group_json
    from grouped
    where cnt > 1
    order by cnt desc;
$$;

revoke all on function _fs_email_dupes() from public;
grant execute on function _fs_email_dupes() to authenticated;

-- ----- Verify duplicate count is zero before the next step ------------------
-- Run this FIRST. If it returns rows, resolve them via the UI before
-- attempting the unique index.
select lower(btrim(email)) as email, count(*) as cnt
from prospects
where email is not null and btrim(email) <> ''
group by lower(btrim(email))
having count(*) > 1;

-- ----- Partial unique index (case-insensitive) ------------------------------
-- APPLIED 2026-04-24 after resolving 3 dupes (kept older record's email,
-- nulled newer in each pair: ids 1776006767328, 1776167735074, 1776513729654).
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS idx_prospects_email_unique
    ON prospects (lower(btrim(email)))
    WHERE email IS NOT NULL AND btrim(email) <> '';
