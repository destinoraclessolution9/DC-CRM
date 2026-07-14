-- =====================================================================
-- attachments_read_policy_2026-07-14.sql
-- SUPERSEDES migrations/attachments_scope_read_2026-07-13.sql (DO NOT APPLY that one).
--
-- WHY THE OLD ONE WAS WRONG (verified live 2026-07-14): the attachments bucket has
-- 663 objects, of which 511 have owner IS NULL (all dc_forms + cps-forms + order_forms
-- were written server-side / without an end-user JWT owner). The old migration scoped
-- SELECT to `owner = auth.uid() OR owner IS NULL OR level<=4` — but because ~77% of
-- objects are owner-null, that allowance re-opens them to EVERY authenticated user,
-- so it neither meaningfully scopes reads NOR is safe to reason about. Owner-based
-- storage RLS is the wrong model here.
--
-- CORRECT MODEL: keep a single bucket-wide authenticated-read policy (this is what the
-- app's signed-URL render pipeline expects and what makes the private-bucket flip safe
-- — every authenticated session can mint a signed URL for any attachment it renders).
-- This migration is IDEMPOTENT: it drops any stray owner-scoped policy and (re)asserts
-- the bucket-wide authenticated SELECT. Anonymous read is already closed by the bucket's
-- public=false flip; this only governs the authenticated tier.
--
-- ⚠ RESIDUAL (F4, KNOWN, DEFERRED): with a single bucket-wide policy, any authenticated
-- AGENT can still read ANY other agent's attachment. TRUE per-agent scoping cannot come
-- from storage.objects.owner (it's null); it requires a policy that joins the object
-- PATH back to prospect_attachments -> prospects -> responsible/lead agent visibility.
-- That is a larger, separate change (and must be perf-tested — it runs per object).
-- Not attempted here; documented so it isn't silently assumed closed.
--
-- Additive/idempotent (drop+recreate the read policy only). Access-control = USER-APPLIED.
-- =====================================================================

-- Remove the flawed owner-scoped policy if it was ever applied.
drop policy if exists attachments_scope_read on storage.objects;

-- (Re)assert the canonical bucket-wide authenticated read.
drop policy if exists attachments_authenticated_select on storage.objects;
create policy attachments_authenticated_select on storage.objects
  for select to authenticated
  using (bucket_id = 'attachments');

-- Verify:
--   select polname, polcmd from pg_policy p join pg_class c on c.oid=p.polrelid
--   where c.relname='objects' and polname like 'attachments%';
