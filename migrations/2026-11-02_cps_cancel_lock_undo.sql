-- Rollback of 2026-11-02_cps_cancel_lock.sql: the trigger goes and cps_cancel
-- returns to its 2026-11-01 body.
drop trigger if exists trg_cps_date_lock on public.activities;
drop function if exists public.cps_date_lock_trg();

create or replace function public.cps_cancel(p_activity bigint, p_reason text, p_note text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
    v_me bigint := public.current_user_row_id();
    v_lvl int := coalesce(public.current_user_level(), 99);
    a public.activities%rowtype;
    p public.prospects%rowtype;
begin
    if v_me is null then raise exception 'Not permitted' using errcode = '42501'; end if;
    if p_reason is null or p_reason not in ('emergency', 'sick', 'clash', 'unreachable', 'changed_mind', 'other') then
        raise exception 'Please pick a reason' using errcode = '22023';
    end if;
    select * into a from public.activities where id = p_activity for update;
    if not found or a.activity_type <> 'CPS' or a.prospect_id is null then
        raise exception 'This CPS no longer exists' using errcode = '22023';
    end if;
    select * into p from public.prospects where id = a.prospect_id;
    if v_lvl > 2 and not (a.lead_agent_id in (select public.current_user_visible_ids())
                          or p.responsible_agent_id in (select public.current_user_visible_ids())) then
        raise exception 'Not permitted' using errcode = '42501';
    end if;
    -- Same test as the button: this CPS really happened.
    if coalesce(a.note_key_points, a.note_needs, a.note_pain_points, a.note_outcome, a.next_action) is not null
       and btrim(concat(a.note_key_points, a.note_needs, a.note_pain_points, a.note_outcome, a.next_action)) <> ''
       or a.is_closing or a.completed_at is not null
       or btrim(concat(a.meeting_minutes ->> 'background', a.meeting_minutes ->> 'advisor', a.meeting_minutes ->> 'reaction')) <> '' then
        raise exception 'This CPS has minutes or a closing, so it cannot be cancelled' using errcode = '22023';
    end if;
    if nullif(btrim(coalesce(p.cps_form_url, '')), '') is not null or p.cps_form_date is not null or p.cps_attachment is not null then
        raise exception 'This person has a CPS form on file, so the CPS cannot be cancelled' using errcode = '22023';
    end if;
    if p.status = 'converted' then
        raise exception 'This person is already a customer' using errcode = '22023';
    end if;

    insert into public.cps_cancellations (prospect_id, activity_id, cps_date, cps_time, venue, lead_agent_id, reason, note, cancelled_by)
    values (a.prospect_id, a.id, a.activity_date, a.start_time::time, a.venue, a.lead_agent_id, p_reason, nullif(btrim(coalesce(p_note, '')), ''), v_me);

    -- Nothing should still go out for a CPS that is not happening.
    update public.follow_up_drafts set status = 'dismissed', updated_at = now() where event_id = a.id and status = 'pending';
    update public.journey_touchpoints set status = 'skipped', notes = coalesce(notes || ' · ', '') || 'auto: CPS cancelled'
     where source_activity_id = a.id and status in ('pending', 'overdue', 'snoozed');

    delete from public.activities where id = a.id;
    update public.prospects set cps_cancelled_on = public.journey_today() where id = a.prospect_id;
    return jsonb_build_object('ok', true, 'prospect_id', a.prospect_id);
end $$;
revoke execute on function public.cps_cancel(bigint, text, text) from public, anon;
grant execute on function public.cps_cancel(bigint, text, text) to authenticated;

drop function if exists public.cps_cancel_blocker(public.activities, public.prospects);
drop function if exists public.cps_cancel_last_day(date);
