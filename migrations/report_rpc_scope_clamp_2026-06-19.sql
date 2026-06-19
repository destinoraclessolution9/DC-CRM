-- ============================================================================
-- report_rpc_scope_clamp_2026-06-19.sql  (Phase 1, finding #1 -- server side)
-- Closes the cross-agent reporting leak on the 8 report RPCs that still TRUSTED
-- the client-supplied p_agent_ids. Mirrors the canonical hardening already live
-- on get_conversion_rate / kpi_extended_summary / agent_sales_by_period /
-- report_activity_details / report_purchase_details:
--   authenticated caller                     -> scope forced to bff_visible_agent_ids(auth.uid())
--   service_role / BFF (auth.uid() IS NULL)  -> trust caller-supplied param
-- Implemented as a helper so every predicate form is handled uniformly by a
-- single textual substitution: p_agent_ids -> public.report_scope_ids(p_agent_ids)
-- ADDITIVE / non-destructive: CREATE OR REPLACE only; signatures unchanged.
-- ============================================================================

create or replace function public.report_scope_ids(p_agent_ids bigint[])
returns bigint[]
language sql
security definer
stable
set search_path to 'public'
as $function$
  select case when auth.uid() is null then p_agent_ids
              else public.bff_visible_agent_ids(auth.uid()) end;
$function$;

grant execute on function public.report_scope_ids(bigint[]) to authenticated, anon, service_role;

-- ---- agent_last_activity_60d(bigint[])  (2 predicate refs scoped) ----
CREATE OR REPLACE FUNCTION public.agent_last_activity_60d(p_agent_ids bigint[] DEFAULT NULL::bigint[])
 RETURNS TABLE(agent_id bigint, last_date date)
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  with cutoff as (select ((now() at time zone 'Asia/Kuala_Lumpur')::date - 60) d),
  recent_events as (
    select distinct a.event_id from activities a, cutoff
    where a.activity_type = 'EVENT' and a.event_id is not null and a.activity_date >= cutoff.d
  ),
  act as (
    select a.lead_agent_id aid, max(a.activity_date) ld
    from activities a, cutoff
    where a.lead_agent_id is not null and a.activity_date >= cutoff.d
    group by a.lead_agent_id
  ),
  evt as (
    select distinct ea.entity_id aid
    from event_attendees ea
    where ea.attendee_type = 'agent' and ea.entity_id is not null
      and ea.event_id in (select event_id from recent_events)
  ),
  merged as (
    select coalesce(a.aid, e.aid) aid, coalesce(a.ld, (select d from cutoff)) ld
    from act a full outer join evt e on e.aid = a.aid
  )
  select aid, ld from merged
  where public.report_scope_ids(p_agent_ids) is null or aid = any(public.report_scope_ids(p_agent_ids));
$function$;

-- ---- kpi_activity_summary(date,date,bigint[],text)  (2 predicate refs scoped) ----
CREATE OR REPLACE FUNCTION public.kpi_activity_summary(p_from date, p_to date, p_agent_ids bigint[] DEFAULT NULL::bigint[], p_role text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
AS $function$
    WITH filtered AS (
        SELECT a.activity_type
        FROM public.activities a
        LEFT JOIN public.users u ON u.id = a.lead_agent_id
        WHERE a.activity_date BETWEEN p_from AND p_to
          AND (public.report_scope_ids(p_agent_ids) IS NULL OR a.lead_agent_id = ANY(public.report_scope_ids(p_agent_ids)))
          AND (p_role IS NULL OR p_role = 'All' OR u.role = p_role)
    )
    SELECT jsonb_build_object(
        'cps_count',         (SELECT COUNT(*) FROM filtered WHERE activity_type = 'CPS'),
        'total_meetings',    (SELECT COUNT(*) FROM filtered WHERE activity_type IN ('EVENT','AGENT_MEETING','FTF','FSA')),
        'agent_meetings',    (SELECT COUNT(*) FROM filtered WHERE activity_type IN ('EVENT','AGENT_MEETING')),
        'client_meetings',   (SELECT COUNT(*) FROM filtered WHERE activity_type IN ('FTF','FSA'))
    );
$function$;

-- ---- kpi_purchase_summary(date,date,bigint[],text)  (2 predicate refs scoped) ----
CREATE OR REPLACE FUNCTION public.kpi_purchase_summary(p_from date, p_to date, p_agent_ids bigint[] DEFAULT NULL::bigint[], p_role text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
AS $function$
    WITH filtered AS (
        SELECT p.amount, p.payment_method, p.epp_bank, p.epp_months
        FROM public.purchases p
        LEFT JOIN public.customers c ON c.id = p.customer_id
        LEFT JOIN public.users u ON u.id = c.responsible_agent_id
        WHERE p.date BETWEEN p_from AND p_to
          AND COALESCE(p.is_agent_package, false) = false
          AND (public.report_scope_ids(p_agent_ids) IS NULL OR c.responsible_agent_id = ANY(public.report_scope_ids(p_agent_ids)))
          AND (p_role IS NULL OR p_role = 'All' OR u.role = p_role)
    ),
    epp_rows AS (
        SELECT COALESCE(epp_bank, 'Unknown') AS bank,
               COALESCE(epp_months::text, '-') AS months,
               COUNT(*) AS cnt
        FROM filtered
        WHERE payment_method = 'EPP'
        GROUP BY bank, months
    )
    SELECT jsonb_build_object(
        'total_sales',  (SELECT COALESCE(SUM(amount), 0) FROM filtered),
        'pop_count',    (SELECT COUNT(*) FROM filtered WHERE payment_method = 'POP'),
        'pop_sales',    (SELECT COALESCE(SUM(amount), 0) FROM filtered WHERE payment_method = 'POP'),
        'epp_count',    (SELECT COUNT(*) FROM filtered WHERE payment_method = 'EPP'),
        'epp_sales',    (SELECT COALESCE(SUM(amount), 0) FROM filtered WHERE payment_method = 'EPP'),
        'epp_details',  COALESCE((SELECT jsonb_agg(jsonb_build_object('bank', bank, 'months', months, 'count', cnt)) FROM epp_rows), '[]'::jsonb)
    );
$function$;

-- ---- kpi_target_comparison(date,date,bigint[],text)  (8 predicate refs scoped) ----
CREATE OR REPLACE FUNCTION public.kpi_target_comparison(p_from date, p_to date, p_agent_ids bigint[] DEFAULT NULL::bigint[], p_role text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
    WITH act AS (
        SELECT a.activity_type
        FROM public.activities a
        LEFT JOIN public.users u ON u.id = a.lead_agent_id
        WHERE a.activity_date BETWEEN p_from AND p_to
          AND (public.report_scope_ids(p_agent_ids) IS NULL OR a.lead_agent_id = ANY(public.report_scope_ids(p_agent_ids)))
          AND (p_role IS NULL OR p_role = 'All' OR u.role = p_role)
    ),
    pur AS (
        SELECT p.amount, p.payment_method, p.is_agent_package
        FROM public.purchases p
        LEFT JOIN public.customers c ON c.id = p.customer_id
        LEFT JOIN public.users u ON u.id = c.responsible_agent_id
        WHERE p.date BETWEEN p_from AND p_to
          AND (public.report_scope_ids(p_agent_ids) IS NULL OR c.responsible_agent_id = ANY(public.report_scope_ids(p_agent_ids)))
          AND (p_role IS NULL OR p_role = 'All' OR u.role = p_role)
    )
    SELECT jsonb_build_object(
        'cps_count',     (SELECT COUNT(*) FROM act WHERE activity_type = 'CPS'),
        'total_meetings',(SELECT COUNT(*) FROM act WHERE activity_type IN ('EVENT','AGENT_MEETING')),
        'total_sales',   (SELECT COALESCE(SUM(amount),0) FROM pur WHERE COALESCE(is_agent_package,false) = false),
        'pop_count',     (SELECT COUNT(*) FROM pur WHERE payment_method = 'POP'),
        'pop_sales',     (SELECT COALESCE(SUM(amount),0) FROM pur WHERE payment_method = 'POP'),
        'epp_count',     (SELECT COUNT(*) FROM pur WHERE payment_method = 'EPP'),
        'epp_sales',     (SELECT COALESCE(SUM(amount),0) FROM pur WHERE payment_method = 'EPP'),
        'new_agents', (
            SELECT COUNT(*)
            FROM public.users u
            WHERE u.join_date BETWEEN p_from AND p_to
              AND (public.report_scope_ids(p_agent_ids) IS NULL OR u.id = ANY(public.report_scope_ids(p_agent_ids)))
              AND (p_role IS NULL OR p_role = 'All' OR u.role = p_role)
              AND (
                  (p_role IS NOT NULL AND p_role <> 'All')
                  OR u.role ~ 'Level[[:space:]]*([3-9]|1[0-2])([^0-9]|$)'
              )
        ),
        'new_customers', (
            SELECT COUNT(*)
            FROM public.customers c
            WHERE c.customer_since BETWEEN p_from AND p_to
              AND (public.report_scope_ids(p_agent_ids) IS NULL OR c.responsible_agent_id = ANY(public.report_scope_ids(p_agent_ids)))
              AND EXISTS (
                  SELECT 1 FROM public.purchases p
                  WHERE p.customer_id = c.id
                    AND p.date BETWEEN p_from AND p_to
              )
        )
    );
$function$;

-- ---- kpi_user_summary(date,date,bigint[],text)  (4 predicate refs scoped) ----
CREATE OR REPLACE FUNCTION public.kpi_user_summary(p_from date, p_to date, p_agent_ids bigint[] DEFAULT NULL::bigint[], p_role text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
AS $function$
    SELECT jsonb_build_object(
        'new_agents', (
            SELECT COUNT(*)
            FROM public.users u
            WHERE u.join_date BETWEEN p_from AND p_to
              AND (public.report_scope_ids(p_agent_ids) IS NULL OR u.id = ANY(public.report_scope_ids(p_agent_ids)))
              AND (
                  p_role IS NULL
                  OR p_role = 'All'
                  OR u.role = p_role
              )
              AND (
                  (p_role IS NOT NULL AND p_role <> 'All')
                  -- isAgent semantics: Level 3 through Level 12 inclusive
                  OR u.role ~ 'Level[[:space:]]*([3-9]|1[0-2])([^0-9]|$)'
              )
        ),
        'new_customers', (
            SELECT COUNT(*)
            FROM public.customers c
            WHERE c.customer_since BETWEEN p_from AND p_to
              AND (public.report_scope_ids(p_agent_ids) IS NULL OR c.responsible_agent_id = ANY(public.report_scope_ids(p_agent_ids)))
              AND EXISTS (
                  SELECT 1 FROM public.purchases p
                  WHERE p.customer_id = c.id
                    AND p.date BETWEEN p_from AND p_to
              )
        )
    );
$function$;

-- ---- report_activity_headcount_details(date,date,bigint[])  (2 predicate refs scoped) ----
CREATE OR REPLACE FUNCTION public.report_activity_headcount_details(p_from date, p_to date, p_agent_ids bigint[] DEFAULT NULL::bigint[])
 RETURNS TABLE(activity_date date, event_title text, attendee_type text, display_name text, is_agent boolean)
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select
    act.activity_date,
    coalesce(e.title, 'Event #' || att.event_id::text) as event_title,
    att.attendee_type,
    case
      when att.attendee_type = 'agent'    then coalesce(u_ent.full_name, att.entity_name, '—')
      when att.attendee_type = 'customer' then coalesce(c_ent.full_name, att.entity_name, '—')
      else coalesce(p_ent.full_name, att.entity_name, '—')
    end as display_name,
    (att.attendee_type = 'agent') as is_agent
  from event_attendees att
  join activities act on act.id = att.activity_id
  left join events e       on e.id = att.event_id
  left join users u_ent    on att.attendee_type = 'agent'    and u_ent.id = coalesce(att.entity_id, att.attendee_id)
  left join customers c_ent on att.attendee_type = 'customer' and c_ent.id = coalesce(att.entity_id, att.attendee_id)
  left join prospects p_ent on att.attendee_type not in ('agent','customer') and p_ent.id = coalesce(att.entity_id, att.attendee_id)
  where (att.attended is true or att.attendance_status = 'Attended')
    and act.activity_date >= p_from and act.activity_date <= p_to
    and (
      public.report_scope_ids(p_agent_ids) is null
      or (case
            when att.attendee_type = 'agent'    then coalesce(att.entity_id, att.attendee_id)
            when att.attendee_type = 'customer' then c_ent.responsible_agent_id
            else p_ent.responsible_agent_id
          end) = any(public.report_scope_ids(p_agent_ids))
    )
  order by act.activity_date desc;
$function$;

-- ---- report_new_customers(date,date,bigint[])  (2 predicate refs scoped) ----
CREATE OR REPLACE FUNCTION public.report_new_customers(p_from date, p_to date, p_agent_ids bigint[] DEFAULT NULL::bigint[])
 RETURNS TABLE(customer_since date, full_name text, agent_name text, source text)
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select c.customer_since, c.full_name, u.full_name as agent_name, null::text as source
  from customers c
  left join users u on u.id = c.responsible_agent_id
  where c.customer_since >= p_from and c.customer_since <= p_to
    and (public.report_scope_ids(p_agent_ids) is null or c.responsible_agent_id = any(public.report_scope_ids(p_agent_ids)))
  order by c.customer_since desc nulls last;
$function$;

-- ---- report_new_prospects(date,date,bigint[])  (2 predicate refs scoped) ----
CREATE OR REPLACE FUNCTION public.report_new_prospects(p_from date, p_to date, p_agent_ids bigint[] DEFAULT NULL::bigint[])
 RETURNS TABLE(created_at timestamp with time zone, full_name text, agent_name text, status text)
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select p.created_at, p.full_name, u.full_name as agent_name, p.status
  from prospects p
  left join users u on u.id = p.responsible_agent_id
  where p.created_at >= p_from::timestamptz and p.created_at < p_to::timestamptz
    and (public.report_scope_ids(p_agent_ids) is null or p.responsible_agent_id = any(public.report_scope_ids(p_agent_ids)))
  order by p.created_at desc;
$function$;

notify pgrst, 'reload schema';
