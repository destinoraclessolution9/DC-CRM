-- migrations/2026-11-11_tan_soo_chi_link_sales.sql — data fix, owner OK 2026-11-11
-- ("Yes, do it"). Two of Tan Soo Chi's sales sat on her old prospect record only
-- (customer_id NULL), so they missed her customer page and the delivery list:
--   1781358652298  财库，财托      2026-02-28  RM34,660  SN 1908016    Pending Delivery
--   1781358652583  TIAN ZHI XI 2  2023-02-01  RM28,980  PRN19021453  Delivered
-- The 2026-06-19 LTV backfill (ltv_purchase_backfill_2026-06-19.sql) had added a
-- stand-in "Imported / pre-system balance" RM34,660 (1781358652787) + delivery item
-- #27 for the unlinked 财库. With the real sale linked that stand-in is a duplicate,
-- so it is removed. Totals follow the app's rule (lifetime_value = sum, total_purchases
-- = count of her purchases). Copy of the removed rows:
-- migrations/2026-11-11_tan_soo_chi_link_sales_BACKUP.json.
do $$
declare cust bigint := 1781658127572; n int;
begin
    update public.purchases set customer_id = cust
     where id in (1781358652298, 1781358652583) and customer_id is null and prospect_id = 1775715972965;
    get diagnostics n = row_count;
    if n <> 2 then raise exception 'expected 2 sales to link, got %', n; end if;

    delete from public.delivery_items
     where id = 27 and purchase_id = 1781358652787 and status = 'pending' and item_name = 'Imported / pre-system balance';
    get diagnostics n = row_count;
    if n <> 1 then raise exception 'expected 1 placeholder item, got %', n; end if;

    delete from public.purchases where id = 1781358652787 and invoice = 'IMPORTED-BACKFILL' and customer_id = cust;
    get diagnostics n = row_count;
    if n <> 1 then raise exception 'expected 1 placeholder sale, got %', n; end if;

    update public.customers c
       set lifetime_value = (select coalesce(sum(p.amount), 0) from public.purchases p where p.customer_id = c.id),
           total_purchases = (select count(*) from public.purchases p where p.customer_id = c.id),
           updated_at = now()
     where c.id = cust;
end $$;
