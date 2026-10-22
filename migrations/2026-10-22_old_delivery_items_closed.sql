-- Old delivery items closed (owner OK 2026-10-22): 35 items from sales before
-- 21 Oct 2025 still showed "not collected" — almost certainly handed over long
-- ago but never ticked (Old_Delivery_Items_Review_2026-10-21.xlsx). The owner
-- approved marking them collected, except item #41 (Power Ring 8, order
-- Cancelled), which is left as it is.
-- Old records have no handover photo, so a `legacy_closed` flag lets these
-- rows pass the photo rule; every NEW handover in the app still needs a photo.
-- The journey trigger is paused so no after-collection steps fire for old
-- customers.
alter table public.delivery_items add column if not exists legacy_closed boolean not null default false;
alter table public.delivery_items drop constraint if exists delivery_items_handover_chk;
alter table public.delivery_items add constraint delivery_items_handover_chk
    check (status = 'pending' or (handover_date is not null and (jsonb_array_length(photos) > 0 or legacy_closed)));

begin;
alter table public.delivery_items disable trigger trg_journey_item_after;
with t as (
    select di.id, coalesce(p.date, di.created_at::date) d
      from public.delivery_items di
      left join public.purchases p on p.id = di.purchase_id
     where di.status = 'pending' and di.id <> 41
       and (p.date is null or p.date < date '2025-10-21'))
update public.delivery_items di
   set status = 'picked_up', handover_date = t.d, legacy_closed = true,
       remarks = coalesce(nullif(di.remarks, '') || ' · ', '') || 'Old record — marked collected 22 Oct 2026 (owner OK, no photo)'
  from t where di.id = t.id;
alter table public.delivery_items enable trigger trg_journey_item_after;
-- orders whose items are now all handed over → Delivered
update public.purchases p set delivery_status = 'Delivered'
 where coalesce(p.delivery_status, '') <> 'Delivered' and coalesce(p.delivery_status, '') !~* 'cancel'
   and exists (select 1 from public.delivery_items di where di.purchase_id = p.id and di.legacy_closed)
   and not exists (select 1 from public.delivery_items di where di.purchase_id = p.id and di.status = 'pending');
commit;
