-- #2: exclude converted/lost prospects from the active Prospects list + count.
-- They live in the Customers view (all 27 converted verified to have a customer row);
-- 'lost' are dead. unable_to_serve is intentionally KEPT (shown greyed in the UI), so it
-- is NOT filtered here. Pure additive change to the filtered CTE — everything else
-- (SECURITY DEFINER, scope re-derivation, sort, pagination) is preserved verbatim.
-- Apply via the Supabase SQL editor (or Management API). Verify query at the bottom.

CREATE OR REPLACE FUNCTION public.prospects_page(p_visible_agent_ids bigint[] DEFAULT NULL::bigint[], p_search text DEFAULT NULL::text, p_ming_gua text DEFAULT NULL::text, p_agent_id bigint DEFAULT NULL::bigint, p_include_dormant boolean DEFAULT false, p_dormant_days integer DEFAULT 500, p_sort text DEFAULT 'score'::text, p_sort_dir text DEFAULT 'desc'::text, p_limit integer DEFAULT 50, p_offset integer DEFAULT 0)
 RETURNS TABLE(rows jsonb, total bigint)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
      -- #2: keep closed deals out of the active pipeline + count.
      and coalesce(p.status, '') not in ('converted', 'lost')
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

-- Verify (BFF path, scope = all): total should drop by the converted/lost count.
-- select total from prospects_page(null, null, null, null, false, 500, 'score', 'desc', 1, 0);
