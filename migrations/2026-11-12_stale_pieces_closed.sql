-- Stale pieces closed (owner, 2026-11-12: "close the 7 stale pieces for me").
-- Name List "📦 Waiting to collect" flagged 7 pieces "check this record". Six
-- are long past their ready date (Oct 2024 – May 2026) with no word from the
-- office, almost certainly handed over and never ticked — marked collected here
-- the same way as the 22 Oct 2026 clean-up (2026-10-22_old_delivery_items_closed.sql):
-- picked up, legacy_closed (no photo), journey trigger paused so no
-- after-collection steps fire, handover date = the piece's ready date.
-- The 7th (#39, Liew Wen Qi, item "???", no ready date, no invoice, ordered
-- Apr 2026) is NOT old — left pending for the agent to identify.
-- Each piece is the only one on its order → the 6 orders go to Delivered.
-- Before-state: migrations/2026-11-12_stale_pieces_closed_BACKUP.json.
-- Undo: migrations/2026-11-12_stale_pieces_closed_undo.sql.
begin;
do $$
begin
    if (select count(*) from public.delivery_items
         where id in (88, 87, 84, 85, 28, 58) and status = 'pending' and not coalesce(legacy_closed, false)) <> 6 then
        raise exception 'Expected 6 pending pieces (88, 87, 84, 85, 28, 58) — something changed, stopping';
    end if;
end $$;
alter table public.delivery_items disable trigger trg_journey_item_after;
update public.delivery_items di
   set status = 'picked_up', handover_date = coalesce(di.expected_ready_date, di.created_at::date), legacy_closed = true,
       remarks = coalesce(nullif(di.remarks, '') || ' · ', '')
                 || 'Old record — marked collected 12 Nov 2026 (owner OK, no photo; ready date long past)'
 where di.id in (88, 87, 84, 85, 28, 58) and di.status = 'pending';
alter table public.delivery_items enable trigger trg_journey_item_after;
-- orders whose pieces are now all handed over → Delivered
update public.purchases p set delivery_status = 'Delivered'
 where p.id in (select purchase_id from public.delivery_items where id in (88, 87, 84, 85, 28, 58))
   and coalesce(p.delivery_status, '') <> 'Delivered' and coalesce(p.delivery_status, '') !~* 'cancel'
   and not exists (select 1 from public.delivery_items di where di.purchase_id = p.id and di.status = 'pending');
commit;
