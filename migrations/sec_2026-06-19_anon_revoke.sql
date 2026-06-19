-- =====================================================================
-- SECURITY HARDENING — Phase 1, group G: revoke blanket anon WRITE grants
-- Date: 2026-06-19  (defense-in-depth, owner-approved destructive grant change)
--
-- The public `anon` role held INSERT/UPDATE/DELETE/TRUNCATE on EVERY table.
-- RLS already denied all of it (after CPS + bujishu were locked, anon has zero
-- table policies), so this is belt-and-suspenders: if RLS is ever accidentally
-- disabled on a table, anon still cannot write. All legitimate anon access now
-- goes through SECURITY DEFINER RPCs (cps get/submit), which do not need table
-- grants. SELECT is intentionally left in place (also moot under RLS) to avoid
-- breaking any unaudited public read path.
-- =====================================================================
revoke insert, update, delete, truncate, references, trigger
  on all tables in schema public from anon;

-- Future tables: stop auto-granting write to anon.
alter default privileges in schema public
  revoke insert, update, delete, truncate, references, trigger on tables from anon;
