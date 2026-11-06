-- UNDO for 2026-11-06_report_rpcs_revoke_anon.sql: puts back the grants read live
-- 2026-11-06 (EXECUTE for PUBLIC, anon, authenticated, service_role on all nine).
-- ⚠ This re-opens the signed-out read of every agent's sales, purchases,
-- activities, prospects and customers. Only use it if a signed-out caller
-- turns out to be needed, and close it again straight after.
begin;

grant execute on function public.agent_sales_by_period(date, date, date, date, bigint[]) to public, anon, authenticated, service_role;
grant execute on function public.kpi_extended_summary(date, date, bigint[], text) to public, anon, authenticated, service_role;
grant execute on function public.report_activity_details(date, date, bigint[], text, text[], text) to public, anon, authenticated, service_role;
grant execute on function public.report_purchase_details(date, date, bigint[], text) to public, anon, authenticated, service_role;
grant execute on function public.report_scope_ids(bigint[]) to public, anon, authenticated, service_role;
grant execute on function public.report_new_prospects(date, date, bigint[]) to public, anon, authenticated, service_role;
grant execute on function public.report_new_customers(date, date, bigint[]) to public, anon, authenticated, service_role;
grant execute on function public.report_activity_headcount_details(date, date, bigint[]) to public, anon, authenticated, service_role;
grant execute on function public.agent_last_activity_60d(bigint[]) to public, anon, authenticated, service_role;

commit;
