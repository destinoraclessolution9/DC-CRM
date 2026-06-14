-- Phase 1 (#12) — agent leaderboard sales aggregation. Additive (pre-authorized).
--
-- renderAgentLeaderboard (chunks/script-reporting.js) did getAll('purchases')
-- and summed per agent client-side. TWO problems:
--   1) SCALE: downloads the whole purchases table on every reporting render.
--   2) BUG (pre-existing): it matched `p.agent_id === agent.id`, but purchases
--      has NO agent_id column — so every agent's sales was always 0 and the
--      leaderboard showed "No agent data" / all-zero in production. The correct
--      agent for a purchase is its customer's responsible_agent_id (same rule
--      as _getPurchaseAgentId / the kpi_purchase_summary RPC).
--
-- This RPC sums each agent's purchase amounts for a current and a previous
-- period in one grouped pass, resolving the agent via customers. The isAgent
-- band + role stay client-side (the client filters its agent list, then looks
-- up each agent's sales here). Visibility scope IS applied server-side via
-- p_agent_ids (null = unrestricted, admin/manager) so a non-admin can't pull
-- every agent's sales by calling the RPC directly — matching the leaderboard's
-- own _visibleUserIds display scope. No is_agent_package exclusion — the
-- leaderboard never had one (agent-self packages without a customer link drop
-- out of the join naturally).

-- Replace any prior unscoped overload (a 4-arg version applied earlier in this
-- session lacked the scope param). Dropping it keeps a single canonical
-- signature so the unqualified GRANT below — and PostgREST resolution — stays
-- unambiguous.
drop function if exists public.agent_sales_by_period(date, date, date, date);

create or replace function public.agent_sales_by_period(
  p_cur_from  date,
  p_cur_to    date,
  p_prev_from date,
  p_prev_to   date,
  p_agent_ids bigint[] default null   -- null = unrestricted (admin/manager)
)
returns table (agent_id bigint, current_sales numeric, prev_sales numeric)
language sql
security definer
set search_path = public
as $$
  select
    c.responsible_agent_id as agent_id,
    coalesce(sum(p.amount) filter (where p.date >= p_cur_from  and p.date <= p_cur_to),  0) as current_sales,
    coalesce(sum(p.amount) filter (where p.date >= p_prev_from and p.date <= p_prev_to), 0) as prev_sales
  from purchases p
  join customers c on c.id = p.customer_id
  where c.responsible_agent_id is not null
    and (p_agent_ids is null or c.responsible_agent_id = any(p_agent_ids))
    and (
      (p.date >= p_cur_from  and p.date <= p_cur_to) or
      (p.date >= p_prev_from and p.date <= p_prev_to)
    )
  group by c.responsible_agent_id;
$$;

grant execute on function public.agent_sales_by_period(date, date, date, date, bigint[]) to authenticated;
