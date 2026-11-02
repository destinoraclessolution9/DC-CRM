-- 🔒 CPS cancel lock (2026-11-02, owner): a CPS can be cancelled up to 13 days
-- after its date, for everyone. CPS on 1 Nov → last day 14 Nov, locked from 15 Nov.
-- Builds on 2026-11-01_cps_cancel.sql:
--   * cps_cancel refuses past the last day, by the Malaysia date, so a page left
--     open can't beat the lock. The button only greys out.
--   * trg_cps_date_lock: without it an agent could move an old CPS's date forward
--     (or change its type) and cancel it. L1–2 can still fix a wrong date. A CPS
--     that can't be cancelled anyway (minutes, closing, form, customer) is left alone.
-- Delete stays open to L1–5: it is the route for real mistakes.
-- Rollback: migrations/2026-11-02_cps_cancel_lock_undo.sql

create or replace function public.cps_cancel_last_day(p_date date)
returns date language sql immutable as $$ select p_date + 13 $$;

-- Why this CPS can't be cancelled at all, whatever its date. Null = it can.
create or replace function public.cps_cancel_blocker(a public.activities, p public.prospects)
returns text language sql stable set search_path = public as $$
    select case
        -- Same test as the button: this CPS really happened.
        when (coalesce(a.note_key_points, a.note_needs, a.note_pain_points, a.note_outcome, a.next_action) is not null
              and btrim(concat(a.note_key_points, a.note_needs, a.note_pain_points, a.note_outcome, a.next_action)) <> '')
             or a.is_closing or a.completed_at is not null
             or btrim(concat(a.meeting_minutes ->> 'background', a.meeting_minutes ->> 'advisor', a.meeting_minutes ->> 'reaction')) <> ''
            then 'This CPS has minutes or a closing, so it cannot be cancelled'
        when nullif(btrim(coalesce(p.cps_form_url, '')), '') is not null or p.cps_form_date is not null or p.cps_attachment is not null
            then 'This person has a CPS form on file, so the CPS cannot be cancelled'
        when p.status = 'converted'
            then 'This person is already a customer'
    end
$$;
revoke execute on function public.cps_cancel_blocker(public.activities, public.prospects) from public, anon, authenticated;

-- ── 1. Cancel ───────────────────────────────────────────────────────────────
create or replace function public.cps_cancel(p_activity bigint, p_reason text, p_note text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
    v_me bigint := public.current_user_row_id();
    v_lvl int := coalesce(public.current_user_level(), 99);
    a public.activities%rowtype;
    p public.prospects%rowtype;
    v_why text;
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
    v_why := public.cps_cancel_blocker(a, p);
    if v_why is not null then raise exception '%', v_why using errcode = '22023'; end if;
    if public.journey_today() > public.cps_cancel_last_day(a.activity_date) then
        raise exception 'Cancel period ended on %, so this CPS cannot be cancelled',
            to_char(public.cps_cancel_last_day(a.activity_date), 'FMDD Mon') using errcode = '22023';
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

-- ── 2. A locked CPS keeps its date and type ─────────────────────────────────
create or replace function public.cps_date_lock_trg()
returns trigger language plpgsql security definer set search_path = public as $$
declare
    p public.prospects%rowtype;
begin
    -- Cron and the service role have no user row. L1–2 fix wrong dates.
    if public.current_user_row_id() is null or coalesce(public.current_user_level(), 99) <= 2 or old.prospect_id is null then
        return new;
    end if;
    if public.journey_today() > public.cps_cancel_last_day(old.activity_date) then
        select * into p from public.prospects where id = old.prospect_id;
        if public.cps_cancel_blocker(old, p) is null then
            raise exception 'This CPS is past its cancel period, so its date and type can''t be changed. Ask an admin to fix a wrong date.'
                using errcode = '22023';
        end if;
    end if;
    return new;
end $$;
revoke execute on function public.cps_date_lock_trg() from public, anon, authenticated;

drop trigger if exists trg_cps_date_lock on public.activities;
create trigger trg_cps_date_lock
    before update of activity_date, activity_type on public.activities
    for each row
    when (old.activity_type = 'CPS' and (new.activity_date is distinct from old.activity_date or new.activity_type is distinct from old.activity_type))
    execute function public.cps_date_lock_trg();
