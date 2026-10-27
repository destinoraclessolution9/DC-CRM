-- 传福者 board (2026-10-27, owner): who really brings the CPS.
--   * prospects.introduced_by_* — the CLIENT who introduced the person (new
--     field on the CPS form); "Referred By" is often the agent (60% of 2026 CPS).
--   * chuanfu_members — clients promoted to 传福者 from the board.
--   * chuanfu_board(from, to) — every client referrer in the caller's scope:
--     CPS brought in the period, all people referred, how many became
--     customers, their sales, last CPS, 传福者 or not.
--   * referrer_unlinked() / referrer_link() — the 292 referrers typed as plain
--     text: list them with likely matches, link them to the real record.
-- Credit for a person goes to introduced_by (if a client), else referred_by
-- (if a client). A prospect who became a customer is ONE person (customer key).

alter table public.prospects add column if not exists introduced_by_id bigint;
alter table public.prospects add column if not exists introduced_by_type text;
alter table public.prospects add column if not exists introduced_by text;

create table if not exists public.chuanfu_members (
    person_key  text primary key,          -- 'c:<customer id>' or 'p:<prospect id>'
    name        text,
    promoted_at timestamptz not null default now(),
    promoted_by bigint
);
alter table public.chuanfu_members enable row level security;
drop policy if exists chuanfu_members_read on public.chuanfu_members;
create policy chuanfu_members_read on public.chuanfu_members for select to authenticated using (true);

-- one person per client: a prospect who became a customer counts as the customer
create or replace function public.chuanfu_key(p_type text, p_id bigint)
returns text
language sql stable set search_path = public as $$
    select case
        when p_id is null then null
        when lower(p_type) = 'customer' then 'c:' || p_id
        when lower(p_type) = 'prospect' then coalesce(
            (select 'c:' || c.id from public.customers c where c.converted_from_prospect_id = p_id order by c.id limit 1),
            'p:' || p_id)
    end
$$;

-- prospects the caller may see in these lists: L1–L2 all, L3–L5 their tree, else own
create or replace function public.chuanfu_scope_agents()
returns setof bigint
language plpgsql stable security definer set search_path = public as $$
declare v_uid bigint := public.current_user_row_id(); v_lvl int;
begin
    if v_uid is null then return; end if;
    select coalesce(role_level, 99) into v_lvl from public.users where id = v_uid;
    if v_lvl <= 2 then
        return query select id from public.users;
    elsif v_lvl between 3 and 5 then
        return query with recursive t(id) as (
            select v_uid union select u.id from public.users u join t on u.reporting_to = t.id)
        select id from t;
    else
        return query select v_uid;
    end if;
end $$;

create or replace function public.chuanfu_board(p_from date default null, p_to date default null)
returns table (person_key text, name text, agent text, is_member boolean, cps_period int, referred_total int,
               became_customers int, sales_rm numeric, last_cps date)
language sql stable security definer set search_path = public as $$
    with scope as (select public.chuanfu_scope_agents() id),
    ppl as (
        select p.id,
               case when p.introduced_by_type in ('Customer', 'Prospect') then public.chuanfu_key(p.introduced_by_type, p.introduced_by_id)
                    when p.referred_by_type in ('Customer', 'Prospect') then public.chuanfu_key(p.referred_by_type, p.referred_by_id) end as k,
               coalesce((select min(a.activity_date)::date from public.activities a where a.prospect_id = p.id and a.activity_type = 'CPS'),
                        p.created_at::date) as cps_date,
               exists (select 1 from public.activities a where a.prospect_id = p.id and a.activity_type = 'CPS') as had_cps,
               (select c.id from public.customers c where c.converted_from_prospect_id = p.id order by c.id limit 1) as cust_id
          from public.prospects p
         where p.responsible_agent_id in (select id from scope)
    ),
    agg as (
        select k,
               count(*) filter (where had_cps and cps_date between coalesce(p_from, '1900-01-01') and coalesce(p_to, '2999-12-31'))::int as cps_period,
               count(*)::int as referred_total,
               count(cust_id)::int as became_customers,
               coalesce(sum((select sum(pu.amount) from public.purchases pu
                              where pu.customer_id = ppl.cust_id and coalesce(pu.status, '') !~* 'cancel|refund|void')), 0) as sales_rm,
               max(cps_date) filter (where had_cps) as last_cps
          from ppl where k is not null group by k
    )
    select a.k,
           coalesce(c.full_name, pr.full_name, m.name, a.k),
           (select u.full_name from public.users u where u.id = coalesce(c.responsible_agent_id, pr.responsible_agent_id)),
           m.person_key is not null,
           a.cps_period, a.referred_total, a.became_customers, a.sales_rm, a.last_cps
      from agg a
      left join public.customers c on a.k = 'c:' || c.id
      left join public.prospects pr on a.k = 'p:' || pr.id
      left join public.chuanfu_members m on m.person_key = a.k
     order by a.cps_period desc, a.referred_total desc, a.sales_rm desc
$$;

-- promote / remove a 传福者 (team leaders and managers)
create or replace function public.chuanfu_promote(p_key text, p_on boolean default true)
returns boolean
language plpgsql security definer set search_path = public as $$
declare v_uid bigint := public.current_user_row_id(); v_lvl int; v_name text;
begin
    select coalesce(role_level, 99) into v_lvl from public.users where id = v_uid;
    if v_uid is null or v_lvl > 5 or p_key !~ '^[cp]:[0-9]+$' then return false; end if;
    if not p_on then delete from public.chuanfu_members where person_key = p_key; return true; end if;
    select full_name into v_name from public.customers where 'c:' || id = p_key;
    if v_name is null then select full_name into v_name from public.prospects where 'p:' || id = p_key; end if;
    if v_name is null then return false; end if;
    insert into public.chuanfu_members (person_key, name, promoted_by) values (p_key, v_name, v_uid)
    on conflict (person_key) do nothing;
    return true;
end $$;

-- referrers typed as text (no link): one row per name, with likely matches
create or replace function public.referrer_unlinked(p_limit int default 200)
returns table (ref_text text, people int, examples text, suggestions jsonb)
language sql stable security definer set search_path = public as $$
    with scope as (select public.chuanfu_scope_agents() id),
    t as (
        select lower(btrim(p.referred_by)) as norm, min(btrim(p.referred_by)) as ref_text, count(*)::int as people,
               string_agg(p.full_name, ', ' order by p.created_at desc) as examples
          from public.prospects p
         where p.responsible_agent_id in (select id from scope)
           and p.referred_by_id is null and nullif(btrim(p.referred_by), '') is not null
         group by 1
    )
    select t.ref_text, t.people, left(t.examples, 160),
           coalesce((select jsonb_agg(s order by s.score desc) from (
                select * from (
                    select 'Customer' as kind, c.id, c.full_name as name, round(similarity(lower(c.full_name), t.norm)::numeric, 2) as score
                      from public.customers c where similarity(lower(c.full_name), t.norm) > 0.3 or lower(c.full_name) like '%' || t.norm || '%'
                    union all
                    select 'Prospect', p.id, p.full_name, round(similarity(lower(p.full_name), t.norm)::numeric, 2)
                      from public.prospects p where p.status is distinct from 'converted'
                       and (similarity(lower(p.full_name), t.norm) > 0.3 or lower(p.full_name) like '%' || t.norm || '%')
                    union all
                    select 'Consultant', u.id, u.full_name, round(similarity(lower(u.full_name), t.norm)::numeric, 2)
                      from public.users u where similarity(lower(u.full_name), t.norm) > 0.3 or lower(u.full_name) like '%' || t.norm || '%'
                ) z order by score desc limit 3) s), '[]'::jsonb)
      from t
     order by t.people desc, t.ref_text
     limit greatest(coalesce(p_limit, 200), 1)
$$;

-- link every prospect (in scope) whose referrer is typed exactly like p_text
create or replace function public.referrer_link(p_text text, p_kind text, p_id bigint)
returns int
language plpgsql security definer set search_path = public as $$
declare v_uid bigint := public.current_user_row_id(); v_lvl int; v_name text; v_n int;
begin
    select coalesce(role_level, 99) into v_lvl from public.users where id = v_uid;
    if v_uid is null or v_lvl > 5 or p_kind not in ('Customer', 'Prospect', 'Consultant') or p_id is null then return 0; end if;
    v_name := case p_kind
        when 'Customer' then (select full_name from public.customers where id = p_id)
        when 'Prospect' then (select full_name from public.prospects where id = p_id)
        else (select full_name from public.users where id = p_id) end;
    if v_name is null then return 0; end if;
    update public.prospects p
       set referred_by_id = p_id, referred_by_type = p_kind, referred_by = v_name, updated_at = now()
     where p.referred_by_id is null and lower(btrim(p.referred_by)) = lower(btrim(p_text))
       and p.responsible_agent_id in (select public.chuanfu_scope_agents());
    get diagnostics v_n = row_count;
    return v_n;
end $$;

revoke all on function public.chuanfu_scope_agents() from public, anon;
grant execute on function public.chuanfu_board(date, date) to authenticated;
grant execute on function public.chuanfu_promote(text, boolean) to authenticated;
grant execute on function public.referrer_unlinked(int) to authenticated;
grant execute on function public.referrer_link(text, text, bigint) to authenticated;

-- the headline: of the CPS in the period, how many have a client behind them
create or replace function public.chuanfu_summary(p_from date default null, p_to date default null)
returns table (cps_total int, from_clients int, agent_only int, own_contact int)
language sql stable security definer set search_path = public as $$
    with scope as (select public.chuanfu_scope_agents() id),
    c as (
        select p.*,
               (select min(a.activity_date)::date from public.activities a where a.prospect_id = p.id and a.activity_type = 'CPS') as cps_date
          from public.prospects p
         where p.responsible_agent_id in (select id from scope)
    )
    select count(*)::int,
           count(*) filter (where introduced_by_type in ('Customer', 'Prospect') or referred_by_type in ('Customer', 'Prospect'))::int,
           count(*) filter (where not (coalesce(introduced_by_type, '') in ('Customer', 'Prospect', 'Own') or coalesce(referred_by_type, '') in ('Customer', 'Prospect')))::int,
           count(*) filter (where introduced_by_type = 'Own')::int
      from c
     where cps_date is not null and cps_date between coalesce(p_from, '1900-01-01') and coalesce(p_to, '2999-12-31')
$$;
grant execute on function public.chuanfu_summary(date, date) to authenticated;
