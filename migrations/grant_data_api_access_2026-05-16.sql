-- Supabase Data API grant hardening
-- From 30 Oct 2026, Supabase will no longer auto-grant public schema tables
-- to the Data API roles on existing projects. This migration makes all grants
-- explicit so supabase-js / PostgREST keep working after that cutoff.
--
-- What this does:
--   1. Grants SELECT/INSERT/UPDATE/DELETE on every existing table to
--      `authenticated` and `service_role` (RLS still controls row visibility).
--   2. Grants USAGE/SELECT on all sequences so bigserial PKs keep incrementing.
--   3. Sets ALTER DEFAULT PRIVILEGES so any NEW table created by the postgres
--      role gets the same grants automatically — no need to add per-table
--      GRANTs in future migrations unless you need anon access or a tighter scope.
--
-- `anon` is intentionally excluded from the broad grant; the CRM is fully
-- login-gated. Tables that legitimately need anon access (e.g. cps_intake_requests)
-- already carry their own explicit GRANT statements and are unaffected here.
--
-- Safe to re-run (all GRANT statements are idempotent).

-- ── 1. Existing tables ────────────────────────────────────────────────────────
grant select, insert, update, delete
  on all tables in schema public
  to authenticated, service_role;

-- ── 2. Existing sequences ─────────────────────────────────────────────────────
grant usage, select
  on all sequences in schema public
  to authenticated, service_role;

-- ── 3. Future tables & sequences (created by the postgres role) ───────────────
alter default privileges in schema public
  grant select, insert, update, delete on tables
  to authenticated, service_role;

alter default privileges in schema public
  grant usage, select on sequences
  to authenticated, service_role;
