-- Profile reorganisation, Phase 2 (2026-10-25): ONE task list.
--
-- journey_touchpoints is THE task record. A meeting's next action (activities /
-- event_attendees.next_action) and a person-made deal next step
-- (pipeline_deals.next_step) become ONE linked task each — the profile shows
-- the task, the meeting keeps its own text as history, nothing is copied.
--   * meeting  → task_sync_activity / task_sync_attendee (insert + update)
--   * deal     → task_sync_deal, only once a person has saved the deal
--                (auto_created = false) and only when no open meeting task
--                already says the same thing (auto drafts copy the meeting text)
--   * task done / skipped → the meeting's next_action_done follows (task_sync_back)
--   * manual   → task_add(prospect, customer, title, due) RPC
-- Titles start with an emoji token because journey_todo_for strips the first
-- word of a touchpoint title for the daily to-do line.
-- Every trigger swallows its errors: a task problem must never block a save.

-- ── 1. Columns ──────────────────────────────────────────────────────────────
alter table public.journey_touchpoints
    add column if not exists source_kind        text,
    add column if not exists source_activity_id bigint,
    add column if not exists source_attendee_id bigint,
    add column if not exists source_deal_id     bigint;
create unique index if not exists jt_one_per_activity on public.journey_touchpoints (source_activity_id) where source_activity_id is not null;
create unique index if not exists jt_one_per_attendee on public.journey_touchpoints (source_attendee_id) where source_attendee_id is not null;
create unique index if not exists jt_one_per_deal     on public.journey_touchpoints (source_deal_id)     where source_deal_id is not null;

-- "By when" on the minutes form (defaults to +7 days client-side).
alter table public.activities      add column if not exists next_action_due  date;
alter table public.event_attendees add column if not exists next_action_due  date;
-- Event next actions had no done flag (ticks lived in one phone's localStorage).
alter table public.event_attendees add column if not exists next_action_done boolean not null default false;

-- ── 2. Helpers ──────────────────────────────────────────────────────────────
-- "九星课, 改命会 | Remarks: call his wife" → "📝 九星课, 改命会 — call his wife"
create or replace function public.task_title_from_next_action(p text) returns text
language sql immutable set search_path = public as $$
    select case when nullif(btrim(coalesce(p, '')), '') is null then null else
        left('📝 ' || btrim(regexp_replace(btrim(regexp_replace(btrim(p), '\s*\|\s*Remarks:\s*', ' — ', 'g')), '^—\s*', '')), 200)
    end
$$;

create or replace function public.task_agent_uuid(p_agent bigint) returns uuid
language sql stable security definer set search_path = public as $$
    select auth_user_id from public.users where id = p_agent
$$;

-- Upsert / close the ONE task that belongs to a meeting-like source.
-- p_src: 'activity' | 'attendee'. Returns nothing.
create or replace function public.task_sync_source(
    p_src text, p_src_id bigint, p_pid bigint, p_cid bigint, p_text text,
    p_meet_date date, p_due date, p_done boolean, p_agent bigint, p_due_changed boolean)
returns void language plpgsql security definer set search_path = public as $$
declare
    v_title text := public.task_title_from_next_action(p_text);
    v_today date := public.journey_today();
    v_tp    public.journey_touchpoints%rowtype;
    v_due   date;
begin
    if p_src = 'activity' then
        select * into v_tp from public.journey_touchpoints where source_activity_id = p_src_id;
    else
        select * into v_tp from public.journey_touchpoints where source_attendee_id = p_src_id;
    end if;

    if v_title is null then
        -- next action cleared → drop the open task; a finished one stays as history
        if v_tp.id is not null and v_tp.status in ('pending', 'overdue', 'snoozed') then
            delete from public.journey_touchpoints where id = v_tp.id;
        end if;
        return;
    end if;

    if v_tp.id is null then
        -- only live meetings make a task: ≤ 90 days old, or an explicit date given
        if p_due is null and coalesce(p_meet_date, v_today) < v_today - 90 then return; end if;
        if p_pid is null and p_cid is null then return; end if;
        v_due := coalesce(p_due, greatest(coalesce(p_meet_date, v_today) + 7, v_today));
        insert into public.journey_touchpoints
            (prospect_id, customer_id, stage_name, track, touchpoint_type, title, due_date, priority,
             status, completed_at, assigned_to, assigned_to_id, follow_mode, auto_created,
             source_kind, source_activity_id, source_attendee_id)
        values (case when p_cid is null then p_pid end, p_cid, 'follow_up', 'active', 'task', v_title, v_due, 'med',
                case when p_done then 'done' else 'pending' end, case when p_done then now() end,
                public.task_agent_uuid(p_agent), p_agent, 'active', true,
                'meeting', case when p_src = 'activity' then p_src_id end, case when p_src = 'attendee' then p_src_id end)
        on conflict do nothing;
        return;
    end if;

    update public.journey_touchpoints t
       set title        = v_title,
           due_date     = case when p_due_changed and p_due is not null then p_due else t.due_date end,
           status       = case when p_done and t.status in ('pending', 'overdue', 'snoozed') then 'done'
                               when not p_done and t.status = 'done' then 'pending'
                               else t.status end,
           completed_at = case when p_done and t.status in ('pending', 'overdue', 'snoozed') then now()
                               when not p_done and t.status = 'done' then null
                               else t.completed_at end,
           updated_at   = now()
     where t.id = v_tp.id
       and (t.title is distinct from v_title
            or (p_due_changed and p_due is not null and t.due_date is distinct from p_due)
            or (p_done and t.status in ('pending', 'overdue', 'snoozed'))
            or (not p_done and t.status = 'done'));
end $$;

-- ── 3. Meeting → task ───────────────────────────────────────────────────────
create or replace function public.task_sync_activity() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_agent bigint;
begin
    v_agent := coalesce(new.lead_agent_id,
                        (select responsible_agent_id from public.prospects where id = new.prospect_id),
                        (select responsible_agent_id from public.customers where id = new.customer_id));
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
    after insert or update of next_action, note_next_steps, next_action_due, next_action_done on public.activities
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
    perform public.task_sync_source('attendee', new.id, v_pid, v_cid, new.next_action,
        v_date, new.next_action_due, coalesce(new.next_action_done, false), v_agent,
        case when tg_op = 'INSERT' then true else new.next_action_due is distinct from old.next_action_due end);
    return null;
exception when others then
    return null;
end $$;
drop trigger if exists trg_task_sync_attendee on public.event_attendees;
create trigger trg_task_sync_attendee
    after insert or update of next_action, next_action_due, next_action_done on public.event_attendees
    for each row execute function public.task_sync_attendee();

-- ── 4. Deal next step → task (person-made only) ─────────────────────────────
create or replace function public.task_sync_deal() returns trigger
language plpgsql security definer set search_path = public as $$
declare
    v_open  boolean := new.stage in ('interested', 'proposal', 'prescribed', 'closing');
    v_title text    := public.task_title_from_next_action(new.next_step);
    v_tp    public.journey_touchpoints%rowtype;
    v_due   date    := coalesce(new.next_step_date, public.journey_today() + 7);
begin
    select * into v_tp from public.journey_touchpoints where source_deal_id = new.id;
    if v_tp.id is not null then
        if not v_open then
            update public.journey_touchpoints
               set status = case when new.stage = 'won' then 'done' else 'skipped' end,
                   completed_at = now(), updated_at = now()
             where id = v_tp.id and status in ('pending', 'overdue', 'snoozed');
        elsif v_title is null then
            delete from public.journey_touchpoints where id = v_tp.id and status in ('pending', 'overdue', 'snoozed');
        else
            update public.journey_touchpoints
               set title = v_title, due_date = v_due, assigned_to_id = new.agent_id,
                   assigned_to = public.task_agent_uuid(new.agent_id), updated_at = now()
             where id = v_tp.id and status in ('pending', 'overdue', 'snoozed')
               and (title is distinct from v_title or due_date is distinct from v_due or assigned_to_id is distinct from new.agent_id);
        end if;
        return null;
    end if;
    if not v_open or v_title is null or coalesce(new.auto_created, false) then return null; end if;
    -- the same words already sit on an open meeting task → that task is the one
    if exists (select 1 from public.journey_touchpoints t
                where t.prospect_id = new.prospect_id and t.source_kind = 'meeting'
                  and t.status in ('pending', 'overdue', 'snoozed') and t.title = v_title) then
        return null;
    end if;
    insert into public.journey_touchpoints
        (prospect_id, stage_name, track, touchpoint_type, title, due_date, priority, status,
         assigned_to, assigned_to_id, follow_mode, auto_created, source_kind, source_deal_id)
    values (new.prospect_id, 'deal_step', 'active', 'task', v_title, v_due, 'high', 'pending',
            public.task_agent_uuid(new.agent_id), new.agent_id, 'active', true, 'deal', new.id)
    on conflict do nothing;
    return null;
exception when others then
    return null;
end $$;
drop trigger if exists trg_task_sync_deal on public.pipeline_deals;
create trigger trg_task_sync_deal
    after insert or update of next_step, next_step_date, stage, agent_id, auto_created on public.pipeline_deals
    for each row execute function public.task_sync_deal();

-- ── 5. Task done / skipped → the meeting's done flag ────────────────────────
create or replace function public.task_sync_back() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_done boolean := new.status in ('done', 'skipped', 'auto_sent');
begin
    if new.source_activity_id is not null then
        update public.activities set next_action_done = v_done
         where id = new.source_activity_id and coalesce(next_action_done, false) is distinct from v_done;
    elsif new.source_attendee_id is not null then
        update public.event_attendees set next_action_done = v_done
         where id = new.source_attendee_id and next_action_done is distinct from v_done;
    end if;
    return null;
exception when others then
    return null;
end $$;
drop trigger if exists trg_task_sync_back on public.journey_touchpoints;
create trigger trg_task_sync_back
    after update of status on public.journey_touchpoints
    for each row when (old.status is distinct from new.status)
    execute function public.task_sync_back();

-- ── 6. Manual task ──────────────────────────────────────────────────────────
create or replace function public.task_add(p_pid bigint, p_cid bigint, p_title text, p_due date)
returns bigint language plpgsql security definer set search_path = public as $$
declare v_me bigint := public.current_user_row_id(); v_id bigint;
begin
    if nullif(btrim(coalesce(p_title, '')), '') is null or p_due is null then
        raise exception 'A title and a due date are required';
    end if;
    if p_cid is not null then
        if not (coalesce(public.current_user_level(), 99) <= 2 or public.customer_is_visible(p_cid)) then
            raise exception 'Not permitted' using errcode = '42501';
        end if;
    elsif p_pid is not null then
        if not (coalesce(public.current_user_level(), 99) <= 2 or public.prospect_is_visible(p_pid)) then
            raise exception 'Not permitted' using errcode = '42501';
        end if;
    else
        raise exception 'A prospect or customer is required';
    end if;
    insert into public.journey_touchpoints
        (prospect_id, customer_id, stage_name, track, touchpoint_type, title, due_date, priority, status,
         assigned_to, assigned_to_id, follow_mode, auto_created, source_kind)
    values (case when p_cid is null then p_pid end, p_cid, 'follow_up', 'active', 'task',
            left('📝 ' || btrim(p_title), 200), p_due, 'med', 'pending',
            public.task_agent_uuid(v_me), v_me, 'active', false, 'manual')
    returning id into v_id;
    return v_id;
end $$;
revoke execute on function public.task_add(bigint, bigint, text, date) from public, anon;
grant execute on function public.task_add(bigint, bigint, text, date) to authenticated;
revoke execute on function public.task_sync_source(text, bigint, bigint, bigint, text, date, date, boolean, bigint, boolean) from public, anon, authenticated;
revoke execute on function public.task_agent_uuid(bigint) from public, anon;

-- ── 7. Backfill: open meeting next actions from the last 90 days ────────────
-- (deal next steps: none — every deal at launch is an auto draft copying a
--  meeting next action, so those are already covered by the meeting task)
insert into public.journey_touchpoints
    (prospect_id, customer_id, stage_name, track, touchpoint_type, title, due_date, priority, status,
     assigned_to, assigned_to_id, follow_mode, auto_created, source_kind, source_activity_id)
select case when a.customer_id is null then a.prospect_id end, a.customer_id, 'follow_up', 'active', 'task',
       public.task_title_from_next_action(coalesce(nullif(btrim(a.next_action), ''), a.note_next_steps)),
       greatest(a.activity_date + 7, public.journey_today()), 'med', 'pending',
       public.task_agent_uuid(ag.agent), ag.agent, 'active', true, 'meeting', a.id
  from public.activities a
  left join public.prospects p on p.id = a.prospect_id
  left join public.customers c on c.id = a.customer_id
  cross join lateral (select coalesce(a.lead_agent_id, p.responsible_agent_id, c.responsible_agent_id) agent) ag
 where coalesce(nullif(btrim(a.next_action), ''), nullif(btrim(a.note_next_steps), '')) is not null
   and a.activity_date >= public.journey_today() - 90
   and not coalesce(a.next_action_done, false)
   and (a.prospect_id is not null or a.customer_id is not null)
on conflict do nothing;
