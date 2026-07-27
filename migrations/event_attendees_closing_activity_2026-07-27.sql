-- event_attendees.closing_activity_id — dedup key for the per-attendee Closing button.
-- ✅ APPLIED to live (remuwhxvzkzjtgbzqjaa) 2026-07-27, verified in information_schema.
--
-- WHY:
--   An event has ONE activity row and MANY attendees, while the whole money path
--   in saveMeetingOutcome is gated on `activity.prospect_id`. So the per-attendee
--   Closing button (app.openAttendeeClosingModal, chunks/script-calendar.js) mints
--   a CHILD activity of type 'EVENT_CLOSING' that IS linked to the attendee's
--   prospect, and hands it to the existing openMeetingOutcomeModal unchanged.
--
--   Re-opening Closing MUST reuse that same child. Otherwise each click mints a
--   fresh activity -> a fresh prospects.closing_record submit -> a duplicate
--   approval_queue 'new_sale' -> a duplicate `purchases` row on approval.
--
--   The child activity itself stays visibility='closed' (the default for ordinary
--   activities), because an 'open' row would expose amount_closed / solution_sold
--   org-wide through the RLS `visibility in ('open','public')` arm — so the child
--   is NOT reliably findable by a second agent via the activities table.
--   event_attendees, by contrast, is auth_full_access (verified live), so a stamp
--   here is readable by every agent who can see the attendee row. That makes it
--   the correct dedup anchor.
--
--   The client still falls back to a (event_id, prospect_id, activity_type) query
--   when the column is empty, so rows predating this stamp still resolve.
--
-- Additive only. No default, nullable, no backfill needed.

alter table public.event_attendees
  add column if not exists closing_activity_id bigint;

comment on column public.event_attendees.closing_activity_id is
  'FK-ish link to the activities row (activity_type=''EVENT_CLOSING'') carrying this attendee''s post-event sale. Written by app.openAttendeeClosingModal. Intentionally NOT a hard FK: activities rows can be deleted by L<=5 and losing the stamp must not block the attendee row.';

notify pgrst, 'reload schema';
