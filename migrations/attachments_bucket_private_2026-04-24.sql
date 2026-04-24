-- =====================================================================
-- Flip attachments bucket to private
-- 2026-04-24
--
-- Prereqs (MUST be done first — applying this without them breaks every
-- photo in the app):
--   1. migrations/secure_attachments_bucket_2026-04-24.sql applied
--      (locks writes to authenticated role)
--   2. migrations/attachment_urls_to_paths_backfill_2026-04-24.sql
--      applied (DB now stores paths, not URLs)
--   3. Render pipeline shipped (data.js resolveAttachmentSrc +
--      index.html DOM auto-resolver). Deployed in commit 08be4dc.
--   4. Visual verification: load a prospect with CPS photos, a case
--      study with photos, an activity with meet-up photos — all three
--      must render correctly while bucket is still public. If any
--      broken image appears, fix the render site before running this.
--
-- What this does:
--   * storage.buckets.public = false for the `attachments` bucket.
--     Public URLs (the `.../object/public/attachments/...` ones) will
--     return 400 "Bucket not found" to anonymous fetchers.
--   * Authenticated session readers still have SELECT access via the
--     policy attachments_authenticated_select (already in place from
--     the secure_attachments_bucket migration).
--   * Signed URLs generated via createSignedUrl() / createSignedUrls()
--     continue to work for their TTL (our render code uses 1 hour).
--
-- Rollback (if a render regression slips through):
--   update storage.buckets set public = true where id = 'attachments';
-- =====================================================================

begin;

update storage.buckets
set public = false
where id = 'attachments';

-- Also remove the anon SELECT policy — pointless on a private bucket,
-- and removing it reduces the attack surface.
drop policy if exists "attachments_anon_select_public_only" on storage.objects;

commit;

-- Verify:
-- select id, name, public from storage.buckets where id = 'attachments';
-- expected: public = false
