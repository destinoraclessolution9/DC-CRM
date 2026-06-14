-- Phase 1 (#12) — prospects_page RPC. APPLIED to live 2026-06-14.
--
-- The customers list paginates fine with plain queryAdvanced, but the prospects
-- list has two things PostgREST can't express in one round-trip:
--   • dormancy curation: hide prospects inactive > 500 days BUT still show
--     never-contacted (last_activity_date IS NULL) brand-new ones, and
--   • role-hierarchy visibility scope.
-- Encapsulating both in a SECURITY DEFINER function gives a correct, indexed,
-- single-call server-side page — the same pattern the calendar already uses
-- (get_calendar_window). Until renderProspectsTable is wired to call this, the
-- flagged server path paginates via queryAdvanced WITHOUT dormancy curation and
-- the legacy client path (getActiveProspects) remains the default.
--
-- SCHEMA NOTES (verified against live 2026-06-14):
--   • prospects has NO deleted_at column — the legacy list applies no
--     status/soft-delete filter, only dormancy. So this RPC must NOT filter
--     by deleted_at (mirrors getActiveProspects exactly).
--   • responsible_agent_id is bigint (users.id is bigint) — params are bigint[],
--     NOT uuid.
--   • search mirrors the client: full_name | nickname | phone | email.
--   • pagination is sort-ordered: row_number() carries the sort so page N is the
--     correct slice of the ordered set (an earlier draft used an unordered
--     row_number(), which paged arbitrarily — fixed here).

create or replace function public.prospects_page(
  p_visible_agent_ids bigint[] default null,   -- null = unrestricted (admin/manager)
  p_search            text    default null,
  p_ming_gua          text    default null,
  p_agent_id          bigint  default null,
  p_include_dormant   boolean default false,
  p_dormant_days      int     default 500,
  p_sort              text    default 'score', -- full_name | score | last_activity_date
  p_sort_dir          text    default 'desc',
  p_limit             int     default 50,
  p_offset            int     default 0
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
    where (p_visible_agent_ids is null or p.responsible_agent_id = any(p_visible_agent_ids))
      and (p_ming_gua is null or p.ming_gua = p_ming_gua)
      and (p_agent_id is null or p.responsible_agent_id = p_agent_id)
      and (
        p_search is null or
        p.full_name ilike '%'||p_search||'%' or
        p.nickname  ilike '%'||p_search||'%' or
        p.phone     ilike '%'||p_search||'%' or
        p.email     ilike '%'||p_search||'%'
      )
      -- dormancy: keep active OR never-contacted; only hide the long-dormant.
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
        f.id desc  -- stable tiebreaker
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
$$;

-- Indexes that keep this fast at 500k rows (most already exist via scale migrations):
-- create index if not exists idx_prospects_agent_activity on prospects (responsible_agent_id, last_activity_date desc);
-- (full-text/trigram on full_name/phone/email already added by perf_indexes migrations)

grant execute on function public.prospects_page to authenticated;
