-- ============================================================================
-- Stock Take v2 — Level 15 "Stock Take Staff" RLS
-- Date: 2026-05-30
-- ----------------------------------------------------------------------------
-- The original migration (stock_take_v2_2026-05-30.sql) gated every st_* table
-- to current_user_level() <= 2 (Super Admin + Marketing Manager). This locks
-- out per-store counter accounts (Level 15 "Stock Take Staff") who only need:
--   * SELECT on the lookup tables so the Scan Shelf flow can resolve a QR
--   * SELECT on open st_sessions + INSERT on st_counts so they can record scans
--
-- Setup mutations (Shelves master, Exclusions, Sessions create / close, Bulk
-- uploads, Variance reasons, baseline rewrites) stay admin-only — Level 15
-- inserts/updates/deletes against those tables are blocked at the DB even if
-- the UI gate is bypassed.
--
-- Idempotent: every CREATE POLICY runs after a DROP IF EXISTS.
-- ============================================================================

-- Helper: is the caller a Stock Take Staff user (Level 15)?
create or replace function public.is_stock_take_staff() returns boolean
language sql stable security invoker as $$
    select coalesce(public.current_user_level(), 99) = 15;
$$;
grant execute on function public.is_stock_take_staff() to authenticated, anon;

-- ---------------------------------------------------------------------------
-- Lookup tables — Level 15 can SELECT, only Level <=2 can mutate
-- ---------------------------------------------------------------------------
do $$
declare t text;
declare lookups text[] := array[
    'st_stores','st_shelves','st_product_master','st_shelf_expected','st_exclusions'
];
begin
    foreach t in array lookups loop
        execute format('drop policy if exists "st_admin_full"   on public.%I', t);
        execute format('drop policy if exists "st_admin_write"  on public.%I', t);
        execute format('drop policy if exists "st_staff_select" on public.%I', t);

        -- Admin (Level 1-2): full CRUD
        execute format(
            'create policy "st_admin_write" on public.%I for all to authenticated ' ||
            '  using  (coalesce(public.current_user_level(), 1) <= 2) ' ||
            '  with check (coalesce(public.current_user_level(), 1) <= 2)', t);
        -- Stock Take Staff (Level 15): read-only
        execute format(
            'create policy "st_staff_select" on public.%I for select to authenticated ' ||
            '  using (public.is_stock_take_staff())', t);
    end loop;
end $$;

-- ---------------------------------------------------------------------------
-- st_sessions — Admin full; Staff SELECT for OPEN sessions only
-- ---------------------------------------------------------------------------
drop policy if exists "st_admin_full"   on public.st_sessions;
drop policy if exists "st_admin_write"  on public.st_sessions;
drop policy if exists "st_staff_select" on public.st_sessions;

create policy "st_admin_write" on public.st_sessions for all to authenticated
    using  (coalesce(public.current_user_level(), 1) <= 2)
    with check (coalesce(public.current_user_level(), 1) <= 2);

create policy "st_staff_select" on public.st_sessions for select to authenticated
    using (public.is_stock_take_staff() and status = 'open');

-- ---------------------------------------------------------------------------
-- st_counts — Admin full; Staff can SELECT + INSERT for OPEN sessions
-- ---------------------------------------------------------------------------
drop policy if exists "st_admin_full"   on public.st_counts;
drop policy if exists "st_admin_write"  on public.st_counts;
drop policy if exists "st_staff_select" on public.st_counts;
drop policy if exists "st_staff_insert" on public.st_counts;

create policy "st_admin_write" on public.st_counts for all to authenticated
    using  (coalesce(public.current_user_level(), 1) <= 2)
    with check (coalesce(public.current_user_level(), 1) <= 2);

create policy "st_staff_select" on public.st_counts for select to authenticated
    using (public.is_stock_take_staff());

create policy "st_staff_insert" on public.st_counts for insert to authenticated
    with check (
        public.is_stock_take_staff()
        and exists (
            select 1 from public.st_sessions s
             where s.id = session_id
               and s.status = 'open'
        )
    );

-- ---------------------------------------------------------------------------
-- Admin-only tables stay closed to Staff: st_bulk_uploads, st_variance_reasons
-- ---------------------------------------------------------------------------
do $$
declare t text;
declare admin_only text[] := array['st_bulk_uploads','st_variance_reasons'];
begin
    foreach t in array admin_only loop
        execute format('drop policy if exists "st_admin_full"  on public.%I', t);
        execute format('drop policy if exists "st_admin_write" on public.%I', t);
        execute format(
            'create policy "st_admin_write" on public.%I for all to authenticated ' ||
            '  using  (coalesce(public.current_user_level(), 1) <= 2) ' ||
            '  with check (coalesce(public.current_user_level(), 1) <= 2)', t);
    end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Verification (run after applying):
-- select polname, polrelid::regclass, polcmd
--   from pg_policy
--  where polrelid::regclass::text like 'st_%'
--  order by polrelid::regclass::text, polname;
-- ---------------------------------------------------------------------------
