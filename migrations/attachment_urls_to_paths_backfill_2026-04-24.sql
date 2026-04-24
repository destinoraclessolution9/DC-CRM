-- =====================================================================
-- Backfill stored attachment URLs to bare object paths
-- 2026-04-24
--
-- After this migration, every stored value in the 3 attachment-holding
-- columns is a bare path (e.g. `case_photos/123_456_abc_foo.jpg`)
-- instead of the full public URL. Combined with the render-side
-- resolver (data.js resolveAttachmentSrc + index.html DOM auto-resolver),
-- the app renders paths as signed URLs on demand.
--
-- This unblocks flipping the bucket's `public` flag to false — at which
-- point existing stored values remain usable because they go through
-- the resolver, but random URL-guessers can no longer read files.
--
-- Idempotent: running twice is a no-op because paths don't match the
-- URL regex.
--
-- Columns covered:
--   * case_studies.photo_urls     (jsonb array of strings)
--   * activities.photo_urls       (jsonb array of strings)
--   * follow_up_drafts.attachment_url (text scalar)
--
-- Any OTHER attachment-storing columns discovered later must be added
-- here and re-run.
-- =====================================================================

begin;

-- Helper: extract the path portion from a Supabase public URL.
-- Matches `/storage/v1/object/public/attachments/<path>` (with optional
-- query string) and returns decoded `<path>`. Returns input unchanged
-- if it doesn't match (already a path, or an external URL).
create or replace function _fs_extract_attachment_path(v text)
returns text language plpgsql immutable as $$
declare
    m text[];
begin
    if v is null then return null; end if;
    m := regexp_match(v, '^https?://[^/]+/storage/v1/object/public/attachments/([^?]+)');
    if m is null then return v; end if;
    return replace(m[1], '%20', ' ');  -- minimal URL decode; paths rarely contain other escapes
end $$;

-- ---------- case_studies.photo_urls (jsonb array of strings) ----------
update case_studies
set photo_urls = (
    select jsonb_agg(_fs_extract_attachment_path(elem #>> '{}'))
    from jsonb_array_elements(photo_urls) elem
)
where photo_urls is not null
  and jsonb_typeof(photo_urls) = 'array'
  and jsonb_array_length(photo_urls) > 0
  and exists (
    select 1 from jsonb_array_elements(photo_urls) elem
    where elem #>> '{}' like 'http%/storage/v1/object/public/attachments/%'
  );

-- ---------- activities.photo_urls (jsonb array of strings) ----------
update activities
set photo_urls = (
    select jsonb_agg(_fs_extract_attachment_path(elem #>> '{}'))
    from jsonb_array_elements(photo_urls) elem
)
where photo_urls is not null
  and jsonb_typeof(photo_urls) = 'array'
  and jsonb_array_length(photo_urls) > 0
  and exists (
    select 1 from jsonb_array_elements(photo_urls) elem
    where elem #>> '{}' like 'http%/storage/v1/object/public/attachments/%'
  );

-- ---------- follow_up_drafts.attachment_url (text scalar) ----------
update follow_up_drafts
set attachment_url = _fs_extract_attachment_path(attachment_url)
where attachment_url like 'http%/storage/v1/object/public/attachments/%';

commit;

-- ===== Verify: these should all return zero rows after the backfill. =====
-- Run separately (not inside the transaction) to sanity-check:
/*
select 'case_studies' as t, count(*) as n from case_studies
 where exists (select 1 from jsonb_array_elements(photo_urls) e
               where e #>> '{}' like 'http%/storage/v1/object/public/attachments/%');
select 'activities'   as t, count(*) as n from activities
 where exists (select 1 from jsonb_array_elements(photo_urls) e
               where e #>> '{}' like 'http%/storage/v1/object/public/attachments/%');
select 'follow_up_drafts' as t, count(*) as n from follow_up_drafts
 where attachment_url like 'http%/storage/v1/object/public/attachments/%';
*/
