-- 🚫 Cancel CPS (2026-11-01, owner): a CPS called off with no next date never
-- happened, so the person joins 🌱 New Friends. Until now an agent could only
-- keep it (it counts as a CPS done) or delete it (the reason is lost and nobody
-- is reminded). Builds on 2026-11-01_new_friends.sql:
--   * cps_cancellations: what was cancelled, why, by whom. The CPS row itself is
--     deleted, so every report and function that counts 'CPS' stays right with
--     no change, and the normal 🚫 notification goes out.
--   * prospects.cps_cancelled_on: the marker that puts them on the list
--     (prospects.source is left alone: it holds where the record came from).
--   * cps_cancel: the only way in. Agents below L5 can't delete activities, so
--     this runs as definer and checks the caller itself. A CPS that really
--     happened (minutes, closing, CPS form) can't be cancelled.
--   * nf_rows / new_friend_list / new_friend_daily: cancelled people are listed,
--     with one Book CPS task 3 days later (per cancellation).
-- Rollback: migrations/2026-11-01_cps_cancel_undo.sql

alter table public.prospects add column if not exists cps_cancelled_on date;

create table if not exists public.cps_cancellations (
    id           bigint generated always as identity primary key,
    prospect_id  bigint not null references public.prospects (id) on delete cascade,
    activity_id  bigint not null,               -- the CPS row, now deleted
    cps_date     date,
    cps_time     time,
    venue        text,
    lead_agent_id bigint,
    reason       text not null check (reason in ('emergency', 'sick', 'clash', 'unreachable', 'changed_mind', 'other')),
    note         text,
    cancelled_by bigint,
    task_made    boolean not null default false,
    created_at   timestamptz not null default now()
);
create index if not exists cps_cancellations_prospect_idx on public.cps_cancellations (prospect_id, id desc);
alter table public.cps_cancellations enable row level security;
revoke all on public.cps_cancellations from public, anon, authenticated;

create or replace function public.cps_reason_label(p_reason text)
returns text language sql immutable as $$
    select case p_reason when 'emergency' then 'Emergency' when 'sick' then 'Sick' when 'clash' then 'Schedule clash'
                         when 'unreachable' then 'Can''t reach' when 'changed_mind' then 'Changed mind' else 'Other' end
$$;

-- ── 1. Cancel ───────────────────────────────────────────────────────────────
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

-- ── 2. The list rule now covers both ways in ────────────────────────────────
drop function if exists public.new_friend_list();
drop function if exists public.nf_rows(date);

create function public.nf_rows(p_today date)
returns table (prospect_id bigint, name text, phone text, agent_id bigint, brought_by text, added_on date,
               session_id bigint, event_title text, event_date date, came_n int, first_came date, last_came date,
               state text, cps_booked date, cancelled_on date, cancelled_cps_date date, cancel_reason text, cancel_note text)
language sql stable security definer set search_path = public as $$
    with p as (
        select pr.id, pr.full_name, pr.phone, pr.responsible_agent_id, pr.referred_by, pr.created_at,
               case when pr.source = 'event_new_friend' then pr.source_id end source_id
          from public.prospects pr
         where (pr.source = 'event_new_friend' or pr.cps_cancelled_on is not null)
           and coalesce(pr.status, '') not in ('converted', 'lost')
           and coalesce(pr.conversion_status, '') not in ('converted', 'approved', 'pending_approval')
           and pr.manual_grade is distinct from 'F'
           and coalesce(pr.unable_to_serve, false) = false
           and nullif(btrim(coalesce(pr.cps_form_url, '')), '') is null
           and pr.cps_form_date is null
           and pr.cps_attachment is null
           and not exists (select 1 from public.activities a
                            where a.prospect_id = pr.id and a.activity_type = 'CPS' and a.activity_date <= p_today)
    ), att as (
        select coalesce(ea.entity_id, ea.attendee_id) pid,
               count(distinct ea.activity_id) filter (where coalesce(ea.attended, false) or ea.attendance_status in ('Attended', 'Late')) came_n,
               count(*) filter (where ea.attendance_status = 'No Show') noshow_n,
               count(*) filter (where s.activity_date >= p_today and ea.attendance_status is distinct from 'No Show') coming_n,
               min(s.activity_date) filter (where coalesce(ea.attended, false) or ea.attendance_status in ('Attended', 'Late')) first_came,
               max(s.activity_date) filter (where coalesce(ea.attended, false) or ea.attendance_status in ('Attended', 'Late')) last_came
          from public.event_attendees ea
          join public.activities s on s.id = ea.activity_id
         where ea.attendee_type = 'prospect' and coalesce(ea.entity_id, ea.attendee_id) in (select id from p)
         group by 1
    )
    select p.id, p.full_name, p.phone, p.responsible_agent_id, p.referred_by, (p.created_at at time zone 'Asia/Kuala_Lumpur')::date,
           p.source_id, coalesce(nullif(btrim(e.title), ''), s.activity_title), s.activity_date,
           coalesce(a.came_n, 0)::int, a.first_came, a.last_came,
           case when c.id is not null then 'cps_cancelled'
                when coalesce(a.came_n, 0) > 0 then 'came'
                when coalesce(a.coming_n, 0) > 0 then 'coming'
                when coalesce(a.noshow_n, 0) > 0 then 'no_show'
                else 'unmarked' end,
           (select min(n.activity_date) from public.activities n
             where n.prospect_id = p.id and n.activity_type = 'CPS' and n.activity_date > p_today),
           (c.created_at at time zone 'Asia/Kuala_Lumpur')::date, c.cps_date, c.reason, c.note
      from p
      left join att a on a.pid = p.id
      left join public.activities s on s.id = p.source_id
      left join public.events e on e.id = s.event_id
      left join lateral (select x.id, x.created_at, x.cps_date, x.reason, x.note from public.cps_cancellations x
                          where x.prospect_id = p.id order by x.id desc limit 1) c on true
$$;
revoke execute on function public.nf_rows(date) from public, anon, authenticated;

create function public.new_friend_list()
returns table (prospect_id bigint, name text, phone text, agent_id bigint, agent_name text, brought_by text, added_on date,
               session_id bigint, event_title text, event_date date, came_n int, state text, cps_booked date, days_waiting int,
               cancelled_cps_date date, cancel_reason text, cancel_note text)
language plpgsql stable security definer set search_path = public as $$
declare
    v_lvl int := coalesce(public.current_user_level(), 99);
    v_today date := public.journey_today();
begin
    if public.current_user_row_id() is null then raise exception 'Not permitted' using errcode = '42501'; end if;
    return query
    select r.prospect_id, r.name, r.phone, r.agent_id, u.full_name, r.brought_by, r.added_on,
           r.session_id, r.event_title, r.event_date, r.came_n, r.state, r.cps_booked,
           greatest(v_today - coalesce(r.cancelled_on, r.first_came, r.added_on), 0)::int,
           r.cancelled_cps_date, public.cps_reason_label(r.cancel_reason), r.cancel_note
      from public.nf_rows(v_today) r
      left join public.users u on u.id = r.agent_id
     where v_lvl <= 2 or r.agent_id in (select public.current_user_visible_ids())
     order by (r.cps_booked is not null),
              case r.state when 'came' then 0 when 'cps_cancelled' then 0 when 'unmarked' then 1 when 'no_show' then 2 else 3 end,
              greatest(v_today - coalesce(r.cancelled_on, r.first_came, r.added_on), 0) desc, r.name
     limit 500;
end $$;
revoke execute on function public.new_friend_list() from public, anon;
grant execute on function public.new_friend_list() to authenticated;

-- ── 3. One Book CPS task 3 days later, per cancellation ─────────────────────
-- 3 days, not the next morning: chasing someone right after an emergency is
-- pushy (owner OK). The latest cancellation only; booking again ends it.
create or replace function public.new_friend_daily()
returns jsonb language plpgsql security definer set search_path = public as $$
declare
    v_today date := public.journey_today();
    v_tasks int := 0; v_closed int := 0;
    rw record;
begin
    for rw in select r.* from public.nf_rows(v_today) r
               where r.state = 'came' and r.cps_booked is null and r.agent_id is not null
                 and r.last_came between v_today - 7 and v_today - 1
                 and not exists (select 1 from public.journey_touchpoints t
                                  where t.prospect_id = r.prospect_id and t.source_kind = 'new_friend') loop
        insert into public.journey_touchpoints (prospect_id, stage_name, track, touchpoint_type, title, due_date, priority,
                                                status, assigned_to, assigned_to_id, follow_mode, auto_created, source_kind)
        values (rw.prospect_id, 'new_friend_cps', 'active', 'task',
                left('🌱 Book CPS — new friend, came to ' || coalesce(rw.event_title, 'the event'), 200),
                v_today, 'high', 'pending', public.task_agent_uuid(rw.agent_id), rw.agent_id, 'active', true, 'new_friend');
        v_tasks := v_tasks + 1;
    end loop;

    for rw in select c.id cid, c.reason, c.cps_date, r.prospect_id, r.agent_id
                from public.nf_rows(v_today) r
                join public.cps_cancellations c
                  on c.id = (select max(x.id) from public.cps_cancellations x where x.prospect_id = r.prospect_id)
               where not c.task_made and r.cps_booked is null and r.agent_id is not null
                 and r.cancelled_on <= v_today - 3 loop
        insert into public.journey_touchpoints (prospect_id, stage_name, track, touchpoint_type, title, due_date, priority,
                                                status, assigned_to, assigned_to_id, follow_mode, auto_created, source_kind)
        values (rw.prospect_id, 'new_friend_cps', 'active', 'task',
                left('🌱 Book CPS again — cancelled ' || coalesce(to_char(rw.cps_date, 'FMDD Mon'), '') || ' (' || public.cps_reason_label(rw.reason) || ')', 200),
                v_today, 'high', 'pending', public.task_agent_uuid(rw.agent_id), rw.agent_id, 'active', true, 'new_friend');
        update public.cps_cancellations set task_made = true where id = rw.cid;
        v_tasks := v_tasks + 1;
    end loop;

    -- bought, graded F, form uploaded: no more New Friend, no more task
    update public.journey_touchpoints t
       set status = 'skipped', notes = coalesce(t.notes || ' · ', '') || 'auto: no longer a new friend'
     where t.source_kind = 'new_friend' and t.status in ('pending', 'overdue', 'snoozed')
       and t.prospect_id not in (select r.prospect_id from public.nf_rows(v_today) r);
    get diagnostics v_closed = row_count;

    return jsonb_build_object('tasks', v_tasks, 'closed', v_closed);
end $$;
revoke execute on function public.new_friend_daily() from public, anon, authenticated;
