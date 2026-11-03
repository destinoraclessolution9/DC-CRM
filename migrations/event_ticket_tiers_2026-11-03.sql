-- Big-event ticket categories (2026-11-03). Additive only.
--
-- events.is_big_event  ticks the event as a big event: the single Ticket Price is
--                      replaced by ticket categories (Super VIP / VVIP / VIP …).
-- events.ticket_tiers  [{ key, name, price, early_price, early_end, seats }]
--                      seats = { "<users.team label>": n, "_none": n } — each team
--                      has its own pool per session date; a missing / null number
--                      means no limit. Full is a warning, never a block.
-- event_attendees.ticket_*  what the attendee was registered under, snapshotted at
--                      registration so a later price / team change never rewrites
--                      it: tier key + name, the price charged (early bird if
--                      registered on or before early_end), and the adder's team.
alter table public.events add column if not exists is_big_event boolean default false;
alter table public.events add column if not exists ticket_tiers jsonb;

alter table public.event_attendees add column if not exists ticket_tier text;
alter table public.event_attendees add column if not exists ticket_tier_name text;
alter table public.event_attendees add column if not exists ticket_price numeric;
alter table public.event_attendees add column if not exists ticket_team text;

-- Seats taken per (team, tier) for one session (event + date). Counts only — no
-- names — so it can see every agent's activity rows for the session, including
-- closed / team-visibility ones the caller's activities RLS would hide (an agent
-- must not be told "3 left" when another team member's private activity already
-- holds them). '' = no team.
create or replace function public.event_ticket_counts(p_event bigint, p_date date)
returns table(ticket_team text, ticket_tier text, taken integer)
language sql stable security definer set search_path = public as $$
  select coalesce(ea.ticket_team, ''), ea.ticket_tier, count(*)::int
  from public.event_attendees ea
  join public.activities a on a.id = ea.activity_id
  where auth.uid() is not null
    and ea.event_id = p_event
    and a.event_id = p_event
    and a.activity_date = p_date
    and ea.ticket_tier is not null
  group by 1, 2;
$$;
revoke all on function public.event_ticket_counts(bigint, date) from public, anon;
grant execute on function public.event_ticket_counts(bigint, date) to authenticated;
