-- =====================================================================
-- ⛔ SUPERSEDED — DO NOT APPLY. See attachments_read_policy_2026-07-14.sql.
--    The owner-based scoping below is invalid: live audit found 511/663 objects
--    have owner IS NULL, so the owner-null allowance re-opens them to all
--    authenticated users. Kept for history only.
-- =====================================================================
-- attachments_scope_read_2026-07-13.sql
-- Audit CLOSING_AUDIT_2026-07-13 finding C2 (CRITICAL) / F4 (MEDIUM).
--
-- The 'attachments' bucket (order-form photos with NRIC/DOB/card data,
-- invoices) grants SELECT to EVERY authenticated user bucket-wide
-- (secure_attachments_bucket_2026-04-24.sql: attachments_authenticated_select
-- USING (bucket_id='attachments')). Any agent can read any other agent's
-- customer PII attachments.
--
-- This scopes read to: the object's uploader (owner), OR management
-- (level<=4, for approval review), OR legacy objects with a NULL owner
-- (older uploads / service-role writes) so historical photos keep
-- rendering. NEW owned uploads are no longer cross-agent readable.
--
-- ⚠ REVIEW BEFORE APPLYING: verify in the Supabase dashboard that
--   `select id, public from storage.buckets where id='attachments'`
--   returns public=false (run attachments_bucket_private_2026-04-24.sql
--   first if not). A public bucket serves /object/public/... regardless
--   of these policies — the anonymous leak is only closed once public=false
--   AND the client stores paths + signed URLs (shipped in this session's
--   frontend change). This migration only closes the authenticated
--   cross-agent read.
--
-- ⚠ The legacy owner-IS-NULL allowance means pre-2026-07-13 objects stay
--   readable by all authenticated users. To fully close, backfill owner on
--   existing attachments objects (out of scope here) then drop the NULL
--   clause. Additive (drop+recreate policy); pre-authorized.
-- =====================================================================

drop policy if exists attachments_authenticated_select on storage.objects;

create policy attachments_authenticated_select on storage.objects
  for select to authenticated
  using (
    bucket_id = 'attachments'
    and (
      owner = auth.uid()
      or owner is null                              -- legacy objects (keep rendering)
      or coalesce(public.current_user_level(), 99) <= 4  -- management review
    )
  );
