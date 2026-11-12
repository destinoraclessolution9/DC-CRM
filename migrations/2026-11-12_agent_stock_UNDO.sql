-- UNDO for migrations/2026-11-12_agent_stock.sql. Drops the 📦 My stock ledger
-- (every line typed by agents is lost — export agent_stock_moves first) and puts
-- delivery_advance_allowed back to simplified-characters only.
drop trigger if exists trg_agent_stock_from_advance on public.delivery_advances;
drop function if exists public.agent_stock_from_advance();
drop function if exists public.agent_stock_counts(text);
drop function if exists public.agent_stock_balance(bigint);
drop table if exists public.agent_stock_moves;
drop function if exists public.agent_stock_move_fill();
drop function if exists public.agent_stock_product(text);
drop function if exists public.agent_stock_products();
drop function if exists public.agent_stock_flat(text);

create or replace function public.delivery_advance_allowed(p_item text) returns boolean
language sql stable security definer set search_path = public as $$
    select not public.journey_is_ring(p_item)
       and coalesce(public.journey_item_group(p_item), '') not like 'Fengshui%'
       and (coalesce(public.journey_item_group(p_item), '') in ('Calligraphy Adornment', 'Artistic Masterpieces', 'Royal Woodwork Series')
            or exists (select 1 from public.products pr
                        where pr.subcategory in ('Calligraphy Adornment', 'Artistic Masterpieces', 'Royal Woodwork Series')
                          and coalesce(pr.is_active, true) and public.pipeline_name_match(p_item, pr.name)))
$$;
