-- =====================================================================
-- cps_intake_requests — orphan (agent_id IS NULL) rows: widen to leaders
-- Date: 2026-07-17 (follow-up to sec_cps_intake_authenticated_scope_2026-07-17)
--
-- The scoped select/update policies gated NULL-agent (orphan) intake rows to
-- L1-L2 only. That contradicts the client contract (chunks/script-cps.js
-- treats "no agent_id" rows as visible to any leader) so an orphaned submitted
-- intake would vanish from a team leader's pending-approval queue, and an L3-5
-- leader generating a link under a degraded session (agent_id momentarily null)
-- would get an RLS error on the insert's RETURNING instead of the token.
-- Widen the orphan branch from L<=2 to L<=5 (leader band) in SELECT + UPDATE.
-- Owned rows are unchanged (still owner + reporting downline + admins). Orphan
-- rows carry no team, so exposing them to leaders is not a cross-team leak.
-- =====================================================================

DROP POLICY IF EXISTS cps_intake_scoped_select ON public.cps_intake_requests;
CREATE POLICY cps_intake_scoped_select ON public.cps_intake_requests
  FOR SELECT TO authenticated USING (
    agent_id IN (SELECT current_user_visible_ids())
    OR agent_id = current_user_row_id()
    OR (agent_id IS NULL AND COALESCE(current_user_level(), 99) <= 5)
  );

DROP POLICY IF EXISTS cps_intake_scoped_update ON public.cps_intake_requests;
CREATE POLICY cps_intake_scoped_update ON public.cps_intake_requests
  FOR UPDATE TO authenticated
  USING (
    agent_id IN (SELECT current_user_visible_ids())
    OR agent_id = current_user_row_id()
    OR (agent_id IS NULL AND COALESCE(current_user_level(), 99) <= 5)
  )
  WITH CHECK (
    agent_id IN (SELECT current_user_visible_ids())
    OR agent_id = current_user_row_id()
    OR (agent_id IS NULL AND COALESCE(current_user_level(), 99) <= 5)
  );
