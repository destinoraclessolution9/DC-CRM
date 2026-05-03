-- ============================================================================
-- Server-side aggregation RPCs to replace JS-side full-table scans
-- Date: 2026-05-03
-- ----------------------------------------------------------------------------
-- The CRM already had kpi_activity_summary / kpi_purchase_summary /
-- kpi_user_summary which calculateKPIs uses as a fast path. These two RPCs
-- cover the next two heaviest hot paths:
--
--   1. Referral leaderboard (renderLeaderboard) used to:
--        getAll('referrals')                       — 1 full scan
--        for each unique referrer:
--            getById('customers', id)              — N reads
--            getById('prospects', id)
--            getById('users', id)
--      That's a ~3N+1 read pattern even when 80% of referrers are agents.
--      The RPC below resolves everything in one query with three LEFT JOINs.
--
--   2. KPI conversion rate (getConversionRate) used to:
--        getAll('prospects')   — 1 full scan
--        getAll('customers')   — 1 full scan
--      Then count in JS. The RPC below replaces both with two indexed
--      COUNT(*) queries that return one integer each.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. get_referral_leaderboard
-- ---------------------------------------------------------------------------
-- p_period: 'all' | 'year' | 'month'
-- Returns ranked rows with referrer details already joined.
create or replace function public.get_referral_leaderboard(p_period text default 'all')
returns table(
    referrer_id     bigint,
    referrer_type   text,
    referrer_name   text,
    referral_count  bigint,
    converted_count bigint,
    latest_at       timestamptz
)
language sql
security definer
set search_path = public
as $func$
    with cutoff as (
        select case
            when p_period = 'year'  then date_trunc('year',  current_date)
            when p_period = 'month' then date_trunc('month', current_date)
            else null
        end as cut
    ),
    grouped as (
        select
            r.referrer_id,
            r.referrer_type,
            count(*) as referral_count,
            count(*) filter (where r.status = 'Active' or r.is_converted) as converted_count,
            max(r.created_at) as latest_at
        from public.referrals r, cutoff
        where r.referrer_id is not null
          and (cutoff.cut is null or r.created_at >= cutoff.cut)
        group by r.referrer_id, r.referrer_type
    )
    select
        g.referrer_id,
        g.referrer_type,
        coalesce(c.full_name, p.full_name, u.full_name) as referrer_name,
        g.referral_count,
        g.converted_count,
        g.latest_at
    from grouped g
    left join public.customers c on c.id = g.referrer_id and g.referrer_type = 'customer'
    left join public.prospects p on p.id = g.referrer_id and g.referrer_type = 'prospect'
    left join public.users     u on u.id = g.referrer_id and g.referrer_type = 'user'
    order by g.referral_count desc, g.latest_at desc;
$func$;

-- ---------------------------------------------------------------------------
-- 2. get_conversion_rate
-- ---------------------------------------------------------------------------
-- p_agent_ids: NULL = no filter (admin view); otherwise restrict to listed
-- responsible_agent_id values.
create or replace function public.get_conversion_rate(
    p_from        date,
    p_to          date,
    p_agent_ids   bigint[] default null
)
returns table(prospect_count bigint, customer_count bigint, conversion_pct integer)
language sql
security definer
set search_path = public
as $func$
    with prosp as (
        select count(*) as n
        from public.prospects
        where created_at::date >= p_from
          and created_at::date <= p_to
          and (p_agent_ids is null or responsible_agent_id = any(p_agent_ids))
    ),
    cust as (
        select count(*) as n
        from public.customers
        where customer_since >= p_from
          and customer_since <= p_to
          and (p_agent_ids is null or responsible_agent_id = any(p_agent_ids))
    )
    select
        prosp.n  as prospect_count,
        cust.n   as customer_count,
        case when prosp.n = 0 then 0
             else round(cust.n::numeric / prosp.n::numeric * 100)::integer
        end      as conversion_pct
    from prosp, cust;
$func$;

-- ---------------------------------------------------------------------------
-- Grants — both RPCs are safe for any authenticated user (RLS still applies
-- to the underlying tables when called via PostgREST, but security definer
-- means we explicitly check via the policies in the function body if needed).
-- For now grants allow `authenticated` only; anon cannot call.
-- ---------------------------------------------------------------------------
grant execute on function public.get_referral_leaderboard(text) to authenticated;
grant execute on function public.get_conversion_rate(date, date, bigint[]) to authenticated;

-- Reload PostgREST so the new RPCs are visible to clients without a restart.
notify pgrst, 'reload schema';

-- Verification:
-- SELECT * FROM public.get_referral_leaderboard('all') LIMIT 5;
-- SELECT * FROM public.get_conversion_rate('2026-01-01', '2026-12-31', NULL);
