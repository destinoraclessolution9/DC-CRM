-- ═══════════════════════════════════════════════════════════════════════════
-- Monthly Review scoreboard (2026-10-20)
--
-- journey_todo_counts(uids)  per agent: 📋 to-do items, how many are overdue,
--                            and the last activity date — one call for the
--                            whole scoreboard (only people the viewer may see)
-- queue_pipeline_weekly_push team leaders' Monday push now also says how many
--                            of their agents have no deal this month and who
--                            is furthest behind their RM100k
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function public.journey_todo_counts(p_uids bigint[])
returns table (agent_id bigint, todo_n integer, overdue_n integer, last_activity date)
language sql stable security definer set search_path = public as $$
    with t as (select (now() at time zone 'Asia/Kuala_Lumpur')::date d),
    u as (select x.id from unnest(p_uids) x(id) where x.id in (select public.pop_scope_ids()))
    select u.id,
           (select count(*) from public.journey_todo_for(u.id, 200))::int,
           (select count(*) from public.journey_todo_for(u.id, 200) j cross join t where j.due < t.d)::int,
           (select max(a.activity_date) from public.activities a cross join t
             where a.lead_agent_id = u.id and a.activity_date <= t.d
               and a.activity_type not in ('PERSONAL', 'AGENT_MEETING'))
      from u
$$;
revoke all on function public.journey_todo_counts(bigint[]) from public, anon;
grant execute on function public.journey_todo_counts(bigint[]) to authenticated;

create or replace function public.queue_pipeline_weekly_push() returns integer
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    v_today date := (now() at time zone 'Asia/Kuala_Lumpur')::date;
    v_month text := to_char(v_today, 'YYYY-MM');
    v_end   date := (date_trunc('month', v_today) + interval '1 month - 1 day')::date;
    v_n     integer;
begin
    insert into public.notification_outbox (user_id, kind, priority, title, body, url, dedupe_key, due_at)
    select s.user_id, 'pipeline_weekly', 'normal',
           '🎯 ' || s.lbl || ': RM' || round(s.won / 1000) || 'k of RM' || round(s.goal / 1000) || 'k',
           case when s.goal - s.won <= 0 then 'Goal reached 🎉 keep closing'
                when s.pipe = 0 then 'No deals closing this month · add deals'
                else 'Pipeline ' || to_char(s.pipe / greatest(s.goal - s.won, 1), 'FM990.0') || '× (need 3×)'
           end
           || case when s.idle > 0 then ' · ' || s.idle || ' idle deal' || case when s.idle = 1 then '' else 's' end else '' end
           || coalesce(' · ' || nullif(s.no_deal, 0) || ' agent' || case when s.no_deal = 1 then '' else 's' end || ' no deals', '')
           || coalesce(' · behind most: ' || s.behind, ''),
           './index.html#pipeline',
           'pipeline_weekly:' || v_today,
           now()
      from (
        select u.id as user_id,
               case when u.role_level between 3 and 5 then 'Team' else 'You' end as lbl,
               coalesce(g.target_amount, case when u.role_level between 3 and 5 then 500000 else 100000 end) as goal,
               coalesce((select sum(p.amount) from public.purchases p
                          where p.agent_id in (select public.pipeline_tree_ids(u.id, u.role_level between 3 and 5))
                            and left(p.date::text, 7) = v_month
                            and coalesce(p.status, '') !~* 'cancel|refund|void' and p.amount > 0), 0) as won,
               coalesce((select sum(d.amount) from public.pipeline_deals d
                          where d.agent_id in (select public.pipeline_tree_ids(u.id, u.role_level between 3 and 5))
                            and d.stage in ('interested','proposal','prescribed','closing')
                            and d.expected_close_date <= v_end), 0) as pipe,
               (select count(*) from public.pipeline_deals d left join public.prospects pr on pr.id = d.prospect_id
                 where d.agent_id in (select public.pipeline_tree_ids(u.id, u.role_level between 3 and 5))
                   and d.stage in ('interested','proposal','prescribed','closing')
                   and greatest(d.updated_at, coalesce(pr.last_activity_date::timestamptz, d.updated_at)) < now() - interval '14 days') as idle,
               -- leaders only: agents (L6–12) in the tree with no deal closing this month
               case when u.role_level between 3 and 5 then
                   (select count(*) from public.users a
                     where a.id in (select public.pipeline_tree_ids(u.id, true)) and a.id <> u.id
                       and a.role_level between 6 and 12
                       and coalesce(a.status, 'active') !~* 'inactive|deleted|resign|terminat'
                       and not exists (select 1 from public.pipeline_deals d where d.agent_id = a.id
                                        and d.stage in ('interested','proposal','prescribed','closing') and d.expected_close_date <= v_end))
               end as no_deal,
               case when u.role_level between 3 and 5 then
                   (select a.full_name || ' (RM' || round(greatest(100000 - coalesce(w.rm, 0), 0) / 1000) || 'k to go)'
                      from public.users a
                      left join lateral (select sum(p.amount) rm from public.purchases p
                                          where p.agent_id = a.id and left(p.date::text, 7) = v_month
                                            and coalesce(p.status, '') !~* 'cancel|refund|void' and p.amount > 0) w on true
                     where a.id in (select public.pipeline_tree_ids(u.id, true)) and a.id <> u.id
                       and a.role_level between 6 and 12
                       and coalesce(a.status, 'active') !~* 'inactive|deleted|resign|terminat'
                     order by coalesce(w.rm, 0) asc,
                              (select count(*) from public.pipeline_deals d where d.agent_id = a.id
                                and d.stage in ('interested','proposal','prescribed','closing') and d.expected_close_date <= v_end) asc,
                              a.full_name
                     limit 1)
               end as behind
          from public.users u
          left join public.pipeline_goals g
                 on g.user_id = u.id and g.month = v_month
                and g.scope = case when u.role_level between 3 and 5 then 'team' else 'personal' end
         where u.role_level between 3 and 12
           and coalesce(u.status, 'active') !~* 'inactive|deleted|resign|terminat'
      ) s
    on conflict (user_id, dedupe_key) do nothing;
    get diagnostics v_n = row_count;
    return v_n;
end $$;
revoke all on function public.queue_pipeline_weekly_push() from public, anon, authenticated;
