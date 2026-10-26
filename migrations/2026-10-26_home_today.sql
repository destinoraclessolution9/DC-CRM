-- Mobile Home "Today" redesign (2026-10-26, owner):
--   1. home_goal(): the goal line — this month's sales against the goal, with
--      the same rules as the Pipeline Goal Bar (purchases by date + frozen
--      agent_id, cancelled/refunded/void and RM0 rows excluded; goals from
--      pipeline_goals, defaults agent RM100k, team leader RM500k for the whole
--      reporting tree incl. the leader). Leaders get their own line too
--      (default RM100k, as approved); L1–L2 get the company line.
--   2. Birthday wishes more than a day late are dropped (expired) — they were
--      30 of the 33 open follow-ups. expire_old_follow_up_drafts already runs
--      nightly (cron expire-old-drafts); it now also does this.

create or replace function public.home_goal()
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
    v_uid   bigint := public.current_user_row_id();
    v_today date := public.journey_today();
    v_month text := to_char(v_today, 'YYYY-MM');
    v_lvl   int;
    v_out   jsonb := jsonb_build_object('month', v_month);
    v_won   numeric; v_n int; v_target numeric;
begin
    if v_uid is null then return v_out; end if;
    select coalesce(role_level, 99) into v_lvl from public.users where id = v_uid;

    -- my own sales
    select coalesce(sum(p.amount), 0), count(*) into v_won, v_n
      from public.purchases p
     where p.agent_id = v_uid and to_char(p.date::date, 'YYYY-MM') = v_month
       and coalesce(p.status, '') !~* 'cancel|refund|void' and coalesce(p.amount, 0) > 0;
    select g.target_amount into v_target from public.pipeline_goals g
     where g.user_id = v_uid and g.month = v_month and g.scope = 'personal';
    if v_target is null and v_lvl between 3 and 12 then v_target := 100000; end if;
    v_out := v_out || jsonb_build_object('me', jsonb_build_object('won', v_won, 'n', v_n, 'target', v_target));

    if v_lvl between 3 and 5 then
        -- my whole reporting tree (me included)
        with recursive tree(id) as (
            select v_uid
            union
            select u.id from public.users u join tree t on u.reporting_to = t.id
        )
        select coalesce(sum(p.amount), 0), count(*) into v_won, v_n
          from public.purchases p
         where p.agent_id in (select id from tree) and to_char(p.date::date, 'YYYY-MM') = v_month
           and coalesce(p.status, '') !~* 'cancel|refund|void' and coalesce(p.amount, 0) > 0;
        select coalesce((select g.target_amount from public.pipeline_goals g
                          where g.user_id = v_uid and g.month = v_month and g.scope = 'team'), 500000) into v_target;
        v_out := v_out || jsonb_build_object('team', jsonb_build_object('won', v_won, 'n', v_n, 'target', v_target));
    elsif v_lvl <= 2 then
        -- company: every sale; goal = the top-level teams' goals
        select coalesce(sum(p.amount), 0), count(*) into v_won, v_n
          from public.purchases p
         where to_char(p.date::date, 'YYYY-MM') = v_month
           and coalesce(p.status, '') !~* 'cancel|refund|void' and coalesce(p.amount, 0) > 0;
        with leaders as (
            select u.id, u.reporting_to from public.users u
             where u.role_level between 3 and 5 and coalesce(u.status, 'active') !~* 'inactive|deleted|resign|terminat'
        ), tops as (
            select l.id from leaders l
             where not exists (
                with recursive up(id, depth) as (
                    select l.reporting_to, 1
                    union all
                    select u.reporting_to, up.depth + 1 from public.users u join up on u.id = up.id where up.depth < 20
                )
                select 1 from up join leaders l2 on l2.id = up.id)
        )
        select coalesce(sum(coalesce((select g.target_amount from public.pipeline_goals g
                                       where g.user_id = t.id and g.month = v_month and g.scope = 'team'), 500000)), 0)
          into v_target from tops t;
        v_out := v_out || jsonb_build_object('company', jsonb_build_object('won', v_won, 'n', v_n, 'target', nullif(v_target, 0)));
    end if;
    return v_out;
end $$;
revoke all on function public.home_goal() from public, anon;
grant execute on function public.home_goal() to authenticated;

create or replace function public.expire_old_follow_up_drafts()
 returns integer
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare v_today date := (now() at time zone 'Asia/Kuala_Lumpur')::date; v_n int;
begin
    update public.follow_up_drafts set status = 'expired', updated_at = now()
     where status = 'pending'
       and (due_date < v_today - 14
            or (event_date is not null and event_date < v_today)
            -- a birthday wish is only worth sending on the day / the day after
            or (trigger_type = 'birthday' and due_date < v_today - 1));
    get diagnostics v_n = row_count;
    return v_n;
end $function$;

-- clear the late ones now (the nightly job keeps it clean from here)
select public.expire_old_follow_up_drafts();
