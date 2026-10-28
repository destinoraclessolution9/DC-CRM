-- Event invites — agents add their own people too (2026-10-28, owner).
-- "CRM proposes and reminds, but the agent can also add." Builds on
-- 2026-10-28_event_invite_engine.sql:
--   * event_invite_add: optional "why invite?" note; "Do not invite" people
--     cannot be added (a leader switches it off on the profile first); a
--     recent decline for the same purpose / the monthly invite limit return a
--     warning the screen shows with "Add anyway"; someone already registered
--     is marked Coming at once; when a leader adds to an agent's list the
--     agent gets a push.
--   * event_invite_person: a profile's "🎯 Invite to an event" — upcoming
--     sessions and this person's invites.
--   * list / results: who added, the note, CRM picks vs agent picks.
-- Rollback: migrations/2026-10-28_event_invite_agent_add_undo.sql

alter table public.event_invites add column if not exists add_note text;

drop function if exists public.event_invite_add(bigint, bigint, bigint);
create or replace function public.event_invite_add(p_activity bigint, p_prospect bigint default null, p_customer bigint default null,
                                                    p_note text default null, p_force boolean default false)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
    v_me bigint := public.current_user_row_id(); c jsonb := public.inv_cfg();
    v_key text; a record; e record; v_agent bigint; v_id bigint; v_name text; v_dni boolean := false;
    v_obj text; v_fit int; v_eng int; v_rdy int; v_rsn jsonb; v_wrn jsonb; v_att bigint; h record; v_sent int;
    v_note text := left(nullif(btrim(coalesce(p_note, '')), ''), 200); v_ev text; v_lim int; v_days int; v_reg boolean;
begin
    if v_me is null then raise exception 'Not permitted' using errcode = '42501'; end if;
    if p_customer is not null then
        if not (public.customer_is_visible(p_customer) or coalesce(public.current_user_level(), 99) <= 2) then
            raise exception 'Not permitted' using errcode = '42501'; end if;
        v_key := 'c:' || p_customer;
    elsif p_prospect is not null then
        if not public.prospect_is_visible(p_prospect) then raise exception 'Not permitted' using errcode = '42501'; end if;
        v_key := public.inv_person_key('prospect', p_prospect);
        if v_key like 'c:%' then p_customer := substr(v_key, 3)::bigint; p_prospect := null; end if;
    else
        raise exception 'Pick a person';
    end if;
    if p_customer is not null then
        select cu.responsible_agent_id, cu.full_name, coalesce(cu.do_not_invite, false) or coalesce(pr.do_not_invite, false)
          into v_agent, v_name, v_dni
          from public.customers cu left join public.prospects pr on pr.id = cu.converted_from_prospect_id where cu.id = p_customer;
    else
        select responsible_agent_id, full_name, coalesce(do_not_invite, false) into v_agent, v_name, v_dni
          from public.prospects where id = p_prospect;
    end if;
    -- owner rule: "stop inviting me" means never — a leader switches it off on the profile first
    if v_dni then raise exception '% is marked "Do not invite". A leader can switch it off on the profile first.', coalesce(v_name, 'This person'); end if;

    select s.id, s.event_id, s.activity_date, s.activity_title into a from public.activities s where s.id = p_activity and s.activity_type = 'EVENT';
    if a.id is null then raise exception 'Not an event'; end if;
    select invite_objectives, title into e from public.events where id = a.event_id;
    v_ev := coalesce(nullif(btrim(e.title), ''), a.activity_title, 'the event');

    -- already on this list: bring a removed row back, keep the note
    select id into v_id from public.event_invites where activity_id = p_activity and person_key = v_key;
    if v_id is not null then
        update public.event_invites set state = case when state = 'removed' then case when sent_at is not null then 'sent' else 'suggested' end else state end,
               removed_reason = null, removed_note = null, removed_at = null, removed_by = null,
               add_note = coalesce(v_note, add_note), updated_at = now()
         where id = v_id;
        return jsonb_build_object('ok', true, 'id', v_id, 'existing', true);
    end if;

    select ea.id into v_att from public.event_attendees ea
     where ea.activity_id = p_activity and ea.attendee_type in ('prospect', 'customer')
       and public.inv_person_key(ea.attendee_type, coalesce(ea.entity_id, ea.attendee_id)) = v_key limit 1;
    v_reg := v_att is not null;

    if not v_reg and not coalesce(p_force, false) then
        -- a recent decline for the same purpose (same rules as the engine's pause)
        select i.decline_reason, i.replied_at, i.reinvite, coalesce(nullif(btrim(ev.title), ''), s.activity_title, 'an event') t into h
          from public.event_invites i
          join public.activities s on s.id = i.activity_id
          left join public.events ev on ev.id = s.event_id
         where i.person_key = v_key and i.reply = 'declined' and i.activity_id <> p_activity
           and i.objectives && public.inv_obj_keys(e.invite_objectives)
         order by i.replied_at desc nulls last limit 1;
        if h.decline_reason is not null and (
               h.decline_reason = 'has_it'
            or (h.decline_reason = 'not_interested' and h.replied_at > now() - make_interval(days => coalesce((c #>> '{pause_days,not_interested}')::int, 180)))
            or (h.decline_reason = 'budget' and h.replied_at > now() - make_interval(days => coalesce((c #>> '{pause_days,budget}')::int, 90)))
            or (h.decline_reason = 'other' and h.reinvite is false and h.replied_at > now() - make_interval(days => coalesce((c #>> '{pause_days,other_no}')::int, 180)))) then
            return jsonb_build_object('ok', false, 'warn', 'paused', 'message',
                coalesce(v_name, 'This person') || ' said "' ||
                case h.decline_reason when 'not_interested' then '没兴趣 not interested' when 'budget' then '太贵 too expensive'
                                      when 'has_it' then '已经有了 already has it' else 'not now' end
                || '" to ' || h.t || ' on ' || to_char(h.replied_at at time zone 'Asia/Kuala_Lumpur', 'FMDD Mon') || '.');
        end if;
        v_lim := coalesce((c #>> '{limit,invites}')::int, 2);
        v_days := coalesce((c #>> '{limit,days}')::int, 30);
        select count(*) into v_sent from public.event_invites
         where person_key = v_key and sent_at >= now() - make_interval(days => v_days) and state <> 'removed';
        if v_sent >= v_lim then
            return jsonb_build_object('ok', false, 'warn', 'limit', 'message',
                coalesce(v_name, 'This person') || ' was already invited ' || v_sent || ' times in the last ' || v_days || ' days.');
        end if;
    end if;

    if e.invite_objectives is not null then
        select x.objective, x.fit, x.engagement, x.readiness, x.reasons, x.warnings into v_obj, v_fit, v_eng, v_rdy, v_rsn, v_wrn
          from public.inv_compute(e.invite_objectives, p_activity, v_key) x limit 1;
    end if;
    insert into public.event_invites (activity_id, event_id, person_key, prospect_id, customer_id, agent_id, objectives, objective,
                                      grp, fit, engagement, readiness, reasons, warnings, source, added_by, add_note,
                                      state, sent_at, sent_by, channel, reply, replied_at, replied_by, attendee_id)
    values (p_activity, a.event_id, v_key, p_prospect, p_customer, coalesce(v_agent, v_me), public.inv_obj_keys(e.invite_objectives),
            v_obj, 'manual', v_fit, v_eng, v_rdy, coalesce(v_rsn, '[]'::jsonb), coalesce(v_wrn, '[]'::jsonb), 'manual', v_me, v_note,
            case when v_reg then 'sent' else 'suggested' end, case when v_reg then now() end, case when v_reg then v_me end,
            case when v_reg then 'in_person' end, case when v_reg then 'coming' end, case when v_reg then now() end,
            case when v_reg then v_me end, v_att)
    returning id into v_id;
    insert into public.audit_trail (actor_auth_id, actor_user_id, actor_role_level, category, action, target_table, target_id, detail)
    values (auth.uid(), v_me, public.current_user_level(), 'event_invite', 'manual_add', 'event_invites', v_id::text,
            jsonb_build_object('person', v_key, 'session', p_activity, 'note', v_note, 'forced', coalesce(p_force, false)));
    -- a leader added someone to an agent's list → tell the agent
    if v_agent is not null and v_agent <> v_me then
        insert into public.notification_outbox (user_id, kind, priority, title, body, url, activity_id, dedupe_key, due_at)
        values (v_agent, 'event_invite', 'normal',
                left('🎯 ' || coalesce((select full_name from public.users where id = v_me), 'Your leader') || ' added ' || coalesce(v_name, 'someone') || ' for ' || v_ev, 200),
                left(to_char(a.activity_date, 'Dy FMDD Mon') || coalesce(' · ' || v_note, '')
                     || case when v_reg then ' — already registered.' else ' — invite them and record the reply.' end, 220),
                './index.html', p_activity, 'event_invite_add:' || v_id, now())
        on conflict (user_id, dedupe_key) do nothing;
    end if;
    return jsonb_build_object('ok', true, 'id', v_id, 'registered', v_reg);
end $$;
revoke execute on function public.event_invite_add(bigint, bigint, bigint, text, boolean) from public, anon;
grant execute on function public.event_invite_add(bigint, bigint, bigint, text, boolean) to authenticated;

-- A profile's "🎯 Invite to an event": the next 60 days of sessions (with
-- their purpose and whether this person is already on the list / registered)
-- and this person's invites from the last 120 days.
create or replace function public.event_invite_person(p_prospect bigint default null, p_customer bigint default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_key text; v_today date := public.journey_today(); v_inv jsonb; v_sess jsonb;
begin
    if public.current_user_row_id() is null then raise exception 'Not permitted' using errcode = '42501'; end if;
    if p_customer is not null then
        if not (public.customer_is_visible(p_customer) or coalesce(public.current_user_level(), 99) <= 2) then
            raise exception 'Not permitted' using errcode = '42501'; end if;
        v_key := 'c:' || p_customer;
    elsif p_prospect is not null then
        if not public.prospect_is_visible(p_prospect) then raise exception 'Not permitted' using errcode = '42501'; end if;
        v_key := public.inv_person_key('prospect', p_prospect);
    else
        raise exception 'Pick a person';
    end if;
    select coalesce(jsonb_agg(jsonb_build_object(
               'id', i.id, 'activity_id', i.activity_id, 'date', s.activity_date,
               'title', coalesce(nullif(btrim(e.title), ''), s.activity_title), 'source', i.source,
               'state', i.state, 'reply', i.reply, 'decline_reason', i.decline_reason, 'attended', i.attended, 'no_show', i.no_show)
             order by s.activity_date desc), '[]'::jsonb)
      into v_inv
      from public.event_invites i
      join public.activities s on s.id = i.activity_id
      left join public.events e on e.id = s.event_id
     where i.person_key = v_key and s.activity_date >= v_today - 120 and i.state <> 'removed' and i.grp <> 'review';
    select coalesce(jsonb_agg(z order by z ->> 'date', z ->> 'time', z ->> 'activity_id'), '[]'::jsonb) into v_sess from (
        select jsonb_build_object(
                 'activity_id', s.id, 'date', s.activity_date, 'time', left(coalesce(s.start_time::text, ''), 5),
                 'title', coalesce(nullif(btrim(e.title), ''), s.activity_title, 'Event'),
                 'purpose', (select string_agg(coalesce(l.label, o ->> 'line') || ' · ' ||
                                case o ->> 'goal' when 'introduce' then 'Introduce' when 'decide' then 'Decide' when 'upgrade' then 'Upgrade'
                                                  when 'service' then 'Service' else 'Come back' end, ' + ')
                               from jsonb_array_elements(case when jsonb_typeof(e.invite_objectives) = 'array' then e.invite_objectives else '[]'::jsonb end) o
                               left join public.invite_lines l on l.key = o ->> 'line'),
                 'on_list', exists (select 1 from public.event_invites i where i.activity_id = s.id and i.person_key = v_key and i.state <> 'removed'),
                 'registered', exists (select 1 from public.event_attendees ea where ea.activity_id = s.id and ea.attendee_type in ('prospect', 'customer')
                                         and public.inv_person_key(ea.attendee_type, coalesce(ea.entity_id, ea.attendee_id)) = v_key)) z
          from public.activities s
          left join public.events e on e.id = s.event_id
         where s.activity_type = 'EVENT' and s.activity_date between v_today and v_today + 60
           and coalesce(s.visibility, 'open') in ('open', 'team', 'public')
           and coalesce(s.activity_title, '') !~ '代理会议' and coalesce(e.title, '') !~ '代理会议'
           and coalesce(lower(e.status), '') <> 'cancelled'
         order by s.activity_date, s.start_time
         limit 40) q;
    return jsonb_build_object('invites', v_inv, 'sessions', v_sess);
end $$;
revoke execute on function public.event_invite_person(bigint, bigint) from public, anon;
grant execute on function public.event_invite_person(bigint, bigint) to authenticated;

-- The list now says who added someone and why; per agent: suggested vs added.
create or replace function public.event_invite_list(p_activity bigint)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_me bigint := public.current_user_row_id(); v_lvl int := coalesce(public.current_user_level(), 99);
        a record; e record; v_rows jsonb; v_agents jsonb; v_sum jsonb; v_can_set boolean;
begin
    if v_me is null then raise exception 'Not permitted' using errcode = '42501'; end if;
    select s.id, s.event_id, s.activity_date, s.start_time, s.activity_title,
           coalesce(nullif(btrim(s.location_address), ''), nullif(btrim(s.venue), '')) venue
      into a from public.activities s where s.id = p_activity;
    if a.id is null then return null; end if;
    select id, title, invite_objectives, invite_slots, location, categories into e from public.events where id = a.event_id;
    v_can_set := v_lvl <= 12;
    select coalesce(jsonb_agg(jsonb_build_object(
               'id', i.id, 'person_key', i.person_key, 'prospect_id', i.prospect_id, 'customer_id', i.customer_id,
               'name', coalesce(cu.full_name, pr.full_name, '—'),
               'is_customer', i.customer_id is not null,
               'phone', coalesce(cu.phone, pr.phone, pr2.phone),
               'prefers_call', coalesce(cu.prefers_call, false) or coalesce(pr.prefers_call, false) or coalesce(pr2.prefers_call, false),
               'agent_id', i.agent_id, 'agent_name', u.full_name, 'mine', i.agent_id = v_me,
               'objective', i.objective, 'grp', i.grp, 'fit', i.fit, 'engagement', i.engagement, 'readiness', i.readiness,
               'slot_rank', i.slot_rank, 'reasons', i.reasons, 'warnings', i.warnings, 'review_reason', i.review_reason,
               'source', i.source, 'state', i.state, 'channel', i.channel, 'prepared_at', i.prepared_at, 'sent_at', i.sent_at,
               'reply', i.reply, 'decline_reason', i.decline_reason, 'reply_note', i.reply_note,
               'removed_reason', i.removed_reason, 'removed_note', i.removed_note,
               'attended', i.attended, 'no_show', i.no_show,
               'added_by', i.added_by, 'added_by_name', ub.full_name, 'add_note', i.add_note)
             order by (i.agent_id = v_me) desc, u.full_name, (i.grp = 'review'), i.state = 'removed',
                      (i.grp = 'strong') desc, i.slot_rank nulls last, i.fit desc nulls last, i.id), '[]'::jsonb)
      into v_rows
      from public.event_invites i
      left join public.customers cu on cu.id = i.customer_id
      left join public.prospects pr on pr.id = i.prospect_id
      left join public.prospects pr2 on pr2.id = cu.converted_from_prospect_id
      left join public.users u on u.id = i.agent_id
      left join public.users ub on ub.id = i.added_by
     where i.activity_id = p_activity
       and (v_lvl <= 2 or i.agent_id in (select public.current_user_visible_ids()) or i.added_by = v_me)
       -- an agent sees their own names; "needs a look" rows are for the upline
       and not (i.grp = 'review' and i.agent_id = v_me and v_lvl > 5);
    -- counts per agent: everyone may see these (no customer names)
    select coalesce(jsonb_agg(z order by z ->> 'agent_name'), '[]'::jsonb) into v_agents from (
        select jsonb_build_object('agent_id', i.agent_id, 'agent_name', coalesce(u.full_name, '—'),
                 'suggested', count(*) filter (where i.grp in ('strong', 'potential') and i.state <> 'removed'),
                 'added', count(*) filter (where i.grp = 'manual' and i.state <> 'removed'),
                 'sent', count(*) filter (where i.sent_at is not null),
                 'replied', count(*) filter (where i.reply in ('coming', 'declined')),
                 'coming', count(*) filter (where i.reply = 'coming'),
                 'declined', count(*) filter (where i.reply = 'declined'),
                 'came', count(*) filter (where i.attended),
                 'review', count(*) filter (where i.grp = 'review' and i.state <> 'removed')) z
          from public.event_invites i left join public.users u on u.id = i.agent_id
         where i.activity_id = p_activity group by i.agent_id, u.full_name) q;
    select case when v_lvl <= 5 then r.summary else r.summary - 'excluded' end || jsonb_build_object('run_at', r.run_at)
      into v_sum from public.event_invite_runs r where r.activity_id = p_activity;
    return jsonb_build_object(
        'event_id', e.id, 'event_title', coalesce(nullif(btrim(e.title), ''), a.activity_title), 'categories', e.categories,
        'start_time', a.start_time, 'venue', coalesce(a.venue, nullif(btrim(e.location), '')),
        'objectives', coalesce((select jsonb_agg(o || jsonb_build_object(
                          'line_label', (select l.label from public.invite_lines l where l.key = o ->> 'line'),
                          'focus_names', coalesce((select jsonb_agg(pr.name order by pr.name) from public.products pr
                                                    where pr.id in (select (jsonb_array_elements_text(coalesce(o -> 'focus', '[]'::jsonb)))::bigint)), '[]'::jsonb)))
                                  from jsonb_array_elements(case when jsonb_typeof(e.invite_objectives) = 'array' then e.invite_objectives else '[]'::jsonb end) o),
                               '[]'::jsonb),
        'slots', coalesce(e.invite_slots, (public.inv_cfg() ->> 'slots')::int, 9),
        'session_date', a.activity_date, 'past', a.activity_date < public.journey_today(),
        'me', v_me, 'level', v_lvl, 'can_set', v_can_set,
        'rows', v_rows, 'agents', v_agents, 'summary', coalesce(v_sum, '{}'::jsonb),
        'message', public.inv_cfg() ->> 'message');
end $$;

-- Event results: CRM picks vs agent picks (came / closed for each).
create or replace function public.event_invite_results(p_days int default 120)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_me bigint := public.current_user_row_id(); v_lvl int := coalesce(public.current_user_level(), 99); v_out jsonb;
begin
    if v_me is null then raise exception 'Not permitted' using errcode = '42501'; end if;
    with rows as (
        select i.*, a.activity_date, coalesce(nullif(btrim(e.title), ''), a.activity_title, '') title, e.invite_objectives,
               exists (select 1 from public.event_attendees ea where ea.id = i.attendee_id and ea.closing_activity_id is not null) closed
          from public.event_invites i
          join public.activities a on a.id = i.activity_id
          left join public.events e on e.id = a.event_id
         where a.activity_date >= public.journey_today() - least(greatest(coalesce(p_days, 120), 7), 730)
           and i.state <> 'removed' and i.grp <> 'review'
           and (v_lvl <= 2 or i.agent_id in (select public.current_user_visible_ids()))
    )
    select coalesce(jsonb_agg(z order by z ->> 'date' desc, z ->> 'activity_id'), '[]'::jsonb) into v_out from (
        select jsonb_build_object(
                 'activity_id', r.activity_id, 'date', r.activity_date, 'title', r.title,
                 'objectives', public.inv_obj_keys(r.invite_objectives),
                 'suggested', count(*) filter (where r.source = 'engine'), 'added', count(*) filter (where r.source = 'manual'),
                 'sent', count(*) filter (where r.sent_at is not null),
                 'replied', count(*) filter (where r.reply in ('coming', 'declined')),
                 'coming', count(*) filter (where r.reply = 'coming'), 'declined', count(*) filter (where r.reply = 'declined'),
                 'came', count(*) filter (where r.attended), 'no_show', count(*) filter (where r.no_show),
                 'closed', count(*) filter (where r.closed),
                 'came_crm', count(*) filter (where r.attended and r.source = 'engine'), 'came_added', count(*) filter (where r.attended and r.source = 'manual'),
                 'closed_crm', count(*) filter (where r.closed and r.source = 'engine'), 'closed_added', count(*) filter (where r.closed and r.source = 'manual'),
                 'reasons', coalesce((select jsonb_object_agg(q.k, q.n) from (select r2.decline_reason k, count(*) n from rows r2
                                       where r2.activity_id = r.activity_id and r2.reply = 'declined' group by r2.decline_reason) q), '{}'::jsonb),
                 'by_agent', (select jsonb_agg(jsonb_build_object('agent', coalesce(u.full_name, '—'), 'suggested', q.s, 'added', q.a, 'sent', q.t, 'coming', q.c, 'came', q.m) order by u.full_name)
                                from (select r3.agent_id, count(*) filter (where r3.source = 'engine') s, count(*) filter (where r3.source = 'manual') a,
                                             count(*) filter (where r3.sent_at is not null) t,
                                             count(*) filter (where r3.reply = 'coming') c, count(*) filter (where r3.attended) m
                                        from rows r3 where r3.activity_id = r.activity_id group by r3.agent_id) q
                                left join public.users u on u.id = q.agent_id)) z
          from rows r
         group by r.activity_id, r.activity_date, r.title, r.invite_objectives) x;
    return v_out;
end $$;
