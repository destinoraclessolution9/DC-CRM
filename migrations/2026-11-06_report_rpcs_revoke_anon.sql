-- Reports RPCs: signed-in users only (close the signed-out read).
--
-- Found 2026-11-06 while fixing prospects_page (same pattern). These SECURITY
-- DEFINER functions had EXECUTE for anon and PUBLIC. A signed-out caller has
-- auth.uid() = null, so each one trusted the caller's p_agent_ids, and
-- p_agent_ids = NULL means "every agent". Anyone holding the public site key
-- (supabase-init.js) could read the whole company's report data.
--
-- Probed 2026-11-06 over REST with ONLY the publishable key (row counts via
-- Prefer: count=exact, no rows pulled), p_agent_ids left NULL, 2000-01-01..2030-12-31:
--   agent_sales_by_period              14 rows  = 14/14 agents with sales (per-agent totals)
--   report_purchase_details           216 rows  = 216/216 purchases (customer name, amount, item, EPP bank)
--   report_activity_details           927 rows  = 927/927 activities (title, agent, customer/prospect name)
--   kpi_extended_summary              company-wide KPI counts (meet-ups 85, attendees 435, active agents 16)
--   report_new_prospects              983 rows  (prospect name, agent, status)
--   report_new_customers              163 rows  (customer name, agent)
--   report_activity_headcount_details 435 rows  (event attendee names)
--   agent_last_activity_60d            17 rows  (agent ids + last active date)
--   report_scope_ids                  echoes its input back; no data on its own, but the
--                                     four functions just above get their anon trust from it
--                                     (they never say auth.uid() themselves).
-- These nine are every SECURITY DEFINER function in public that anon can run and
-- that takes an agent-scope parameter (catalog check 2026-11-06).
--
-- Callers (origin/main 259f0576), all signed in, all unaffected:
--   chunks/script-reporting.js  kpi_extended_summary, report_purchase_details,
--     report_activity_details, agent_last_activity_60d, report_new_customers,
--     report_new_prospects. Reports tab only; each falls back to the client path
--     on any RPC error.
--   data.js agentSalesByPeriod  agent_sales_by_period. Refuses to call without a
--     live session (hasLiveSession) and falls back on error.
--   report_scope_ids and report_activity_headcount_details: no app caller. The
--     SECURITY INVOKER kpi_activity_summary / kpi_purchase_summary /
--     kpi_user_summary / kpi_target_comparison call report_scope_ids as the
--     signed-in user, so authenticated keeps EXECUTE on it.
--   No api/*.mjs, src/react, diag.html, edge function or cron job calls any of them.
--
-- Signed-in calls are unchanged: with a session, auth.uid() is set and each
-- function scopes by bff_visible_agent_ids(auth.uid()), ignoring p_agent_ids.
-- After this, a signed-out call gets 42501 (permission denied).
--
-- Only grants change, no function body. If any of these is later rebuilt with
-- DROP + CREATE, Supabase's default privileges grant anon EXECUTE again: re-run
-- the revoke for it (CREATE OR REPLACE keeps the grants).
--
-- prospects_approval_guard and users_guard_privileged_cols also show anon
-- EXECUTE, but they return trigger: PostgREST does not expose them (REST call
-- answers PGRST202 "not found") and Postgres refuses to call a trigger function
-- directly. Left as they are.
--
-- Undo: 2026-11-06_report_rpcs_revoke_anon_UNDO.sql

begin;

revoke all on function public.agent_sales_by_period(date, date, date, date, bigint[]) from public, anon;
grant execute on function public.agent_sales_by_period(date, date, date, date, bigint[]) to authenticated, service_role;

revoke all on function public.kpi_extended_summary(date, date, bigint[], text) from public, anon;
grant execute on function public.kpi_extended_summary(date, date, bigint[], text) to authenticated, service_role;

revoke all on function public.report_activity_details(date, date, bigint[], text, text[], text) from public, anon;
grant execute on function public.report_activity_details(date, date, bigint[], text, text[], text) to authenticated, service_role;

revoke all on function public.report_purchase_details(date, date, bigint[], text) from public, anon;
grant execute on function public.report_purchase_details(date, date, bigint[], text) to authenticated, service_role;

revoke all on function public.report_scope_ids(bigint[]) from public, anon;
grant execute on function public.report_scope_ids(bigint[]) to authenticated, service_role;

revoke all on function public.report_new_prospects(date, date, bigint[]) from public, anon;
grant execute on function public.report_new_prospects(date, date, bigint[]) to authenticated, service_role;

revoke all on function public.report_new_customers(date, date, bigint[]) from public, anon;
grant execute on function public.report_new_customers(date, date, bigint[]) to authenticated, service_role;

revoke all on function public.report_activity_headcount_details(date, date, bigint[]) from public, anon;
grant execute on function public.report_activity_headcount_details(date, date, bigint[]) to authenticated, service_role;

revoke all on function public.agent_last_activity_60d(bigint[]) from public, anon;
grant execute on function public.agent_last_activity_60d(bigint[]) to authenticated, service_role;

commit;

-- Check (expect anon_exec = false, auth_exec = true on all nine):
-- select p.oid::regprocedure, has_function_privilege('anon', p.oid, 'EXECUTE') anon_exec,
--        has_function_privilege('authenticated', p.oid, 'EXECUTE') auth_exec
-- from pg_proc p join pg_namespace n on n.oid = p.pronamespace
-- where n.nspname = 'public' and p.proname in ('agent_sales_by_period','kpi_extended_summary',
--   'report_activity_details','report_purchase_details','report_scope_ids','report_new_prospects',
--   'report_new_customers','report_activity_headcount_details','agent_last_activity_60d');
