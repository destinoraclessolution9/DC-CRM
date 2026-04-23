-- ============================================================================
-- Replace unrestricted "allow_all" RLS policies with role-scoped policies
-- Date: 2026-04-24
-- ----------------------------------------------------------------------------
-- Previous state (SCHEMA_MIGRATION.sql lines 509-510):
--     create policy "allow_all" on <table> for all using (true) with check (true);
-- That let any authenticated user read, modify, or delete rows in transactions,
-- contracts, approval_queue and 15 other tables. This migration replaces those
-- policies with role-aware ones backed by current_user_level().
--
-- Prereq: migrations/rls_helpers.sql must have been run (it has, per memory).
-- Idempotent: all drops are IF EXISTS, all creates are fresh.
-- ============================================================================

do $$
declare
    t text;
    admin_only_tables text[] := array['transactions','contracts','approval_queue'];
    general_tables    text[] := array[
        'user_preferences','special_programs','special_program_participants',
        'booking_slots','booking_appointments','booking_pages',
        'lead_forms','lead_submissions','surveys','survey_responses',
        'custom_field_definitions','custom_field_values','portal_sessions',
        'ai_predictions','document_tags','document_tag_mappings'
    ];
begin
    foreach t in array admin_only_tables loop
        execute format('alter table %I enable row level security', t);
        execute format('drop policy if exists "allow_all"    on %I', t);
        execute format('drop policy if exists "admin_select" on %I', t);
        execute format('drop policy if exists "admin_write"  on %I', t);
        execute format(
            'create policy "admin_select" on %I for select to authenticated
               using (coalesce(current_user_level(), 99) <= 2)', t);
        execute format(
            'create policy "admin_write" on %I for all to authenticated
               using  (coalesce(current_user_level(), 99) <= 2)
               with check (coalesce(current_user_level(), 99) <= 2)', t);
    end loop;

    foreach t in array general_tables loop
        execute format('alter table %I enable row level security', t);
        execute format('drop policy if exists "allow_all"    on %I', t);
        execute format('drop policy if exists "auth_select"  on %I', t);
        execute format('drop policy if exists "auth_insert"  on %I', t);
        execute format('drop policy if exists "mgr_update"   on %I', t);
        execute format('drop policy if exists "admin_delete" on %I', t);

        execute format(
            'create policy "auth_select" on %I for select to authenticated using (true)', t);
        execute format(
            'create policy "auth_insert" on %I for insert to authenticated with check (true)', t);
        execute format(
            'create policy "mgr_update" on %I for update to authenticated
               using  (coalesce(current_user_level(), 99) <= 10)
               with check (coalesce(current_user_level(), 99) <= 10)', t);
        execute format(
            'create policy "admin_delete" on %I for delete to authenticated
               using (coalesce(current_user_level(), 99) <= 2)', t);
    end loop;
end $$;

-- Also tighten the formula_purchaser policy generator.
create or replace function fp_install_rls(tbl text) returns void
language plpgsql as $fp$
begin
    execute format('alter table %I enable row level security', tbl);
    execute format('drop policy if exists "fp_auth_full"    on %I', tbl);
    execute format('drop policy if exists "fp_auth_select"  on %I', tbl);
    execute format('drop policy if exists "fp_auth_insert"  on %I', tbl);
    execute format('drop policy if exists "fp_mgr_update"   on %I', tbl);
    execute format('drop policy if exists "fp_admin_delete" on %I', tbl);

    execute format('create policy "fp_auth_select" on %I for select to authenticated using (true)', tbl);
    execute format('create policy "fp_auth_insert" on %I for insert to authenticated with check (true)', tbl);
    execute format('create policy "fp_mgr_update"  on %I for update to authenticated
        using (coalesce(current_user_level(), 99) <= 10)
        with check (coalesce(current_user_level(), 99) <= 10)', tbl);
    execute format('create policy "fp_admin_delete" on %I for delete to authenticated
        using (coalesce(current_user_level(), 99) <= 2)', tbl);
end
$fp$;
