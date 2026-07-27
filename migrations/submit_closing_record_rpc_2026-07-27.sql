-- submit_closing_record — let an agent file a closing for a prospect they closed
-- but do NOT own, WITHOUT handing them write access to the rest of the prospect row.
--
-- THE BUG THIS FIXES (silent revenue loss):
--   saveMeetingOutcome persists the sale with
--     AppDataStore.update('prospects', id, { closing_record: newCR, ... })
--   which issues .update().eq('id',id).select().single()  (data.js:2610-2617),
--   i.e. PostgREST `Prefer: return=representation`. RLS SELECT is applied to the
--   RETURNING rows, so for a caller who cannot SELECT that prospect the
--   representation comes back EMPTY -> PGRST116 -> the whole statement is rolled
--   back. Independently, `auth_write_update` on prospects is scoped to
--   current_user_visible_ids() on responsible/cps/lead agent, so the UPDATE would
--   be denied anyway.
--   Net effect: the closing_record never lands -> no approval_queue 'new_sale' row
--   -> the sale NEVER reaches `purchases`, which is the only table reporting reads
--   for revenue. No error the agent can act on; the activity itself saves fine.
--
--   current_user_visible_ids() = all users for level<=2, self+downline for <=10,
--   self only for 11+. So peers and cross-chain agents are blocked. Measured on
--   live data 2026-07-27: of 11 cross-owner event attendees, 4 would be blocked.
--   The new per-attendee Closing button makes this the NORMAL case at an event.
--
-- WHY AN RPC: SECURITY DEFINER bypasses the prospects UPDATE policy, and
-- `returns jsonb` (not the row) means there is no RETURNING clause for RLS to
-- filter — the same reason the existing set_closing_record_field works.
--
-- SCOPE — this is deliberately NOT a general prospects write:
--   * it writes closing_record and, optionally, the three conversion_request_*
--     fields. Nothing else on the row is reachable.
--   * it REFUSES to touch a closing_record already 'submitted' or 'approved',
--     mirroring the client guard and the prospects_approval_guard trigger, so it
--     cannot be used to overwrite a sale that is awaiting or past approval.
--   * the caller must be management (level<=4), OR an agent already attached to
--     the prospect (responsible / cps / lead), OR the lead agent on an activity
--     linked to that prospect — i.e. someone who demonstrably met this person.
--     A random authenticated user cannot file a closing on a stranger.
--   * it never sets conversion_status='approved' or status='converted' — those
--     stay manager-only via the existing approval flow and the guard trigger.
--
-- ✅ APPLIED to live (remuwhxvzkzjtgbzqjaa) 2026-07-27, verified by pg_get_functiondef.

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

    -- Authorization: management, an agent already on the prospect, or the lead
    -- agent of an activity linked to it (covers the EVENT_CLOSING child minted by
    -- the per-attendee Closing button, whose lead_agent_id IS the closer).
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
        -- Same refusal the client applies: never overwrite a record that is
        -- awaiting or past manager approval.
        return jsonb_build_object('ok', false, 'reason', 'locked', 'status', v_status);
    end if;

    -- NOTE: there is no `conversion_requested_at` column on prospects. The client
    -- has always sent one (chunks/script-calendar.js) and AppDataStore's unknown-
    -- column strip-retry (data.js:2338-2342) silently dropped it every time, so it
    -- was never persisted. Only the three columns that actually exist are written
    -- here: conversion_status, conversion_requested_by, updated_at.
    update prospects
       set closing_record          = p_closing_record,
           updated_at              = now(),
           conversion_status       = case when p_request_conversion then 'pending_approval'
                                          else conversion_status end,
           conversion_requested_by = case when p_request_conversion then v_uid
                                          else conversion_requested_by end
     where id = p_prospect_id;

    return jsonb_build_object('ok', true, 'status', p_closing_record->>'status');
end;
$$;

revoke all on function public.submit_closing_record(bigint, jsonb, boolean) from public, anon;
grant execute on function public.submit_closing_record(bigint, jsonb, boolean) to authenticated;

notify pgrst, 'reload schema';
