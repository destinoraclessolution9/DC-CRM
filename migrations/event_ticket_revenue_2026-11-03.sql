-- Big event ticket sales per category (2026-11-03, phase 2). Additive only.
--
-- One session (p_date) or the whole event across all its dates (p_date null).
-- Amounts are the price snapshotted on each attendee (event_attendees.
-- ticket_price, early bird included); "paid" = the attendee's Paid tick.
-- Admin / Marketing Manager (level <= 2) only — everyone else gets no rows.
create or replace function public.event_ticket_revenue(p_event bigint, p_date date default null)
returns table(ticket_tier text, taken integer, amount numeric, paid_count integer, paid_amount numeric)
language sql stable security definer set search_path = public as $$
  select ea.ticket_tier,
         count(*)::int,
         coalesce(sum(ea.ticket_price), 0),
         (count(*) filter (where ea.paid))::int,
         coalesce(sum(ea.ticket_price) filter (where ea.paid), 0)
  from public.event_attendees ea
  join public.activities a on a.id = ea.activity_id
  where coalesce(public.current_user_level(), 99) <= 2
    and ea.event_id = p_event
    and a.event_id = p_event
    and (p_date is null or a.activity_date = p_date)
    and ea.ticket_tier is not null
  group by 1;
$$;
revoke all on function public.event_ticket_revenue(bigint, date) from public, anon;
grant execute on function public.event_ticket_revenue(bigint, date) to authenticated;
