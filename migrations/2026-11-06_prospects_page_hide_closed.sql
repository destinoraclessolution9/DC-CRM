-- Prospects list: hide Unable to Serve + Dropped (grade F) rows unless asked.
--
-- Owner 2026-11-06: "those rejected since is hide then should not show in list,
-- unless i want to call it out. else it looks messy" → hide both Unable to Serve
-- and Dropped (F). They come back when the user searches a name / phone / email
-- or ticks "Show Unable to Serve / Dropped (F)".
--
-- Changes vs the live definition read 2026-11-06 (which already differs from
-- prospects_page_exclude_converted_2026-06-22.sql: it has v_searching):
--   1. New last parameter p_include_closed boolean DEFAULT TRUE. The default keeps
--      today's behaviour for any caller that does not pass it (cached old app
--      builds), so applying this before the app deploy changes nothing on screen.
--      The new app passes false to hide the rows.
--   2. A search (v_searching) always includes them, same as converted/lost.
--   3. EXECUTE only for authenticated + service_role. Before this, anon (and
--      PUBLIC) could call it: auth.uid() is null for anon, so the function trusted
--      p_visible_agent_ids = NULL and returned every prospect to anyone holding the
--      public site key. The only callers are the BFF (service_role) and
--      AppDataStore.prospectsPage (signed-in session), both unaffected.
--
-- Adding a parameter with CREATE OR REPLACE would leave the old 10-arg version
-- beside the new one and PostgREST could not choose between them (PGRST203), so
-- the old signature is dropped and the new one created in one transaction.
-- No SET clauses are lost: the old one has only search_path, re-stated below.
-- Undo: 2026-11-06_prospects_page_hide_closed_UNDO.sql

begin;

drop function if exists public.prospects_page(bigint[], text, text, bigint, boolean, integer, text, text, integer, integer);

create function public.prospects_page(
  p_visible_agent_ids bigint[] default null::bigint[],
  p_search text default null::text,
  p_ming_gua text default null::text,
  p_agent_id bigint default null::bigint,
  p_include_dormant boolean default false,
  p_dormant_days integer default 500,
  p_sort text default 'score'::text,
  p_sort_dir text default 'desc'::text,
  p_limit integer default 50,
  p_offset integer default 0,
  p_include_closed boolean default true
)
 returns table(rows jsonb, total bigint)
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
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
      -- 2026-11-06: Unable to Serve + Dropped (F) stay out of the list unless the
      -- caller asks for them or is searching (so they can still be found + revived).
      and (
        p_include_closed
        or v_searching
        or (not coalesce(p.unable_to_serve, false) and coalesce(p.manual_grade, '') <> 'F')
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

revoke all on function public.prospects_page(bigint[], text, text, bigint, boolean, integer, text, text, integer, integer, boolean) from public, anon;
grant execute on function public.prospects_page(bigint[], text, text, bigint, boolean, integer, text, text, integer, integer, boolean) to authenticated, service_role;

commit;

notify pgrst, 'reload schema';

-- Verify (service role, scope = all):
--   select total from prospects_page(null,null,null,null,false,500,'score','desc',0,0,true);   -- same as before
--   select total from prospects_page(null,null,null,null,false,500,'score','desc',0,0,false);  -- minus Unable to Serve / F
--   select has_function_privilege('anon', 'public.prospects_page(bigint[],text,text,bigint,boolean,integer,text,text,integer,integer,boolean)', 'EXECUTE'); -- false
