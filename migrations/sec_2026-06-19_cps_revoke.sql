-- =====================================================================
-- SECURITY HARDENING — Phase 1, group F (part 2): CPS intake anon REVOKE
-- Date: 2026-06-19
-- Apply ONLY after cps-intake.html (RPC version) is confirmed live, so there is
-- no window where the public page can't read/submit its appointment.
--
-- C1 (destructive, owner-approved): remove the blanket anon SELECT/UPDATE on the
-- table. anon now reaches the data ONLY through the token-scoped definer RPCs.
-- =====================================================================
drop policy if exists cps_intake_anon_read   on public.cps_intake_requests;
drop policy if exists cps_intake_anon_submit on public.cps_intake_requests;
revoke all on public.cps_intake_requests from anon;
