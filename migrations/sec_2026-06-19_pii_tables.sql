-- =====================================================================
-- SECURITY HARDENING — Phase 1, group E: scope PII tables (H4/H5)
-- Date: 2026-06-19
--
-- These tables were `FOR ALL USING(true) WITH CHECK(true)` -> ANY authenticated
-- staff member could read/edit/delete EVERY customer's IC/NRIC, DOB, phone,
-- email, signatures, redemption history. Scope read/update/delete to the owning
-- agent / linked-prospect visibility / admin. INSERT stays permissive (creation
-- sets owner = self; scoping it risks breaking form submission).
-- =====================================================================

-- Helper: is the given prospect within the caller's visibility scope?
create or replace function public.prospect_is_visible(p_prospect_id bigint)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(current_user_level(), 99) <= 2
      or (p_prospect_id is not null and exists(
            select 1 from public.prospects p
            where p.id = p_prospect_id and (
                 p.responsible_agent_id in (select current_user_visible_ids())
              or p.cps_agent_id        in (select current_user_visible_ids())
              or p.lead_agent_id       in (select current_user_visible_ids())
              or p.responsible_agent_id = current_user_row_id()
              or p.cps_agent_id         = current_user_row_id()
              or p.lead_agent_id        = current_user_row_id())));
$$;
revoke all on function public.prospect_is_visible(bigint) from public;
grant execute on function public.prospect_is_visible(bigint) to authenticated;

-- ---------- apu_appraisals ----------
drop policy if exists apu_appraisals_auth_full_access on public.apu_appraisals;
create policy apu_appraisals_sel on public.apu_appraisals for select to authenticated
  using (coalesce(current_user_level(),99)<=2
         or created_by    in (select current_user_visible_ids())
         or consultant_id in (select current_user_visible_ids())
         or dealer_ea_id  in (select current_user_visible_ids())
         or public.prospect_is_visible(prospect_id));
create policy apu_appraisals_ins on public.apu_appraisals for insert to authenticated with check (true);
create policy apu_appraisals_upd on public.apu_appraisals for update to authenticated
  using (coalesce(current_user_level(),99)<=2 or created_by in (select current_user_visible_ids()) or consultant_id in (select current_user_visible_ids()) or dealer_ea_id in (select current_user_visible_ids()))
  with check (coalesce(current_user_level(),99)<=2 or created_by in (select current_user_visible_ids()) or consultant_id in (select current_user_visible_ids()) or dealer_ea_id in (select current_user_visible_ids()));
create policy apu_appraisals_del on public.apu_appraisals for delete to authenticated
  using (coalesce(current_user_level(),99)<=2 or created_by in (select current_user_visible_ids()));

-- ---------- apu_referrals (scope via parent appraisal) ----------
drop policy if exists apu_referrals_auth_full_access on public.apu_referrals;
create policy apu_referrals_sel on public.apu_referrals for select to authenticated
  using (coalesce(current_user_level(),99)<=2
         or exists(select 1 from public.apu_appraisals a where a.id = apu_referrals.appraisal_id
                   and (a.created_by in (select current_user_visible_ids())
                        or a.consultant_id in (select current_user_visible_ids())
                        or a.dealer_ea_id in (select current_user_visible_ids())
                        or public.prospect_is_visible(a.prospect_id))));
create policy apu_referrals_ins on public.apu_referrals for insert to authenticated with check (true);
create policy apu_referrals_upd on public.apu_referrals for update to authenticated
  using (coalesce(current_user_level(),99)<=2
         or exists(select 1 from public.apu_appraisals a where a.id = apu_referrals.appraisal_id
                   and (a.created_by in (select current_user_visible_ids()) or a.consultant_id in (select current_user_visible_ids()) or a.dealer_ea_id in (select current_user_visible_ids()))))
  with check (true);
create policy apu_referrals_del on public.apu_referrals for delete to authenticated
  using (coalesce(current_user_level(),99)<=2
         or exists(select 1 from public.apu_appraisals a where a.id = apu_referrals.appraisal_id and a.created_by in (select current_user_visible_ids())));

-- ---------- cps_analyses ----------
drop policy if exists cps_analyses_auth_full_access on public.cps_analyses;
create policy cps_analyses_sel on public.cps_analyses for select to authenticated
  using (coalesce(current_user_level(),99)<=2
         or created_by in (select current_user_visible_ids())
         or dealer_id  in (select current_user_visible_ids())
         or cps_by_id  in (select current_user_visible_ids())
         or public.prospect_is_visible(prospect_id));
create policy cps_analyses_ins on public.cps_analyses for insert to authenticated with check (true);
create policy cps_analyses_upd on public.cps_analyses for update to authenticated
  using (coalesce(current_user_level(),99)<=2 or created_by in (select current_user_visible_ids()) or dealer_id in (select current_user_visible_ids()) or cps_by_id in (select current_user_visible_ids()))
  with check (coalesce(current_user_level(),99)<=2 or created_by in (select current_user_visible_ids()) or dealer_id in (select current_user_visible_ids()) or cps_by_id in (select current_user_visible_ids()));
create policy cps_analyses_del on public.cps_analyses for delete to authenticated
  using (coalesce(current_user_level(),99)<=2 or created_by in (select current_user_visible_ids()));

-- ---------- customer_surveys ----------
drop policy if exists customer_surveys_auth_full_access on public.customer_surveys;
create policy customer_surveys_sel on public.customer_surveys for select to authenticated
  using (coalesce(current_user_level(),99)<=2
         or created_by    in (select current_user_visible_ids())
         or consultant_id in (select current_user_visible_ids())
         or public.prospect_is_visible(prospect_id));
create policy customer_surveys_ins on public.customer_surveys for insert to authenticated with check (true);
create policy customer_surveys_upd on public.customer_surveys for update to authenticated
  using (coalesce(current_user_level(),99)<=2 or created_by in (select current_user_visible_ids()) or consultant_id in (select current_user_visible_ids()))
  with check (coalesce(current_user_level(),99)<=2 or created_by in (select current_user_visible_ids()) or consultant_id in (select current_user_visible_ids()));
create policy customer_surveys_del on public.customer_surveys for delete to authenticated
  using (coalesce(current_user_level(),99)<=2 or created_by in (select current_user_visible_ids()));

-- ---------- journey_touchpoints (empty today) ----------
drop policy if exists journey_touchpoints_auth on public.journey_touchpoints;
-- assigned_to / completed_by are uuid (auth.users), compare against auth.uid()
create policy journey_touchpoints_sel on public.journey_touchpoints for select to authenticated
  using (coalesce(current_user_level(),99)<=2
         or assigned_to  = auth.uid()
         or completed_by = auth.uid()
         or public.prospect_is_visible(prospect_id));
create policy journey_touchpoints_ins on public.journey_touchpoints for insert to authenticated with check (true);
create policy journey_touchpoints_upd on public.journey_touchpoints for update to authenticated
  using (coalesce(current_user_level(),99)<=2 or assigned_to = auth.uid() or public.prospect_is_visible(prospect_id))
  with check (true);
create policy journey_touchpoints_del on public.journey_touchpoints for delete to authenticated
  using (coalesce(current_user_level(),99)<=2 or assigned_to = auth.uid());

-- ---------- prospect_attachments (scope via parent prospect) ----------
drop policy if exists auth_full_access on public.prospect_attachments;
create policy prospect_attachments_sel on public.prospect_attachments for select to authenticated
  using (public.prospect_is_visible(prospect_id));
create policy prospect_attachments_ins on public.prospect_attachments for insert to authenticated with check (true);
create policy prospect_attachments_upd on public.prospect_attachments for update to authenticated
  using (public.prospect_is_visible(prospect_id)) with check (true);
create policy prospect_attachments_del on public.prospect_attachments for delete to authenticated
  using (public.prospect_is_visible(prospect_id));

-- ---------- redemption_requests (only SELECT was open) ----------
drop policy if exists redemption_requests_select on public.redemption_requests;
create policy redemption_requests_select on public.redemption_requests for select to authenticated
  using (user_id = current_user_row_id() or coalesce(current_user_level(),99) <= 2);
