-- ═══════════════════════════════════════════════════════════════════════════
-- Product lead times from the owner (2026-10-21)
--
-- A sale's ready date = sale date + lead time; it drives the 📦 ready push,
-- Step 3 / Step 4 and the 📋 top-5 "collect" row. Owner's numbers:
--   Power Ring 6 months · Calligraphy 4 months (天至喜3/4, 宝王象, 长胜决 9)
--   Artistic Masterpieces 8 months · Royal Woodwork 财库/财托 9 months
--   专案 3 months · 灵活 / 简易 / 商业 Feng Shui 2 months
-- Sales usually carry shorthand ("专案 Project Plan", "Flexi Fengshui Double
-- story", "Calligraphy: 謙卑而光"), so journey_item_profile now falls back to
-- the product GROUP by keyword when no product name matches.
-- ═══════════════════════════════════════════════════════════════════════════

update public.products set delivery_lead_time = 'About 6 months' where subcategory = 'Power Ring';
update public.products set delivery_lead_time = 'About 4 months' where subcategory = 'Calligraphy Adornment';
update public.products set delivery_lead_time = 'About 9 months'
 where subcategory = 'Calligraphy Adornment' and name ~ '(天至喜[34]|宝王象|长胜决)';
update public.products set delivery_lead_time = 'About 8 months' where subcategory = 'Artistic Masterpieces';
update public.products set delivery_lead_time = 'About 9 months' where subcategory = 'Royal Woodwork Series';
update public.products set delivery_lead_time = 'About 3 months' where subcategory = 'Fengshui Audit · 专案 Direct On';
update public.products set delivery_lead_time = 'About 2 months'
 where subcategory in ('Fengshui Audit · 灵活 Flexi', 'Fengshui Audit · 简易 Simplified', 'Fengshui Audit · 商业 Commercial');

-- Sold-item text → product group (when no single product name matches)
create or replace function public.journey_item_group(p_item text) returns text
language sql immutable as $$
    select case
        when public.journey_is_ring(p_item) then 'Power Ring'
        when p_item ~* '(专案|project\s*plan|direct\s*on)' then 'Fengshui Audit · 专案 Direct On'
        when p_item ~* '(灵活|flexi|plexi)' then 'Fengshui Audit · 灵活 Flexi'
        when p_item ~* '(简易|simplif)' then 'Fengshui Audit · 简易 Simplified'
        when p_item ~* '(商业|commercial)' then 'Fengshui Audit · 商业 Commercial'
        when p_item ~* '(财库|财托|cai\s*ku|cai\s*tuo|woodwork)' then 'Royal Woodwork Series'
        when p_item ~* '(artistic|masterpiece)' then 'Artistic Masterpieces'
        when p_item ~* '(calligraph|书法|画作)' then 'Calligraphy Adornment'
        else null end
$$;

create or replace function public.journey_item_profile(p_item text, out lead_days integer, out gr_sessions integer, out is_ring boolean)
language plpgsql stable security definer set search_path = public as $$
declare v_group text;
begin
    is_ring := public.journey_is_ring(p_item);
    -- 1a. products whose FULL name is in the text ("天至喜4 Tian Zhi Xi 4");
    --     several items on one sale → the slowest one decides when it is ready
    select max(public.journey_lead_days(pr.delivery_lead_time)), max(pr.golden_road_sessions)
      into lead_days, gr_sessions
      from public.products pr
     where coalesce(pr.is_active, true) and length(pr.name) >= 3
       and position(lower(pr.name) in lower(coalesce(p_item, ''))) > 0;
    -- 1b. otherwise a looser name match (full Chinese or English half), slowest wins
    if lead_days is null then
        select max(public.journey_lead_days(pr.delivery_lead_time)), coalesce(gr_sessions, max(pr.golden_road_sessions))
          into lead_days, gr_sessions
          from public.products pr
         where coalesce(pr.is_active, true) and public.pipeline_name_match(p_item, pr.name);
    end if;
    -- 2. otherwise the product group by keyword (the group's usual lead time)
    if lead_days is null or (is_ring and gr_sessions is null) then
        v_group := public.journey_item_group(p_item);
        if v_group is not null then
            select coalesce(lead_days, mode() within group (order by public.journey_lead_days(pr.delivery_lead_time))),
                   coalesce(gr_sessions, max(pr.golden_road_sessions))
              into lead_days, gr_sessions
              from public.products pr
             where pr.subcategory = v_group and coalesce(pr.is_active, true) and pr.delivery_lead_time is not null;
        end if;
    end if;
    if gr_sessions is not null and gr_sessions <= 0 then gr_sessions := null; end if;
end $$;

-- Back-fill: this year's items still waiting with no ready date (the BEFORE
-- trigger fills it, the AFTER trigger adds Step 3 / Step 4 + Golden Road).
update public.delivery_items di set expected_ready_date = expected_ready_date
 where di.status = 'pending' and di.expected_ready_date is null
   and exists (select 1 from public.purchases p where p.id = di.purchase_id
                and p.date >= (now() at time zone 'Asia/Kuala_Lumpur')::date - 365);
