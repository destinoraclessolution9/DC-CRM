-- Per-attendee discussion-paper photos for the Post-Event Notes modal.
-- The attendee notes form reuses the shared notes block, which renders the
-- "Discussion Papers" uploader. Before this column existed, the per-attendee
-- save path (saveAttendeePostEventNotes) silently dropped those photos.
-- JSONB array of short public URLs — mirrors activities.photo_urls.
alter table event_attendees
    add column if not exists photo_urls jsonb default '[]'::jsonb;
