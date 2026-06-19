-- ============================================================================
-- adjust_customer_ltv_2026-06-19.sql  (Phase 4 — money: findings #8 #16 #22)
-- ADDITIVE / non-destructive: ADD COLUMN IF NOT EXISTS + count-only backfill +
-- CREATE OR REPLACE FUNCTION. Never recomputes lifetime_value.
--
-- #22: total_purchases never existed as a column (the Avg-Order-Value tile read a
--      phantom field -> always 0). Add it and backfill the COUNT of purchase rows.
--      lifetime_value is deliberately NOT recomputed from purchases: imported /
--      auto-converted customers carry an LTV with zero purchases rows (audit #9),
--      so a recompute would wrongly zero them out.
-- #16/#8: replace the client read-modify-write of lifetime_value (lost-update race
--      + add/delete asymmetry) with a single atomic, symmetric UPDATE. Invoker
--      rights (NO security definer) so the caller's existing RLS on customers still
--      governs the write — identical trust boundary to the PostgREST UPDATE it
--      replaces, just race-free.
-- ============================================================================

alter table public.customers
  add column if not exists total_purchases integer not null default 0;

-- Count-only backfill (safe to re-run).
update public.customers c
   set total_purchases = (select count(*) from public.purchases p where p.customer_id = c.id)
 where total_purchases is distinct from (select count(*) from public.purchases p where p.customer_id = c.id);

create or replace function public.adjust_customer_ltv(
    p_customer_id  bigint,
    p_amount_delta numeric,
    p_count_delta  integer default 0
) returns void
language sql
set search_path to 'public'
as $function$
    update public.customers
       set lifetime_value  = greatest(0, coalesce(lifetime_value, 0) + p_amount_delta),
           total_purchases = greatest(0, coalesce(total_purchases, 0) + p_count_delta)
     where id = p_customer_id;
$function$;

grant execute on function public.adjust_customer_ltv(bigint, numeric, integer) to authenticated, service_role;

notify pgrst, 'reload schema';
