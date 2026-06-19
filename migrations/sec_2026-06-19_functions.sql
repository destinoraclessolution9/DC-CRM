-- =====================================================================
-- SECURITY HARDENING — Phase 1, group A: function hardening
-- Date: 2026-06-19  (applied to live via Management API)
--
-- H3: add SET search_path to the 3 SECURITY DEFINER RLS helpers that lacked it
--     (search_path hijack -> could force current_user_level()=1 everywhere).
-- C2: make scope-parameter SECURITY DEFINER RPCs re-derive the visible-agent
--     scope from auth.uid() for any DIRECT authenticated caller, and trust the
--     caller-supplied p_*agent_ids ONLY when auth.uid() IS NULL (the service-role
--     / BFF path — api/customers.mjs + api/prospects.mjs call with the secret key
--     and pass an already-server-computed scope). This closes the
--     "POST /rpc/prospects_page {p_visible_agent_ids:null}" full-table exfiltration
--     while keeping the BFF working unchanged.
-- =====================================================================

-- ---- H3: search_path on the 3 helpers (additive, body unchanged) -------------
alter function public.current_user_level()        set search_path = public, pg_temp;
alter function public.current_user_row_id()        set search_path = public, pg_temp;
alter function public.current_user_visible_ids()   set search_path = public, pg_temp;

-- ---- C2: prospects_page (plpgsql) -------------------------------------------
create or replace function public.prospects_page(
  p_visible_agent_ids bigint[] default null,
  p_search text default null, p_ming_gua text default null, p_agent_id bigint default null,
  p_include_dormant boolean default false, p_dormant_days integer default 500,
  p_sort text default 'score', p_sort_dir text default 'desc',
  p_limit integer default 50, p_offset integer default 0)
returns table(rows jsonb, total bigint)
language plpgsql security definer set search_path to 'public'
as $function$
declare
  v_cutoff date := (now() at time zone 'Asia/Kuala_Lumpur')::date - p_dormant_days;
  v_scope bigint[];
begin
  -- Re-derive scope for a real end-user; trust the param only for the service-role/BFF path.
  if auth.uid() is null then
    v_scope := p_visible_agent_ids;
  else
    v_scope := public.bff_visible_agent_ids(auth.uid());
  end if;

  return query
  with filtered as (
    select p.*
    from prospects p
    where (v_scope is null or p.responsible_agent_id = any(v_scope))
      and (p_ming_gua is null or p.ming_gua = p_ming_gua)
      and (p_agent_id is null or p.responsible_agent_id = p_agent_id)
      and (
        p_search is null or
        p.full_name ilike '%'||p_search||'%' or
        p.nickname  ilike '%'||p_search||'%' or
        p.phone     ilike '%'||p_search||'%' or
        p.email     ilike '%'||p_search||'%'
      )
      and (
        p_include_dormant
        or p.last_activity_date is null
        or p.last_activity_date >= v_cutoff
      )
  ),
  ordered as (
    select f.*,
      row_number() over (order by
        case when p_sort = 'full_name'          and p_sort_dir = 'asc'  then coalesce(f.full_name, '') end asc,
        case when p_sort = 'full_name'          and p_sort_dir = 'desc' then coalesce(f.full_name, '') end desc,
        case when p_sort = 'score'              and p_sort_dir = 'asc'  then coalesce(f.score, 0) end asc,
        case when p_sort = 'score'              and p_sort_dir = 'desc' then coalesce(f.score, 0) end desc,
        case when p_sort = 'last_activity_date' and p_sort_dir = 'asc'  then coalesce(f.last_activity_date, '0001-01-01') end asc,
        case when p_sort = 'last_activity_date' and p_sort_dir = 'desc' then coalesce(f.last_activity_date, '0001-01-01') end desc,
        f.id desc
      ) as rn,
      count(*) over () as total
    from filtered f
  )
  select
    coalesce(
      jsonb_agg((to_jsonb(o) - 'rn' - 'total') order by o.rn)
        filter (where o.rn > p_offset and o.rn <= p_offset + p_limit),
      '[]'::jsonb
    ),
    coalesce(max(o.total), 0)
  from ordered o;
end;
$function$;

-- ---- C2: report_purchase_details (sql) -------------------------------------
create or replace function public.report_purchase_details(
  p_from date, p_to date, p_agent_ids bigint[] default null, p_role text default null)
returns table(date date, amount numeric, payment_method text, item text, epp_bank text,
  epp_months integer, is_agent_package boolean, responsible_agent_id bigint,
  agent_name text, customer_name text)
language sql security definer set search_path to 'public'
as $function$
  with scope as (
    select case when auth.uid() is null then p_agent_ids
                else public.bff_visible_agent_ids(auth.uid()) end as ids
  )
  select
    p.date, p.amount, p.payment_method, p.item,
    p.epp_bank, p.epp_months, p.is_agent_package,
    c.responsible_agent_id, u.full_name as agent_name, c.full_name as customer_name
  from purchases p
  left join customers c on c.id = p.customer_id
  left join users u     on u.id = c.responsible_agent_id
  where (p.date is null or (p.date >= p_from and p.date <= p_to))
    and ((select ids from scope) is null or c.responsible_agent_id in (select unnest(ids) from scope))
    and (p_role is null or p_role = 'All' or u.role = p_role)
  order by p.date desc nulls last;
$function$;

-- ---- C2: report_activity_details (sql) -------------------------------------
create or replace function public.report_activity_details(
  p_from date, p_to date, p_agent_ids bigint[] default null, p_role text default null,
  p_types text[] default null, p_title_like text default null)
returns table(activity_date date, activity_type text, activity_title text, lead_agent_id bigint,
  agent_name text, customer_id bigint, entity_name text)
language sql security definer set search_path to 'public'
as $function$
  with scope as (
    select case when auth.uid() is null then p_agent_ids
                else public.bff_visible_agent_ids(auth.uid()) end as ids
  )
  select
    a.activity_date, a.activity_type, a.activity_title,
    a.lead_agent_id, u.full_name as agent_name,
    a.customer_id, coalesce(c.full_name, pr.full_name) as entity_name
  from activities a
  left join users u      on u.id  = a.lead_agent_id
  left join customers c  on c.id  = a.customer_id
  left join prospects pr on pr.id = a.prospect_id
  where (a.activity_date is null or (a.activity_date >= p_from and a.activity_date <= p_to))
    and (
      (p_types is not null and a.activity_type = any(p_types))
      or (p_title_like is not null and lower(coalesce(a.activity_title,'')) like p_title_like)
    )
    and ((select ids from scope) is null or a.lead_agent_id in (select unnest(ids) from scope))
    and (p_role is null or p_role = 'All' or u.role = p_role)
  order by a.activity_date desc nulls last;
$function$;

-- ---- C2: agent_sales_by_period (sql) ---------------------------------------
create or replace function public.agent_sales_by_period(
  p_cur_from date, p_cur_to date, p_prev_from date, p_prev_to date, p_agent_ids bigint[] default null)
returns table(agent_id bigint, current_sales numeric, prev_sales numeric)
language sql security definer set search_path to 'public'
as $function$
  with scope as (
    select case when auth.uid() is null then p_agent_ids
                else public.bff_visible_agent_ids(auth.uid()) end as ids
  )
  select
    c.responsible_agent_id as agent_id,
    coalesce(sum(p.amount) filter (where p.date >= p_cur_from  and p.date <= p_cur_to),  0) as current_sales,
    coalesce(sum(p.amount) filter (where p.date >= p_prev_from and p.date <= p_prev_to), 0) as prev_sales
  from purchases p
  join customers c on c.id = p.customer_id
  where c.responsible_agent_id is not null
    and ((select ids from scope) is null or c.responsible_agent_id in (select unnest(ids) from scope))
    and ((p.date >= p_cur_from and p.date <= p_cur_to) or (p.date >= p_prev_from and p.date <= p_prev_to))
  group by c.responsible_agent_id;
$function$;

-- ---- C2: get_conversion_rate (sql) -----------------------------------------
create or replace function public.get_conversion_rate(
  p_from date, p_to date, p_agent_ids bigint[] default null)
returns table(prospect_count bigint, customer_count bigint, conversion_pct integer)
language sql security definer set search_path to 'public'
as $function$
  with scope as (
    select case when auth.uid() is null then p_agent_ids
                else public.bff_visible_agent_ids(auth.uid()) end as ids
  ),
  prosp as (
    select count(*) as n from public.prospects
    where created_at::date >= p_from and created_at::date <= p_to
      and ((select ids from scope) is null or responsible_agent_id in (select unnest(ids) from scope))
  ),
  cust as (
    select count(*) as n from public.customers
    where customer_since >= p_from and customer_since <= p_to
      and ((select ids from scope) is null or responsible_agent_id in (select unnest(ids) from scope))
  )
  select prosp.n, cust.n,
    case when prosp.n = 0 then 0 else round(cust.n::numeric / prosp.n::numeric * 100)::integer end
  from prosp, cust;
$function$;

-- ---- C2: kpi_extended_summary (sql) ----------------------------------------
create or replace function public.kpi_extended_summary(
  p_from date, p_to date, p_agent_ids bigint[] default null, p_role text default null)
returns jsonb
language sql security definer set search_path to 'public'
as $function$
  with scope as (
    select case when auth.uid() is null then p_agent_ids
                else public.bff_visible_agent_ids(auth.uid()) end as ids
  ),
  cutoff as (select ((now() at time zone 'Asia/Kuala_Lumpur')::date - 60) as d),
  meetup as (
    select count(*) c from activities a left join users u on u.id = a.lead_agent_id
    where a.activity_date >= p_from and a.activity_date <= p_to
      and (a.activity_type in ('FTF','FSA') or lower(coalesce(a.activity_title,'')) like '%golden road%')
      and ((select ids from scope) is null or a.lead_agent_id in (select unnest(ids) from scope))
      and (p_role is null or p_role = 'All' or u.role = p_role)
  ),
  cf as (
    select count(distinct a.customer_id) c from activities a left join users u on u.id = a.lead_agent_id
    where a.activity_type = 'CPS' and a.activity_date >= p_from and a.activity_date <= p_to
      and a.customer_id is not null
      and ((select ids from scope) is null or a.lead_agent_id in (select unnest(ids) from scope))
      and (p_role is null or p_role = 'All' or u.role = p_role)
  ),
  ah as (
    select count(*) c
    from event_attendees att
    join activities act on act.id = att.activity_id
    left join customers c  on att.attendee_type = 'customer' and c.id  = coalesce(att.entity_id, att.attendee_id)
    left join prospects pr on att.attendee_type not in ('agent','customer') and pr.id = coalesce(att.entity_id, att.attendee_id)
    where (att.attended is true or att.attendance_status = 'Attended')
      and act.activity_date >= p_from and act.activity_date <= p_to
      and (
        (select ids from scope) is null
        or (case when att.attendee_type = 'agent' then coalesce(att.entity_id, att.attendee_id)
                 when att.attendee_type = 'customer' then c.responsible_agent_id
                 else pr.responsible_agent_id end) in (select unnest(ids) from scope)
      )
  ),
  recent_events as (
    select distinct a.event_id from activities a, cutoff
    where a.activity_type = 'EVENT' and a.event_id is not null and a.activity_date >= cutoff.d
  ),
  active_ids as (
    select a.lead_agent_id as uid from activities a, cutoff
    where a.lead_agent_id is not null and a.activity_date >= cutoff.d
    union
    select ea.entity_id as uid from event_attendees ea
    where ea.attendee_type = 'agent' and ea.entity_id is not null
      and ea.event_id in (select event_id from recent_events)
  ),
  aa as (
    select count(*) c from users u
    where u.role_level between 3 and 12
      and ((select ids from scope) is null or u.id in (select unnest(ids) from scope))
      and u.id in (select uid from active_ids)
  )
  select jsonb_build_object(
    'meet_up_existing',   (select c from meetup),
    'cf_headcount',       (select c from cf),
    'activity_headcount', (select c from ah),
    'active_agents',      (select c from aa)
  );
$function$;
