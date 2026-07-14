-- =====================================================================
-- approval_queue_agent_insert_2026-07-14.sql
-- Audit CLOSING_AUDIT_2026-07-13 finding M8 — VERIFIED on live 2026-07-14.
--
-- LIVE STATE (pg_policies): approval_queue has only two policies, both gated
--   admin_select  SELECT  current_user_level() <= 2
--   admin_write   ALL     using/check current_user_level() <= 2
-- So INSERT is admin-only (level 1-2). Agents (level 3-12) submitting a sale
-- call AppDataStore.create('approval_queue', …) which is REJECTED by the
-- with_check, and the client only console.warn's the failure — so every
-- agent-submitted closing is SILENTLY DROPPED and never reaches the manager
-- Approval Queue. This is the "sales not saving to the database" symptom.
--
-- Fix: add a PERMISSIVE INSERT policy so an authenticated agent can enqueue an
-- approval row they themselves submitted (submitted_by = their own users.id).
-- Admins keep full access via admin_write. Permissive policies are OR-combined,
-- so this widens INSERT without loosening SELECT/UPDATE/DELETE.
--
-- current_user_row_id() maps auth.uid() -> public.users.id (already used by the
-- prospects/customers write policies, sec_2026-06-19_writes.sql).
-- Additive (create policy); pre-authorized.
-- =====================================================================

drop policy if exists approval_queue_agent_insert on public.approval_queue;

create policy approval_queue_agent_insert on public.approval_queue
  for insert to authenticated
  with check (
    submitted_by = public.current_user_row_id()
    or coalesce(public.current_user_level(), 99) <= 2
  );

notify pgrst, 'reload schema';

-- Verify (run as an L3-L12 agent via a rolled-back simulation):
--   set local role authenticated;  -- + set request.jwt.claims to the agent
--   insert into approval_queue(approval_type,status,submitted_by,submitted_at)
--     values('new_sale','pending', current_user_row_id(), now());  -- expect: OK
-- Cross-user spoof (submitted_by = someone else) must still FAIL for non-admins.
