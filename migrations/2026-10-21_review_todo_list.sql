-- 📋 To-do list behind a Monthly Review cell (2026-10-21): the same rows each
-- agent sees as "Today's top 5", for one agent or a whole team, limited to
-- the people the viewer may see (pop_scope_ids: company / team tree / own).
create or replace function public.journey_todo_list(p_uids bigint[], p_limit integer default 50)
returns table (agent_id bigint, kind text, icon text, prospect_id bigint, customer_id bigint, name text,
               why text, rm numeric, due date, score numeric, ref_id bigint)
language sql stable security definer set search_path = public as $$
    select u.id, t.kind, t.icon, t.prospect_id, t.customer_id, t.name, t.why, t.rm, t.due, t.score, t.ref_id
      from unnest(p_uids) u(id)
      cross join lateral public.journey_todo_for(u.id, greatest(coalesce(p_limit, 50), 1)) t
     where u.id in (select public.pop_scope_ids())
     order by t.score desc
     limit greatest(coalesce(p_limit, 50), 1) * 2
$$;
revoke all on function public.journey_todo_list(bigint[], integer) from public, anon;
grant execute on function public.journey_todo_list(bigint[], integer) to authenticated;
