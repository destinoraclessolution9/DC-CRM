-- =====================================================================
-- SECURITY HARDENING — Phase 1, group F (part 1): CPS intake token RPCs
-- Date: 2026-06-19
--
-- C1: cps_intake_requests had `anon SELECT USING(true)` + `anon UPDATE` -> anyone
--     with the public key could dump ALL intake PII (name, IC/NRIC, phone, email,
--     venue) and tamper with any awaiting row. Replace blanket anon table access
--     with two SECURITY DEFINER RPCs keyed by the secret token:
--       * get_cps_intake_by_token  — returns ONLY the appointment fields for the
--         single row matching the token (no other rows, no other prospects' PII).
--       * submit_cps_intake        — writes ONLY the prospect_* fields + flips
--         status to 'submitted', only while awaiting & not expired. Cannot touch
--         agent-set fields (date/venue/waze) -> closes the tamper vector too.
--     The anon policies + table grants are revoked in a SEPARATE step AFTER the
--     public page (cps-intake.html) is switched to these RPCs and verified live.
-- =====================================================================

create or replace function public.get_cps_intake_by_token(p_token uuid)
returns table(activity_date date, start_time time, end_time time,
              venue_name text, venue_address text, waze_link text,
              status text, expires_at timestamptz)
language sql security definer set search_path = public, pg_temp
as $$
  select activity_date, start_time, end_time, venue_name, venue_address,
         waze_link, status, expires_at
  from public.cps_intake_requests
  where token = p_token
  limit 1;
$$;

create or replace function public.submit_cps_intake(
  p_token uuid, p_name text, p_ic text, p_occupation text, p_phone text, p_email text)
returns text
language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_status text;
begin
  update public.cps_intake_requests
     set prospect_name       = left(coalesce(p_name,''), 200),
         prospect_ic         = left(coalesce(p_ic,''), 50),
         prospect_occupation = nullif(left(coalesce(p_occupation,''), 120), ''),
         prospect_phone      = left(coalesce(p_phone,''), 40),
         prospect_email      = nullif(left(coalesce(p_email,''), 200), ''),
         status              = 'submitted',
         submitted_at        = now()
   where token = p_token
     and status = 'awaiting_submission'
     and expires_at > now()
  returning status into v_status;
  return v_status;  -- 'submitted' on success; NULL if no eligible row matched
end;
$$;

revoke all on function public.get_cps_intake_by_token(uuid) from public;
revoke all on function public.submit_cps_intake(uuid,text,text,text,text,text) from public;
grant execute on function public.get_cps_intake_by_token(uuid) to anon, authenticated;
grant execute on function public.submit_cps_intake(uuid,text,text,text,text,text) to anon, authenticated;
