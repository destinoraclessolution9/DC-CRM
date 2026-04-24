-- =====================================================================
-- Secure the `attachments` Storage bucket
-- 2026-04-24
--
-- Findings (audit 2026-04-24):
--   * The `attachments` bucket is public.
--   * Code uses sb.storage.from('attachments').getPublicUrl(path), persisting
--     the public URL into DB columns like activities.photo_urls,
--     case_studies.photos, etc.
--   * Anyone with a URL can read the file (customer photos, signed contract
--     PDFs, CPS intake attachments).
--   * Anonymous (unauthenticated) clients can also UPLOAD via the public
--     bucket policies that ship with Supabase by default.
--
-- This migration is the SAFE first step:
--   1. Restrict WRITE (insert/update/delete) on the bucket to authenticated
--      users only — closes anon-upload abuse.
--   2. Leaves the bucket `public = true` so existing public URLs in the DB
--      continue to render. We CANNOT flip the bucket to private here without
--      breaking every photo currently linked from a customer / case-study /
--      activity record.
--
-- FOLLOW-UP (separate migration after a data backfill):
--   * Add a `storage_path` text column to every table that currently stores
--     a public URL (activities.photo_urls, case_studies.photos, etc.).
--   * Backfill from the existing URL by stripping the public prefix.
--   * Update render code to call sb.storage.from('attachments')
--       .createSignedUrl(path, 3600) on demand.
--   * Then run `update storage.buckets set public = false where id = 'attachments';`.
--
-- Rollback: see "rollback" block at the bottom.
-- =====================================================================

begin;

-- 1. Make sure the bucket exists. Idempotent.
insert into storage.buckets (id, name, public)
values ('attachments', 'attachments', true)
on conflict (id) do nothing;

-- 2. Drop any prior `allow_anon_write` style policies that ship with public buckets.
do $$
declare p record;
begin
    for p in
        select polname from pg_policies
        where schemaname = 'storage' and tablename = 'objects'
          and (polname like '%attachments%' or polname in ('Public Access', 'Allow public uploads'))
    loop
        execute format('drop policy if exists %I on storage.objects', p.polname);
    end loop;
end $$;

-- 3. Re-create write policies — authenticated users only.
create policy "attachments_authenticated_insert"
on storage.objects for insert to authenticated
with check (bucket_id = 'attachments');

create policy "attachments_authenticated_update"
on storage.objects for update to authenticated
using (bucket_id = 'attachments')
with check (bucket_id = 'attachments');

create policy "attachments_authenticated_delete"
on storage.objects for delete to authenticated
using (bucket_id = 'attachments');

-- 4. Read remains permissive while bucket is public so existing public URLs
--    in the DB keep working. When the data backfill is done, drop this and
--    flip `public = false` on the bucket; sign URLs on demand instead.
create policy "attachments_authenticated_select"
on storage.objects for select to authenticated
using (bucket_id = 'attachments');

create policy "attachments_anon_select_public_only"
on storage.objects for select to anon
using (bucket_id = 'attachments');

commit;

-- =====================================================================
-- ROLLBACK (run manually if you need to revert):
--   drop policy if exists "attachments_authenticated_insert" on storage.objects;
--   drop policy if exists "attachments_authenticated_update" on storage.objects;
--   drop policy if exists "attachments_authenticated_delete" on storage.objects;
--   drop policy if exists "attachments_authenticated_select" on storage.objects;
--   drop policy if exists "attachments_anon_select_public_only"  on storage.objects;
-- =====================================================================
