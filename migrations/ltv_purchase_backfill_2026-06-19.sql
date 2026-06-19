-- ============================================================================
-- ltv_purchase_backfill_2026-06-19.sql  (audit #9 — leaderboard<->LTV divergence)
-- ADDITIVE + REVERSIBLE. Inserts ONE clearly-marked purchase row per customer that
-- carries a lifetime_value but has NO purchases rows (imported / pre-system /
-- converted-without-itemized-sale). At time of writing: 3 customers, RM 107,630.
--
-- WHY: revenue/leaderboard reports sum the `purchases` table, so these customers'
-- value was invisible to the leaderboard while showing in their LTV — the audit's
-- #9 divergence. Backfilling a purchase = their current LTV makes purchase-based
-- reports agree with LTV and credits the responsible agent.
--
-- lifetime_value is NOT modified (the backfill amount EQUALS it, so no double-count).
-- BUSINESS ASSUMPTION: imported pre-system balances DO count as the responsible
-- agent's revenue. If that is wrong, this is fully reversible:
--     DELETE FROM public.purchases WHERE invoice = 'IMPORTED-BACKFILL';
--     UPDATE public.customers c SET total_purchases =
--        (SELECT count(*) FROM public.purchases p WHERE p.customer_id = c.id);
-- ============================================================================

insert into public.purchases (id, customer_id, date, item, amount, status, invoice, payment_method, notes, created_at, updated_at)
select
    (select coalesce(max(id), 0) from public.purchases) + row_number() over (order by c.id),
    c.id,
    coalesce(c.customer_since, current_date),
    'Imported / pre-system balance',
    c.lifetime_value,
    'COMPLETED',
    'IMPORTED-BACKFILL',
    'Imported',
    'LTV backfill 2026-06-19 (audit #9). Reversible: DELETE WHERE invoice=''IMPORTED-BACKFILL''.',
    now(), now()
from public.customers c
where coalesce(c.lifetime_value, 0) > 0
  and not exists (select 1 from public.purchases p where p.customer_id = c.id);

-- Keep the denormalized counter consistent for the customers we just backfilled.
update public.customers c
   set total_purchases = (select count(*) from public.purchases p where p.customer_id = c.id)
 where exists (select 1 from public.purchases p where p.customer_id = c.id and p.invoice = 'IMPORTED-BACKFILL');

notify pgrst, 'reload schema';
