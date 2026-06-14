-- Phase 1 (#12) — purchase drill-down detail rows. Additive (pre-authorized).
--
-- The three purchase KPI drill-downs (buildTotalSalesDetails / buildPOPDetails /
-- buildEPPCasesDetails in chunks/script-reporting.js) each do
-- getAll('purchases') + getAll('customers') [+ users] on click, then filter
-- client-side. This RPC returns ONLY the period + scope + role purchase rows
-- (joined with the resolved agent + customer names) in one call; each client
-- builder then sub-filters (total = NOT is_agent_package; POP/EPP = by
-- payment_method) and formats. Same customer-resolved-agent scope/role rule as
-- kpi_purchase_summary (purchases has no agent_id — agent = customer's
-- responsible_agent_id).
--
-- Returns ALL period+scope+role rows (incl. agent packages) — the builders apply
-- their own sub-filter, exactly as today. p_agent_ids NULL = unrestricted;
-- p_role NULL/'All' = no role filter. NULL-agent rows are kept when unrestricted
-- and dropped when scoped (parity with the client's String(agentId) miss).
--
-- NULL-date parity (deliberate): the client builders use `p.date < from ||
-- p.date > to` which, for a NULL date in JS, is false on both sides — so
-- null-date purchases are NOT skipped and appear in the drill-down for EVERY
-- period. We replicate that with `(p.date is null or p.date between ...)` so the
-- migration is behavior-preserving. NOTE: this means the Total-Sales DRILL-DOWN
-- includes null-date sales (RM 177,250 over 13 rows on 2026-06-14) that the KPI
-- CARD (kpi_purchase_summary, which excludes null dates) does NOT — a
-- PRE-EXISTING card-vs-drilldown inconsistency. The real fix is data hygiene
-- (assign dates to those purchases); flagged to the user, not silently changed.

create or replace function public.report_purchase_details(
  p_from      date,
  p_to        date,
  p_agent_ids bigint[] default null,
  p_role      text     default null
)
returns table (
  date                 date,
  amount               numeric,
  payment_method       text,
  item                 text,
  epp_bank             text,
  epp_months           integer,
  is_agent_package     boolean,
  responsible_agent_id bigint,
  agent_name           text,
  customer_name        text
)
language sql
security definer
set search_path = public
as $$
  select
    p.date, p.amount, p.payment_method, p.item,
    p.epp_bank, p.epp_months, p.is_agent_package,
    c.responsible_agent_id,
    u.full_name as agent_name,
    c.full_name as customer_name
  from purchases p
  left join customers c on c.id = p.customer_id
  left join users u     on u.id = c.responsible_agent_id
  where (p.date is null or (p.date >= p_from and p.date <= p_to))
    and (p_agent_ids is null or c.responsible_agent_id = any(p_agent_ids))
    and (p_role is null or p_role = 'All' or u.role = p_role)
  order by p.date desc nulls last;
$$;

grant execute on function public.report_purchase_details(date, date, bigint[], text) to authenticated;
