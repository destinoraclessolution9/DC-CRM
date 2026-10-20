-- 💰 Open potential per person (2026-10-20). Additive.
-- prospects.open_potential_rm = RM still to sell to this person, counted once
-- per product:
--   sources  · Feng Shui audit "Product Potential Needed" (all audits)
--            · meeting notes (activities + event attendee notes) — last 6 months
--            · open prescription lines (quoted price WINS over catalogue price)
--            · open manual pipeline deals (auto-drafts are derived from the
--              notes, so they are not counted again)
--   price    · prescription quote > deal amount > catalogue price
--              (DC products.price, Bujishu option / item customer price)
--   minus    · items bought on or after the date they were noted
-- Customers keep the number on their original (converted) prospect row.

alter table public.prospects
    add column if not exists open_potential_rm numeric not null default 0,
    add column if not exists open_potential_detail jsonb,
    add column if not exists open_potential_at timestamptz;
create index if not exists prospects_open_potential_idx on public.prospects (open_potential_rm desc) where open_potential_rm > 0;

-- "[Group] a, b | [Group2] c | Remarks: x"  →  rows (grp, name)
create or replace function public.potential_text_items(p_text text)
returns table (grp text, name text)
language sql immutable as $$
    with body as (select regexp_replace(coalesce(p_text, ''), '\|\s*Remarks:.*$', '') as t),
         g as (select m[1] as grp, m[2] as names from body, regexp_matches(body.t, '\[([^\]]+)\]\s*([^\[|]*)', 'g') m)
    select btrim(g.grp), btrim(n) from g, unnest(string_to_array(g.names, ',')) n where btrim(n) <> ''
$$;

create or replace function public.open_potential_refresh(p_pid bigint) returns numeric
language plpgsql security definer set search_path = public as $$
declare
    v_cust bigint;
    v_since date := (now() at time zone 'Asia/Kuala_Lumpur')::date - 183;
    v_total numeric := 0;
    v_detail jsonb;
begin
    if p_pid is null then return 0; end if;
    select id into v_cust from public.customers where converted_from_prospect_id = p_pid limit 1;

    create temp table if not exists _pot (k text, label text, price numeric, src text, pri int, dt date) on commit drop;
    delete from _pot;

    -- 1. noted items (audit + meetings) priced from the catalogues
    insert into _pot (k, label, price, src, pri, dt)
    select coalesce(case when r.catalog_id is not null then 'bjc:' || r.catalog_id || ':' || coalesce(r.option_id, 0) end,
                    case when pr.id is not null then 'dc:' || pr.id end,
                    'txt:' || lower(x.name)),
           x.name,
           coalesce(case when r.option_id is not null then o.price_customer end,
                    case when r.catalog_id is not null then c.price_customer end,
                    nullif(pr.price, 0)),
           x.src, 3, x.dt
      from (
            select i.grp, i.name, 'audit'::text as src, nullif(a->>'audit_date', '')::date as dt
              from public.prospects p, jsonb_array_elements(coalesce(p.feng_shui_audits::jsonb, '[]'::jsonb)) a,
                   public.potential_text_items(a->>'products') i
             where p.id = p_pid
            union all
            select i.grp, i.name, 'meeting', act.activity_date::date
              from public.activities act, public.potential_text_items(act.opportunity_potential) i
             where (act.prospect_id = p_pid or (v_cust is not null and act.customer_id = v_cust))
               and act.activity_date::date >= v_since and act.opportunity_potential like '%[%'
            union all
            select i.grp, i.name, 'meeting', coalesce(ea.post_event_updated_at, ea.updated_at, ea.created_at)::date
              from public.event_attendees ea, public.potential_text_items(ea.opportunity_potential) i
             where ea.attendee_type = 'prospect' and ea.entity_id = p_pid
               and coalesce(ea.post_event_updated_at, ea.updated_at, ea.created_at) >= v_since and ea.opportunity_potential like '%[%'
           ) x
      left join lateral public.bjc_resolve(case when x.grp = 'Bujishu Catalogue' or x.grp ilike 'bujishu%' then x.name else null end) r on true
      left join public.bujishu_catalog c on c.id = r.catalog_id
      left join public.bujishu_catalog_options o on o.id = r.option_id
      left join lateral (select pp.id, pp.price from public.products pp
                          where r.catalog_id is null and btrim(pp.name) = x.name limit 1) pr on true;

    -- 2. open prescription lines (quoted price wins)
    insert into _pot (k, label, price, src, pri, dt)
    select coalesce(case when ap.catalog_item_id is not null then 'bjc:' || ap.catalog_item_id || ':' || coalesce(ap.catalog_option_id, 0) end,
                    case when ap.product_id is not null then 'dc:' || ap.product_id end,
                    (select 'dc:' || pp.id from public.products pp where btrim(pp.name) = btrim(ap.product) limit 1),
                    'txt:' || lower(btrim(ap.product))),
           ap.product, ap.quoted_amount, 'prescription', 1, ap.created_at::date
      from public.audit_prescriptions ap
     where ap.prospect_id = p_pid and ap.status in ('proposed', 'accepted');

    -- 3. open manual deals (not audit-linked, not auto-drafted)
    insert into _pot (k, label, price, src, pri, dt)
    select coalesce(case when d.catalog_item_id is not null then 'bjc:' || d.catalog_item_id || ':' || coalesce(d.catalog_option_id, 0) end,
                    case when d.product_id is not null then 'dc:' || d.product_id end,
                    (select 'dc:' || pp.id from public.products pp where btrim(pp.name) = btrim(d.product) limit 1),
                    'txt:' || lower(btrim(d.product))),
           d.product, d.amount, 'deal', 2, d.created_at::date
      from public.pipeline_deals d
     where d.prospect_id = p_pid and d.audit_id is null and not d.auto_created
       and d.stage in ('interested', 'proposal', 'prescribed', 'closing');

    -- one row per product: best price source, earliest mention date
    with best as (
        select distinct on (k) k, label, price, src, min(dt) over (partition by k) as first_dt
          from _pot order by k, pri, price desc nulls last
    ),
    open_items as (
        select b.* from best b
         where not exists (
             select 1 from public.purchases pu
              where (pu.prospect_id = p_pid or (v_cust is not null and pu.customer_id = v_cust))
                and coalesce(pu.status, '') !~* 'cancel|refund|void'
                and (b.first_dt is null or pu.date >= b.first_dt)
                and (case when b.k like 'bjc:%'
                          then pu.bujishu_catalog_id::text = split_part(b.k, ':', 2)
                          else public.pipeline_name_match(pu.item, b.label) end))
    )
    select coalesce(sum(price) filter (where price > 0), 0),
           jsonb_build_object(
               'total', coalesce(sum(price) filter (where price > 0), 0),
               'by_source', jsonb_build_object(
                   'audit', coalesce(sum(price) filter (where src = 'audit' and price > 0), 0),
                   'meeting', coalesce(sum(price) filter (where src = 'meeting' and price > 0), 0),
                   'prescription', coalesce(sum(price) filter (where src = 'prescription' and price > 0), 0),
                   'deal', coalesce(sum(price) filter (where src = 'deal' and price > 0), 0)),
               'unpriced', count(*) filter (where coalesce(price, 0) <= 0),
               'items', coalesce(jsonb_agg(jsonb_build_object('label', label, 'price', price, 'src', src) order by price desc nulls last), '[]'::jsonb))
      into v_total, v_detail
      from open_items;

    update public.prospects
       set open_potential_rm = coalesce(v_total, 0), open_potential_detail = v_detail, open_potential_at = now()
     where id = p_pid
       and (open_potential_rm is distinct from coalesce(v_total, 0) or open_potential_detail is distinct from v_detail);
    return coalesce(v_total, 0);
end $$;
revoke all on function public.open_potential_refresh(bigint) from public, anon;
grant execute on function public.open_potential_refresh(bigint) to authenticated;

-- Triggers: recompute the affected person; never block the original write.
create or replace function public.open_potential_trg() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_pid bigint; v_old bigint; r record;
begin
    if tg_op = 'DELETE' then r := old; else r := new; end if;
    if tg_table_name = 'activities' then
        v_pid := r.prospect_id;
        if v_pid is null and r.customer_id is not null then
            select converted_from_prospect_id into v_pid from public.customers where id = r.customer_id;
        end if;
    elsif tg_table_name = 'event_attendees' then
        if r.attendee_type = 'prospect' then v_pid := r.entity_id; end if;
    elsif tg_table_name = 'purchases' then
        v_pid := r.prospect_id;
        if v_pid is null and r.customer_id is not null then
            select converted_from_prospect_id into v_pid from public.customers where id = r.customer_id;
        end if;
    elsif tg_table_name = 'prospects' then
        v_pid := r.id;
    else
        v_pid := r.prospect_id;  -- audit_prescriptions / pipeline_deals
    end if;
    perform public.open_potential_refresh(v_pid);
    if tg_op = 'UPDATE' and tg_table_name in ('activities', 'pipeline_deals', 'audit_prescriptions')
       and old.prospect_id is distinct from new.prospect_id then
        perform public.open_potential_refresh(old.prospect_id);
    end if;
    return null;
exception when others then
    return null;
end $$;

drop trigger if exists trg_open_potential_act on public.activities;
create trigger trg_open_potential_act after insert or update of opportunity_potential, activity_date, prospect_id, customer_id or delete
    on public.activities for each row execute function public.open_potential_trg();
drop trigger if exists trg_open_potential_ea on public.event_attendees;
create trigger trg_open_potential_ea after insert or update of opportunity_potential or delete
    on public.event_attendees for each row execute function public.open_potential_trg();
drop trigger if exists trg_open_potential_pros on public.prospects;
create trigger trg_open_potential_pros after update of feng_shui_audits
    on public.prospects for each row execute function public.open_potential_trg();
drop trigger if exists trg_open_potential_rx on public.audit_prescriptions;
create trigger trg_open_potential_rx after insert or update or delete
    on public.audit_prescriptions for each row execute function public.open_potential_trg();
drop trigger if exists trg_open_potential_deal on public.pipeline_deals;
create trigger trg_open_potential_deal after insert or update or delete
    on public.pipeline_deals for each row execute function public.open_potential_trg();
drop trigger if exists trg_open_potential_pur on public.purchases;
create trigger trg_open_potential_pur after insert or update of item, amount, status, date or delete
    on public.purchases for each row execute function public.open_potential_trg();

-- Nightly safety net (03:30 MYT = 19:30 UTC) + 6-month window roll-off.
create or replace function public.open_potential_refresh_all() returns integer
language plpgsql security definer set search_path = public as $$
declare r record; n int := 0;
begin
    for r in select id from public.prospects loop
        perform public.open_potential_refresh(r.id); n := n + 1;
    end loop;
    return n;
end $$;
revoke all on function public.open_potential_refresh_all() from public, anon, authenticated;
select cron.unschedule('open-potential-nightly') where exists (select 1 from cron.job where jobname = 'open-potential-nightly');
select cron.schedule('open-potential-nightly', '30 19 * * *', 'select public.open_potential_refresh_all();');

-- Weekly push: + biggest open potential with nothing booked (2026-10-20)
create or replace function public.queue_pipeline_weekly_push() returns integer
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    v_today date := (now() at time zone 'Asia/Kuala_Lumpur')::date;
    v_month text := to_char(v_today, 'YYYY-MM');
    v_end   date := (date_trunc('month', v_today) + interval '1 month - 1 day')::date;
    v_n     integer;
begin
    insert into public.notification_outbox (user_id, kind, priority, title, body, url, dedupe_key, due_at)
    select s.user_id, 'pipeline_weekly', 'normal',
           '🎯 ' || s.lbl || ': RM' || round(s.won / 1000) || 'k of RM' || round(s.goal / 1000) || 'k',
           case when s.goal - s.won <= 0 then 'Goal reached 🎉 keep closing'
                when s.pipe = 0 then 'No deals closing this month · add deals'
                else 'Pipeline ' || to_char(s.pipe / greatest(s.goal - s.won, 1), 'FM990.0') || '× (need 3×)'
           end
           || case when s.rx > 0 then ' · ' || s.rx || ' prescription' || case when s.rx = 1 then '' else 's' end || ' open' else '' end
           || case when s.idle > 0 then ' · ' || s.idle || ' idle' else '' end
           || coalesce(' · Top: ' || s.top_name || ' RM' || round(s.top_rm / 1000) || 'k', ''),
           './index.html#pipeline',
           'pipeline_weekly:' || v_today,
           now()
      from (
        select u.id as user_id,
               case when u.role_level between 3 and 5 then 'Team' else 'You' end as lbl,
               coalesce(g.target_amount, case when u.role_level between 3 and 5 then 500000 else 100000 end) as goal,
               coalesce((select sum(p.amount) from public.purchases p
                          where p.agent_id in (select public.pipeline_tree_ids(u.id, u.role_level between 3 and 5))
                            and left(p.date::text, 7) = v_month
                            and coalesce(p.status, '') !~* 'cancel|refund|void' and p.amount > 0), 0) as won,
               coalesce((select sum(d.amount) from public.pipeline_deals d
                          where d.agent_id in (select public.pipeline_tree_ids(u.id, u.role_level between 3 and 5))
                            and d.stage in ('interested','proposal','prescribed','closing')
                            and d.expected_close_date <= v_end), 0) as pipe,
               (select count(*) from public.pipeline_deals d
                 where d.agent_id in (select public.pipeline_tree_ids(u.id, u.role_level between 3 and 5))
                   and d.stage = 'prescribed') as rx,
               (select count(*) from public.pipeline_deals d left join public.prospects pr on pr.id = d.prospect_id
                 where d.agent_id in (select public.pipeline_tree_ids(u.id, u.role_level between 3 and 5))
                   and d.stage in ('interested','proposal','prescribed','closing')
                   and greatest(d.updated_at, coalesce(pr.last_activity_date::timestamptz, d.updated_at)) < now() - interval '14 days') as idle,
               t.full_name as top_name, t.open_potential_rm as top_rm
          from public.users u
          left join public.pipeline_goals g
                 on g.user_id = u.id and g.month = v_month
                and g.scope = case when u.role_level between 3 and 5 then 'team' else 'personal' end
          left join lateral (
              -- biggest open potential in scope with nothing booked from today
              select p.full_name, p.open_potential_rm from public.prospects p
               where p.responsible_agent_id in (select public.pipeline_tree_ids(u.id, u.role_level between 3 and 5))
                 and p.open_potential_rm > 0
                 and not exists (select 1 from public.activities a where a.prospect_id = p.id and a.activity_date::date >= v_today)
               order by p.open_potential_rm desc limit 1) t on true
         where u.role_level between 3 and 12
           and coalesce(u.status, 'active') !~* 'inactive|deleted|resign|terminat'
      ) s
    on conflict (user_id, dedupe_key) do nothing;
    get diagnostics v_n = row_count;
    return v_n;
end $$;
revoke all on function public.queue_pipeline_weekly_push() from public, anon, authenticated;
