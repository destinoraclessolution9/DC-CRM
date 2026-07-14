-- =====================================================================
-- prospects_approval_guard_2026-07-13.sql
-- Audit CLOSING_AUDIT_2026-07-13 finding C1 (CRITICAL) + M3 (MEDIUM).
--
-- ✅ APPLIED to live remuwhxvzkzjtgbzqjaa 2026-07-14 (Management API).
--    Verified by rolled-back simulation impersonating an L12 (non-manager)
--    agent: conversion_status->'approved' BLOCKED ("not authorized to
--    approve a conversion"), status->'converted' BLOCKED, ->'pending_approval'
--    ALLOWED. Manager (level<=4) and service-role (auth.uid() null) bypass.
--
-- The manager-approval gate on the sales-closing money path was enforced
-- ONLY client-side (script-approvals.js isManagement()). Server-side, the
-- prospects UPDATE RLS (sec_2026-06-19_writes.sql) scopes by ROW OWNERSHIP
-- with NO column guard — so an owning agent could, from the console:
--   * flip their own prospect to conversion_status='approved' / status='converted'
--     (self-approve a sale, bypassing the Manager Approval Queue), and
--   * mutate an already-SUBMITTED closing_record around the review snapshot.
--
-- This mirrors the existing users_guard trigger (sec_2026-06-19_writes.sql:78)
-- but for the prospects approval columns. Non-managers (level > 4) may still
-- do everything the normal flow needs — set conversion_status='pending_approval',
-- take a draft closing_record to 'submitted' — but may NOT self-grant the
-- approved/converted terminal states, nor edit a locked (submitted/approved)
-- closing_record. Service-role (auth.uid() IS NULL) and management (level<=4)
-- bypass. Additive (CREATE OR REPLACE + trigger); pre-authorized.
-- =====================================================================

create or replace function public.prospects_approval_guard()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $guard$
declare
  caller_level int := coalesce(public.current_user_level(), 99);
  old_cr_status text := coalesce(old.closing_record->>'status', 'draft');
begin
  -- Service-role / edge functions / direct DB (no end-user JWT) and management bypass.
  if auth.uid() is null or caller_level <= 4 then
    return new;
  end if;

  -- A non-manager may not self-grant the approved conversion state.
  if new.conversion_status is distinct from old.conversion_status
     and new.conversion_status = 'approved' then
    raise exception 'prospects_guard: not authorized to approve a conversion';
  end if;

  -- ...nor flip the prospect to a converted customer directly.
  if new.status is distinct from old.status
     and new.status = 'converted' then
    raise exception 'prospects_guard: not authorized to mark a prospect converted';
  end if;

  -- ...nor edit a closing_record that is already submitted/approved (lock bypass).
  -- Draft -> submitted (the normal auto-submit) is allowed because OLD is 'draft'.
  if old_cr_status in ('submitted', 'approved')
     and new.closing_record is distinct from old.closing_record then
    raise exception 'prospects_guard: closing record is locked (%) — cannot edit', old_cr_status;
  end if;

  return new;
end;
$guard$;

drop trigger if exists prospects_approval_guard on public.prospects;
create trigger prospects_approval_guard before update on public.prospects
  for each row execute function public.prospects_approval_guard();

notify pgrst, 'reload schema';
