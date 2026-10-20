-- 📊 Monthly review "⏰ overdue" counts only rows with a real deadline
-- (collection ready date, Golden Road session, journey step, POP charge,
-- stock return). "book" / "cps" rows carry the last-met / CPS date, which is
-- not a deadline, so they never count as overdue.
create or replace function public.journey_todo_counts(p_uids bigint[])
returns table (agent_id bigint, todo_n integer, overdue_n integer, last_activity date)
language sql stable security definer set search_path = public as $$
    with t as (select (now() at time zone 'Asia/Kuala_Lumpur')::date d),
    u as (select x.id from unnest(p_uids) x(id) where x.id in (select public.pop_scope_ids()))
    select u.id,
           (select count(*) from public.journey_todo_for(u.id, 200))::int,
           (select count(*) from public.journey_todo_for(u.id, 200) j cross join t
             where j.due < t.d and j.kind in ('collect', 'gr', 'touch', 'pop', 'advance'))::int,
           (select max(a.activity_date) from public.activities a cross join t
             where a.lead_agent_id = u.id and a.activity_date <= t.d
               and a.activity_type not in ('PERSONAL', 'AGENT_MEETING'))
      from u
$$;
revoke all on function public.journey_todo_counts(bigint[]) from public, anon;
grant execute on function public.journey_todo_counts(bigint[]) to authenticated;
