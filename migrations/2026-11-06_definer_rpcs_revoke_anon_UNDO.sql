-- UNDO for 2026-11-06_definer_rpcs_revoke_anon.sql: puts back the grants read live
-- 2026-11-06. 24 functions had EXECUTE for PUBLIC, anon, authenticated, service_role;
-- crm_nav_predictions had anon, authenticated, service_role (no PUBLIC).
-- authenticated and service_role keep EXECUTE through the forward migration, so only
-- PUBLIC and anon are granted back here.
-- ⚠ This re-opens signed-out reads of daily sales totals, sales per product line and
-- class waitlists, and signed-out writes to journey tasks, the e-voucher counter and the
-- audit trail. Only use it if a signed-out caller turns out to be needed, and close it
-- again straight after.
begin;

grant execute on function public.purchase_sales_by_day(date, date) to public, anon;
grant execute on function public.purchase_category_counts(date, date) to public, anon;
grant execute on function public.potential_tier_rates() to public, anon;
grant execute on function public.class_wait_entries_for(bigint) to public, anon;
grant execute on function public.crm_nav_predictions(integer, integer, integer) to anon;
grant execute on function public.bff_visible_agent_ids(uuid) to public, anon;

grant execute on function public.journey_customer_of(bigint, bigint) to public, anon;
grant execute on function public.inv_person_key(text, bigint) to public, anon;
grant execute on function public.is_anc_or_self(bigint, bigint) to public, anon;
grant execute on function public.same_team_chain(bigint, bigint) to public, anon;
grant execute on function public.inv_cfg() to public, anon;
grant execute on function public.event_cats(bigint) to public, anon;
grant execute on function public.inv_line_kw(text) to public, anon;
grant execute on function public.bjc_resolve(text) to public, anon;
grant execute on function public.delivery_advance_allowed(text) to public, anon;
grant execute on function public.journey_item_profile(text) to public, anon;

grant execute on function public.journey_spawn(bigint, bigint, text, date, bigint, text, bigint, bigint, text[]) to public, anon;
grant execute on function public.journey_pr_sync(bigint) to public, anon;
grant execute on function public.journey_sale_sync(bigint) to public, anon;
grant execute on function public.journey_item_sync(bigint) to public, anon;
grant execute on function public.journey_gr_spawn(bigint) to public, anon;
grant execute on function public.class_wait_task(bigint, bigint) to public, anon;
grant execute on function public.next_evoucher_number() to public, anon;
grant execute on function public.record_audit(text, text, text, text, jsonb) to public, anon;
grant execute on function public.purge_old_archives(integer) to public, anon;

commit;
