-- Post-Meetup Notes redesign, Phase 1 (2026-10-26): several next steps per meeting.
--
-- The minutes form now saves next steps as a list on the meeting:
--   activities.next_actions / event_attendees.next_actions =
--     [{ "text": "...", "type": "call|meetup|event|whatsapp|other", "due": "YYYY-MM-DD",
--        "event_activity_id": 123 (event invites only) }, ...]
-- Each row is ONE task in journey_touchpoints, keyed by (source_activity_id |
-- source_attendee_id, source_seq = row number 1..n). Meetings saved the old way
-- (one next_action text, no list) keep the single task with source_seq = 0.
-- The meeting's next_action_done = "no open task left for it".
-- Also: names.phone (Name List / APU entries made from the minutes form).
-- Every trigger swallows its errors: a task problem must never block a save.

alter table public.activities      add column if not exists next_actions jsonb;
alter table public.event_attendees add column if not exists next_actions jsonb;
alter table public.names           add column if not exists phone text;
alter table public.journey_touchpoints add column if not exists source_seq integer not null default 0;

drop index if exists public.jt_one_per_activity;
drop index if exists public.jt_one_per_attendee;
create unique index if not exists jt_one_per_activity_seq on public.journey_touchpoints (source_activity_id, source_seq) where source_activity_id is not null;
create unique index if not exists jt_one_per_attendee_seq on public.journey_touchpoints (source_attendee_id, source_seq) where source_attendee_id is not null;

-- Row type → touchpoint type + title emoji (the first word of a title is
-- stripped by journey_todo_for, so the emoji is that word).
create or replace function public.task_step_type(p_type text) returns text
language sql immutable set search_path = public as $$
    select case p_type when 'call' then 'call' when 'meetup' then 'meeting' when 'whatsapp' then 'whatsapp' else 'task' end
$$;
create or replace function public.task_step_title(p_type text, p_text text) returns text
language sql immutable set search_path = public as $$
    select case when nullif(btrim(coalesce(p_text, '')), '') is null then null else
        left(case p_type when 'call' then '📞 ' when 'meetup' then '🤝 ' when 'event' then '🎟️ ' when 'whatsapp' then '💬 ' else '📝 ' end
             || btrim(p_text), 200) end
$$;

-- Sync the list of next steps of one meeting to its tasks.
create or replace function public.task_sync_rows(
    p_src text, p_src_id bigint, p_pid bigint, p_cid bigint, p_rows jsonb, p_old jsonb,
    p_meet_date date, p_agent bigint)
returns void language plpgsql security definer set search_path = public as $$
declare
    v_today date := public.journey_today();
    v_n int := 0;
    v_row jsonb; v_old jsonb; v_title text; v_due date; v_old_due date; v_type text;
    v_tp public.journey_touchpoints%rowtype;
    i int;
begin
    if p_pid is null and p_cid is null then return; end if;
    if jsonb_typeof(p_rows) = 'array' then v_n := jsonb_array_length(p_rows); end if;
    for i in 1 .. v_n loop
        v_row := p_rows -> (i - 1);
        v_old := case when jsonb_typeof(p_old) = 'array' then p_old -> (i - 1) end;
        v_title := public.task_step_title(v_row ->> 'type', v_row ->> 'text');
        v_type := public.task_step_type(v_row ->> 'type');
        begin v_due := nullif(v_row ->> 'due', '')::date; exception when others then v_due := null; end;
        begin v_old_due := nullif(v_old ->> 'due', '')::date; exception when others then v_old_due := null; end;
        if p_src = 'activity' then
            select * into v_tp from public.journey_touchpoints where source_activity_id = p_src_id and source_seq = i;
        else
            select * into v_tp from public.journey_touchpoints where source_attendee_id = p_src_id and source_seq = i;
        end if;
        if v_title is null then
            if v_tp.id is not null and v_tp.status in ('pending', 'overdue', 'snoozed') then
                delete from public.journey_touchpoints where id = v_tp.id;
            end if;
            continue;
        end if;
        if v_tp.id is null then
            insert into public.journey_touchpoints
                (prospect_id, customer_id, stage_name, track, touchpoint_type, title, due_date, priority, status,
                 assigned_to, assigned_to_id, follow_mode, auto_created, source_kind,
                 source_activity_id, source_attendee_id, source_seq)
            values (case when p_cid is null then p_pid end, p_cid, 'follow_up', 'active', v_type, v_title,
                    coalesce(v_due, greatest(coalesce(p_meet_date, v_today) + 7, v_today)), 'med', 'pending',
                    public.task_agent_uuid(p_agent), p_agent, 'active', true, 'meeting',
                    case when p_src = 'activity' then p_src_id end, case when p_src = 'attendee' then p_src_id end, i)
            on conflict do nothing;
        else
            -- the due date follows the form only when the form's date changed
            -- (a task rescheduled in Next up keeps its own date)
            update public.journey_touchpoints t
               set title = v_title, touchpoint_type = v_type,
                   due_date = case when v_due is not null and v_due is distinct from v_old_due then v_due else t.due_date end,
                   updated_at = now()
             where t.id = v_tp.id
               and (t.title is distinct from v_title or t.touchpoint_type is distinct from v_type
                    or (v_due is not null and v_due is distinct from v_old_due and t.due_date is distinct from v_due));
        end if;
    end loop;
    -- rows removed from the list, and the old single next action → drop their open tasks
    if p_src = 'activity' then
        delete from public.journey_touchpoints
         where source_activity_id = p_src_id and (source_seq > v_n or source_seq = 0)
           and status in ('pending', 'overdue', 'snoozed');
    else
        delete from public.journey_touchpoints
         where source_attendee_id = p_src_id and (source_seq > v_n or source_seq = 0)
           and status in ('pending', 'overdue', 'snoozed');
    end if;
end $$;
revoke execute on function public.task_sync_rows(text, bigint, bigint, bigint, jsonb, jsonb, date, bigint) from public, anon, authenticated;

create or replace function public.task_sync_activity() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_agent bigint;
begin
    v_agent := coalesce(new.lead_agent_id,
                        (select responsible_agent_id from public.prospects where id = new.prospect_id),
                        (select responsible_agent_id from public.customers where id = new.customer_id));
    if new.next_actions is not null then
        perform public.task_sync_rows('activity', new.id, new.prospect_id, new.customer_id, new.next_actions,
            case when tg_op = 'UPDATE' then old.next_actions end, new.activity_date, v_agent);
        return null;
    end if;
    perform public.task_sync_source('activity', new.id, new.prospect_id, new.customer_id,
        coalesce(nullif(btrim(new.next_action), ''), new.note_next_steps),
        new.activity_date, new.next_action_due, coalesce(new.next_action_done, false), v_agent,
        case when tg_op = 'INSERT' then true else new.next_action_due is distinct from old.next_action_due end);
    return null;
exception when others then
    return null;
end $$;
drop trigger if exists trg_task_sync_activity on public.activities;
create trigger trg_task_sync_activity
    after insert or update of next_action, note_next_steps, next_action_due, next_action_done, next_actions on public.activities
    for each row execute function public.task_sync_activity();

create or replace function public.task_sync_attendee() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_pid bigint; v_cid bigint; v_date date; v_agent bigint;
begin
    if new.attendee_type = 'customer' then v_cid := new.entity_id; else v_pid := new.entity_id; end if;
    select activity_date into v_date from public.activities where id = new.activity_id;
    v_agent := coalesce(case when v_cid is not null then (select responsible_agent_id from public.customers where id = v_cid)
                             else (select responsible_agent_id from public.prospects where id = v_pid) end,
                        new.added_by_agent_id);
    if new.next_actions is not null then
        perform public.task_sync_rows('attendee', new.id, v_pid, v_cid, new.next_actions,
            case when tg_op = 'UPDATE' then old.next_actions end, v_date, v_agent);
        return null;
    end if;
    perform public.task_sync_source('attendee', new.id, v_pid, v_cid, new.next_action,
        v_date, new.next_action_due, coalesce(new.next_action_done, false), v_agent,
        case when tg_op = 'INSERT' then true else new.next_action_due is distinct from old.next_action_due end);
    return null;
exception when others then
    return null;
end $$;
drop trigger if exists trg_task_sync_attendee on public.event_attendees;
create trigger trg_task_sync_attendee
    after insert or update of next_action, next_action_due, next_action_done, next_actions on public.event_attendees
    for each row execute function public.task_sync_attendee();

-- Task done / skipped → the meeting is "done" once none of its tasks is open.
create or replace function public.task_sync_back() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_done boolean;
begin
    if new.source_activity_id is not null then
        v_done := not exists (select 1 from public.journey_touchpoints t where t.source_activity_id = new.source_activity_id
                                and t.status in ('pending', 'overdue', 'snoozed'));
        update public.activities set next_action_done = v_done
         where id = new.source_activity_id and coalesce(next_action_done, false) is distinct from v_done;
    elsif new.source_attendee_id is not null then
        v_done := not exists (select 1 from public.journey_touchpoints t where t.source_attendee_id = new.source_attendee_id
                                and t.status in ('pending', 'overdue', 'snoozed'));
        update public.event_attendees set next_action_done = v_done
         where id = new.source_attendee_id and next_action_done is distinct from v_done;
    end if;
    return null;
exception when others then
    return null;
end $$;
