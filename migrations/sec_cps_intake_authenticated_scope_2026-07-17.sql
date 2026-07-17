-- =====================================================================
-- SECURITY HARDENING — cps_intake_requests authenticated scoping
-- Date: 2026-07-17
--
-- Gap: after the 2026-06-19 anon revoke (sec_2026-06-19_cps_revoke.sql), the
-- only remaining policy was `cps_intake_auth_all FOR ALL USING(true)`, so ANY
-- authenticated user could read AND tamper EVERY team's intake PII (prospect
-- name / IC / phone / email / venue) straight off the REST API — the exact
-- class of cross-team leak fixed elsewhere. The client already narrows the
-- list by getVisibleUserIds() and hand-rolls per-id IDOR gates in
-- chunks/script-cps.js (openApproveCpsIntakeModal / rejectCpsIntake); this
-- moves that scope into RLS so it is actually enforced, not just cosmetic.
--
-- Mirrors prospects_scoped_select / activities_scoped_select: owning agent +
-- their reporting downline (current_user_visible_ids) + self + L1-L2 admins
-- for orphan (NULL agent_id) rows. Read/update/delete scoped; insert stays
-- permissive (consistent with prospects/activities auth_write_insert — the app
-- always stamps agent_id = self at creation).
--
-- ANON SUBMIT PATH IS UNAFFECTED: anon has no table grant/policy and reaches
-- the row only through the SECURITY DEFINER token RPCs get_cps_intake_by_token
-- / submit_cps_intake, which bypass RLS by design.
-- =====================================================================

DROP POLICY IF EXISTS cps_intake_auth_all ON public.cps_intake_requests;

-- Also drop the new policy names first so this migration is idempotent.
DROP POLICY IF EXISTS cps_intake_scoped_select ON public.cps_intake_requests;
DROP POLICY IF EXISTS cps_intake_auth_insert   ON public.cps_intake_requests;
DROP POLICY IF EXISTS cps_intake_scoped_update ON public.cps_intake_requests;
DROP POLICY IF EXISTS cps_intake_scoped_delete ON public.cps_intake_requests;

CREATE POLICY cps_intake_scoped_select ON public.cps_intake_requests
  FOR SELECT TO authenticated USING (
    agent_id IN (SELECT current_user_visible_ids())
    OR agent_id = current_user_row_id()
    OR (agent_id IS NULL AND COALESCE(current_user_level(), 99) <= 2)
  );

-- Insert stays permissive; the app stamps agent_id = self. Scope is enforced
-- on read/update/delete, matching the prospects/activities write model.
CREATE POLICY cps_intake_auth_insert ON public.cps_intake_requests
  FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY cps_intake_scoped_update ON public.cps_intake_requests
  FOR UPDATE TO authenticated
  USING (
    agent_id IN (SELECT current_user_visible_ids())
    OR agent_id = current_user_row_id()
    OR (agent_id IS NULL AND COALESCE(current_user_level(), 99) <= 2)
  )
  WITH CHECK (
    agent_id IN (SELECT current_user_visible_ids())
    OR agent_id = current_user_row_id()
    OR (agent_id IS NULL AND COALESCE(current_user_level(), 99) <= 2)
  );

-- Delete is unused by the app (reject = UPDATE status). Restrict to leaders
-- (L<=5) within their visible scope so a stray client can't purge PII rows.
CREATE POLICY cps_intake_scoped_delete ON public.cps_intake_requests
  FOR DELETE TO authenticated USING (
    (agent_id IN (SELECT current_user_visible_ids()) OR agent_id = current_user_row_id())
    AND COALESCE(current_user_level(), 99) <= 5
  );
