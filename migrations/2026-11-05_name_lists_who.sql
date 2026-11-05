-- Name lists: "Who to include" by what people bought (2026-11-05, owner).
--
-- Ask: a second Power Ring is RM1,000 off — list the customers who bought only
-- ONE ring. Power Ring × Upgrade already held back owners of 2+, but the engine
-- keeps only fit ≥ 50 and a plain one-ring owner scores 35, so 2 of 62 showed;
-- it also counted sale ROWS ("SUPPORT POWER RING + WISDOM POWER RING" = 1).
--
-- A list now carries who:
--   best       the engine's best fits (as before)
--   owns_1     bought exactly 1 from the line   (the ring promotion)
--   owns_any   bought 1 or more from the line
--   owns_none  never bought from the line
-- plus an optional "bought between" window (a sale of the line in the window)
-- and an Offer line shown as the next step + in the WhatsApp opener.
--
-- An ownership list takes EVERY match (the engine runs with no 50 cut-off via
-- the inv.min_fit setting — ✨ Who to invite never sets it, so events are
-- unchanged), still minus Do not contact / unable to serve / grade F / cooling /
-- said-no pauses; "already owns 2" no longer holds anyone back there. Items per
-- sale = the parts of the item text split on + & , 、 that name the line (min 1).
--
-- name_list_preview(p) counts the matches before a list is made (same pool).
-- Functions keep timezone Asia/Kuala_Lumpur (2026-11-04 fix).
-- Rollback: migrations/2026-11-05_name_lists_who_undo.sql.

-- ── 1. The list remembers who it is for ─────────────────────────────────────
alter table public.name_lists
    add column if not exists who text not null default 'best',
    add column if not exists bought_from date,
    add column if not exists bought_to date,
    add column if not exists offer text;
do $$
begin
    if not exists (select 1 from pg_constraint where conname = 'name_lists_who_chk') then
        alter table public.name_lists add constraint name_lists_who_chk check (who in ('best', 'owns_1', 'owns_any', 'owns_none'));
    end if;
    if not exists (select 1 from pg_constraint where conname = 'name_lists_offer_len') then
        alter table public.name_lists add constraint name_lists_offer_len check (offer is null or char_length(offer) <= 120);
    end if;
end $$;

-- ── 2. Engine: an optional lower cut-off (inv.min_fit) ──────────────────────
-- Two lines of inv_compute change; with the setting unset they behave exactly
-- as before (a person whose only objective is blocked already had fit 0 < 50).
do $$
declare d text := pg_get_functiondef('public.inv_compute(jsonb,bigint,text)'::regprocedure);
begin
    if position('inv.min_fit' in d) > 0 then return; end if;
    if position('v_pot := coalesce((c ->> ''potential'')::int, 50);' in d) = 0
       or position('when cd.fit < v_pot then coalesce(cd.blocked, ''paused'')' in d) = 0 then
        raise exception 'inv_compute changed — patch by hand';
    end if;
    d := replace(d, 'v_pot := coalesce((c ->> ''potential'')::int, 50);',
                    'v_pot := coalesce(nullif(current_setting(''inv.min_fit'', true), '''')::int, (c ->> ''potential'')::int, 50);');
    d := replace(d, 'when cd.fit < v_pot then coalesce(cd.blocked, ''paused'')',
                    'when cd.fit < v_pot or (cd.okey is null and cd.blocked is not null) then coalesce(cd.blocked, ''paused'')');
    execute d;
end $$;
revoke execute on function public.inv_compute(jsonb, bigint, text) from public, anon, authenticated;

-- ── 3. What each person bought from a line (cancelled / refunded sales out) ──
create or replace function public.nl_line_sales(p_line text)
returns table (person_key text, d date, item text, items int)
language sql stable security definer set search_path = public set timezone to 'Asia/Kuala_Lumpur' as $$
    with kw as (select public.inv_line_kw(p_line) k)
    select coalesce('c:' || pu.customer_id,
                    'c:' || (select min(cu.id) from public.customers cu where cu.converted_from_prospect_id = pu.prospect_id),
                    'p:' || pu.prospect_id),
           coalesce(pu.date, pu.created_at::date), coalesce(pu.item, ''),
           greatest(1, (select count(*) from regexp_split_to_table(lower(coalesce(pu.item, '')), '\s*(\+|&|、|，|,)\s*') part
                         where public.inv_hit(part, kw.k) is not null))::int
      from public.purchases pu, kw
     where (pu.customer_id is not null or pu.prospect_id is not null)
       and coalesce(pu.status, '') !~* 'cancel|refund|void'
       and not exists (select 1 from public.sale_cancellations sc where sc.purchase_id = pu.id
                         and sc.status in ('refunding', 'completed'))
       and case p_line
             when 'general' then false
             when 'bujishu' then pu.bujishu_catalog_id is not null or public.inv_hit(lower(coalesce(pu.item, '')), kw.k) is not null
             when 'business' then coalesce(pu.is_agent_package, false) or public.inv_hit(lower(coalesce(pu.item, '')), kw.k) is not null
             else public.inv_hit(lower(coalesce(pu.item, '')), kw.k) is not null
           end
$$;

-- ── 4. The pool: who matches a list's rule (fills _nl_scope + _nl_c) ─────────
-- Shared by nl_generate and name_list_preview so the count shown before
-- "Find the people" is the list that gets made.
create or replace function public.nl_pool(p_owner bigint, p_scope text, p_line text, p_goal text, p_focus jsonb,
                                          p_who text, p_from date, p_to date)
returns void language plpgsql security definer set search_path = public set timezone to 'Asia/Kuala_Lumpur' as $$
begin
    drop table if exists _nl_scope, _nl_c, _nl_own;
    create temp table _nl_scope on commit drop as
    select distinct t id from public.nl_team_ids(p_owner) t where p_scope = 'team'
    union select p_owner where p_scope = 'mine';

    -- engine (people outside the list's scope are not looked at); an ownership
    -- list wants every match, not only the ≥ 50 fits
    perform set_config('inv.min_fit', case when p_who <> 'best' then '0' else '' end, true);
    create temp table _nl_c on commit drop as
    select x.*, (x.excl is not null and x.excl <> 'limit' and not (p_who <> 'best' and x.excl = 'complete')) held,
           null::int own_items, null::date own_d, null::text own_what
      from public.inv_compute(jsonb_build_array(jsonb_build_object('line', p_line, 'goal', p_goal,
                                                                   'focus', coalesce(p_focus, '[]'::jsonb))), null, null) x
     where x.agent_id in (select id from _nl_scope);
    perform set_config('inv.min_fit', '', true);

    if p_who <> 'best' then
        create temp table _nl_own on commit drop as
        select s.person_key, sum(s.items)::int items, max(s.d) last_d,
               (array_agg(s.item order by s.d desc))[1] what,
               bool_or(s.d between coalesce(p_from, '-infinity'::date) and coalesce(p_to, 'infinity'::date)) in_range
          from public.nl_line_sales(p_line) s group by s.person_key;
        update _nl_c x set own_items = o.items, own_d = o.last_d, own_what = o.what
          from _nl_own o where o.person_key = x.person_key;
        delete from _nl_c x
         where not coalesce(case p_who
                   when 'owns_none' then x.own_items is null
                   when 'owns_1' then x.own_items = 1 and (select o.in_range from _nl_own o where o.person_key = x.person_key)
                   when 'owns_any' then x.own_items >= 1 and (select o.in_range from _nl_own o where o.person_key = x.person_key)
               end, false);
    end if;
end $$;

-- ── 5. Generate a version (pool from nl_pool; owned item first in the reasons) ─
create or replace function public.nl_generate(p_list bigint, p_by bigint)
returns int language plpgsql security definer set search_path = public set timezone to 'Asia/Kuala_Lumpur' as $$
declare
    l public.name_lists; c jsonb := public.inv_cfg(); n jsonb := public.nl_cfg();
    v_mult numeric; v_offer int; v_line_label text; v_objs jsonb; v_no int; v_prev bigint; v_ver bigint;
    v_held jsonb; v_cand int; v_offered int; v_picked int;
begin
    select * into l from public.name_lists where id = p_list for update;
    if l.id is null then raise exception 'List not found'; end if;
    v_mult := greatest(coalesce((n ->> 'offer_multiplier')::numeric, 2.5), 1);
    v_offer := ceil(l.target_qty * v_mult)::int;
    select coalesce(label, key) into v_line_label from public.invite_lines where key = l.line;
    v_objs := jsonb_build_array(jsonb_build_object('line', l.line, 'goal', l.goal, 'focus', coalesce(l.focus, '[]'::jsonb)));
    select coalesce(max(version_no), 0) + 1 into v_no from public.name_list_versions where list_id = p_list;
    v_prev := public.nl_latest_version(p_list);

    perform public.nl_pool(l.owner_id, l.scope, l.line, l.goal, l.focus, l.who, l.bought_from, l.bought_to);

    drop table if exists _nl_prev;
    create temp table _nl_prev on commit drop as
    select r.* from public.name_list_rows r
     where v_prev is not null and r.version_id = v_prev
       and (r.decision in ('selected', 'removed') or r.source = 'manual')
       and public.nl_person_blocked(r.person_key) is null
       and not exists (select 1 from _nl_c x where x.person_key = r.person_key and x.held);

    insert into public.name_list_versions (list_id, version_no, rules, engine_version, generated_by)
    values (p_list, v_no, jsonb_build_object(
                'engine', 'inv_compute', 'objectives', v_objs, 'invite_rules', c, 'name_list_rules', n,
                'scope', l.scope, 'scope_agents', (select coalesce(jsonb_agg(id order by id), '[]'::jsonb) from _nl_scope),
                'who', l.who, 'bought_from', l.bought_from, 'bought_to', l.bought_to, 'offer', l.offer,
                'own_count', case when l.who <> 'best'
                                  then 'items per sale = parts split on + & , 、 naming the line (min 1); cancelled / refunded sales out; no fit cut-off' end,
                'target_qty', l.target_qty, 'offered', v_offer,
                'order', 'Strong first, then Fit, Engaged, person key (same as Smart lists)'),
            'nl-1.1', p_by)
    returning id into v_ver;

    perform set_config('nl.engine', 'on', true);
    -- the engine's ranked people (top target × multiplier per partition) + anyone carried over
    insert into public.name_list_rows (version_id, list_id, person_key, prospect_id, customer_id, name_snapshot, agent_id,
           agent_name_snapshot, fit, engagement, readiness, grp, rank, reasons, warnings, last_touch, source,
           added_by, add_note, decision, decision_reason, decision_note, decided_by, decided_at)
    select v_ver, p_list, q.person_key, q.prospect_id, q.customer_id, coalesce(nullif(btrim(q.name), ''), '—'), q.agent_id, u.full_name,
           q.fit, q.engagement, q.readiness, q.grp, q.rk,
           case when q.own_items is not null
                then jsonb_build_array(jsonb_build_object('p', 50, 'ref', 'person', 'd', q.own_d,
                         't', 'Bought ' || left(q.own_what, 40) || case when q.own_items > 1 then ' (' || q.own_items || ' in all)' else '' end))
                     || coalesce((select jsonb_agg(e) from jsonb_array_elements(q.reasons) e where e ->> 't' not like 'Owns %'), '[]'::jsonb)
                else coalesce(q.reasons, '[]'::jsonb) end,
           coalesce(q.warnings, '[]'::jsonb)
             || case when q.excl = 'limit' then '["invited_often"]'::jsonb else '[]'::jsonb end
             || case when q.review is not null then jsonb_build_array('check_first:' || q.review) else '[]'::jsonb end,
           q.last_touch, case when p.source = 'manual' then 'manual' else 'engine' end,
           p.added_by, p.add_note, coalesce(p.decision, 'pending'), p.decision_reason, p.decision_note, p.decided_by, p.decided_at
      from (select x.*, row_number() over (partition by case when l.scope = 'team' then x.agent_id end
                                           order by (x.grp = 'strong') desc, x.fit desc, x.engagement desc, x.person_key)::int rk
              from _nl_c x where not x.held) q
      left join _nl_prev p on p.person_key = q.person_key
      left join public.users u on u.id = q.agent_id
     where q.rk <= v_offer or p.person_key is not null;

    -- carried over but the engine no longer matches them (kept, marked)
    insert into public.name_list_rows (version_id, list_id, person_key, prospect_id, customer_id, name_snapshot, agent_id,
           agent_name_snapshot, reasons, warnings, last_touch, source, added_by, add_note,
           decision, decision_reason, decision_note, decided_by, decided_at)
    select v_ver, p_list, p.person_key, p.prospect_id, p.customer_id, p.name_snapshot, p.agent_id, p.agent_name_snapshot,
           p.reasons, '["not_matched_now"]'::jsonb, p.last_touch, case when p.source = 'manual' then 'manual' else 'carried' end,
           p.added_by, p.add_note, p.decision, p.decision_reason, p.decision_note, p.decided_by, p.decided_at
      from _nl_prev p
     where not exists (select 1 from public.name_list_rows r where r.version_id = v_ver and r.person_key = p.person_key);

    -- the engine ticks the best ones up to the target (per agent for a team list);
    -- "check first" people are offered, never ticked by the engine
    with sel as (
        select case when l.scope = 'team' then r.agent_id end part, count(*) n from public.name_list_rows r
         where r.version_id = v_ver and r.decision = 'selected' group by 1
    ), cand as (
        select r.id, case when l.scope = 'team' then r.agent_id end part,
               row_number() over (partition by case when l.scope = 'team' then r.agent_id end order by r.rank) k
          from public.name_list_rows r
         where r.version_id = v_ver and r.decision = 'pending' and r.source = 'engine'
           and not exists (select 1 from jsonb_array_elements_text(r.warnings) w where w like 'check_first:%')
    )
    update public.name_list_rows r set engine_picked = true, decision = 'selected'
      from cand c left join sel s on s.part is not distinct from c.part
     where r.id = c.id and c.k <= l.target_qty - coalesce(s.n, 0);

    -- next step per person (frozen with the version)
    update public.name_list_rows r
       set next_step = ns ->> 't', next_step_why = ns ->> 'why', next_step_rule = ns ->> 'rule'
      from (select r2.id, public.nl_next_step(r2.prospect_id,
                       coalesce(r2.customer_id, (select min(cu.id) from public.customers cu
                                                  where r2.prospect_id is not null and cu.converted_from_prospect_id = r2.prospect_id)),
                       v_line_label, n) ns
              from public.name_list_rows r2 where r2.version_id = v_ver) z
     where r.id = z.id;
    perform set_config('nl.engine', 'off', true);

    select count(*) into v_cand from _nl_c;
    select coalesce(jsonb_object_agg(excl, k), '{}'::jsonb) into v_held
      from (select excl, count(*) k from _nl_c where held group by excl) h;
    select count(*), count(*) filter (where decision = 'selected') into v_offered, v_picked
      from public.name_list_rows where version_id = v_ver;
    update public.name_list_versions set candidates = v_cand, offered = v_offered, picked = v_picked, held = v_held
     where id = v_ver;
    update public.name_lists set updated_at = now() where id = p_list;
    return v_no;
end $$;
revoke execute on function public.nl_line_sales(text) from public, anon, authenticated;
revoke execute on function public.nl_pool(bigint, text, text, text, jsonb, text, date, date) from public, anon, authenticated;
revoke execute on function public.nl_generate(bigint, bigint) from public, anon, authenticated;

-- ── 6. New list / preview: shared input checks ──────────────────────────────
-- p = {purpose, line, goal, focus:[ids], scope, who, bought_from, bought_to}
-- → {line, goal, scope, who, focus, from, to, label}
create or replace function public.nl_parse(p jsonb)
returns jsonb language plpgsql stable security definer set search_path = public set timezone to 'Asia/Kuala_Lumpur' as $$
declare
    v_purpose text := coalesce(nullif(p ->> 'purpose', ''), 'promote'); v_line text := p ->> 'line'; v_goal text := p ->> 'goal';
    v_scope text := coalesce(nullif(p ->> 'scope', ''), 'mine'); v_who text := coalesce(nullif(p ->> 'who', ''), 'best');
    v_label text; v_focus jsonb; v_from date; v_to date;
begin
    if v_purpose not in ('promote', 'service', 'follow_up', 'other') then raise exception 'Pick what the list is for'; end if;
    select label into v_label from public.invite_lines where key = v_line and active;
    if v_label is null then raise exception 'Pick a product line'; end if;
    if v_goal not in ('introduce', 'decide', 'upgrade', 'service', 'comeback') then raise exception 'Pick a goal'; end if;
    if v_scope not in ('mine', 'team') then raise exception 'Pick whose people'; end if;
    if v_scope = 'team' and not public.nl_has_team() then raise exception 'Only team leaders can make a team list'; end if;
    if v_who not in ('best', 'owns_1', 'owns_any', 'owns_none') then raise exception 'Pick who to include'; end if;
    if v_who <> 'best' and v_line = 'general' then raise exception 'Pick a product line to count what they bought'; end if;
    begin
        v_from := nullif(p ->> 'bought_from', '')::date;
        v_to := nullif(p ->> 'bought_to', '')::date;
    exception when others then raise exception 'Bought between: not a date'; end;
    if v_who not in ('owns_1', 'owns_any') then v_from := null; v_to := null; end if;
    if v_from > v_to then raise exception 'Bought between: the first date is after the second'; end if;
    select coalesce(jsonb_agg(pr.id order by pr.id), '[]'::jsonb) into v_focus
      from (select pr.id from public.products pr
             where pr.id in (select (f #>> '{}')::bigint from jsonb_array_elements(
                                case when jsonb_typeof(p -> 'focus') = 'array' then p -> 'focus' else '[]'::jsonb end) f
                              where (f #>> '{}') ~ '^[0-9]+$')
             order by pr.id limit 2) pr;
    return jsonb_build_object('purpose', v_purpose, 'line', v_line, 'goal', v_goal, 'scope', v_scope, 'who', v_who,
                              'focus', v_focus, 'from', v_from, 'to', v_to, 'label', v_label);
end $$;
revoke execute on function public.nl_parse(jsonb) from public, anon, authenticated;

-- How many people a list would hold, before it is made.
-- → {match, held, agents, per_agent_max}
create or replace function public.name_list_preview(p jsonb)
returns jsonb language plpgsql security definer set search_path = public set timezone to 'Asia/Kuala_Lumpur' as $$
declare v_me bigint := public.current_user_row_id(); v_lvl int := coalesce(public.current_user_level(), 99); x jsonb; v_out jsonb;
begin
    if v_me is null or v_lvl > 11 then raise exception 'Not permitted' using errcode = '42501'; end if;
    x := public.nl_parse(p);
    perform public.nl_pool(v_me, x ->> 'scope', x ->> 'line', x ->> 'goal', x -> 'focus', x ->> 'who',
                           (x ->> 'from')::date, (x ->> 'to')::date);
    select jsonb_build_object('match', count(*) filter (where not held), 'held', count(*) filter (where held),
                              'agents', count(distinct agent_id) filter (where not held),
                              'per_agent_max', coalesce((select max(k) from (select count(*) k from _nl_c where not held group by agent_id) z), 0))
      into v_out from _nl_c;
    return v_out;
end $$;
revoke execute on function public.name_list_preview(jsonb) from public, anon;
grant execute on function public.name_list_preview(jsonb) to authenticated;

-- New list: p = {name, purpose, line, goal, focus, target_qty, target_date, scope, who, bought_from, bought_to, offer, remarks}
create or replace function public.name_list_create(p jsonb)
returns jsonb language plpgsql security definer set search_path = public set timezone to 'Asia/Kuala_Lumpur' as $$
declare
    v_me bigint := public.current_user_row_id(); v_lvl int := coalesce(public.current_user_level(), 99);
    x jsonb; v_qty int; v_date date; v_name text; v_id bigint; v_no int; v_max int;
begin
    if v_me is null or v_lvl > 11 then raise exception 'Not permitted' using errcode = '42501'; end if;
    x := public.nl_parse(p);
    begin v_qty := (p ->> 'target_qty')::int; exception when others then v_qty := null; end;
    v_max := (case when x ->> 'scope' = 'team' then 50 else 200 end);
    if v_qty is null or v_qty < 1 or v_qty > v_max then
        raise exception 'How many people? 1–%', v_max;
    end if;
    begin v_date := nullif(p ->> 'target_date', '')::date; exception when others then raise exception 'Target date is not a date'; end;
    v_name := left(coalesce(nullif(btrim(p ->> 'name'), ''),
                   (x ->> 'label') || ' · ' || case x ->> 'who' when 'owns_1' then 'Bought exactly 1' when 'owns_any' then 'Bought before'
                                                             when 'owns_none' then 'Never bought' else
                       case x ->> 'goal' when 'introduce' then 'Introduce' when 'decide' then 'Decide' when 'upgrade' then 'Upgrade'
                                         when 'service' then 'Service' else 'Come back' end end), 120);
    insert into public.name_lists (name, purpose, line, goal, focus, scope, target_qty, target_date, remarks, owner_id,
                                   who, bought_from, bought_to, offer)
    values (v_name, x ->> 'purpose', x ->> 'line', x ->> 'goal', x -> 'focus', x ->> 'scope', v_qty, v_date,
            nullif(btrim(p ->> 'remarks'), ''), v_me,
            x ->> 'who', (x ->> 'from')::date, (x ->> 'to')::date, left(nullif(btrim(p ->> 'offer'), ''), 120))
    returning id into v_id;
    v_no := public.nl_generate(v_id, v_me);
    insert into public.audit_trail (actor_auth_id, actor_user_id, actor_role_level, category, action, target_table, target_id, detail)
    values (auth.uid(), v_me, v_lvl, 'name_list', 'create', 'name_lists', v_id::text,
            jsonb_build_object('line', x ->> 'line', 'goal', x ->> 'goal', 'scope', x ->> 'scope', 'target', v_qty, 'who', x ->> 'who'));
    return jsonb_build_object('ok', true, 'id', v_id, 'version', v_no);
end $$;

-- Rename / dates / remarks / target / offer / status. Starting a team list tells each agent.
create or replace function public.name_list_set(p_list bigint, p jsonb)
returns jsonb language plpgsql security definer set search_path = public set timezone to 'Asia/Kuala_Lumpur' as $$
declare
    v_me bigint := public.current_user_row_id(); l public.name_lists; v_status text; v_date date; v_qty int;
begin
    if v_me is null or not public.nl_can_manage(p_list) then raise exception 'Not permitted' using errcode = '42501'; end if;
    select * into l from public.name_lists where id = p_list for update;
    v_status := coalesce(nullif(p ->> 'status', ''), l.status);
    if v_status not in ('draft', 'active', 'completed', 'archived') then raise exception 'Unknown status'; end if;
    if v_status = 'draft' and l.status <> 'draft' then raise exception 'A started list cannot go back to draft'; end if;
    if p ? 'target_date' then
        begin v_date := nullif(p ->> 'target_date', '')::date; exception when others then raise exception 'Target date is not a date'; end;
    else v_date := l.target_date; end if;
    if p ? 'target_qty' then
        begin v_qty := (p ->> 'target_qty')::int; exception when others then v_qty := null; end;
        if v_qty is null or v_qty < 1 or v_qty > (case when l.scope = 'team' then 50 else 200 end) then raise exception 'How many people?'; end if;
    else v_qty := l.target_qty; end if;
    update public.name_lists
       set name = coalesce(left(nullif(btrim(p ->> 'name'), ''), 120), name),
           remarks = case when p ? 'remarks' then nullif(btrim(p ->> 'remarks'), '') else remarks end,
           offer = case when p ? 'offer' then left(nullif(btrim(p ->> 'offer'), ''), 120) else offer end,
           target_date = v_date, target_qty = v_qty, status = v_status,
           started_at = case when v_status = 'active' and started_at is null then now() else started_at end,
           updated_at = now()
     where id = p_list;
    if v_status = 'active' and l.started_at is null and l.scope = 'team' then
        insert into public.notification_outbox (user_id, kind, priority, title, body, url, dedupe_key, due_at)
        select r.agent_id, 'name_list', 'normal',
               '📋 ' || count(*) || case when count(*) = 1 then ' person' else ' people' end || ' to contact · ' || l.name,
               coalesce(nullif(l.offer, '') || ' — open', 'Open') || ' Name List to see why each one fits and the next step.',
               './index.html#name_list', 'name_list:' || p_list, now()
          from public.name_list_rows r
         where r.version_id = public.nl_latest_version(p_list) and r.decision = 'selected'
           and r.agent_id is not null and r.agent_id <> v_me
         group by r.agent_id
        on conflict (user_id, dedupe_key) do nothing;
    end if;
    insert into public.audit_trail (actor_auth_id, actor_user_id, actor_role_level, category, action, target_table, target_id, detail)
    values (auth.uid(), v_me, public.current_user_level(), 'name_list', 'set', 'name_lists', p_list::text, coalesce(p, '{}'::jsonb));
    return jsonb_build_object('ok', true);
end $$;

-- Lists I can see, active first then newest, each with its funnel (viewer-scoped).
-- {lists: [...], can_team: bool}
create or replace function public.name_list_index()
returns jsonb language plpgsql security definer set search_path = public set timezone to 'Asia/Kuala_Lumpur' as $$
declare v_me bigint := public.current_user_row_id(); v_out jsonb;
begin
    if v_me is null then raise exception 'Not permitted' using errcode = '42501'; end if;
    perform public.nl_claim_sales();
    select coalesce(jsonb_agg(z.j order by z.ord, z.created_at desc, z.id desc), '[]'::jsonb) into v_out from (
        select l.id, l.created_at,
               case l.status when 'active' then 0 when 'draft' then 1 when 'completed' then 2 else 3 end ord,
               jsonb_build_object(
                   'id', l.id, 'name', l.name, 'purpose', l.purpose, 'line', l.line, 'line_label', il.label, 'goal', l.goal,
                   'scope', l.scope, 'status', l.status, 'target_qty', l.target_qty, 'target_date', l.target_date,
                   'who', l.who, 'offer', l.offer,
                   'owner_id', l.owner_id, 'owner_name', u.full_name, 'created_at', l.created_at, 'started_at', l.started_at,
                   'mine', l.owner_id = v_me, 'can_manage', public.nl_can_manage(l.id),
                   'version', v.version_no, 'generated_at', v.generated_at,
                   'counts', public.nl_counts(l.id, v.id, public.nl_can_manage(l.id))) j
          from public.name_lists l
          join public.name_list_versions v on v.id = public.nl_latest_version(l.id)
          left join public.invite_lines il on il.key = l.line
          left join public.users u on u.id = l.owner_id
         where public.nl_can_see(l.id)) z;
    return jsonb_build_object('lists', v_out, 'can_team', public.nl_has_team());
end $$;

-- One list: header, versions, rows (viewer-scoped) with live progress.
create or replace function public.name_list_get(p_list bigint, p_version int default null)
returns jsonb language plpgsql security definer set search_path = public set timezone to 'Asia/Kuala_Lumpur' as $$
declare
    v_me bigint := public.current_user_row_id(); l public.name_lists; v public.name_list_versions;
    v_latest int; v_all boolean; v_rows jsonb; v_vers jsonb; v_cfg jsonb := public.nl_cfg();
begin
    if v_me is null then raise exception 'Not permitted' using errcode = '42501'; end if;
    select * into l from public.name_lists where id = p_list;
    if l.id is null or not public.nl_can_see(p_list) then raise exception 'Not permitted' using errcode = '42501'; end if;
    perform public.nl_claim_sales();
    select max(version_no) into v_latest from public.name_list_versions where list_id = p_list;
    select * into v from public.name_list_versions where list_id = p_list and version_no = coalesce(p_version, v_latest);
    if v.id is null then raise exception 'No such version'; end if;
    v_all := public.nl_can_manage(p_list);

    select coalesce(jsonb_agg(jsonb_build_object(
               'id', r.id, 'person_key', r.person_key, 'prospect_id', r.prospect_id, 'customer_id', r.customer_id,
               'name', r.name_snapshot, 'agent_id', r.agent_id, 'agent_name', r.agent_name_snapshot,
               'fit', r.fit, 'engagement', r.engagement, 'readiness', r.readiness, 'grp', r.grp, 'rank', r.rank,
               'reasons', r.reasons, 'warnings', r.warnings, 'last_touch', r.last_touch, 'engine_picked', r.engine_picked,
               'next_step', r.next_step, 'next_step_why', r.next_step_why, 'next_step_rule', r.next_step_rule, 'source', r.source,
               'added_by_name', ab.full_name, 'add_note', r.add_note,
               'decision', r.decision, 'decision_reason', r.decision_reason, 'decision_note', r.decision_note,
               'decided_by_name', db.full_name, 'decided_at', r.decided_at,
               'contact_at', x.contact_at, 'contact_via', x.contact_via, 'contact_auto', x.contact_auto,
               'reply', x.reply, 'reply_at', x.reply_at, 'reply_note', x.reply_note, 'met_at', x.met_at, 'met_via', x.met_via,
               'sale_amount', x.sale_amount, 'sale_date', x.sale_date, 'sale_item', x.sale_item,
               'freq', x.freq, 'dni', x.dni, 'phone', x.phone, 'prefers_call', x.prefers_call)
             order by case r.decision when 'selected' then 0 when 'pending' then 1 else 2 end,
                      r.agent_name_snapshot nulls last, r.rank nulls last, r.id), '[]'::jsonb)
      into v_rows
      from public.name_list_rows r
      join public.nl_live(p_list, v.id) x on x.row_id = r.id
      left join public.users ab on ab.id = r.added_by
      left join public.users db on db.id = r.decided_by
     where r.version_id = v.id and (v_all or r.agent_id in (select public.current_user_visible_ids()));

    select coalesce(jsonb_agg(jsonb_build_object('no', vv.version_no, 'generated_at', vv.generated_at, 'by', gu.full_name,
                                                 'picked', vv.picked, 'offered', vv.offered, 'held', vv.held, 'candidates', vv.candidates)
                              order by vv.version_no desc), '[]'::jsonb)
      into v_vers
      from public.name_list_versions vv left join public.users gu on gu.id = vv.generated_by
     where vv.list_id = p_list;

    return jsonb_build_object(
        'list', jsonb_build_object(
            'id', l.id, 'name', l.name, 'purpose', l.purpose, 'line', l.line,
            'line_label', (select label from public.invite_lines where key = l.line), 'goal', l.goal, 'focus', l.focus,
            'focus_names', (select coalesce(jsonb_agg(pr.name order by pr.id), '[]'::jsonb) from public.products pr
                             where pr.id in (select (f #>> '{}')::bigint from jsonb_array_elements(l.focus) f)),
            'scope', l.scope, 'status', l.status, 'target_qty', l.target_qty, 'target_date', l.target_date, 'remarks', l.remarks,
            'who', l.who, 'bought_from', l.bought_from, 'bought_to', l.bought_to, 'offer', l.offer,
            'owner_id', l.owner_id, 'owner_name', (select full_name from public.users where id = l.owner_id),
            'created_at', l.created_at, 'started_at', l.started_at, 'mine', l.owner_id = v_me, 'can_manage', v_all),
        'version', jsonb_build_object('no', v.version_no, 'latest', v.version_no = v_latest, 'generated_at', v.generated_at,
                                      'held', v.held, 'candidates', v.candidates, 'offered', v.offered, 'picked', v.picked),
        'versions', v_vers,
        'counts', public.nl_counts(p_list, v.id, v_all),
        'freq_limit', coalesce((v_cfg ->> 'freq_limit')::int, 2), 'freq_days', coalesce((v_cfg ->> 'freq_days')::int, 30),
        'rows', v_rows);
end $$;
