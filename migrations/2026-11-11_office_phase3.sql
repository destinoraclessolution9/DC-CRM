-- migrations/2026-11-11_office_phase3.sql
-- Office ready notices, Phase 3 (owner 2026-11-11: "start Phase 3").
--  A. The lender's own piece follows the office's word. When the office says the
--     office piece for a lent item is ready, the advance's "owed back" date becomes
--     that day; the lender's reminder (day 3, then weekly) and to-do row say
--     "collect it from the office · LVL 20 · ready 22 May". The lender still ticks
--     "↩ Returned to me" themselves (owner rule 2026-10-21).
--  B. Better ready dates. journey_item_profile:
--     · "天至喜 1" / "TIAN ZHI XI 1" now get 天至喜1's 4 months, not the 9 months of
--       天至喜3/4 (the loose name match took the slowest 天至喜 for any number);
--     · traditional characters on sales ("元亨利貞") match the simplified product.
--     The owner's lead times themselves are NOT changed.
--  C. Real production times: office_lead_times() — per product group, the days
--     from order to "ready at the office" (median, range, pieces) next to what the
--     CRM uses. Samples: every line of every office sheet read (matched by SN) +
--     office_lead_history (seeded from the 2026-11-11 catch-up of the old sheets).
-- Undo: 2026-11-11_office_phase3_UNDO.sql.

-- ── helpers ─────────────────────────────────────────────────────────────────
-- traditional → simplified for product names (same table as the review screen's _OFN_T2S)
create or replace function public.office_t2s(p text) returns text
language sql immutable as $$
    select translate(coalesce(p, ''), '財庫龍貞寶萬積倉圖鴻勝決書順麗風載機見潤祿晉雲運圓滿極達護環權業傳寧樂長門開發會華興壽歲號體東陽陰將時間臨鳳億雙貴榮譽聖贏錢銀鑽飾鏈經緣紅綠藍黃進遠還過來為對從與無兩實學專葉協廣慶歡覺觀舉夢靈氣豐戰擇據際隨點讀誠說證識議讓變處師歸擁層屬區單嚴團園國圍齊龜錦繡網聯總鐘鐵鏡閣關雞魚鶴獅馬騰創奮鉅轉', '财库龙贞宝万积仓图鸿胜决书顺丽风载机见润禄晋云运圆满极达护环权业传宁乐长门开发会华兴寿岁号体东阳阴将时间临凤亿双贵荣誉圣赢钱银钻饰链经缘红绿蓝黄进远还过来为对从与无两实学专叶协广庆欢觉观举梦灵气丰战择据际随点读诚说证识议让变处师归拥层属区单严团园国围齐龟锦绣网联总钟铁镜阁关鸡鱼鹤狮马腾创奋钜转')
$$;
grant execute on function public.office_t2s(text) to authenticated;

-- A numbered product named with its number: 天至喜1 ↔ "天至喜 1" / "TIAN ZHI XI 1".
-- p_flat = the sold text, lower-cased with spaces removed.
create or replace function public.journey_numbered_match(p_name text, p_flat text) returns boolean
language sql immutable as $$
    select coalesce(
        split_part(p_name, ' ', 1) ~ '[一-鿿]' and split_part(p_name, ' ', 1) ~ '[0-9]'
        and (coalesce(position(lower(regexp_replace(split_part(p_name, ' ', 1), '[（(].*$', '')) in p_flat) > 0, false)
             or coalesce(position(lower(regexp_replace(substring(p_name from '[A-Za-z][A-Za-z ]*[0-9]+'), '\s+', '', 'g')) in p_flat) > 0, false)),
        false)
$$;

-- ── B. ready dates: numbered products + traditional characters ─────────────
create or replace function public.journey_item_profile(p_item text, out lead_days integer, out gr_sessions integer, out is_ring boolean)
 returns record
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
declare v_group text; v_txt text; v_flat text;
begin
    -- "元亨利貞" = 元亨利贞; "天之喜" is a common slip for 天至喜
    v_txt := replace(public.office_t2s(p_item), '天之喜', '天至喜');
    v_flat := lower(regexp_replace(v_txt, '\s+', '', 'g'));
    is_ring := public.journey_is_ring(v_txt);
    -- 1a. products whose FULL name is in the text ("天至喜4 Tian Zhi Xi 4"), or a
    --     numbered product named with its number ("天至喜 1", "TIAN ZHI XI 1");
    --     several items on one sale → the slowest one decides when it is ready
    select max(public.journey_lead_days(pr.delivery_lead_time)), max(pr.golden_road_sessions)
      into lead_days, gr_sessions
      from public.products pr
     where coalesce(pr.is_active, true)
       and ((length(pr.name) >= 3 and position(lower(pr.name) in lower(v_txt)) > 0)
            or public.journey_numbered_match(pr.name, v_flat));
    -- 1b. otherwise a looser name match (full Chinese or English half), slowest wins
    if lead_days is null then
        select max(public.journey_lead_days(pr.delivery_lead_time)), coalesce(gr_sessions, max(pr.golden_road_sessions))
          into lead_days, gr_sessions
          from public.products pr
         where coalesce(pr.is_active, true) and public.pipeline_name_match(v_txt, pr.name);
    end if;
    -- 2. otherwise the product group by keyword (the group's usual lead time)
    if lead_days is null or (is_ring and gr_sessions is null) then
        v_group := public.journey_item_group(v_txt);
        if v_group is not null then
            select coalesce(lead_days, mode() within group (order by public.journey_lead_days(pr.delivery_lead_time))),
                   coalesce(gr_sessions, max(pr.golden_road_sessions))
              into lead_days, gr_sessions
              from public.products pr
             where pr.subcategory = v_group and coalesce(pr.is_active, true) and pr.delivery_lead_time is not null;
        end if;
    end if;
    if gr_sessions is not null and gr_sessions <= 0 then gr_sessions := null; end if;
end $function$;

-- The product group a sold piece belongs to (same matching as the ready date).
create or replace function public.office_lead_group(p_item text) returns text
language plpgsql stable security definer set search_path = public as $$
declare v_txt text := replace(public.office_t2s(p_item), '天之喜', '天至喜'); v_flat text; v text;
begin
    v_flat := lower(regexp_replace(v_txt, '\s+', '', 'g'));
    select pr.subcategory into v from public.products pr
     where coalesce(pr.is_active, true) and pr.subcategory is not null
       and ((length(pr.name) >= 3 and position(lower(pr.name) in lower(v_txt)) > 0) or public.journey_numbered_match(pr.name, v_flat))
     order by public.journey_lead_days(pr.delivery_lead_time) desc nulls last limit 1;
    if v is null then
        select pr.subcategory into v from public.products pr
         where coalesce(pr.is_active, true) and pr.subcategory is not null and public.pipeline_name_match(v_txt, pr.name)
         order by public.journey_lead_days(pr.delivery_lead_time) desc nulls last limit 1;
    end if;
    return coalesce(v, public.journey_item_group(v_txt), 'Other');
end $$;

-- ── A. the lender's piece follows the office date ──────────────────────────
-- a new advance on an item the office already released is owed back from that day
create or replace function public.delivery_advance_fill()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare di record; pu record; prof record;
begin
    select * into di from public.delivery_items where id = new.delivery_item_id;
    if di.id is null then raise exception 'Delivery item not found'; end if;
    if tg_op = 'INSERT' then
        if not public.delivery_advance_allowed(di.item_name) then
            raise exception 'Only calligraphy, artistic masterpieces and 财库/财托 can come from an agent''s own stock';
        end if;
        if di.status = 'pending' then
            raise exception 'Hand the item over to the customer first';
        end if;
        select * into pu from public.purchases where id = di.purchase_id;
        new.customer_id   := di.customer_id;
        new.item_name     := di.item_name;
        new.given_date    := coalesce(new.given_date, di.handover_date);
        new.sale_agent_id := coalesce(new.sale_agent_id, pu.agent_id,
                                      (select responsible_agent_id from public.customers where id = di.customer_id));
        -- the office piece is back when the office says so, else when the order would have been ready
        if new.expected_back is null then
            prof := public.journey_item_profile(di.item_name);
            new.expected_back := coalesce(di.office_ready_date, di.expected_ready_date,
                                          (coalesce(pu.date, new.given_date) + coalesce(prof.lead_days, 120)));
        end if;
        new.created_by := coalesce(new.created_by, public.current_user_row_id());
    end if;
    if tg_op = 'UPDATE' and new.status = 'returned' and old.status = 'owed' then
        new.returned_by := coalesce(public.current_user_row_id(), new.returned_by);
    end if;
    if new.status = 'owed' then new.returned_date := null; end if;
    new.updated_at := now();
    return new;
end $function$;

-- the office says the piece is ready → the owed advance is due back from that day
create or replace function public.delivery_advance_office_trg() returns trigger
language plpgsql security definer set search_path = public as $$
begin
    if new.office_ready_date is not null and new.office_ready_date is distinct from old.office_ready_date then
        update public.delivery_advances set expected_back = new.office_ready_date
         where delivery_item_id = new.id and status = 'owed' and expected_back is distinct from new.office_ready_date;
    end if;
    return null;
exception when others then
    return null;
end $$;
drop trigger if exists trg_delivery_advance_office on public.delivery_items;
create trigger trg_delivery_advance_office after update of office_ready_date on public.delivery_items
    for each row execute function public.delivery_advance_office_trg();

-- reminders: the office's word first (day 3, then weekly), else the owed-back date (as before)
create or replace function public.queue_advance_reminders()
 returns integer
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
declare v_today date := (now() at time zone 'Asia/Kuala_Lumpur')::date; v_n int;
begin
    insert into public.notification_outbox (user_id, kind, priority, title, body, url, dedupe_key, due_at)
    select x.uid, 'advance_due', 'normal',
           case when x.uid = a.lender_agent_id then '↩ Collect your stock back' else '↩ Return stock to ' || coalesce(l.full_name, 'the agent') end,
           left(a.item_name, 40) || ' · lent to ' || coalesce(c.full_name, 'customer') || ' on ' || to_char(a.given_date, 'FMDD Mon')
             || case when di.office_ready_date is not null
                     then ' · ready at the office since ' || to_char(di.office_ready_date, 'FMDD Mon') || coalesce(' · ' || nullif(di.office_ready_place, ''), '')
                     when v_today > a.expected_back then ' · ' || (v_today - a.expected_back) || ' days late'
                     else ' · office piece due today' end,
           './index.html?delivery=1#customers',
           'advance_due:' || a.id || ':' || x.uid || ':' || v_today, now()
      from public.delivery_advances a
      left join public.delivery_items di on di.id = a.delivery_item_id
      left join public.customers c on c.id = a.customer_id
      left join public.users l on l.id = a.lender_agent_id
      cross join lateral (select a.lender_agent_id uid
                          union select a.sale_agent_id where a.sale_agent_id is not null and a.sale_agent_id <> a.lender_agent_id) x
     where a.status = 'owed'
       and case when di.office_ready_date is not null
                then v_today - di.office_ready_date >= 3 and (v_today - di.office_ready_date - 3) % 7 = 0
                else a.expected_back is not null and v_today >= a.expected_back and (v_today - a.expected_back) % 7 = 0 end
    on conflict (user_id, dedupe_key) do nothing;
    get diagnostics v_n = row_count;
    return v_n;
end $function$;

-- pieces already lent when this goes live: owed back from the office date
update public.delivery_advances a set expected_back = di.office_ready_date
  from public.delivery_items di
 where di.id = a.delivery_item_id and a.status = 'owed' and di.office_ready_date is not null
   and a.expected_back is distinct from di.office_ready_date;

-- ── C. real production times ───────────────────────────────────────────────
create table if not exists public.office_lead_history (
  id          bigint generated by default as identity primary key,
  order_kind  text   not null default 'purchase',
  order_id    bigint,
  sn          text,
  order_date  date   not null,
  office_date date   not null,
  item        text,
  order_item  text,
  source      text   not null default 'catch-up 2026-11-11',
  created_at  timestamptz not null default now()
);
alter table public.office_lead_history enable row level security;
-- (no policies: read only through office_lead_times())

-- the 33 old sheets read on 2026-11-11 (their photos were not kept): one row per
-- piece matched to a CRM order — order date → the day the office said ready
insert into public.office_lead_history (order_kind, order_id, sn, order_date, office_date, item, order_item)
select v.* from (values
  ('purchase', 1781358652739, '19024741', date '2023-12-03', date '2024-05-21', '聖智', 'SHENG ZHI WEN CHANG 5 — LAUNCH PROMO X2'),
  ('purchase', 1781358652517, '19024797', date '2023-12-03', date '2024-11-11', '寶王象 3', '1 0 BAO WANG XIANG 3 - LAUNCH PROMO X3'),
  ('purchase', 1781358652496, '19027693', date '2024-10-26', date '2025-01-21', '曲全奮盈,利生藏鉅', 'QU QUAN HUO YING LI SHENG CANG JU'),
  ('purchase', 1781358652424, '19015351', date '2022-01-20', date '2025-01-21', '源祿晉富', 'HU JIA SHIN PACKAGE (PREON + ADDITIONAL FEE)'),
  ('purchase', 1781358652499, '19027477', date '2024-09-08', date '2025-01-24', 'PR 4', 'WISDOM POWER RING / RINGSIZE 20.5'),
  ('purchase', 1781358652502, '19027475', date '2024-09-08', date '2025-01-24', 'PR 5', 'FIVE STAR POWER RING / RINGSIZE 14.5'),
  ('purchase', 1781358652766, '19028687', date '2025-01-19', date '2025-05-30', '元亨利貞', 'YUAN HENG LI ZHEN'),
  ('purchase', 1781358652364, '1921449', date '2024-06-25', date '2025-06-03', '創運聖智', '圣智+ PR 6'),
  ('purchase', 1781358652340, '1935511', date '2025-04-28', date '2025-08-14', '天道酬勤', '天道酬勤'),
  ('purchase', 1781358652349, '1935521', date '2026-06-11', date '2025-08-14', '謙卑而光', 'Calligraphy: 謙卑而光'),
  ('purchase', 1781358652703, '19027195', date '2024-07-08', date '2025-08-15', 'PR 4', 'XIN CHENG PEI TAO / PRODUCT NOTES PR4'),
  ('purchase', 1781358652475, '19029553', date '2025-05-30', date '2025-09-08', '', 'PROSPERITY POWER RING / RINGSIZE 22'),
  ('purchase', 1781358652601, '19020101', date '2022-12-03', date '2025-09-11', '潤雷益德', 'RUN LEI YI DE X3 LAUNCH PROMO'),
  ('purchase', 1781358652361, '1934110', date '2026-06-11', date '2025-09-26', '積倉富', '圣智，积仓福， 源录晋福， 天瑞'),
  ('purchase', 1781358652346, '1935509', date '2026-06-11', date '2025-10-03', '滴水興波', '滴水兴波'),
  ('purchase', 1781358652361, '1934110', date '2026-06-11', date '2025-10-03', '聖智', '圣智，积仓福， 源录晋福， 天瑞'),
  ('purchase', 1781358652358, '1934111', date '2025-07-03', date '2025-10-03', '順麗昭德,雷風赫惠', 'Others: 上龍柄, 长丰，天至喜'),
  ('purchase', 1781358652751, '19026038', date '2024-02-05', date '2025-10-17', '上龍柄- 2nd', 'SHANG LONG BING — LAUNCH PROMO X2'),
  ('purchase', 1781358652472, '19029637', date '2025-07-27', date '2025-10-29', '曲全霍盈,利生藏鉅', 'QU QUAN HUO YING LI SHENG CANG JU'),
  ('purchase', 1781358652361, '1934110', date '2026-06-11', date '2025-10-29', '源祿晉富', '圣智，积仓福， 源录晋福， 天瑞'),
  ('purchase', 1781358652727, '19023510', date '2023-09-16', date '2025-10-29', '元極大通', 'YUAN JI DA TONG — PROMO X3 (DIRECTON)'),
  ('purchase', 1781358652757, '19027928', date '2024-12-01', date '2025-11-21', '逆轉勝', 'NI ZHUAN SHENG — LAUNCH PROMO X3'),
  ('purchase', 1781358652757, '19027928', date '2024-12-01', date '2025-12-19', '逆轉勝 2nd', 'NI ZHUAN SHENG — LAUNCH PROMO X3'),
  ('purchase', 1781358652757, '19027928', date '2024-12-01', date '2026-01-09', '逆轉勝', 'NI ZHUAN SHENG — LAUNCH PROMO X3'),
  ('purchase', 1781358652358, '1934111', date '2025-07-03', date '2026-01-16', '上龍柄', 'Others: 上龍柄, 长丰，天至喜'),
  ('purchase', 1781358652598, '19020118', date '2022-12-03', date '2026-01-16', '藏勝決', 'CANG SHENG JUE X2 LAUNCH PROMO'),
  ('purchase', 1781358652307, '1934137', date '2025-11-05', date '2026-01-26', '天道酬勤', 'Others: 天道酬勤'),
  ('purchase', 1781358652313, '1934136', date '2025-11-05', date '2026-01-26', '聖智', '圣智'),
  ('purchase', 1782393426808, '1934135', date '2025-11-05', date '2026-04-03', '天至喜 2', 'Feng Shui Product: 天之喜 2'),
  ('purchase', 1781358652361, '1934110', date '2026-06-11', date '2026-04-03', '積倉富', '圣智，积仓福， 源录晋福， 天瑞'),
  ('purchase', 1781358652295, '1935530', date '2026-06-11', date '2026-05-22', '元亨利貞', 'Calligraphy Series: 元亨利貞'),
  ('purchase', 1781358652784, '19031257', date '2026-02-02', date '2026-05-22', '天至喜 1', 'TIAN ZHI XI 1'),
  ('purchase', 1781358652781, '19031165', date '2026-01-29', date '2026-05-22', '見龍在田', 'JIAN LONG ZAI TIAN')
) v(order_kind, order_id, sn, order_date, office_date, item, order_item)
where not exists (select 1 from public.office_lead_history h where h.source = 'catch-up 2026-11-11');

create or replace function public.office_lead_times()
 returns table(grp text, set_days integer, pieces integer, median_days integer, min_days integer, max_days integer, examples text)
 language plpgsql stable security definer set search_path to 'public'
as $function$
begin
    if coalesce(public.current_user_level(), 99) > 12 then
        raise exception 'Staff only' using errcode = '42501';
    end if;
    return query
    with live as (   -- every line of every sheet read, matched to a sale by SN
        select 'purchase'::text kind, p.id oid, p.date od,
               coalesce(n.collect_date, (n.created_at at time zone 'Asia/Kuala_Lumpur')::date) fd,
               coalesce(nullif(l.item, ''), p.item) item
          from public.office_notice_lines l
          join public.office_notices n on n.id = l.notice_id and n.status in ('read', 'applied')
          join public.purchases p on public.office_sn_norm(p.invoice) = l.sn_norm
         where l.sn_norm is not null and coalesce(l.decision, '') <> 'not_ours' and p.date is not null
    ), hist as (
        select h.order_kind, h.order_id, h.order_date, h.office_date, coalesce(nullif(h.item, ''), h.order_item)
          from public.office_lead_history h
    ), s as (
        select distinct on (x.kind, x.oid, public.office_t2s(x.item), x.fd) x.item, x.fd - x.od days
          from (select * from live union all select * from hist) x
         order by x.kind, x.oid, public.office_t2s(x.item), x.fd
    ), g as (
        -- a wrong order date (after the sheet) or a promo delivered over years is not production time
        select public.office_lead_group(s.item) grp, (public.journey_item_profile(s.item)).lead_days set_days, s.days, s.item
          from s where s.days between 14 and 365
    )
    select g.grp, g.set_days, count(*)::int, (percentile_disc(0.5) within group (order by g.days))::int,
           min(g.days)::int, max(g.days)::int, string_agg(distinct left(public.office_t2s(g.item), 16), ' · ')
      from g
     group by g.grp, g.set_days
     order by count(*) desc, g.grp;
end $function$;
revoke all on function public.office_lead_times() from public, anon;
grant execute on function public.office_lead_times() to authenticated;

-- ── A. the to-do row for my own stock says where it is ─────────────────────
-- (journey_todo_rows as in 2026-11-11_office_steps_phase2.sql; only the "adv" CTE changed)
create or replace function public.journey_todo_rows(p_uid bigint, p_limit integer default 5, p_agent_view boolean default true)
 returns table(kind text, icon text, prospect_id bigint, customer_id bigint, name text, why text, rm numeric, due date,
               score numeric, ref_id bigint, row_key text, hidden_until date, hidden_action text, shown_days integer)
 language sql stable security definer set search_path to 'public'
as $function$
with t as (select public.journey_today() d),
c as (   -- ① collections, one step at a time (office notices, Phase 2 2026-11-11):
         --   📦 no office word yet: ready ≤ 7 days by the estimate (as before)
         --   🏢 the office says it is ready → collect it from the office
         --   📲 collected → tell the customer
         --   🤝 told 14+ days ago and still not handed over → book the handover
    select 'collect'::text kind,
           (case s.stage when 'told' then '🤝' when 'collected' then '📲' when 'office' then '🏢' else '📦' end)::text icon,
           cu.converted_from_prospect_id pid, cu.id cid, cu.full_name nm,
           case s.stage
                when 'told' then 'Told ' || to_char(s.told, 'FMDD Mon') || ' · ' || left(di.item_name, 30) || ' not collected yet · book the handover + photo'
                when 'collected' then 'Tell the customer · ' || left(di.item_name, 30) || ' collected ' || to_char(di.collected_at, 'FMDD Mon')
                when 'office' then 'Collect ' || left(di.item_name, 30) || ' from the office'
                                   || coalesce(' · ' || nullif(di.office_ready_place, ''), '') || ' · ready ' || to_char(di.office_ready_date, 'FMDD Mon')
                when 'late' then 'Collect ' || left(di.item_name, 30) || ' · ready since ' || to_char(di.expected_ready_date, 'FMDD Mon')
                else 'Ready ' || to_char(di.expected_ready_date, 'FMDD Mon') || ' · book the collection + photo' end why,
           coalesce(pu.amount, 10000)::numeric rm, s.due due,
           greatest(coalesce(pu.amount, 10000), 3000)::numeric money,
           (case s.stage when 'soon' then 2 when 'told' then 2.5 else 3 end
             * (1 + least(greatest(t.d - s.due, 0), 30) / 30.0))::numeric urg,
           di.purchase_id ref
      from public.delivery_items di cross join t
      join public.customers cu on cu.id = di.customer_id
      left join public.purchases pu on pu.id = di.purchase_id
      cross join lateral (select (di.customer_told_at at time zone 'Asia/Kuala_Lumpur')::date told) tt
      cross join lateral (select tt.told,
            case when tt.told is not null then 'told'
                 when di.collected_at is not null then 'collected'
                 when di.office_ready_date is not null then 'office'
                 when di.expected_ready_date < t.d then 'late'
                 else 'soon' end stage,
            case when tt.told is not null then tt.told + 14
                 when di.collected_at is not null then di.collected_at
                 when di.office_ready_date is not null then di.office_ready_date
                 else di.expected_ready_date end due) s
     where di.status = 'pending'
       and coalesce(pu.agent_id, cu.responsible_agent_id) = p_uid
       and case s.stage
             when 'told' then s.due <= t.d
             when 'collected' then di.collected_at >= t.d - 400
             when 'office' then di.office_ready_date <= t.d and di.office_ready_date >= t.d - 400
             else di.expected_ready_date <= t.d + 7 and di.expected_ready_date >= t.d - 120 end
),
g as (   -- ② Golden Road session due
    select 'gr', '🟣', coalesce(tp.prospect_id, cu.converted_from_prospect_id), tp.customer_id, coalesce(cu.full_name, pr.full_name),
           'Golden Road ' || tp.seq || '/' || tp.seq_total || case when tp.due_date < t.d then ' · overdue' else ' · due ' || to_char(tp.due_date, 'FMDD Mon') end,
           coalesce(pu.amount, 10000), tp.due_date,
           greatest(coalesce(pu.amount, 10000), 3000),
           2 * (1 + least(greatest(t.d - tp.due_date, 0), 30) / 30.0),
           tp.purchase_id
      from public.journey_touchpoints tp cross join t
      left join public.customers cu on cu.id = tp.customer_id
      left join public.prospects pr on pr.id = tp.prospect_id
      left join public.purchases pu on pu.id = tp.purchase_id
     where tp.status = 'pending' and tp.seq is not null and tp.assigned_to_id = p_uid and tp.due_date <= t.d + 3
       and coalesce(tp.snooze_until, t.d) <= t.d
),
cps as ( -- ③ CPS with no 2nd meeting (A)
    select 'cps', '🆕', p.id, null::bigint, p.full_name,
           'CPS ' || to_char(x.d, 'FMDD Mon') || ' · no 2nd meeting booked',
           coalesce(nullif(p.open_potential_rm, 0), 5000), x.d,
           greatest(coalesce(p.open_potential_rm, 0), 5000),
           1.5 * case when t.d - x.d <= 14 then 1.2 else 0.8 end,
           null::bigint
      from public.prospects p cross join t
      cross join lateral (select max(a.activity_date) d from public.activities a where a.prospect_id = p.id and a.activity_type = 'CPS') x
     where p.responsible_agent_id = p_uid and x.d between t.d - 30 and t.d - 1
       and coalesce(p.status, '') not in ('converted', 'lost') and not coalesce(p.unable_to_serve, false)
       and coalesce(p.manual_grade, '') <> 'F' and coalesce(p.cps_next_step, '') <> 'not_interested'
       -- the CPS must have its minutes first (an empty one is the "minutes" row below)
       and exists (select 1 from public.activities a where a.prospect_id = p.id and a.activity_type = 'CPS'
                     and a.activity_date = x.d and public.activity_has_minutes(a))
       and not exists (select 1 from public.activities a where a.prospect_id = p.id and a.activity_date > x.d
                         and a.activity_type in ('CPS', 'FTF', 'FSA', 'SITE', 'GR', 'EVENT', 'EVENT_CLOSING'))
       and not exists (select 1 from public.event_attendees ea where ea.attendee_type = 'prospect' and ea.entity_id = p.id
                         and ea.created_at::date >= x.d)
),
hot as ( -- ④ Commit / Audit / Hot with nothing booked
    select 'book', case p.potential_tier when 'commit' then '🟢' when 'audit' then '🩺' else '🔥' end, p.id, null::bigint, p.full_name,
           initcap(p.potential_tier) || ' · RM' || round(p.open_potential_rm / 1000) || 'k · nothing booked'
             || coalesce(case when lm.met then ' · met ' else ' · last contact ' end || to_char(p.potential_last_met, 'FMDD Mon'), ''),
           p.open_potential_rm, p.potential_last_met,
           p.open_potential_rm,
           case p.potential_tier when 'commit' then 3 when 'audit' then 2 else 1.5 end
             * (1 + least(coalesce(t.d - p.potential_last_met, 60), 60) / 60.0),
           null::bigint
      from public.prospects p cross join t
      -- potential_last_met counts calls too: say "met" only for a real meeting
      cross join lateral (select p.potential_last_met is not null and (
               exists (select 1 from public.activities a
                        where a.prospect_id = p.id and a.activity_date::date = p.potential_last_met
                          and a.activity_type in ('CPS', 'FTF', 'FSA', 'SITE', 'EVENT', 'EVENT_CLOSING', 'AGENT_MEETING', 'GR'))
            or exists (select 1 from public.customers c2 join public.activities a on a.customer_id = c2.id
                        where c2.converted_from_prospect_id = p.id and a.activity_date::date = p.potential_last_met
                          and a.activity_type in ('CPS', 'FTF', 'FSA', 'SITE', 'EVENT', 'EVENT_CLOSING', 'AGENT_MEETING', 'GR'))
            or exists (select 1 from public.event_attendees ea join public.events e on e.id = ea.event_id
                        where ea.attendee_type = 'prospect' and ea.entity_id = p.id
                          and (ea.attended or ea.attendance_status = 'Attended')
                          and nullif(e.date::text, '')::date = p.potential_last_met)) met) lm
     where p.responsible_agent_id = p_uid and p.potential_tier in ('commit', 'audit', 'hot')
       and p.potential_next_booked is null and p.open_potential_rm > 0
),
tp as (  -- ⑤ any other journey step due today or overdue
    select 'touch', '🧭', coalesce(j.prospect_id, cu.converted_from_prospect_id), j.customer_id, coalesce(cu.full_name, pr.full_name),
           regexp_replace(j.title, '^\S+\s+', '') || case when j.due_date < t.d then ' · overdue' else '' end,
           coalesce(nullif(pr.open_potential_rm, 0), 3000), j.due_date,
           greatest(coalesce(pr.open_potential_rm, 0), 3000),
           case when j.priority = 'high' then 1.2 else 1 end * (1 + least(greatest(t.d - j.due_date, 0), 30) / 30.0),
           j.id
      from public.journey_touchpoints j cross join t
      left join public.customers cu on cu.id = j.customer_id
      left join public.prospects pr on pr.id = j.prospect_id
     where j.status = 'pending' and j.seq is null and j.assigned_to_id = p_uid and j.due_date <= t.d
       and j.due_date >= t.d - 60 and coalesce(j.snooze_until, t.d) <= t.d
),
pop as ( -- ⑥ POP charge lapsed → collect the manual bank-in receipt
    select 'pop', '💳', cu.converted_from_prospect_id, cu.id, cu.full_name,
           'POP lapsed · ' || to_char(i.due_date, 'FMMon') || ' RM' || round(i.amount) || ' — collect the bank-in receipt',
           i.amount, i.due_date,
           greatest(x.left_rm, 3000),
           2.5 * (1 + least(greatest(t.d - coalesce(i.lapsed_at, i.due_date), 0), 60) / 60.0),
           i.purchase_id
      from public.pop_installments i cross join t
      join public.customers cu on cu.id = i.customer_id
      cross join lateral (select coalesce(sum(j.amount) filter (where j.status in ('due', 'lapsed')), 0) left_rm
                            from public.pop_installments j where j.purchase_id = i.purchase_id) x
     where i.agent_id = p_uid and i.status = 'lapsed'
),
adv as ( -- ⑦ my own stock lent to a customer: office piece due → collect it back
         --   (Phase 3: once the office says that piece is ready, say where and since when)
    select 'advance', '↩', cu.converted_from_prospect_id, cu.id, cu.full_name,
           case when di.office_ready_date is not null
                then 'Collect your ' || left(a.item_name, 24) || ' back from the office'
                     || coalesce(' · ' || nullif(di.office_ready_place, ''), '') || ' · ready ' || to_char(di.office_ready_date, 'FMDD Mon')
                else 'Collect your ' || left(a.item_name, 24) || ' back · lent ' || to_char(a.given_date, 'FMDD Mon')
                     || case when a.expected_back < t.d then ' · ' || (t.d - a.expected_back) || ' days late' else ' · office piece due' end end,
           coalesce(pu.amount, 5000), a.expected_back,
           greatest(coalesce(pu.amount, 5000), 3000),
           1.5 * (1 + least(greatest(t.d - a.expected_back, 0), 60) / 60.0),
           a.id
      from public.delivery_advances a cross join t
      join public.customers cu on cu.id = a.customer_id
      left join public.delivery_items di on di.id = a.delivery_item_id
      left join public.purchases pu on pu.id = di.purchase_id
     where a.lender_agent_id = p_uid and a.status = 'owed' and a.expected_back <= t.d + 3
),
mins as ( -- ⓪ a CPS / FTF that already happened with no minutes yet (≤ 14 days)
    select 'minutes', '📝', a.prospect_id, null::bigint, pr.full_name,
           'Fill the ' || a.activity_type || ' minutes · ' || to_char(a.activity_date, 'FMDD Mon')
             || case when t.d - a.activity_date = 1 then ' (yesterday)' else ' (' || (t.d - a.activity_date) || ' days ago)' end,
           coalesce(nullif(pr.open_potential_rm, 0), 5000), a.activity_date,
           greatest(coalesce(pr.open_potential_rm, 0), 5000),
           2 * case when a.activity_type = 'CPS' then 1.2 else 1 end,
           a.id
      from public.activities a cross join t
      join public.prospects pr on pr.id = a.prospect_id
     where a.activity_type in ('CPS', 'FTF') and a.activity_date between t.d - 14 and t.d - 1
       and coalesce(a.lead_agent_id, pr.responsible_agent_id) = p_uid
       and coalesce(pr.status, '') not in ('converted', 'lost') and not coalesce(pr.unable_to_serve, false)
       and not public.activity_has_minutes(a)
       and not exists (select 1 from public.activities b where b.prospect_id = a.prospect_id and b.id <> a.id
                         and b.activity_date > a.activity_date and b.activity_date <= t.d
                         and b.activity_type in ('CPS', 'FTF', 'FSA', 'SITE', 'GR', 'EVENT_CLOSING'))
),
ofp as ( -- ⑧ a closing saved without its order-form photo (attach later — owner 2026-10-22)
    select 'photo', '📸', a.prospect_id, cu.id, coalesce(cu.full_name, pr.full_name),
           'Attach the order form photo · closed ' || to_char(a.activity_date, 'FMDD Mon'),
           coalesce(nullif(a.closing_amount, 0), 5000), a.activity_date,
           greatest(coalesce(a.closing_amount, 0), 5000),
           3 * (1 + least(greatest(t.d - a.activity_date, 0), 30) / 30.0),
           a.id
      from public.activities a cross join t
      join public.prospects pr on pr.id = a.prospect_id
      left join lateral (select c2.id, c2.full_name from public.customers c2
                          where c2.converted_from_prospect_id = a.prospect_id order by c2.id limit 1) cu on true
     where a.is_closing and coalesce(a.lead_agent_id, pr.responsible_agent_id) = p_uid
       -- owner 2026-10-22: every closing from 1 Jan 2026
       and a.activity_date >= date '2026-01-01' and a.activity_date <= t.d
       and not exists (select 1 from public.prospect_attachments pa
                        where pa.prospect_id = a.prospect_id and pa.attachment_type = 'order_form'
                          and pa.metadata->>'activity_id' = a.id::text)
       -- before 22 Oct photos were not tagged with their closing: any order-form
       -- photo or invoice on the prospect's closing record counts as attached
       and not (a.activity_date < date '2026-10-22' and (
                exists (select 1 from public.prospect_attachments pa
                         where pa.prospect_id = a.prospect_id and pa.attachment_type = 'order_form')
             or nullif(pr.closing_record->>'invoice_file', '') is not null
             or exists (select 1 from jsonb_array_elements(case when jsonb_typeof(pr.closing_records_history) = 'array'
                                                               then pr.closing_records_history else '[]'::jsonb end) h
                         where nullif(h->>'invoice_file', '') is not null)))
),
allx as (select * from c union all select * from mins union all select * from g union all select * from cps union all select * from hot
         union all select * from tp union all select * from pop union all select * from adv union all select * from ofp),
k as (select x.*, public.journey_todo_key(x.kind, x.pid, x.cid, x.ref) rk from allx x where x.nm is not null),
hid as ( -- rows I put away that are still away
    select z.row_key, z.until, z.action from public.todo_snoozes z cross join t
     where z.user_id = p_uid and z.until > t.d
),
seen as ( -- days each row was in my morning top 5 over the last week (today not counted)
    select h.row_key, count(*)::int n from public.todo_shown h cross join t
     where h.user_id = p_uid and h.day between t.d - 7 and t.d - 1
     group by h.row_key
),
scored as (
    select k.*, hid.until h_until, hid.action h_action, coalesce(seen.n, 0) n,
           -- money counts up to RM30k, then urgency decides; fatigue only in the agent's own view
           least(k.money, 30000) * k.urg
             * case when p_agent_view and coalesce(seen.n, 0) >= 3 then power(0.5, coalesce(seen.n, 0) - 2) else 1 end sc
      from k
      left join hid on hid.row_key = k.rk
      left join seen on seen.row_key = k.rk
     where not (p_agent_view and hid.row_key is not null)
),
best as (
    select distinct on (coalesce('c' || cid::text, 'p' || pid::text)) * from scored
     order by coalesce('c' || cid::text, 'p' || pid::text), sc desc
)
select kind, icon, pid, cid, nm, why, rm, due, round(sc), ref, rk, h_until, h_action, n
  from best order by sc desc, rk limit greatest(coalesce(p_limit, 5), 1)
$function$;
revoke all on function public.journey_todo_rows(bigint, integer, boolean) from public, anon, authenticated;
