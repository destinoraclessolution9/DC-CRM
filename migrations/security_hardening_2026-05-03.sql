-- ============================================================================
-- Security hardening — RLS for refill_reminders + RPC anon lockdown
-- Date: 2026-05-03
-- ----------------------------------------------------------------------------
-- Two pre-existing gaps surfaced by the post-IO-overhaul audit:
--
-- 1. public.refill_reminders has RLS enabled (relrowsecurity=true) but ZERO
--    policies. With RLS on and no policy, all SELECT/INSERT/UPDATE/DELETE
--    against the table fail for `authenticated` and `anon`. The pg_cron
--    populator works because it runs as `postgres` (BYPASS RLS), but every
--    client read failed silently — the badge's refill-reminder count was
--    always 0 regardless of actual data. Add proper policies matching the
--    score_history convention.
--
-- 2. SECURITY DEFINER functions inherit PUBLIC EXECUTE by default in Postgres.
--    `anon` is a member of PUBLIC, so anon callers (anyone with the
--    publishable key — i.e. everyone, since it's in the bundle) could call
--    aggregation RPCs and read PII (referrer names, conversion counts, the
--    full calendar window with prospect/customer names). We REVOKE FROM
--    PUBLIC and GRANT only to `authenticated` for every user-data RPC.
--    Trigger and cron-only functions are also locked from anon as defense
--    in depth — they execute as `postgres` regardless, so the GRANT change
--    has no functional effect on the cron scheduler.
--
-- Functions intentionally NOT locked down here:
--   - pg_trgm extension functions (similarity, gtrgm_*, gin_*) — these are
--     part of the trigram index machinery and must stay anon-callable for
--     pg_trgm-indexed search (e.g. searchProspects) to work.
--   - current_user_level / current_user_row_id / current_user_visible_ids
--     — RLS helper functions; policies on every table call them, including
--     under the anon role for paths like the cps-intake anon read.
--   - record_audit, _audit_trigger, set_updated_at, sync_prospect_last_
--     activity_date, trigger_notify_activity_push, refresh_referral_path
--     — internal triggers / housekeeping invoked by Postgres itself.
--
-- Idempotent. Safe to re-run.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. refill_reminders RLS policies
-- ---------------------------------------------------------------------------
do $rr$
begin
    if not exists (select 1 from information_schema.tables
                   where table_schema='public' and table_name='refill_reminders') then
        return;
    end if;

    execute 'alter table public.refill_reminders enable row level security';

    -- Drop any leftover policies first (idempotent re-run safety)
    execute 'drop policy if exists "refill_reminders_select" on public.refill_reminders';
    execute 'drop policy if exists "refill_reminders_insert" on public.refill_reminders';
    execute 'drop policy if exists "refill_reminders_update" on public.refill_reminders';
    execute 'drop policy if exists "refill_reminders_delete" on public.refill_reminders';
    execute 'drop policy if exists "auth_full_access"        on public.refill_reminders';

    -- All authenticated users can read (matches what the badge needs).
    execute 'create policy "refill_reminders_select"
                on public.refill_reminders
                for select to authenticated using (true)';

    -- Authenticated users can manually create reminders (UI flow). The
    -- pg_cron job runs as postgres role and bypasses RLS regardless.
    execute 'create policy "refill_reminders_insert"
                on public.refill_reminders
                for insert to authenticated with check (true)';

    -- Updates (e.g. marking a reminder dismissed) gated to managers+
    -- (level <= 10 covers Super Admin / Marketing Manager / Manager /
    --  team_leader). Same threshold as follow_up_drafts.
    execute 'create policy "refill_reminders_update"
                on public.refill_reminders
                for update to authenticated
                using  (coalesce(current_user_level(), 99) <= 10)
                with check (coalesce(current_user_level(), 99) <= 10)';

    execute 'create policy "refill_reminders_delete"
                on public.refill_reminders
                for delete to authenticated
                using (coalesce(current_user_level(), 99) <= 10)';
end $rr$;


-- ---------------------------------------------------------------------------
-- 2. Lock RPCs from anon
-- ---------------------------------------------------------------------------
-- For each function: revoke PUBLIC default, then grant only to authenticated.
-- We do this per-signature because Postgres function privileges are tied to
-- the (name, argtypes) tuple.

-- NOTE on Supabase grants: Supabase's PostgREST exposes any function that has
-- EXECUTE for `anon` or `authenticated`. Earlier migrations (or Supabase's
-- automatic post-create grants) gave EXECUTE to `anon` directly — REVOKE FROM
-- PUBLIC alone is insufficient since `anon` is a real role with a direct
-- grant, not just a PUBLIC inheritor. We REVOKE explicitly from both PUBLIC
-- and `anon` to fully close the door.

-- KPI suite
revoke execute on function public.kpi_activity_summary(date, date, bigint[], text) from public, anon;
grant  execute on function public.kpi_activity_summary(date, date, bigint[], text) to authenticated;

revoke execute on function public.kpi_purchase_summary(date, date, bigint[], text) from public, anon;
grant  execute on function public.kpi_purchase_summary(date, date, bigint[], text) to authenticated;

revoke execute on function public.kpi_user_summary(date, date, bigint[], text) from public, anon;
grant  execute on function public.kpi_user_summary(date, date, bigint[], text) to authenticated;

-- New aggregation RPCs (added today)
revoke execute on function public.get_referral_leaderboard(text) from public, anon;
grant  execute on function public.get_referral_leaderboard(text) to authenticated;

revoke execute on function public.get_conversion_rate(date, date, bigint[]) from public, anon;
grant  execute on function public.get_conversion_rate(date, date, bigint[]) to authenticated;

-- Calendar perf RPCs
revoke execute on function public.get_calendar_window(date, date, bigint, bigint[], boolean, bigint, text) from public, anon;
grant  execute on function public.get_calendar_window(date, date, bigint, bigint[], boolean, bigint, text) to authenticated;

revoke execute on function public.get_calendar_hot_details(date, date, bigint, bigint[], boolean) from public, anon;
grant  execute on function public.get_calendar_hot_details(date, date, bigint, bigint[], boolean) to authenticated;

-- Cron / trigger functions — defense in depth (already invoked as postgres
-- internally, so removing PUBLIC EXECUTE has no functional impact on the
-- scheduler or the trigger fires).
revoke execute on function public.apply_weekly_inactivity_scoring() from public, anon;
grant  execute on function public.apply_weekly_inactivity_scoring() to authenticated;

revoke execute on function public.queue_action_plan_reminders() from public, anon;
grant  execute on function public.queue_action_plan_reminders() to authenticated;

-- log_score_change is a trigger function. It runs from inside the trigger
-- regardless of who has EXECUTE on it, so we just lock it down explicitly.
revoke execute on function public.log_score_change() from public, anon, authenticated;

-- compute_refill_reminders is the cron-fed populator for refill_reminders.
-- Only the cron job (postgres role) calls it.
revoke execute on function public.compute_refill_reminders() from public, anon, authenticated;

notify pgrst, 'reload schema';

-- ---------------------------------------------------------------------------
-- Verification queries (run manually)
-- ---------------------------------------------------------------------------
-- SELECT tablename, policyname, cmd FROM pg_policies
--   WHERE schemaname='public' AND tablename='refill_reminders' ORDER BY policyname;
-- SELECT proname, has_function_privilege('anon'::regrole, oid, 'EXECUTE') AS anon
--   FROM pg_proc WHERE proname IN
--     ('kpi_activity_summary','kpi_purchase_summary','kpi_user_summary',
--      'get_referral_leaderboard','get_conversion_rate',
--      'get_calendar_window','get_calendar_hot_details',
--      'apply_weekly_inactivity_scoring','queue_action_plan_reminders',
--      'log_score_change','compute_refill_reminders');
