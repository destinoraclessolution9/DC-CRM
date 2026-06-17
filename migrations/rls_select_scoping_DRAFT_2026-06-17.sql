-- ============================================================================
--  ██  DRAFT — HIGH BLAST RADIUS — DO NOT APPLY AS-IS  ██
-- ============================================================================
--  REVIEW + TEST ON A BRANCH / STAGING SUPABASE PROJECT BEFORE APPLYING.
--  A wrong SELECT policy on these three tables will EITHER lock every user
--  out of their own data (app shows empty lists everywhere) OR silently leak
--  every row to every user. There is no safe middle failure mode.
--
--  THIS FILE IS NOT AUTO-APPLIED. It is a reviewable artifact only.
--  Nothing here has been run against any database.
--
--  Date drafted: 2026-06-17
--  Author: drafted by Claude (Task B). Hand-verify every -- ASSUMPTION/REVIEW
--          comment below before you run a single statement.
--
--  WHAT THIS DOES
--  --------------
--  Replaces the permissive app-wide `auth_full_access` SELECT path on:
--      - public.activities
--      - public.prospects
--      - public.customers
--  with a per-row SELECT policy that mirrors the EXISTING app-layer scoping
--  model (script.js getVisibleUserIds + the calendar queryAdvanced scopeFields
--  + the calendar_dashboard_payload / get_calendar_dashboard RPCs). Today those
--  three tables over-fetch (RLS returns everything; the client filters), so any
--  authenticated user can read every row straight from PostgREST / DevTools.
--
--  ROW IS VISIBLE TO THE CALLER IF ANY OF:
--    1. caller is an admin / leader whose visible-id set includes the row owner
--       (Super Admin & Marketing Manager => "all"; managers => self + downline)
--    2. caller OWNS the row (owner-agent column maps to caller's users.id)
--    3. (activities only) caller is a co-agent on the row
--    4. (activities only) the row is public/open (visibility IN ('open','public'))
--
--  All of the above is exactly what migrations/calendar_perf_2026-05-03.sql and
--  migrations/calendar_dashboard_rpc_2026-05-31.sql already enforce inside
--  SECURITY INVOKER RPCs — this migration pushes the same rule down to the base
--  tables so the protection holds for EVERY query path, not just the calendar.
--
--  ROLLOUT DISCIPLINE (read migrations/rls_hardening_plan.md first):
--    * Apply to ONE table at a time on staging; smoke-test each role
--      (Super Admin, Marketing Manager, Manager, Agent L11, Ambassador L12+).
--    * This file ADDS the new scoped SELECT policy and, in a CLEARLY MARKED
--      separate step at the bottom, DROPS auth_full_access SELECT. Keep
--      auth_full_access in place until the new policy is proven, then run the
--      drop step. Rollback section restores auth_full_access verbatim.
--    * EXPLAIN ANALYZE a COUNT(*) on each table as a mid-tree manager AND as a
--      plain agent after applying — current_user_visible_ids() is evaluated per
--      scanned row and can tank large scans if not inlined (see Cost notes).
-- ============================================================================


-- ============================================================================
-- SECTION 0 — PRE-FLIGHT ASSUMPTIONS YOU MUST VERIFY (do NOT skip)
-- ============================================================================
-- The helper functions are assumed already present (migrations/rls_helpers.sql,
-- confirmed shipped per project memory): current_user_level(),
-- current_user_row_id(), current_user_visible_ids(). This migration depends on
-- all three. Verify with:
--     \df+ current_user_level
--     \df+ current_user_row_id
--     \df+ current_user_visible_ids
--
-- -- ASSUMPTION/REVIEW (A1) auth.uid() -> users.id MAPPING
--    The helpers map the JWT via `users.auth_user_id = auth.uid()`. This column
--    MUST exist and MUST be backfilled for EVERY active user, or the helpers
--    return NULL and (with the policies below) that user sees ZERO rows.
--    NOTE: migrations/rls_hardening_plan.md (older) claimed users had no
--    auth_user_id column and login matched on email. rls_helpers.sql and
--    bff_visible_agent_ids both already use auth_user_id, so it presumably was
--    added — but THIS IS THE #1 LOCKOUT RISK. Verify BEFORE applying:
--        SELECT count(*) FILTER (WHERE auth_user_id IS NULL) AS unlinked,
--               count(*) AS total
--          FROM public.users
--         WHERE coalesce(status,'') <> 'deleted';
--    If `unlinked > 0`, STOP and backfill first (see rls_hardening_plan.md
--    Step 1) — those users would be locked out. Also confirm a trigger / signup
--    path populates auth_user_id for NEW users, or new accounts lock out on day
--    one.
--
-- -- ASSUMPTION/REVIEW (A2) LEVEL-BAND OFF-BY-ONE (manager vs agent boundary)
--    The shipped current_user_visible_ids() treats level <=10 as "manager
--    (self + downline)" and level >=11 as "self only". But the app
--    (script.js getVisibleUserIds, line ~689) treats levels 3..11 as the
--    downline-walking manager band and only 12+ as self-only. => A Level-11
--    user (still in the agent band, isAgent) would, under the shipped helper,
--    see ONLY themselves, which matches the app for an individual agent — but
--    if any L11 acts as a team leader in your data, the helper under-grants vs
--    the app. Decide which is canonical and, if needed, fix the helper (not
--    this file). Flagged, not changed here.
--
-- -- ASSUMPTION/REVIEW (A3) TEAM-ID RESTRICTION IN THE DOWNLINE WALK
--    The app's getVisibleUserIds AND bff_visible_agent_ids restrict the
--    recursive downline to the SAME team_id (or null team_id). The shipped
--    current_user_visible_ids() in rls_helpers.sql does NOT apply that team
--    filter — it walks the full reporting_to tree. => current_user_visible_ids()
--    may return a SUPERSET (a manager could see cross-team reports the app
--    hides). If exact parity matters, prefer bff_visible_agent_ids(auth.uid())
--    (it already encodes the team filter + uses the authoritative role_level
--    column). See the "VARIANT B" blocks below — pick A or B per table after
--    verifying which visible-id source you trust.
--
-- -- ASSUMPTION/REVIEW (A4) OWNER COLUMNS (verified against schema + RPCs)
--    activities  -> owner = lead_agent_id (bigint)
--    prospects   -> owner = responsible_agent_id; ALSO cps_agent_id; ALSO
--                   lead_agent_id  (all three count as "ownership" in
--                   calendar_dashboard_payload). Verify these 3 columns exist:
--                       \d public.prospects   -- expect responsible_agent_id,
--                                              --        cps_agent_id, lead_agent_id
--    customers   -> owner = responsible_agent_id ONLY (per calendar RPC + the
--                   agent_sales_by_period RPC). Verify customers has NO
--                   lead_agent_id / cps_agent_id you also need to honor.
--
-- -- ASSUMPTION/REVIEW (A5) co_agents SHAPE (activities)
--    co_agents is JSONB = array of objects [{ "id": <bigint>, "name": ..., ... }].
--    The calendar perf RPC matches with containment:
--        co_agents @> jsonb_build_array(jsonb_build_object('id', <my_id>))
--    NOTE: calendar_dashboard_payload uses `co_agents ? p_agent_id` instead —
--    the `?` (top-level key existence) operator is WRONG for an array-of-objects
--    and only works if co_agents is sometimes stored as an object keyed by id.
--    This DRAFT uses the @> containment form (the correct + indexed one, backed
--    by idx_activities_co_agents_gin). Confirm the real stored shape with:
--        SELECT co_agents FROM public.activities
--         WHERE co_agents IS NOT NULL AND co_agents <> '[]'::jsonb LIMIT 5;
--    If any rows store co_agents as a bare object/string, adjust the predicate.
--
-- -- ASSUMPTION/REVIEW (A6) VISIBILITY VALUES (activities)
--    Public/open activities are visibility IN ('open','public'). Customers and
--    prospects have NO public/open concept (no row-level sharing) — they are
--    owner/leader-scoped only. Confirm prospects/customers should NOT honor any
--    `visibility` column even if one exists.
--
-- -- ASSUMPTION/REVIEW (A7) NULL-OWNER ROWS
--    Rows with a NULL owner (e.g. an unassigned prospect / a system event with
--    no lead_agent_id) are NOT matched by `owner = current_user_row_id()` and,
--    for non-admins, become INVISIBLE. Today (auth_full_access) everyone sees
--    them. Decide whether unassigned rows should be visible to managers/all.
--    The policies below add an OPTIONAL, COMMENTED OUT clause to let admins
--    (level <= 2) see NULL-owner rows; un-comment if your data has orphans that
--    admins must still see. (Admins already see all via current_user_visible_ids
--    returning every id, so the orphan only matters if an owner id is set to a
--    user NOT returned by the visible-id set — unlikely for admins.)
--
-- -- ASSUMPTION/REVIEW (A8) anon ROLE
--    These policies target the `authenticated` role only. Any anon/public read
--    path (lead-capture pages, portal) does NOT go through these tables with the
--    anon role today; confirm no anon SELECT on activities/prospects/customers
--    is required. (The helpers are granted to anon, but anon's auth.uid() is
--    NULL => helpers return NULL => anon sees nothing here, which is intended.)
-- ============================================================================


begin;

-- Defensive: ensure RLS is actually ON (it should already be).
alter table public.activities enable row level security;
alter table public.prospects  enable row level security;
alter table public.customers  enable row level security;


-- ============================================================================
-- SECTION 1 — ACTIVITIES: per-row scoped SELECT
-- ============================================================================
-- Mirrors migrations/calendar_perf_2026-05-03.sql get_calendar_dashboard:
--   admin/leader visible-id set  OR  own (lead_agent_id)  OR  co-agent  OR
--   public/open.
-- Idempotent: drop-if-exists then create.

drop policy if exists "activities_scoped_select" on public.activities;

-- ----- VARIANT A (uses the shipped rls_helpers current_user_visible_ids) -----
-- Pick this if you accept the team-filter / level-band caveats in A2 + A3.
create policy "activities_scoped_select" on public.activities
    for select to authenticated
    using (
        -- (1) admin / leader: row owner is in the caller's visible-id set.
        --     For Super Admin / Marketing Manager this set is "everyone", so
        --     they keep full read. Managers get self + downline.
        lead_agent_id in (select current_user_visible_ids())
        -- (2) own row (covered by (1) for non-orphans, kept explicit + cheap)
        or lead_agent_id = current_user_row_id()
        -- (3) co-agent on the activity (JSONB array-of-objects containment)
        or co_agents @> jsonb_build_array(
               jsonb_build_object('id', current_user_row_id()))
        -- (4) public / open activity, visible to all authenticated users
        or visibility in ('open', 'public')
        -- (A7) OPTIONAL: let admins see orphan (NULL-owner) rows. Un-comment if
        --      you have unassigned activities admins must still read:
        -- or (lead_agent_id is null and coalesce(current_user_level(), 99) <= 2)
    );

-- ----- VARIANT B (uses bff_visible_agent_ids — team-filtered, role_level) ----
-- Prefer this for EXACT parity with the app/BFF (encodes the team_id filter +
-- reads the authoritative role_level column). To use it: DROP the policy above
-- and create this one instead. NOTE bff_visible_agent_ids returns NULL = "all"
-- (unrestricted) and is keyed by auth.uid() (uuid), so the NULL case must be
-- handled explicitly.
--
-- drop policy if exists "activities_scoped_select" on public.activities;
-- create policy "activities_scoped_select" on public.activities
--     for select to authenticated
--     using (
--         bff_visible_agent_ids(auth.uid()) is null               -- admin = all
--         or lead_agent_id = any(bff_visible_agent_ids(auth.uid()))
--         or co_agents @> jsonb_build_array(
--                jsonb_build_object('id', current_user_row_id()))
--         or visibility in ('open', 'public')
--     );


-- ============================================================================
-- SECTION 2 — PROSPECTS: per-row scoped SELECT
-- ============================================================================
-- Mirrors calendar_dashboard_payload: ownership is ANY of responsible_agent_id
-- / cps_agent_id / lead_agent_id. No public/open concept, no co_agents.
-- -- ASSUMPTION/REVIEW (A4): confirm all three owner columns exist on prospects.

drop policy if exists "prospects_scoped_select" on public.prospects;

-- ----- VARIANT A -----
create policy "prospects_scoped_select" on public.prospects
    for select to authenticated
    using (
        responsible_agent_id in (select current_user_visible_ids())
        or cps_agent_id       in (select current_user_visible_ids())
        or lead_agent_id      in (select current_user_visible_ids())
        -- own-row fast path (redundant with the above for non-orphans):
        or responsible_agent_id = current_user_row_id()
        or cps_agent_id        = current_user_row_id()
        or lead_agent_id       = current_user_row_id()
        -- (A7) OPTIONAL orphan visibility for admins:
        -- or (responsible_agent_id is null and cps_agent_id is null
        --     and lead_agent_id is null
        --     and coalesce(current_user_level(), 99) <= 2)
    );

-- ----- VARIANT B (bff_visible_agent_ids parity) -----
-- drop policy if exists "prospects_scoped_select" on public.prospects;
-- create policy "prospects_scoped_select" on public.prospects
--     for select to authenticated
--     using (
--         bff_visible_agent_ids(auth.uid()) is null
--         or responsible_agent_id = any(bff_visible_agent_ids(auth.uid()))
--         or cps_agent_id        = any(bff_visible_agent_ids(auth.uid()))
--         or lead_agent_id       = any(bff_visible_agent_ids(auth.uid()))
--     );


-- ============================================================================
-- SECTION 3 — CUSTOMERS: per-row scoped SELECT
-- ============================================================================
-- Mirrors calendar_dashboard_payload + agent_sales_by_period: ownership is
-- responsible_agent_id ONLY. No co_agents, no public/open.
-- -- ASSUMPTION/REVIEW (A4): confirm customers has no other owner column you
--    must also honor (e.g. a secondary/servicing agent).

drop policy if exists "customers_scoped_select" on public.customers;

-- ----- VARIANT A -----
create policy "customers_scoped_select" on public.customers
    for select to authenticated
    using (
        responsible_agent_id in (select current_user_visible_ids())
        or responsible_agent_id = current_user_row_id()
        -- (A7) OPTIONAL orphan visibility for admins:
        -- or (responsible_agent_id is null
        --     and coalesce(current_user_level(), 99) <= 2)
    );

-- ----- VARIANT B (bff_visible_agent_ids parity) -----
-- drop policy if exists "customers_scoped_select" on public.customers;
-- create policy "customers_scoped_select" on public.customers
--     for select to authenticated
--     using (
--         bff_visible_agent_ids(auth.uid()) is null
--         or responsible_agent_id = any(bff_visible_agent_ids(auth.uid()))
--     );


commit;


-- ============================================================================
-- SECTION 4 — RETIRE auth_full_access SELECT  (RUN ONLY AFTER PROVING SECTION 1-3)
-- ============================================================================
-- ██ DO NOT RUN THIS BLOCK IN THE SAME PASS AS SECTIONS 1-3. ██
-- Keep auth_full_access in place while you smoke-test the new scoped policies
-- with every role. The new "*_scoped_select" policies are PERMISSIVE, so while
-- auth_full_access also exists, SELECT = (scoped OR full) = still full access
-- (no lockout risk during testing, but ALSO no privacy gain yet). The privacy
-- fix only takes effect once auth_full_access stops granting SELECT.
--
-- -- ASSUMPTION/REVIEW (A9) auth_full_access POLICY SHAPE
--    The app-wide policy is named "auth_full_access" and is FOR ALL
--    (USING true / WITH CHECK true) — it grants SELECT *and* INSERT/UPDATE/
--    DELETE in one policy. You CANNOT simply drop it for SELECT only without
--    also losing write access. Inspect the real definition first:
--        SELECT polname, cmd, qual, with_check
--          FROM pg_policies
--         WHERE tablename in ('activities','prospects','customers')
--         ORDER BY tablename, polname;
--    Then choose ONE migration path below (B1 or B2) per table and DELETE the
--    other. Do NOT run both.
--
-- ---- PATH B1: auth_full_access is SELECT-ONLY on these tables ----------------
-- If (and only if) auth_full_access is a SELECT-only policy here, dropping it
-- leaves writes governed by other existing policies (the *_delete_lead_only
-- RESTRICTIVE overlays + whatever INSERT/UPDATE policies exist). Verify writes
-- still have a permissive policy before dropping, or writes will start failing.
--
--   drop policy if exists "auth_full_access" on public.activities;
--   drop policy if exists "auth_full_access" on public.prospects;
--   drop policy if exists "auth_full_access" on public.customers;
--
-- ---- PATH B2: auth_full_access is FOR ALL (the likely case) ------------------
-- Replace the single FOR ALL policy with command-split policies so SELECT
-- becomes scoped while INSERT/UPDATE keep working as before. DELETE is already
-- governed by the RESTRICTIVE *_delete_lead_only policies
-- (migrations/rls_restrictive_delete_policies.sql), so we re-grant a permissive
-- DELETE base here and let the RESTRICTIVE overlay narrow it.
-- -- ASSUMPTION/REVIEW (A10): adjust the INSERT/UPDATE rules to match your real
--    intent. Below keeps them permissive-to-authenticated (status quo) so this
--    change is PURELY a SELECT tightening and nothing else regresses. Tighten
--    writes in a SEPARATE migration once SELECT is proven.
--
-- begin;
-- -- ACTIVITIES
-- drop policy if exists "auth_full_access" on public.activities;
-- drop policy if exists "activities_auth_insert" on public.activities;
-- drop policy if exists "activities_auth_update" on public.activities;
-- drop policy if exists "activities_auth_delete" on public.activities;
-- create policy "activities_auth_insert" on public.activities
--     for insert to authenticated with check (true);
-- create policy "activities_auth_update" on public.activities
--     for update to authenticated using (true) with check (true);
-- create policy "activities_auth_delete" on public.activities
--     for delete to authenticated using (true);   -- narrowed by RESTRICTIVE overlay
-- -- (SELECT is now governed solely by activities_scoped_select from Section 1)
--
-- -- PROSPECTS
-- drop policy if exists "auth_full_access" on public.prospects;
-- drop policy if exists "prospects_auth_insert" on public.prospects;
-- drop policy if exists "prospects_auth_update" on public.prospects;
-- drop policy if exists "prospects_auth_delete" on public.prospects;
-- create policy "prospects_auth_insert" on public.prospects
--     for insert to authenticated with check (true);
-- create policy "prospects_auth_update" on public.prospects
--     for update to authenticated using (true) with check (true);
-- create policy "prospects_auth_delete" on public.prospects
--     for delete to authenticated using (true);
--
-- -- CUSTOMERS
-- drop policy if exists "auth_full_access" on public.customers;
-- drop policy if exists "customers_auth_insert" on public.customers;
-- drop policy if exists "customers_auth_update" on public.customers;
-- drop policy if exists "customers_auth_delete" on public.customers;
-- create policy "customers_auth_insert" on public.customers
--     for insert to authenticated with check (true);
-- create policy "customers_auth_update" on public.customers
--     for update to authenticated using (true) with check (true);
-- create policy "customers_auth_delete" on public.customers
--     for delete to authenticated using (true);
-- commit;


-- ============================================================================
-- SECTION 5 — ROLLBACK  (restore the previous permissive behavior, fast)
-- ============================================================================
-- If ANY role starts seeing an empty / wrong row set after applying, roll back
-- IMMEDIATELY by restoring auth_full_access and removing the scoped policies.
-- This returns the tables to exactly today's behavior (everyone reads
-- everything; app-layer scoping does the filtering).
--
-- begin;
-- -- 1) Re-grant the permissive app-wide policy (FOR ALL, USING true).
-- --    Use this if you had taken PATH B2 (the original was FOR ALL):
-- drop policy if exists "auth_full_access" on public.activities;
-- drop policy if exists "auth_full_access" on public.prospects;
-- drop policy if exists "auth_full_access" on public.customers;
-- create policy "auth_full_access" on public.activities
--     for all to authenticated using (true) with check (true);
-- create policy "auth_full_access" on public.prospects
--     for all to authenticated using (true) with check (true);
-- create policy "auth_full_access" on public.customers
--     for all to authenticated using (true) with check (true);
--
-- -- 2) Drop the scoped SELECT policies + any command-split write policies added
-- --    in PATH B2 (harmless if they don't exist).
-- drop policy if exists "activities_scoped_select" on public.activities;
-- drop policy if exists "prospects_scoped_select"  on public.prospects;
-- drop policy if exists "customers_scoped_select"  on public.customers;
-- drop policy if exists "activities_auth_insert" on public.activities;
-- drop policy if exists "activities_auth_update" on public.activities;
-- drop policy if exists "activities_auth_delete" on public.activities;
-- drop policy if exists "prospects_auth_insert"  on public.prospects;
-- drop policy if exists "prospects_auth_update"  on public.prospects;
-- drop policy if exists "prospects_auth_delete"  on public.prospects;
-- drop policy if exists "customers_auth_insert"  on public.customers;
-- drop policy if exists "customers_auth_update"  on public.customers;
-- drop policy if exists "customers_auth_delete"  on public.customers;
-- commit;
--
-- NOTE: the RESTRICTIVE *_delete_lead_only policies from
-- migrations/rls_restrictive_delete_policies.sql are independent and remain in
-- force across both apply and rollback — do NOT drop them.


-- ============================================================================
-- SECTION 6 — POST-APPLY VERIFICATION (run as each role on staging)
-- ============================================================================
-- For each test login, confirm the row counts MATCH what the app shows today:
--   -- as Super Admin / Marketing Manager: counts == unscoped totals
--   select count(*) from public.activities;
--   select count(*) from public.prospects;
--   select count(*) from public.customers;
--   -- as a mid-tree Manager: counts == self + downline (same as app sidebar)
--   -- as a plain Agent (L11): counts == own rows + public/open activities only
--
-- Functional smoke (must all still work end-to-end):
--   - prospects-table view, daily/weekly dashboard, reports KPIs
--   - calendar (own + co-agent + public events)  <-- the model this mirrors
--   - CPS invite flow, prospect->customer conversion
--
-- Performance (current_user_visible_ids() is per-row on scans):
--   explain (analyze, buffers) select count(*) from public.prospects;
--   -- run as a manager with a large downline. If the helper is NOT inlined and
--   -- you see a per-row function call dominating, switch that table to VARIANT B
--   -- (array literal via bff_visible_agent_ids, evaluated once) or pre-expand
--   -- the id set with a STABLE wrapper.
-- ============================================================================
