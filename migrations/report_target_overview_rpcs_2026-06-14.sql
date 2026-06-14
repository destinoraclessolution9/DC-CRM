-- Phase 1 (#12) — renderTargetOverview purchase aggregations. Additive.
-- Removes the cached getAll('purchases') from the Target Overview tab by serving
-- its sales charts + product-category breakdown server-side.

-- (A) Daily non-agent-package sales totals in [from,to] (inclusive). The client
--     charts (weekly day-of-week, monthly, quarterly, custom per-day) all sum
--     `date in range && !is_agent_package` and bucket by a time unit — so one
--     per-day total lets the client bucket however it likes. Excludes null-date
--     (the chart code can't bucket a null date; the client filters them out via
--     `date >= from` / would throw on `date.startsWith`).
create or replace function public.purchase_sales_by_day(
  p_from date, p_to date
)
returns table (sale_date date, total numeric)
language sql security definer set search_path = public
as $$
  select p.date as sale_date, coalesce(sum(p.amount), 0) as total
  from purchases p
  where p.date >= p_from and p.date <= p_to
    and coalesce(p.is_agent_package, false) = false
  group by p.date
  order by p.date;
$$;

-- (B) Product-category case counts in [from,to], by keyword match on item.
--     Mirrors getCaseCountsByProduct EXACTLY: priority order (first match wins,
--     in the SAME order as the client's keywordMap), case-insensitive substring,
--     NO is_agent_package filter. NULL-date kept (client date check fails open
--     for null, so null-date purchases are categorized in every range — matches
--     the purchase drill-down null-date parity the user chose to leave as-is).
--     The client's agent filter is a dead path (purchases has no agent_id), so
--     the caller only invokes this when _currentAgentFilter = 'all'.
create or replace function public.purchase_category_counts(
  p_from date, p_to date
)
returns table (category text, cnt bigint)
language sql security definer set search_path = public
as $$
  with cat as (
    select case
      when lower(coalesce(item,'')) like '%feng shui%' or lower(coalesce(item,'')) like '%fengshui%' then 'FengShui'
      when lower(coalesce(item,'')) like '%flexi%' or lower(coalesce(item,'')) like '%flexible feng shui%' then 'Flexi FengShui'
      when lower(coalesce(item,'')) like '%simplified%' or lower(coalesce(item,'')) like '%simple feng shui%' then 'Simplified Feng Shui'
      when lower(coalesce(item,'')) like '%power ring%' or lower(coalesce(item,'')) like '%pr4%' or lower(coalesce(item,'')) like '%pr3%' or lower(coalesce(item,'')) like '%pr5%' then 'Power Ring'
      when lower(coalesce(item,'')) like '%calligraphy%' then 'Calligraphy'
      when lower(coalesce(item,'')) like '%adornment%' or lower(coalesce(item,'')) like '%decoration%' then 'Adornment'
      when lower(coalesce(item,'')) like '%royal woodwork%' or lower(coalesce(item,'')) like '%woodwork%' then 'Royal Woodwork'
      when lower(coalesce(item,'')) like '%course%' or lower(coalesce(item,'')) like '%workshop%' or lower(coalesce(item,'')) like '%seminar%' then 'Courses'
      when lower(coalesce(item,'')) like '%book%' or lower(coalesce(item,'')) like '%publication%' then 'Book'
      else null
    end as category
    from purchases p
    where (p.date is null or (p.date >= p_from and p.date <= p_to))
  )
  select category, count(*) as cnt
  from cat
  where category is not null
  group by category;
$$;

grant execute on function public.purchase_sales_by_day(date, date) to authenticated;
grant execute on function public.purchase_category_counts(date, date) to authenticated;
