-- UNDO for 2026-11-06_prospects_page_hide_closed.sql: restores the exact live
-- definition read 2026-11-06 (10 args, no p_include_closed) and its old grants
-- (including anon/PUBLIC, which re-opens the signed-out read; only use if needed).
begin;
drop function if exists public.prospects_page(bigint[], text, text, bigint, boolean, integer, text, text, integer, integer, boolean);
CREATE OR REPLACE FUNCTION public.prospects_page(p_visible_agent_ids bigint[] DEFAULT NULL::bigint[], p_search text DEFAULT NULL::text, p_ming_gua text DEFAULT NULL::text, p_agent_id bigint DEFAULT NULL::bigint, p_include_dormant boolean DEFAULT false, p_dormant_days integer DEFAULT 500, p_sort text DEFAULT 'score'::text, p_sort_dir text DEFAULT 'desc'::text, p_limit integer DEFAULT 50, p_offset integer DEFAULT 0)
 RETURNS TABLE(rows jsonb, total bigint)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_cutoff date := (now() at time zone 'Asia/Kuala_Lumpur')::date - p_dormant_days;
  v_scope bigint[];
  v_searching boolean := (p_search is not null and btrim(p_search) <> '');
begin
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
      -- #2: keep closed deals out of the ACTIVE pipeline list + count, but an
      -- explicit name/phone/email search must still surface them (mirrors the
      -- searchable-when-dormant contract in script-prospects.js). Only hide
      -- converted/lost when the caller is NOT searching.
      and (
        v_searching
        or coalesce(p.status, '') not in ('converted', 'lost')
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
grant execute on function public.prospects_page(bigint[], text, text, bigint, boolean, integer, text, text, integer, integer) to public, anon, authenticated, service_role;
commit;
notify pgrst, 'reload schema';
