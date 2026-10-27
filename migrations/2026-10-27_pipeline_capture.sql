-- Pipeline capture (2026-10-27, owner): the CRM tracked 3 of 27 lines of the
-- owner's manual sales list. Two system causes fixed here:
--   1. Quoted price. The agent can enter the quoted RM per product on the
--      meeting (activities.quoted_prices / event_attendees.quoted_prices,
--      {"<product as ticked>": RM}). A quote beats the catalogue price, so
--      专案 / 商业 / 灵活 plans (no single catalogue price) finally count.
--   2. Names. Half the ticks (33 of 67) used a short code or an old name
--      ("PR6", "积仓富", "天至喜1", 天之喜 typo) and never matched the catalogue,
--      so they counted RM0. product_resolve() maps them.
-- Also: a customer's event notes now count toward their potential (before,
-- only attendee_type = 'prospect').

alter table public.activities add column if not exists quoted_prices jsonb;
alter table public.event_attendees add column if not exists quoted_prices jsonb;

-- Ticked name → catalogue product (unique answer only, else null).
--   exact name · Power Ring code (PR1–PR9 by the name's numeral, PR4 文昌,
--   PR2 掌权, PRH 健康 — the weekly-report codes) · short code · the Chinese
--   head ("积仓富" → "积仓富 Ji Cang Fu", the regular one before a promo).
create or replace function public.product_resolve(p_name text)
returns bigint
language plpgsql stable set search_path = public as $$
declare
    v_name text := btrim(coalesce(p_name, ''));
    v_up   text;
    v_head text;
    v_id   bigint;
    v_n    int;
begin
    if v_name = '' then return null; end if;
    select id into v_id from public.products where btrim(name) = v_name and is_active limit 1;
    if v_id is not null then return v_id; end if;

    v_up := upper(regexp_replace(v_name, '\s+', '', 'g'));
    if v_up ~ '^(PR|POWERRING|POWERING)([1-9]|H|HE|AU|WI)$' then
        v_up := regexp_replace(v_up, '^(PR|POWERRING|POWERING)', '');
        select id into v_id from public.products
         where is_active and category = 'Power Ring'
           and name like (case v_up
                            when '4' then '文昌%' when 'WI' then '文昌%'
                            when '2' then '掌权%' when 'AU' then '掌权%'
                            when 'H' then '健康%' when 'HE' then '健康%'
                            when '1' then '一%' when '3' then '三%' when '5' then '五%' when '6' then '六%'
                            when '7' then '七%' when '8' then '八%' when '9' then '紫贵%' end)
         limit 1;
        if v_id is not null then return v_id; end if;
    end if;

    select id into v_id from public.products where is_active and upper(short_code_suggested) = upper(v_name) limit 1;
    if v_id is not null then return v_id; end if;

    -- Chinese head: everything before the first space / bracket; 天之喜 → 天至喜
    v_head := replace(split_part(regexp_replace(v_name, '[（(].*$', ''), ' ', 1), '天之喜', '天至喜');
    if length(v_head) >= 2 and v_head ~ '[一-鿿]' then
        select count(*), min(id) into v_n, v_id from public.products
         where is_active and split_part(name, ' ', 1) = v_head;
        if v_n = 1 then return v_id; end if;
    end if;
    return null;
end $$;

CREATE OR REPLACE FUNCTION public.open_potential_refresh(p_pid bigint)
 RETURNS numeric
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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

    -- 1. noted items (audit + meetings): the agent's quoted RM, else the catalogue price
    insert into _pot (k, label, price, src, pri, dt)
    select coalesce(case when r.catalog_id is not null then 'bjc:' || r.catalog_id || ':' || coalesce(r.option_id, 0) end,
                    case when pr.id is not null then 'dc:' || pr.id end,
                    'txt:' || lower(x.name)),
           coalesce(pr.name, x.name),
           coalesce(nullif(x.quote, 0),
                    case when r.option_id is not null then o.price_customer end,
                    case when r.catalog_id is not null then c.price_customer end,
                    nullif(pr.price, 0)),
           x.src, case when coalesce(x.quote, 0) > 0 then 1 else 3 end, x.dt
      from (
            select i.grp, i.name, 'audit'::text as src, nullif(a->>'audit_date', '')::date as dt, null::numeric as quote
              from public.prospects p, jsonb_array_elements(coalesce(p.feng_shui_audits::jsonb, '[]'::jsonb)) a,
                   public.potential_text_items(a->>'products') i
             where p.id = p_pid
            union all
            select i.grp, i.name, 'meeting', act.activity_date::date,
                   case when coalesce(act.quoted_prices->>i.name, '') ~ '^\s*[0-9]+(\.[0-9]+)?\s*$' then (act.quoted_prices->>i.name)::numeric end
              from public.activities act, public.potential_text_items(act.opportunity_potential) i
             where (act.prospect_id = p_pid or (v_cust is not null and act.customer_id = v_cust))
               and act.activity_date::date >= v_since and act.opportunity_potential like '%[%'
            union all
            select i.grp, i.name, 'meeting', coalesce(ea.post_event_updated_at, ea.updated_at, ea.created_at)::date,
                   case when coalesce(ea.quoted_prices->>i.name, '') ~ '^\s*[0-9]+(\.[0-9]+)?\s*$' then (ea.quoted_prices->>i.name)::numeric end
              from public.event_attendees ea, public.potential_text_items(ea.opportunity_potential) i
             where ((ea.attendee_type = 'prospect' and ea.entity_id = p_pid)
                    or (v_cust is not null and ea.attendee_type = 'customer' and ea.entity_id = v_cust))
               and coalesce(ea.post_event_updated_at, ea.updated_at, ea.created_at) >= v_since and ea.opportunity_potential like '%[%'
           ) x
      left join lateral public.bjc_resolve(case when x.grp = 'Bujishu Catalogue' or x.grp ilike 'bujishu%' then x.name else null end) r on true
      left join public.bujishu_catalog c on c.id = r.catalog_id
      left join public.bujishu_catalog_options o on o.id = r.option_id
      left join lateral (select pp.id, pp.price, pp.name from public.products pp
                          where r.catalog_id is null and pp.id = public.product_resolve(x.name)) pr on true;

    -- 2. open prescription lines (quoted price wins)
    insert into _pot (k, label, price, src, pri, dt)
    select coalesce(case when ap.catalog_item_id is not null then 'bjc:' || ap.catalog_item_id || ':' || coalesce(ap.catalog_option_id, 0) end,
                    case when ap.product_id is not null then 'dc:' || ap.product_id end,
                    (select 'dc:' || pp.id from public.products pp where pp.id = public.product_resolve(ap.product)),
                    'txt:' || lower(btrim(ap.product))),
           ap.product, ap.quoted_amount, 'prescription', 1, ap.created_at::date
      from public.audit_prescriptions ap
     where ap.prospect_id = p_pid and ap.status in ('proposed', 'accepted');

    -- 3. open manual deals (not audit-linked, not auto-drafted)
    insert into _pot (k, label, price, src, pri, dt)
    select coalesce(case when d.catalog_item_id is not null then 'bjc:' || d.catalog_item_id || ':' || coalesce(d.catalog_option_id, 0) end,
                    case when d.product_id is not null then 'dc:' || d.product_id end,
                    (select 'dc:' || pp.id from public.products pp where pp.id = public.product_resolve(d.product)),
                    'txt:' || lower(btrim(d.product))),
           d.product, d.amount, 'deal', 2, d.created_at::date
      from public.pipeline_deals d
     where d.prospect_id = p_pid and d.audit_id is null and not d.auto_created
       and d.stage in ('interested', 'proposal', 'prescribed', 'closing');

    -- one row per product: a quote / prescription first (latest one), then a
    -- manual deal, then the catalogue; earliest mention date
    with best as (
        select distinct on (k) k, label, price, src, min(dt) over (partition by k) as first_dt
          from _pot order by k, pri, dt desc nulls last, price desc nulls last
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
    perform public.potential_tier_refresh(p_pid);
    return coalesce(v_total, 0);
end $function$;

-- Recompute when a quote changes; a customer's event notes map to their prospect.
CREATE OR REPLACE FUNCTION public.open_potential_trg()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_pid bigint; v_old bigint; r record;
begin
    if tg_op = 'DELETE' then r := old; else r := new; end if;
    if tg_table_name = 'activities' then
        v_pid := r.prospect_id;
        if v_pid is null and r.customer_id is not null then
            select converted_from_prospect_id into v_pid from public.customers where id = r.customer_id;
        end if;
    elsif tg_table_name = 'event_attendees' then
        if r.attendee_type = 'prospect' then v_pid := r.entity_id;
        elsif r.attendee_type = 'customer' then
            select converted_from_prospect_id into v_pid from public.customers where id = r.entity_id;
        end if;
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
end $function$;

drop trigger if exists trg_open_potential_act on public.activities;
create trigger trg_open_potential_act after insert or delete or update of opportunity_potential, quoted_prices, activity_date, prospect_id, customer_id
    on public.activities for each row execute function public.open_potential_trg();
drop trigger if exists trg_open_potential_ea on public.event_attendees;
create trigger trg_open_potential_ea after insert or delete or update of opportunity_potential, quoted_prices, attendance_status, attended
    on public.event_attendees for each row execute function public.open_potential_trg();

-- recount everyone now (old names start counting today)
select public.open_potential_refresh_all();
