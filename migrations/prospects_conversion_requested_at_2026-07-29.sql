-- prospects.conversion_requested_at — the companion timestamp to conversion_requested_by.
--
-- THE BUG: three code paths have always written this column, and it has never
-- existed. AppDataStore's unknown-column strip-retry (data.js:2338-2342) caught the
-- PGRST204, deleted the key and re-issued the write — so every conversion request
-- silently cost an extra failed round-trip plus a console error, and the timestamp
-- was dropped on the floor. Same phantom-column class as the 2026-04 purchases
-- agent_id bug; the strip-retry makes these invisible unless you probe the schema.
--
--   chunks/script-approvals.js:606   requestProspectConversion
--   chunks/script-prospects.js:6094  submitClosingRecord (qualifiesForConversion)
--   chunks/script-journey.js:597     journey automation parking a prospect for review
--
-- A fourth writer in chunks/script-calendar.js was removed on 2026-07-27 when the
-- column was first found to be missing. Both halves of that path are restored here:
-- the direct-write fallback in the chunk, and the submit_closing_record RPC (below),
-- which until now set conversion_status + conversion_requested_by but silently
-- dropped the timestamp — and that RPC is the ONLY write channel a cross-owner
-- closer has, so the request time was lost for exactly the flow that most needs it.
--
-- WHY ADD IT RATHER THAN DELETE THE WRITES:
--   * The schema already has conversion_rejected_at AND conversion_rejected_by, and
--     conversion_requested_by WITHOUT its timestamp. The gap is an oversight, not a
--     decision.
--   * The timestamp is not recoverable elsewhere for every path. approval_queue rows
--     carry submitted_at, but the journey-automation path creates NO queue row, and
--     submitClosingRecord skips the queue entirely for managers. Measured on live
--     data 2026-07-29: of the 9 prospects currently in pending_approval, all 9 have
--     conversion_requested_by but only 6 have a matching approval_queue row — so 3
--     pending requests have no request time anywhere.
--   * Without it, conversion_status='pending_approval' cannot be aged: nobody can
--     ask "how long has this been waiting?".
--
-- ✅ APPLIED to live (remuwhxvzkzjtgbzqjaa) 2026-07-29, verified in
--    information_schema + a rolled-back write test through the real client path.

alter table public.prospects
  add column if not exists conversion_requested_at timestamptz;

comment on column public.prospects.conversion_requested_at is
  'When the prospect->customer conversion was requested. Companion to conversion_requested_by (which predates it). Written by requestProspectConversion, submitClosingRecord and the journey automation. Backfilled 2026-07-29 from the matching approval_queue new_customer submitted_at where one existed.';

-- Backfill from the approval queue wherever the request produced a queue row, so
-- existing pending requests are ageable immediately. Rows with no queue entry stay
-- NULL — there is genuinely no record of when they were requested, and inventing
-- one (e.g. updated_at) would be worse than an honest NULL.
update public.prospects p
   set conversion_requested_at = aq.submitted_at
  from (
        select distinct on (prospect_id) prospect_id, submitted_at
          from public.approval_queue
         where approval_type = 'new_customer'
           and prospect_id is not null
           and submitted_at is not null
         order by prospect_id, submitted_at desc
       ) aq
 where aq.prospect_id = p.id
   and p.conversion_requested_at is null
   and p.conversion_status is not null;

-- ── submit_closing_record: stamp the request time too ────────────────────────
-- Identical to the 2026-07-27 definition except for the conversion_requested_at
-- assignment; the old body omitted it only because the column did not exist.
create or replace function public.submit_closing_record(
    p_prospect_id       bigint,
    p_closing_record    jsonb,
    p_request_conversion boolean default false
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    v_uid      bigint;
    v_lvl      int;
    v_existing jsonb;
    v_status   text;
    v_allowed  boolean;
begin
    v_uid := public.current_user_row_id();
    v_lvl := coalesce(public.current_user_level(), 99);

    if v_uid is null then
        return jsonb_build_object('ok', false, 'reason', 'not_authenticated');
    end if;
    if p_prospect_id is null or p_closing_record is null then
        return jsonb_build_object('ok', false, 'reason', 'bad_request');
    end if;

    select (
        v_lvl <= 4
        or exists (
            select 1 from prospects p
             where p.id = p_prospect_id
               and v_uid in (p.responsible_agent_id, p.cps_agent_id, p.lead_agent_id)
        )
        or exists (
            select 1 from activities a
             where a.prospect_id = p_prospect_id
               and a.lead_agent_id = v_uid
        )
    ) into v_allowed;

    if not v_allowed then
        return jsonb_build_object('ok', false, 'reason', 'not_permitted');
    end if;

    select closing_record into v_existing from prospects where id = p_prospect_id;
    if not found then
        return jsonb_build_object('ok', false, 'reason', 'prospect_not_found');
    end if;

    v_status := coalesce(v_existing->>'status', 'draft');
    if v_status in ('submitted', 'approved') then
        return jsonb_build_object('ok', false, 'reason', 'locked', 'status', v_status);
    end if;

    update prospects
       set closing_record          = p_closing_record,
           updated_at              = now(),
           conversion_status       = case when p_request_conversion then 'pending_approval'
                                          else conversion_status end,
           conversion_requested_at = case when p_request_conversion then now()
                                          else conversion_requested_at end,
           conversion_requested_by = case when p_request_conversion then v_uid
                                          else conversion_requested_by end
     where id = p_prospect_id;

    return jsonb_build_object('ok', true, 'status', p_closing_record->>'status');
end;
$$;

revoke all on function public.submit_closing_record(bigint, jsonb, boolean) from public, anon;
grant execute on function public.submit_closing_record(bigint, jsonb, boolean) to authenticated;

notify pgrst, 'reload schema';
