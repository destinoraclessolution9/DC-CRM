-- Pipeline v8.2 — full sales process automation (2026-10-20). Additive only.
--  1. pipeline_deals.auto_created — draft deals the system adds from warm
--     prospects (client side, after the scoring engine runs). One open auto
--     draft per prospect, enforced by a partial unique index.
--  2. Proposal logged (proposed_solutions INSERT) → that prospect's
--     'interested' deals move to 'proposal'.
--  3. Monday 08:45 MYT goal-check push to every agent / team leader through
--     notification_outbox (dispatched by the existing every-minute job).

alter table public.pipeline_deals add column if not exists auto_created boolean not null default false;
create unique index if not exists pipeline_deals_one_open_auto_per_prospect
    on public.pipeline_deals (prospect_id)
    where auto_created and stage in ('interested','proposal','closing');

create or replace function public.pipeline_deal_on_proposal() returns trigger
language plpgsql security definer set search_path = public as $$
begin
    if new.prospect_id is not null then
        update public.pipeline_deals
           set stage = 'proposal', updated_at = now()
         where prospect_id = new.prospect_id and stage = 'interested';
    end if;
    return new;
exception when others then
    return new; -- never block logging a proposal
end $$;

drop trigger if exists trg_pipeline_deal_on_proposal on public.proposed_solutions;
create trigger trg_pipeline_deal_on_proposal after insert on public.proposed_solutions
    for each row execute function public.pipeline_deal_on_proposal();

-- Self + (for leaders) every descendant via users.reporting_to.
create or replace function public.pipeline_tree_ids(p_uid bigint, p_tree boolean) returns setof bigint
language sql stable security definer set search_path = public as $$
    with recursive t as (
        select p_uid as id
        union
        select c.id from public.users c join t on c.reporting_to = t.id where p_tree
    ) select id from t
$$;
revoke all on function public.pipeline_tree_ids(bigint, boolean) from public, anon, authenticated;

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
           || case when s.idle > 0 then ' · ' || s.idle || ' idle deal' || case when s.idle = 1 then '' else 's' end else '' end,
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
                            and d.stage in ('interested','proposal','closing')
                            and d.expected_close_date <= v_end), 0) as pipe,
               (select count(*) from public.pipeline_deals d left join public.prospects pr on pr.id = d.prospect_id
                 where d.agent_id in (select public.pipeline_tree_ids(u.id, u.role_level between 3 and 5))
                   and d.stage in ('interested','proposal','closing')
                   and greatest(d.updated_at, coalesce(pr.last_activity_date::timestamptz, d.updated_at)) < now() - interval '14 days') as idle
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

-- Monday 08:45 MYT (00:45 UTC).
select cron.unschedule('pipeline-weekly-push') where exists (select 1 from cron.job where jobname = 'pipeline-weekly-push');
select cron.schedule('pipeline-weekly-push', '45 0 * * 1', 'select public.queue_pipeline_weekly_push();');
