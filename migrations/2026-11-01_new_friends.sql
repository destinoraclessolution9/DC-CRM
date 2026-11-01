-- 🌱 New Friends (2026-11-01, owner): a friend can come to an event first and
-- never have done a CPS. Those people get their own list, moving forward only.
-- ★ Old names ALL did CPS, they were only keyed in by hand, so "no CPS logged"
-- never means New Friend: the only way in is the tag set by the New Friend
-- button on an event (prospects.source = 'event_new_friend', source_id = the
-- event session). Existing rows are never tagged.
--   * nf_rows: the one rule for who is still a New Friend.
--   * new_friend_list: Reports → Name List tab + the Prospects filters, scoped
--     to your own people (or your team as an upline).
--   * new_friend_daily: one "Book CPS" task the day after they came, once ever;
--     closes the task when the person leaves the list another way.
--   * trg_new_friend_cps: a CPS logged or booked closes that task at once.
--   * inv_compute: the "New friend · CPS" reason now reads "Recent CPS" (it
--     means a CPS in the last 60 days, the opposite of a New Friend).
-- Rollback: migrations/2026-11-01_new_friends_undo.sql

create index if not exists prospects_new_friend_idx on public.prospects (responsible_agent_id)
    where source = 'event_new_friend';

-- ── 1. Who is still a New Friend ────────────────────────────────────────────
-- Leaves when a CPS has happened (a CPS booked for later stays, marked booked)
-- or a CPS form is on file, when they buy, or when they are graded F / lost /
-- unable to serve.
create or replace function public.nf_rows(p_today date)
returns table (prospect_id bigint, name text, phone text, agent_id bigint, brought_by text, added_on date,
               session_id bigint, event_title text, event_date date, came_n int, first_came date, last_came date,
               state text, cps_booked date)
language sql stable security definer set search_path = public as $$
    with p as (
        select pr.id, pr.full_name, pr.phone, pr.responsible_agent_id, pr.referred_by, pr.created_at, pr.source_id
          from public.prospects pr
         where pr.source = 'event_new_friend'
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
           case when coalesce(a.came_n, 0) > 0 then 'came'
                when coalesce(a.coming_n, 0) > 0 then 'coming'
                when coalesce(a.noshow_n, 0) > 0 then 'no_show'
                else 'unmarked' end,
           (select min(c.activity_date) from public.activities c
             where c.prospect_id = p.id and c.activity_type = 'CPS' and c.activity_date > p_today)
      from p
      left join att a on a.pid = p.id
      left join public.activities s on s.id = p.source_id
      left join public.events e on e.id = s.event_id
$$;
revoke execute on function public.nf_rows(date) from public, anon, authenticated;

-- ── 2. The list (Name List tab, Prospects filters) ──────────────────────────
create or replace function public.new_friend_list()
returns table (prospect_id bigint, name text, phone text, agent_id bigint, agent_name text, brought_by text, added_on date,
               session_id bigint, event_title text, event_date date, came_n int, state text, cps_booked date, days_waiting int)
language plpgsql stable security definer set search_path = public as $$
declare
    v_lvl int := coalesce(public.current_user_level(), 99);
    v_today date := public.journey_today();
begin
    if public.current_user_row_id() is null then raise exception 'Not permitted' using errcode = '42501'; end if;
    return query
    select r.prospect_id, r.name, r.phone, r.agent_id, u.full_name, r.brought_by, r.added_on,
           r.session_id, r.event_title, r.event_date, r.came_n, r.state, r.cps_booked,
           greatest(v_today - coalesce(r.first_came, r.added_on), 0)::int
      from public.nf_rows(v_today) r
      left join public.users u on u.id = r.agent_id
     where v_lvl <= 2 or r.agent_id in (select public.current_user_visible_ids())
     order by (r.cps_booked is not null),
              case r.state when 'came' then 0 when 'unmarked' then 1 when 'no_show' then 2 else 3 end,
              greatest(v_today - coalesce(r.first_came, r.added_on), 0) desc, r.name
     limit 500;
end $$;
revoke execute on function public.new_friend_list() from public, anon;
grant execute on function public.new_friend_list() to authenticated;

-- ── 3. The Book CPS task ────────────────────────────────────────────────────
-- Once ever per person, only for people who came, never when a CPS is already
-- booked. Attendance marked a few days late still gets the task (7-day window).
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

    -- bought, graded F, form uploaded: no more New Friend, no more task
    update public.journey_touchpoints t
       set status = 'skipped', notes = coalesce(t.notes || ' · ', '') || 'auto: no longer a new friend'
     where t.source_kind = 'new_friend' and t.status in ('pending', 'overdue', 'snoozed')
       and t.prospect_id not in (select r.prospect_id from public.nf_rows(v_today) r);
    get diagnostics v_closed = row_count;

    return jsonb_build_object('tasks', v_tasks, 'closed', v_closed);
end $$;
revoke execute on function public.new_friend_daily() from public, anon, authenticated;

do $$ begin
    perform cron.unschedule('new-friend-daily') where exists (select 1 from cron.job where jobname = 'new-friend-daily');
    perform cron.schedule('new-friend-daily', '25 0 * * *', 'select public.new_friend_daily()');
end $$;

-- A CPS logged or booked is what the task asked for.
create or replace function public.new_friend_cps_trg()
returns trigger language plpgsql security definer set search_path = public as $$
begin
    update public.journey_touchpoints
       set status = 'done', completed_at = now(), completed_by_id = new.lead_agent_id, done_by_activity_id = new.id,
           notes = coalesce(notes || ' · ', '') || 'auto: CPS ' || new.activity_date
     where prospect_id = new.prospect_id and source_kind = 'new_friend' and status in ('pending', 'overdue', 'snoozed');
    return null;
exception when others then
    return null;
end $$;
drop trigger if exists trg_new_friend_cps on public.activities;
create trigger trg_new_friend_cps after insert or update of activity_type, prospect_id on public.activities
    for each row when (new.activity_type = 'CPS' and new.prospect_id is not null)
    execute function public.new_friend_cps_trg();

-- ── 4. Who to invite: "New friend" now means no CPS yet ─────────────────────
do $$
declare v_def text; v_new text;
begin
    select pg_get_functiondef(p.oid) into strict v_def from pg_proc p
     where p.pronamespace = 'public'::regnamespace and p.proname = 'inv_compute';
    v_new := replace(v_def, '''New friend · CPS''', '''Recent CPS''');
    if v_new = v_def then raise exception 'inv_compute: reason label not found'; end if;
    execute v_new;
end $$;
