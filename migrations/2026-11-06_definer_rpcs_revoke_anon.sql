-- SECURITY DEFINER functions: signed-in users only (close the rest of the signed-out holes).
--
-- Follow-up to 2026-11-06_report_rpcs_revoke_anon.sql (nine report functions)
-- and the prospects_page fix. After those, 46 non-trigger SECURITY DEFINER
-- functions in public still had EXECUTE for anon (catalog check 2026-11-06).
-- Each body was read with pg_get_functiondef and sorted:
--
--   (a) meant for signed-out use, KEEP anon (2):
--       get_cps_intake_by_token, submit_cps_intake  (cps-intake.html, token-gated)
--   (b) checks the caller itself via auth.uid() / current_user_row_id() /
--       chuanfu_scope_agents(); anon gets nothing, KEEP as is (18):
--       add_event_session_media, can_approve_sales, chuanfu_board, chuanfu_promote,
--       chuanfu_summary, current_user_level, current_user_row_id,
--       current_user_visible_ids, customer_improvement_can_write, customer_is_visible,
--       delete_event_session_media, festival_wish_list, festival_wish_mark,
--       inv_can_act, pop_can_act, prospect_is_visible, referrer_link, referrer_unlinked
--       (several are used inside RLS policies, so anon must keep EXECUTE on them:
--       a policy that calls a function anon cannot run turns an empty read into an error)
--   rls_auto_enable returns event_trigger: cannot be called directly. Left as is.
--   (c) never checks who is calling: the 25 below. Revoked here.
--
-- Probed 2026-11-06 over REST with ONLY the publishable key (supabase-init.js);
-- counts only, no rows kept:
--
--   Read leaks (company data):
--     purchase_sales_by_day(2000-01-01..2030-12-31)  164 rows = 164/164 sale days, daily RM totals
--     purchase_category_counts(same range)            5 rows, company-wide sales count per product line
--     potential_tier_rates()                          0 rows today (snapshots not 90 days old yet);
--                                                     company-wide win rate per tier once they are
--     class_wait_entries_for(session id)              1 row for a real session (23 sessions have
--                                                     entries): waitlist prospect/customer ids,
--                                                     category, recommending agent
--     crm_nav_predictions(3650, 50, 1)                180 rows of view-to-view navigation counts
--                                                     (no personal data, but no reason to be public)
--     bff_visible_agent_ids(a team leader's auth id)  14 agent ids (that leader's downline). Needs
--                                                     an auth uuid; anon cannot read users (0 rows)
--   Small lookups by id (internal helpers, no app caller):
--     journey_customer_of, inv_person_key   prospect id -> customer id (answered for a real id)
--     is_anc_or_self, same_team_chain       who reports to whom / same team, for any two user ids
--     inv_cfg                               the invite-engine rules (9 keys, answered)
--     event_cats, inv_line_kw, bjc_resolve, delivery_advance_allowed, journey_item_profile
--                                           event categories, product-line keywords, catalog ids,
--                                           product lead times
--   Writes with no caller check (anon could change data):
--     journey_spawn          inserts journey tasks for any prospect/customer, assigned to any agent
--     journey_pr_sync        re-runs the ring-track stage logic for a prospect (marks pending tasks
--                            'skipped', spawns new ones)
--     journey_sale_sync      skips a prospect's pending tasks and spawns order tasks for a purchase
--     journey_item_sync      spawns / moves / completes delivery tasks for a delivery item
--     journey_gr_spawn       spawns Golden Road session tasks for a delivery item
--     class_wait_task        creates a class-invite task for a waitlist entry
--     next_evoucher_number   burns the next e-voucher running number
--     record_audit           writes an audit_trail row (actor null)
--     purge_old_archives     deletes archived_records older than N years (min 1). Today it errors
--                            (archived_records has no created_at column) and the table is empty,
--                            but nothing stops a signed-out call once that is fixed.
--     The six journey/class writers were confirmed callable by anon with no-op arguments
--     (null/-1 ids, they return before writing; journey_touchpoints stayed 269, journey_stage_log
--     141). next_evoucher_number, record_audit and purge_old_archives were NOT called (any call
--     writes); has_function_privilege('anon', ..., 'EXECUTE') was true for all three.
--
-- Callers (origin/main d5191bbd), all signed in, all unaffected:
--   chunks/script-reporting.js  purchase_sales_by_day, purchase_category_counts (Reports tab,
--     all-scope viewers only; both fall back to the client path on any RPC error)
--   chunks/script-pipeline.js   potential_tier_rates (Pipeline, signed in)
--   chunks/script-prospects.js  next_evoucher_number (Generate E-Voucher, signed in)
--   script.js                   crm_nav_predictions (prefetch model, only when _currentUser is set,
--                                best-effort, errors ignored)
--   api/prospects.mjs, api/customers.mjs  bff_visible_agent_ids, called with the SECRET key
--                                (service_role), after verifying the caller's token
--   RLS: same_team_chain is in activities_scoped_select and bff_visible_agent_ids in
--     npo_sales_scoped, both TO authenticated, so authenticated keeps EXECUTE. No policy for
--     anon or public, no column default, check constraint or view uses any of the 25.
--   Everything else is called only from other SECURITY DEFINER functions and triggers
--     (journey_*_trg, class_wait_*_trg, event_invite_*, nl_*, inv_compute, report functions,
--     prospects_page ...), which run as the owner (postgres) and are not affected by grants.
--   No cron job, edge function, diag.html or public page calls any of them.
--
-- After this, a signed-out call to any of the 25 gets 42501 (permission denied).
-- Signed-in calls are unchanged.
--
-- Only grants change, no function body. If any of these is later rebuilt with
-- DROP + CREATE, Supabase's default privileges grant anon EXECUTE again: re-run
-- the revoke for it (CREATE OR REPLACE keeps the grants).
--
-- Not in scope here (signed-in users): purchase_sales_by_day, purchase_category_counts and
-- potential_tier_rates return company-wide figures to ANY signed-in user (the client only hides
-- them from scoped viewers), and authenticated can still call the internal writers
-- (journey_spawn, purge_old_archives, record_audit ...). See the follow-up notes.
--
-- Undo: 2026-11-06_definer_rpcs_revoke_anon_UNDO.sql

begin;

-- Read leaks
revoke all on function public.purchase_sales_by_day(date, date) from public, anon;
grant execute on function public.purchase_sales_by_day(date, date) to authenticated, service_role;

revoke all on function public.purchase_category_counts(date, date) from public, anon;
grant execute on function public.purchase_category_counts(date, date) to authenticated, service_role;

revoke all on function public.potential_tier_rates() from public, anon;
grant execute on function public.potential_tier_rates() to authenticated, service_role;

revoke all on function public.class_wait_entries_for(bigint) from public, anon;
grant execute on function public.class_wait_entries_for(bigint) to authenticated, service_role;

revoke all on function public.crm_nav_predictions(integer, integer, integer) from public, anon;
grant execute on function public.crm_nav_predictions(integer, integer, integer) to authenticated, service_role;

revoke all on function public.bff_visible_agent_ids(uuid) from public, anon;
grant execute on function public.bff_visible_agent_ids(uuid) to authenticated, service_role;

-- Small lookups by id (internal helpers)
revoke all on function public.journey_customer_of(bigint, bigint) from public, anon;
grant execute on function public.journey_customer_of(bigint, bigint) to authenticated, service_role;

revoke all on function public.inv_person_key(text, bigint) from public, anon;
grant execute on function public.inv_person_key(text, bigint) to authenticated, service_role;

revoke all on function public.is_anc_or_self(bigint, bigint) from public, anon;
grant execute on function public.is_anc_or_self(bigint, bigint) to authenticated, service_role;

revoke all on function public.same_team_chain(bigint, bigint) from public, anon;
grant execute on function public.same_team_chain(bigint, bigint) to authenticated, service_role;

revoke all on function public.inv_cfg() from public, anon;
grant execute on function public.inv_cfg() to authenticated, service_role;

revoke all on function public.event_cats(bigint) from public, anon;
grant execute on function public.event_cats(bigint) to authenticated, service_role;

revoke all on function public.inv_line_kw(text) from public, anon;
grant execute on function public.inv_line_kw(text) to authenticated, service_role;

revoke all on function public.bjc_resolve(text) from public, anon;
grant execute on function public.bjc_resolve(text) to authenticated, service_role;

revoke all on function public.delivery_advance_allowed(text) from public, anon;
grant execute on function public.delivery_advance_allowed(text) to authenticated, service_role;

revoke all on function public.journey_item_profile(text) from public, anon;
grant execute on function public.journey_item_profile(text) to authenticated, service_role;

-- Writes with no caller check
revoke all on function public.journey_spawn(bigint, bigint, text, date, bigint, text, bigint, bigint, text[]) from public, anon;
grant execute on function public.journey_spawn(bigint, bigint, text, date, bigint, text, bigint, bigint, text[]) to authenticated, service_role;

revoke all on function public.journey_pr_sync(bigint) from public, anon;
grant execute on function public.journey_pr_sync(bigint) to authenticated, service_role;

revoke all on function public.journey_sale_sync(bigint) from public, anon;
grant execute on function public.journey_sale_sync(bigint) to authenticated, service_role;

revoke all on function public.journey_item_sync(bigint) from public, anon;
grant execute on function public.journey_item_sync(bigint) to authenticated, service_role;

revoke all on function public.journey_gr_spawn(bigint) from public, anon;
grant execute on function public.journey_gr_spawn(bigint) to authenticated, service_role;

revoke all on function public.class_wait_task(bigint, bigint) from public, anon;
grant execute on function public.class_wait_task(bigint, bigint) to authenticated, service_role;

revoke all on function public.next_evoucher_number() from public, anon;
grant execute on function public.next_evoucher_number() to authenticated, service_role;

revoke all on function public.record_audit(text, text, text, text, jsonb) from public, anon;
grant execute on function public.record_audit(text, text, text, text, jsonb) to authenticated, service_role;

revoke all on function public.purge_old_archives(integer) from public, anon;
grant execute on function public.purge_old_archives(integer) to authenticated, service_role;

commit;

-- Check 1 (expect 25 rows, anon_exec = false, auth_exec = true, svc_exec = true):
-- select p.oid::regprocedure, has_function_privilege('anon', p.oid, 'EXECUTE') anon_exec,
--        has_function_privilege('authenticated', p.oid, 'EXECUTE') auth_exec,
--        has_function_privilege('service_role', p.oid, 'EXECUTE') svc_exec
-- from pg_proc p join pg_namespace n on n.oid = p.pronamespace
-- where n.nspname = 'public' and p.proname in ('purchase_sales_by_day','purchase_category_counts',
--   'potential_tier_rates','class_wait_entries_for','crm_nav_predictions','bff_visible_agent_ids',
--   'journey_customer_of','inv_person_key','is_anc_or_self','same_team_chain','inv_cfg','event_cats',
--   'inv_line_kw','bjc_resolve','delivery_advance_allowed','journey_item_profile','journey_spawn',
--   'journey_pr_sync','journey_sale_sync','journey_item_sync','journey_gr_spawn','class_wait_task',
--   'next_evoucher_number','record_audit','purge_old_archives');
--
-- Check 2 (expect exactly the 2 (a) + 18 (b) functions above, plus rls_auto_enable):
-- select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid = p.pronamespace
-- where n.nspname = 'public' and p.prosecdef and has_function_privilege('anon', p.oid, 'EXECUTE')
--   and pg_get_function_result(p.oid) <> 'trigger' order by 1;
