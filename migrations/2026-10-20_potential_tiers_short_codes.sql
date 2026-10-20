-- 🏷️ product short codes (suggested; owner approves into short_code)
alter table public.products add column if not exists short_code text, add column if not exists short_code_suggested text;
update public.products set short_code_suggested = 'WFT' where id = 1775468320159;
update public.products set short_code_suggested = 'SLB' where id = 1775796093298;
update public.products set short_code_suggested = 'SLB-P' where id = 1792025261420;
update public.products set short_code_suggested = 'NYHL' where id = 1792025261416;
update public.products set short_code_suggested = 'NYHL-P' where id = 1792025261417;
update public.products set short_code_suggested = 'JCF' where id = 1775796026053;
update public.products set short_code_suggested = 'JCF-P' where id = 1792025261419;
update public.products set short_code_suggested = 'NZS' where id = 1775795881270;
update public.products set short_code_suggested = 'NZS-P' where id = 1792025261418;
update public.products set short_code_suggested = 'ZXJ1' where id = 1792025261421;
update public.products set short_code_suggested = 'ZXJ2' where id = 1792025261422;
update public.products set short_code_suggested = 'ZXJ3' where id = 1792025261423;
update public.products set short_code_suggested = 'ZXJ4' where id = 1792025261424;
update public.products set short_code_suggested = 'ZXJ5' where id = 1792025261425;
update public.products set short_code_suggested = 'ZXJ6' where id = 1792025261426;
update public.products set short_code_suggested = 'ZXJ7' where id = 1792025261427;
update public.products set short_code_suggested = 'SFT' where id = 1775468325136;
update public.products set short_code_suggested = 'SSRS' where id = 1775468324369;
update public.products set short_code_suggested = 'JCL' where id = 1775468325859;
update public.products set short_code_suggested = 'YXYS' where id = 1775468323366;
update public.products set short_code_suggested = 'YHLZ' where id = 1775468323451;
update public.products set short_code_suggested = 'YJDT' where id = 1775468319915;
update public.products set short_code_suggested = 'LQYZ' where id = 1775468328012;
update public.products set short_code_suggested = 'HDZW' where id = 1775468329089;
update public.products set short_code_suggested = 'SZWC5' where id = 1775468321329;
update public.products set short_code_suggested = 'DMF' where id = 1775468315666;
update public.products set short_code_suggested = 'TZX1' where id = 1775468321751;
update public.products set short_code_suggested = 'TZX2' where id = 1775468322785;
update public.products set short_code_suggested = 'TZX3' where id = 1775468321964;
update public.products set short_code_suggested = 'TZX4' where id = 1775468321882;
update public.products set short_code_suggested = 'TZX4-P' where id = 1775900000010;
update public.products set short_code_suggested = 'TDCQ' where id = 1775468330334;
update public.products set short_code_suggested = 'BWX1' where id = 1775468326101;
update public.products set short_code_suggested = 'BWX2' where id = 1775468317595;
update public.products set short_code_suggested = 'BWX3' where id = 1775468318919;
update public.products set short_code_suggested = 'FTP1' where id = 1775468318288;
update public.products set short_code_suggested = 'FTP2' where id = 1775468317686;
update public.products set short_code_suggested = 'KXWC2' where id = 1775468328615;
update public.products set short_code_suggested = 'QQHY' where id = 1775468323372;
update public.products set short_code_suggested = 'YWXS' where id = 1775468323913;
update public.products set short_code_suggested = 'SJFL' where id = 1775468322708;
update public.products set short_code_suggested = 'RLYD' where id = 1775468319907;
update public.products set short_code_suggested = 'YH' where id = 1775468323345;
update public.products set short_code_suggested = 'YLJF' where id = 1775468317628;
update public.products set short_code_suggested = 'DSXB' where id = 1775468324275;
update public.products set short_code_suggested = 'ZRQQ' where id = 1775468330482;
update public.products set short_code_suggested = 'JCL-P' where id = 1775900000011;
update public.products set short_code_suggested = 'JRYC' where id = 1775468325343;
update public.products set short_code_suggested = 'ZTYZ' where id = 1775468322880;
update public.products set short_code_suggested = 'JLZT' where id = 1775468329362;
update public.products set short_code_suggested = 'QBEG' where id = 1775468324096;
update public.products set short_code_suggested = 'SLZD' where id = 1775468328099;
update public.products set short_code_suggested = 'CSJ' where id = 1775468319428;
update public.products set short_code_suggested = 'KXWC3' where id = 1775468325308;
update public.products set short_code_suggested = 'HLYJ' where id = 1775468317845;
update public.products set short_code_suggested = 'PCA' where id = 1775900000001;
update public.products set short_code_suggested = 'PRA' where id = 1775900000002;
update public.products set short_code_suggested = 'ANP' where id = 1775468328779;
update public.products set short_code_suggested = 'WRA' where id = 1775900000008;
update public.products set short_code_suggested = 'NCDC' where id = 1775900000004;
update public.products set short_code_suggested = 'ANC' where id = 1775900000005;
update public.products set short_code_suggested = 'MGZZ' where id = 1775468332062;
update public.products set short_code_suggested = 'CFC' where id = 1775900000006;
update public.products set short_code_suggested = 'FMA' where id = 1775900000009;
update public.products set short_code_suggested = 'HFC' where id = 1775900000003;
update public.products set short_code_suggested = 'PDNB' where id = 1775468326749;
update public.products set short_code_suggested = 'ANNB' where id = 1775468331447;
update public.products set short_code_suggested = 'XGJY26' where id = 1775468329994;
update public.products set short_code_suggested = 'SMLT3' where id = 1775468325122;
update public.products set short_code_suggested = 'SMLT5' where id = 1775468323880;
update public.products set short_code_suggested = 'TLC' where id = 1775900000007;
update public.products set short_code_suggested = 'GXFW' where id = 1775468429681;
update public.products set short_code_suggested = '专案-Condo-1.5k' where id = 1792025261410;
update public.products set short_code_suggested = '专案-Condo-2k' where id = 1792025261411;
update public.products set short_code_suggested = '专案-Condo-1k' where id = 1792025261409;
update public.products set short_code_suggested = '专案-SD' where id = 1792025261413;
update public.products set short_code_suggested = '专案-Terrace' where id = 1792025261414;
update public.products set short_code_suggested = '专案-Bungalow' where id = 1792025261412;
update public.products set short_code_suggested = '商业' where id = 1775468323359;
update public.products set short_code_suggested = '灵活-3T' where id = 1792025261405;
update public.products set short_code_suggested = '灵活-3T-C' where id = 1792025261402;
update public.products set short_code_suggested = '灵活-Condo' where id = 1792025261408;
update public.products set short_code_suggested = '灵活-1T' where id = 1792025261407;
update public.products set short_code_suggested = '灵活-1T-C' where id = 1792025261404;
update public.products set short_code_suggested = '灵活-3SD' where id = 1792025261400;
update public.products set short_code_suggested = '灵活-2SD' where id = 1792025261401;
update public.products set short_code_suggested = '灵活-2T' where id = 1792025261406;
update public.products set short_code_suggested = '灵活-2T-C' where id = 1792025261403;
update public.products set short_code_suggested = '简易-Condo' where id = 1792025261399;
update public.products set short_code_suggested = '简易-SD' where id = 1792025261397;
update public.products set short_code_suggested = '简易-Terrace' where id = 1792025261398;
update public.products set short_code_suggested = '简易-Bungalow' where id = 1792025261396;
update public.products set short_code_suggested = '换天心' where id = 1792025261415;
update public.products set short_code_suggested = 'SPEC' where id = 1775799118825;
update public.products set short_code_suggested = 'PR1' where id = 1775468317455;
update public.products set short_code_suggested = 'PR7' where id = 1775468319716;
update public.products set short_code_suggested = 'PR3' where id = 1775468321577;
update public.products set short_code_suggested = 'PR5' where id = 1775468321033;
update public.products set short_code_suggested = 'PR-HE' where id = 1775468318134;
update public.products set short_code_suggested = 'PR8' where id = 1775468321161;
update public.products set short_code_suggested = 'PR6' where id = 1775468314810;
update public.products set short_code_suggested = 'PR-AU' where id = 1775468319688;
update public.products set short_code_suggested = 'PR-WI' where id = 1775468321308;
update public.products set short_code_suggested = 'PR9' where id = 1775468321988;
update public.products set short_code_suggested = 'DC-AGENT' where id = 1783261890804001;
update public.products set short_code_suggested = 'CK' where id = 1775468329485;
update public.products set short_code_suggested = 'CT' where id = 1775468324663;

-- 💼 Business-potential tiers (2026-10-20). Additive.
-- Each person with open potential sits in ONE tier (highest that applies):
--   commit  🟢 an open deal at Closing
--   audit   🩺 Feng Shui audit potential / open prescription keyed ≤ 183 days ago
--   hot     🔥 met ≤ 90 days AND (visited 汇集 · met 3+ times in a year ·
--              VIP (RM50k+) customer referral · ⚡ High Closer referral),
--              OR registered for an upcoming 汇集
--   new     🌱 met ≤ 30 days (CPS / first meetings)
--   cold    💤 none of the above — outside the forecast, listed to reactivate
-- Plus: last_met, next_booked, meetings in 365 days, repeat customer.

alter table public.prospects
    add column if not exists potential_tier text,
    add column if not exists potential_last_met date,
    add column if not exists potential_next_booked date,
    add column if not exists potential_meet_count int not null default 0,
    add column if not exists potential_is_repeat boolean not null default false;

create or replace function public.potential_tier_refresh(p_pid bigint) returns text
language plpgsql security definer set search_path = public as $$
declare
    v_today date := (now() at time zone 'Asia/Kuala_Lumpur')::date;
    v_rm numeric; v_cust bigint; v_tier text;
    v_last date; v_next date; v_meets int; v_repeat boolean;
    v_huiji boolean; v_rsvp boolean; v_ref boolean; v_audit boolean; v_commit boolean;
    p record;
begin
    select * into p from public.prospects where id = p_pid;
    if p.id is null then return null; end if;
    v_rm := coalesce(p.open_potential_rm, 0);
    select id into v_cust from public.customers where converted_from_prospect_id = p_pid limit 1;
    v_repeat := v_cust is not null or p.status = 'converted';

    -- meetings (face-to-face kinds) + attended events
    select max(d) filter (where d <= v_today), min(d) filter (where d >= v_today),
           count(*) filter (where d between v_today - 365 and v_today and kind = 'meet')
      into v_last, v_next, v_meets
      from (
        select a.activity_date::date d,
               case when a.activity_type in ('CPS','FTF','FSA','SITE','EVENT','EVENT_CLOSING','AGENT_MEETING','GR') then 'meet' else 'other' end kind
          from public.activities a
         where (a.prospect_id = p_pid or (v_cust is not null and a.customer_id = v_cust)) and a.activity_date is not null
        union all
        select nullif(e.date::text, '')::date, case when ea.attended or ea.attendance_status = 'Attended' then 'meet' else 'other' end
          from public.event_attendees ea join public.events e on e.id = ea.event_id
         where ea.attendee_type = 'prospect' and ea.entity_id = p_pid and coalesce(ea.attendance_status, '') <> 'No Show'
      ) x;

    select exists (select 1 from public.event_attendees ea join public.events e on e.id = ea.event_id
                    where ea.attendee_type = 'prospect' and ea.entity_id = p_pid
                      and (ea.attended or ea.attendance_status = 'Attended')
                      and (coalesce(e.categories::text, '') ~ '汇[集聚]' or coalesce(e.title, '') ~ '汇[集聚]')) into v_huiji;
    select exists (select 1 from public.event_attendees ea join public.events e on e.id = ea.event_id
                    where ea.attendee_type = 'prospect' and ea.entity_id = p_pid
                      and coalesce(ea.attendance_status, 'Registered') = 'Registered'
                      and nullif(e.date::text, '')::date >= v_today
                      and (coalesce(e.categories::text, '') ~ '汇[集聚]' or coalesce(e.title, '') ~ '汇[集聚]')) into v_rsvp;
    -- high-chance referral: VIP customer (lifetime ≥ RM50k) or ⚡ High Closer agent
    v_ref := false;
    if lower(coalesce(p.referred_by_type, '')) = 'customer' and p.referred_by_id is not null then
        select coalesce(sum(pu.amount), 0) >= 50000 into v_ref
          from public.customers c join public.purchases pu
            on (pu.customer_id = c.id or (c.converted_from_prospect_id is not null and pu.prospect_id = c.converted_from_prospect_id))
         where (c.id = p.referred_by_id or c.converted_from_prospect_id = p.referred_by_id)
           and coalesce(pu.status, '') !~* 'cancel|refund|void' and pu.amount > 0;
    elsif lower(coalesce(p.referred_by_type, '')) in ('consultant', 'agent') and p.referred_by_id is not null then
        select exists (select 1 from public.agent_labels al where al.user_id = p.referred_by_id and al.high_closer) into v_ref;
    end if;
    v_commit := exists (select 1 from public.pipeline_deals d where d.prospect_id = p_pid and d.stage = 'closing');
    v_audit := exists (select 1 from jsonb_array_elements(coalesce(p.feng_shui_audits::jsonb, '[]'::jsonb)) a
                        where coalesce(a->>'products', '') like '%[%'
                          and coalesce(nullif(a->>'created_at', '')::date, nullif(a->>'audit_date', '')::date) >= v_today - 183)
            or exists (select 1 from public.audit_prescriptions r where r.prospect_id = p_pid
                        and r.status in ('proposed', 'accepted') and r.created_at::date >= v_today - 183);

    v_tier := case
        when v_rm <= 0 then null
        when v_commit then 'commit'
        when v_audit then 'audit'
        when v_rsvp or (v_last >= v_today - 90 and (v_huiji or v_meets >= 3 or v_ref)) then 'hot'
        when v_last >= v_today - 30 then 'new'
        else 'cold' end;

    update public.prospects
       set potential_tier = v_tier, potential_last_met = v_last, potential_next_booked = v_next,
           potential_meet_count = coalesce(v_meets, 0), potential_is_repeat = coalesce(v_repeat, false)
     where id = p_pid
       and (potential_tier is distinct from v_tier or potential_last_met is distinct from v_last
            or potential_next_booked is distinct from v_next or potential_meet_count is distinct from coalesce(v_meets, 0)
            or potential_is_repeat is distinct from coalesce(v_repeat, false));
    return v_tier;
exception when others then
    return null;
end $$;
revoke all on function public.potential_tier_refresh(bigint) from public, anon;

-- Daily tier snapshots → after 90 days the panel uses YOUR close rate per tier.
create table if not exists public.potential_snapshots (
    snap_date   date   not null,
    prospect_id bigint not null,
    tier        text   not null,
    rm          numeric not null,
    agent_id    bigint,
    primary key (snap_date, prospect_id)
);
alter table public.potential_snapshots enable row level security;
drop policy if exists ps_select on public.potential_snapshots;
create policy ps_select on public.potential_snapshots for select to authenticated
    using (coalesce(public.current_user_level(), 99) <= 2 or agent_id in (select public.current_user_visible_ids()));
grant select on public.potential_snapshots to authenticated;

-- Close rate per tier: snapshots ≥ 90 days old → did that person buy within 90 days?
create or replace function public.potential_tier_rates() returns table (tier text, samples int, won int, rate numeric)
language sql stable security definer set search_path = public as $$
    select s.tier, count(*)::int,
           count(*) filter (where exists (
               select 1 from public.purchases pu left join public.customers c on c.id = pu.customer_id
                where (pu.prospect_id = s.prospect_id or c.converted_from_prospect_id = s.prospect_id)
                  and pu.amount > 0 and pu.date > s.snap_date and pu.date <= s.snap_date + 90))::int,
           round(100.0 * count(*) filter (where exists (
               select 1 from public.purchases pu left join public.customers c on c.id = pu.customer_id
                where (pu.prospect_id = s.prospect_id or c.converted_from_prospect_id = s.prospect_id)
                  and pu.amount > 0 and pu.date > s.snap_date and pu.date <= s.snap_date + 90)) / greatest(count(*), 1), 1)
      from public.potential_snapshots s
     where s.snap_date <= (now() at time zone 'Asia/Kuala_Lumpur')::date - 90
     group by s.tier
$$;
grant execute on function public.potential_tier_rates() to authenticated;

create or replace function public.open_potential_refresh_all() returns integer
language plpgsql security definer set search_path = public as $$
declare r record; n int := 0; v_today date := (now() at time zone 'Asia/Kuala_Lumpur')::date;
begin
    for r in select id from public.prospects loop
        perform public.open_potential_refresh(r.id); n := n + 1;
    end loop;
    insert into public.potential_snapshots (snap_date, prospect_id, tier, rm, agent_id)
    select v_today, id, potential_tier, open_potential_rm, responsible_agent_id
      from public.prospects where open_potential_rm > 0 and potential_tier is not null
    on conflict (snap_date, prospect_id) do update set tier = excluded.tier, rm = excluded.rm, agent_id = excluded.agent_id;
    return n;
end $$;
revoke all on function public.open_potential_refresh_all() from public, anon, authenticated;

-- refresh after the tier function exists
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
    perform public.potential_tier_refresh(p_pid);
    return coalesce(v_total, 0);
end $$;

drop trigger if exists trg_open_potential_ea on public.event_attendees;
create trigger trg_open_potential_ea after insert or update of opportunity_potential, attendance_status, attended or delete
    on public.event_attendees for each row execute function public.open_potential_trg();
