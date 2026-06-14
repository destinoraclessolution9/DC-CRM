-- Phase 1 (#12) — prospects_page RPC. SCAFFOLD: review + apply when ready (DDL).
--
-- The customers list paginates fine with plain queryAdvanced, but the prospects
-- list has two things PostgREST can't express in one round-trip:
--   • dormancy curation: hide prospects inactive > 500 days BUT still show
--     never-contacted (last_activity_date IS NULL) brand-new ones, and
--   • role-hierarchy visibility scope.
-- Encapsulating both in a SECURITY DEFINER function gives a correct, indexed,
-- single-call server-side page — the same pattern the calendar already uses
-- (get_calendar_window). Until this is applied, renderProspectsTable's flagged
-- server path paginates WITHOUT dormancy curation and the legacy client path
-- (getActiveProspects) remains the default.

create or replace function public.prospects_page(
  p_visible_agent_ids uuid[] default null,   -- null = unrestricted (admin/manager)
  p_search            text   default null,
  p_ming_gua          text   default null,
  p_agent_id          uuid   default null,
  p_include_dormant   boolean default false,
  p_dormant_days      int    default 500,
  p_sort              text   default 'score', -- full_name | score | last_activity_date
  p_sort_dir          text   default 'desc',
  p_limit             int    default 50,
  p_offset            int    default 0
)
returns table (rows jsonb, total bigint)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cutoff date := (now() at time zone 'Asia/Kuala_Lumpur')::date - p_dormant_days;
begin
  return query
  with filtered as (
    select p.*
    from prospects p
    where p.deleted_at is null
      and (p_visible_agent_ids is null or p.responsible_agent_id = any(p_visible_agent_ids))
      and (p_ming_gua  is null or p.ming_gua = p_ming_gua)
      and (p_agent_id  is null or p.responsible_agent_id = p_agent_id)
      and (
        p_search is null or
        p.full_name ilike '%'||p_search||'%' or
        p.phone     ilike '%'||p_search||'%' or
        p.email     ilike '%'||p_search||'%'
      )
      -- dormancy: keep active OR never-contacted; only hide the long-dormant.
      and (
        p_include_dormant
        or p.last_activity_date is null
        or p.last_activity_date >= v_cutoff
      )
  )
  select
    coalesce(jsonb_agg(to_jsonb(f) order by
      case when p_sort = 'full_name'         and p_sort_dir = 'asc'  then f.full_name end asc,
      case when p_sort = 'full_name'         and p_sort_dir = 'desc' then f.full_name end desc,
      case when p_sort = 'score'             and p_sort_dir = 'asc'  then f.score end asc,
      case when p_sort = 'score'             and p_sort_dir = 'desc' then f.score end desc,
      case when p_sort = 'last_activity_date'and p_sort_dir = 'asc'  then f.last_activity_date end asc,
      case when p_sort = 'last_activity_date'and p_sort_dir = 'desc' then f.last_activity_date end desc
    ) filter (where f.rn > p_offset and f.rn <= p_offset + p_limit), '[]'::jsonb),
    max(f.total)
  from (
    select f.*, row_number() over () as rn, count(*) over () as total
    from filtered f
  ) f;
end;
$$;

-- Indexes that keep this fast at 500k rows (most already exist via scale migrations):
-- create index if not exists idx_prospects_agent_activity on prospects (responsible_agent_id, last_activity_date desc) where deleted_at is null;
-- (full-text/trigram on full_name/phone/email already added by perf_indexes migrations)

grant execute on function public.prospects_page to authenticated;
