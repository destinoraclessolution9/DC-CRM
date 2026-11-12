-- Undo for migrations/2026-11-12_stale_pieces_closed.sql — puts the 6 pieces
-- back to "not collected" and their orders back to Pending Delivery, exactly
-- as in migrations/2026-11-12_stale_pieces_closed_BACKUP.json (all six had no
-- remarks, no photos, no handover date before).
begin;
alter table public.delivery_items disable trigger trg_journey_item_after;
update public.delivery_items
   set status = 'pending', handover_date = null, legacy_closed = false, remarks = null
 where id in (88, 87, 84, 85, 28, 58) and legacy_closed
   and remarks like 'Old record — marked collected 12 Nov 2026%';
alter table public.delivery_items enable trigger trg_journey_item_after;
update public.purchases set delivery_status = 'Pending Delivery'
 where id in (1776579955634, 1782393426794, 1793605403062003, 1793605411500005, 1793605437790009, 1793605452680011)
   and delivery_status = 'Delivered';
commit;
