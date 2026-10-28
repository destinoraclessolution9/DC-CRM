-- Rollback for 2026-10-28_event_invite_engine.sql. Drops only what that file
-- added; event_attendees rows created by "Coming" stay (they are real RSVPs).
-- The class_wait_invite fix is kept (the old body wrote a column that does not exist).
do $$ begin
    perform cron.unschedule('event-invite-daily') where exists (select 1 from cron.job where jobname = 'event-invite-daily');
end $$;
drop trigger if exists trg_event_invite_attendee on public.event_attendees;
drop function if exists public.event_invite_attendee_trg();
drop function if exists public.event_invite_daily();
drop function if exists public.invite_smart_list(text, text, jsonb, int);
drop function if exists public.event_invite_results(int);
drop function if exists public.event_invite_add(bigint, bigint, bigint);
drop function if exists public.event_invite_act(bigint, text, jsonb);
drop function if exists public.event_invite_set_objectives(bigint, jsonb, int);
drop function if exists public.event_invite_list(bigint);
drop function if exists public.event_invite_refresh(bigint, boolean);
drop function if exists public.inv_can_act(bigint, bigint);
drop function if exists public.inv_compute(jsonb, bigint, text);
drop function if exists public.inv_obj_keys(jsonb);
drop function if exists public.inv_cfg();
drop function if exists public.inv_person_key(text, bigint);
drop function if exists public.inv_line_kw(text);
drop function if exists public.inv_product_head(text);
drop function if exists public.inv_hit(text, text[]);
drop table if exists public.event_invite_runs;
drop table if exists public.event_invites;
drop table if exists public.invite_config;
drop table if exists public.invite_lines;
drop index if exists public.jt_invite;
alter table public.journey_touchpoints drop column if exists source_invite_id;
alter table public.events drop column if exists invite_objectives;
alter table public.events drop column if exists invite_slots;
alter table public.prospects drop column if exists do_not_invite;
alter table public.prospects drop column if exists prefers_call;
alter table public.customers drop column if exists do_not_invite;
alter table public.customers drop column if exists prefers_call;
update public.follow_up_templates set is_active = true
 where trigger_type in ('cps_fengshui_plan', 'cps_power_ring', 'cps_painting', 'cps_agent_package', 'cps_bujishu', 'cps_formula')
   and event_keywords like '%???%';
