-- Event Invite Engine — "✨ Who to invite" (2026-10-28, owner).
-- Plan: EVENT_INVITE_ENGINE_PLAN.md (v2) in the main CRM folder.
--
-- An event topic says what it is FOR: 1–2 objectives, each a product line
-- (风水 / Power Ring / 书法 …, mapped to catalogue groups) plus a goal
-- (introduce / decide / upgrade / service / comeback), optionally focus
-- products (换天心). For every session of that topic the engine reads the
-- recorded evidence (meetings, ticks, quotes, events attended, purchases,
-- audits, prescriptions, deals, waiting list) and gives EACH AGENT their best
-- N people (owner: 9) with Fit / Engagement / Ready scores and the top
-- reasons. Agents invite, record the reply; a decline needs a reason and the
-- reason decides when that person can be suggested again for an event with
-- the same line + goal. Attendance stays in event_attendees.
--
-- Visibility: an agent sees their own names; their upline (reporting tree)
-- sees the team; L1–2 see all; anyone else sees counts per agent only.
-- Everything is written through SECURITY DEFINER functions; the new tables
-- have no client write grants.
--
-- Rollback: migrations/2026-10-28_event_invite_engine_undo.sql

-- ── 0. Fix: 🎟️ Invite on the waiting list wrote event_attendees.added_by_name,
--      a column that does not exist, so every tap failed. Same body without it.
create or replace function public.class_wait_invite(p_entry bigint, p_activity bigint)
returns boolean language plpgsql security definer set search_path = public as $$
declare e public.class_waitlist%rowtype; a record; v_me bigint := public.current_user_row_id(); v_kind text; v_pid bigint; v_name text;
begin
    select * into e from public.class_waitlist where id = p_entry and status = 'waiting';
    if e.id is null then return false; end if;
    if not (coalesce(public.current_user_level(), 99) <= 2 or e.recommended_by = v_me
            or public.prospect_is_visible(e.prospect_id) or public.customer_is_visible(e.customer_id)) then
        raise exception 'Not permitted' using errcode = '42501';
    end if;
    select id, event_id into a from public.activities where id = p_activity and activity_type = 'EVENT';
    if a.id is null then return false; end if;
    v_kind := case when e.prospect_id is not null then 'prospect' else 'customer' end;
    v_pid := coalesce(e.prospect_id, e.customer_id);
    select coalesce((select full_name from public.prospects where id = e.prospect_id), (select full_name from public.customers where id = e.customer_id)) into v_name;
    if not exists (select 1 from public.event_attendees where activity_id = a.id and attendee_type = v_kind and entity_id = v_pid) then
        insert into public.event_attendees (id, event_id, activity_id, attendee_id, entity_id, entity_name, attendee_type,
                                            attendance_status, added_by_agent_id, created_at)
        values ((extract(epoch from clock_timestamp()) * 1000000)::bigint, a.event_id, a.id, v_pid, v_pid, coalesce(v_name, ''), v_kind,
                'Registered', v_me, now());
    end if;
    return true;
end $$;

-- ── 1. Rules: product lines + numbers (everyone reads, L1–2 edit) ───────────
create table if not exists public.invite_lines (
    key            text primary key,
    label          text not null,
    sort           int not null default 0,
    subcategories  text[] not null default '{}',   -- products.subcategory values in this line
    keywords       text[] not null default '{}',   -- extra words for ticks / notes / sale items (lowercase)
    event_keywords text[] not null default '{}',   -- event title / category words; empty = every event
    feeder_lines   text[] not null default '{}',   -- owners of these lines are natural "introduce" guests
    complete_count int,                            -- owning this many items = journey done (ring 2, 财库 1)
    fsa_is_rung    boolean not null default false, -- an audit (FSA) counts as the first rung (风水)
    active         boolean not null default true,
    updated_at     timestamptz not null default now()
);
create table if not exists public.invite_config (
    key        text primary key,
    value      jsonb not null,
    updated_at timestamptz not null default now()
);
alter table public.invite_lines enable row level security;
alter table public.invite_config enable row level security;
drop policy if exists invite_lines_sel on public.invite_lines;
create policy invite_lines_sel on public.invite_lines for select to authenticated using (true);
drop policy if exists invite_lines_mgr on public.invite_lines;
create policy invite_lines_mgr on public.invite_lines for all to authenticated
    using (coalesce(public.current_user_level(), 99) <= 2) with check (coalesce(public.current_user_level(), 99) <= 2);
drop policy if exists invite_config_sel on public.invite_config;
create policy invite_config_sel on public.invite_config for select to authenticated using (true);
drop policy if exists invite_config_mgr on public.invite_config;
create policy invite_config_mgr on public.invite_config for all to authenticated
    using (coalesce(public.current_user_level(), 99) <= 2) with check (coalesce(public.current_user_level(), 99) <= 2);
grant select, insert, update, delete on public.invite_lines, public.invite_config to authenticated;

insert into public.invite_lines (key, label, sort, subcategories, keywords, event_keywords, feeder_lines, complete_count, fsa_is_rung) values
 ('fengshui', '风水 Fengshui', 10,
   array['Fengshui Audit · 灵活 Flexi', 'Fengshui Audit · 专案 Direct On', 'Fengshui Audit · 简易 Simplified', 'Fengshui Audit · 商业 Commercial', 'Huan Tian Xin'],
   array['风水', 'fengshui', 'feng shui', '灵活', '简易', '专案', 'flexi', 'simplified', 'direct on', 'directon', '活d1', '天心', 'commercial audit', '勘察', '阳宅'],
   array['汇集', '汇聚', '匯集', '考察', '风水', '風水', '天心', '专案', '灵活', '简易', '博物馆', '运程'],
   array['ring'], null, true),
 ('ring', '改命指环 Power Ring', 20, array['Power Ring'],
   array['power ring', '指环', '班指', '改命戒指', '戒指', 'pr1', 'pr2', 'pr3', 'pr4', 'pr5', 'pr6', 'pr7', 'pr8', 'pr9', 'prh'],
   array['个人改命', '九星', '改命', '博物馆', '运程'], '{}', 2, false),
 ('calligraphy', '书法 Calligraphy', 30, array['Calligraphy Adornment'],
   array['书法', 'calligraphy'], array['书法', '字画', '艺品'], array['fengshui'], null, false),
 ('art', '画作 Art', 40, array['Artistic Masterpieces'],
   array['画作', 'artistic', 'masterpiece'], array['画作', '艺品', '艺术'], array['fengshui'], null, false),
 ('caiku', '财库 Cai Ku', 50, array['Royal Woodwork Series'],
   array['财库', 'cai ku', 'caiku', '财托', '催财'], array['财库'], array['fengshui'], 1, false),
 ('consult', '咨询 Consultation', 60, array['Consultation Service'],
   array['咨询', '谘询', '星卦', '解运', '生命蓝图', '测名', '取名'], array['运程', '星卦', '咨询'], '{}', null, false),
 ('bujishu', 'Bujishu', 70, '{}', array['bujishu'], array['bujishu'], '{}', null, false),
 ('formula', 'Formula', 80, '{}', array['formula'], array['formula'], '{}', null, false),
 ('business', '招商 Business', 90, array['Recruitment'],
   array['招商', 'recruit', 'join team', '加入团队', '做代理', '当代理', '创业', 'business opportunity', '生意机会', 'extra income', '代理配套'],
   array['招商'], '{}', 1, false),
 ('general', 'General 一般', 100, '{}', '{}', '{}', '{}', null, false)
on conflict (key) do nothing;

insert into public.invite_config (key, value) values ('rules', jsonb_build_object(
    'strong', 70, 'potential', 50, 'slots', 9,
    'pts', jsonb_build_object(
        'wait', 60, 'tick', 40, 'quoted', 10, 'tick_upgrade', 20, 'rx', 40, 'focus', 30,
        'rung', 35, 'rung_audited', 15, 'fsa_decide', 40, 'owns_service', 40, 'service_due', 20, 'owns_comeback', 20,
        'feeder', 35, 'feeder_recent', 15, 'ev1', 30, 'ev2', 45, 'ev3', 60, 'huiji', 10,
        'talk', 15, 'talk_max', 30, 'new_cps', 30, 'interest', 15, 'old_ev', 10, 'old_ev_max', 30, 'tick_ever', 30),
    'pause_days', jsonb_build_object('not_interested', 180, 'budget', 90, 'other_no', 180),
    'review', jsonb_build_object('no_time', 3, 'no_reply', 2, 'no_show', 2),
    'limit', jsonb_build_object('invites', 2, 'days', 30),
    'refill_stop_days', 2,
    'message', 'Hi {name}，诚邀您出席《{event}》！日期：{date}（{weekday}）{time}，地点：{venue}。期待与您相见！— {agent}'))
on conflict (key) do nothing;

-- ── 2. Event objectives, profile switches ───────────────────────────────────
alter table public.events add column if not exists invite_objectives jsonb;   -- [{line, goal, focus:[product ids]}]
alter table public.events add column if not exists invite_slots smallint;     -- names per agent (null = rules.slots)
alter table public.prospects add column if not exists do_not_invite boolean default false;
alter table public.prospects add column if not exists prefers_call boolean default false;
alter table public.customers add column if not exists do_not_invite boolean default false;
alter table public.customers add column if not exists prefers_call boolean default false;
alter table public.journey_touchpoints add column if not exists source_invite_id bigint;
create index if not exists jt_invite on public.journey_touchpoints (source_invite_id) where source_invite_id is not null;

-- ── 3. One row per session × person ─────────────────────────────────────────
create table if not exists public.event_invites (
    id             bigint generated by default as identity primary key,
    activity_id    bigint not null references public.activities(id) on delete cascade,
    event_id       bigint,
    person_key     text not null,                  -- 'c:<customer>' or 'p:<prospect>'
    prospect_id    bigint references public.prospects(id) on delete cascade,
    customer_id    bigint references public.customers(id) on delete cascade,
    agent_id       bigint references public.users(id),
    objectives     text[] not null default '{}',   -- the session's 'line:goal' keys when suggested
    objective      text,                           -- the best matching one
    grp            text not null default 'potential' check (grp in ('strong', 'potential', 'review', 'manual')),
    fit            smallint, engagement smallint, readiness smallint,
    slot_rank      smallint,
    reasons        jsonb not null default '[]',
    warnings       jsonb not null default '[]',
    review_reason  text,
    source         text not null default 'engine' check (source in ('engine', 'manual')),
    state          text not null default 'suggested' check (state in ('suggested', 'sent', 'removed')),
    channel        text check (channel in ('whatsapp', 'call', 'in_person')),
    prepared_at    timestamptz,
    sent_at        timestamptz, sent_by bigint,
    reply          text check (reply in ('coming', 'declined', 'no_reply')),
    decline_reason text check (decline_reason in ('no_time', 'away', 'not_interested', 'budget', 'has_it', 'stop', 'other')),
    reply_note     text, reinvite boolean,
    replied_at     timestamptz, replied_by bigint,
    removed_reason text check (removed_reason in ('not_fit', 'handled', 'wrong_objective', 'missing_info', 'excluded', 'other')),
    removed_note   text, removed_by bigint, removed_at timestamptz,
    attendee_id    bigint, attended boolean, no_show boolean,
    followup_done  boolean not null default false,
    added_by       bigint,
    created_at     timestamptz not null default now(),
    updated_at     timestamptz not null default now(),
    constraint event_invites_one unique (activity_id, person_key),
    constraint event_invites_person check (prospect_id is not null or customer_id is not null)
);
create index if not exists ei_session_agent on public.event_invites (activity_id, agent_id);
create index if not exists ei_person on public.event_invites (person_key, replied_at);
create index if not exists ei_prospect on public.event_invites (prospect_id) where prospect_id is not null;
create index if not exists ei_customer on public.event_invites (customer_id) where customer_id is not null;
alter table public.event_invites enable row level security;
drop policy if exists event_invites_sel on public.event_invites;
create policy event_invites_sel on public.event_invites for select to authenticated using (
    coalesce(public.current_user_level(), 99) <= 2 or agent_id in (select public.current_user_visible_ids()));
grant select on public.event_invites to authenticated;

create table if not exists public.event_invite_runs (
    activity_id bigint primary key references public.activities(id) on delete cascade,
    run_at      timestamptz not null default now(),
    summary     jsonb not null default '{}'
);
alter table public.event_invite_runs enable row level security;
drop policy if exists event_invite_runs_sel on public.event_invite_runs;
create policy event_invite_runs_sel on public.event_invite_runs for select to authenticated using (true);
grant select on public.event_invite_runs to authenticated;

-- ── 4. Small helpers ────────────────────────────────────────────────────────
-- First keyword found in a lower-cased text (array order = deterministic).
create or replace function public.inv_hit(p_txt text, p_kws text[]) returns text
language sql immutable parallel safe as $$
    select k from unnest(coalesce(p_kws, '{}'::text[])) k
     where p_txt is not null and k <> '' and position(k in p_txt) > 0 limit 1
$$;
-- "换天心 Huan Tian Xin" → 换天心 · "天至喜1 …" → 天至喜 · "上龙柄（推介特价）…" → 上龙柄.
-- Kept only when it is 2+ Chinese characters or 4+ letters ("DC" is too generic).
create or replace function public.inv_product_head(p_name text) returns text
language sql immutable parallel safe as $$
    select h from (select lower(regexp_replace(regexp_replace(split_part(btrim(coalesce(p_name, '')), ' ', 1),
                         '[（(].*$', ''), '[0-9０-９]+$', '')) h) x
     where h ~ '[一-龥].*[一-龥]' or char_length(h) >= 4
$$;
create or replace function public.inv_line_kw(p_line text) returns text[]
language sql stable security definer set search_path = public as $$
    select coalesce(array_agg(distinct k order by k) filter (where k is not null and k <> ''), '{}')
      from (select lower(unnest(l.keywords)) k from public.invite_lines l where l.key = p_line
            union
            select public.inv_product_head(pr.name) from public.products pr
              join public.invite_lines l on l.key = p_line
             where pr.subcategory = any (l.subcategories)) x
$$;
-- A prospect who became a customer is ALWAYS the customer person.
create or replace function public.inv_person_key(p_kind text, p_id bigint) returns text
language sql stable security definer set search_path = public as $$
    select case when p_id is null then null
                when p_kind = 'customer' then 'c:' || p_id
                else coalesce((select 'c:' || c.id from public.customers c where c.converted_from_prospect_id = p_id order by c.id limit 1),
                              'p:' || p_id) end
$$;
create or replace function public.inv_cfg() returns jsonb
language sql stable security definer set search_path = public as $$
    select coalesce((select value from public.invite_config where key = 'rules'), '{}'::jsonb)
$$;
create or replace function public.inv_obj_keys(p_objs jsonb) returns text[]
language sql immutable as $$
    select coalesce(array_agg((o ->> 'line') || ':' || (o ->> 'goal')), '{}')
      from jsonb_array_elements(case when jsonb_typeof(p_objs) = 'array' then p_objs else '[]'::jsonb end) o
$$;

-- ── 5. The engine ───────────────────────────────────────────────────────────
-- p_objs     : [{line, goal, focus:[product ids]}] (1–2)
-- p_activity : the session (null = smart list without a session)
-- p_only     : one person_key (manual add) or null for everyone
-- Returns every person with fit ≥ the potential threshold, plus those held
-- back (excl) so the screen can count them. Deterministic for the same data.
create or replace function public.inv_compute(p_objs jsonb, p_activity bigint default null, p_only text default null)
returns table (person_key text, prospect_id bigint, customer_id bigint, name text, agent_id bigint, agent_moved boolean,
               objective text, rr int, fit int, engagement int, readiness int, grp text, excl text, review text,
               reasons jsonb, warnings jsonb, last_touch date, phone_ok boolean, prefers_call boolean)
language plpgsql security definer set search_path = public as $$
declare
    c jsonb := public.inv_cfg(); p jsonb; v_today date := public.journey_today();
    v_strong int; v_pot int; v_cats text[] := '{}'; v_lim int; v_lim_days int;
begin
    p := coalesce(c -> 'pts', '{}'::jsonb);
    v_strong := coalesce((c ->> 'strong')::int, 70);
    v_pot := coalesce((c ->> 'potential')::int, 50);
    v_lim := coalesce((c #>> '{limit,invites}')::int, 2);
    v_lim_days := coalesce((c #>> '{limit,days}')::int, 30);
    if p_activity is not null then
        select public.event_cats(a.event_id) into v_cats from public.activities a where a.id = p_activity;
    end if;

    drop table if exists _inv_o, _inv_map, _inv_p, _inv_a, _inv_e, _inv_b, _inv_x, _inv_h, _inv_g, _inv_f, _inv_s, _inv_reg;

    -- objectives
    create temp table _inv_o on commit drop as
    select x.n::int ord, l.key line, x.goal, l.key || ':' || x.goal okey,
           public.inv_line_kw(l.key) kw,
           (select coalesce(array_agg(distinct lower(k) order by lower(k)), '{}') from unnest(l.event_keywords) k) ekw,
           (select coalesce(array_agg(distinct k order by k), '{}') from (
                select public.inv_line_kw(f) kk from unnest(l.feeder_lines) f) y, unnest(y.kk) k) fkw,
           (select coalesce(array_agg(distinct h order by h) filter (where h is not null), '{}')
              from public.products pr, public.inv_product_head(pr.name) h
             where pr.id in (select (jsonb_array_elements_text(coalesce(x.focus, '[]'::jsonb)))::bigint)) focus_kw,
           l.complete_count, l.fsa_is_rung
      from (select t.v ->> 'line' line, t.v ->> 'goal' goal, t.v -> 'focus' focus, t.n
              from jsonb_array_elements(case when jsonb_typeof(p_objs) = 'array' then p_objs else '[]'::jsonb end)
                   with ordinality t(v, n)) x
      join public.invite_lines l on l.key = x.line and l.active
     where x.goal in ('introduce', 'decide', 'upgrade', 'service', 'comeback')
     order by x.n
     limit 2;

    -- prospect → person key
    create temp table _inv_map on commit drop as
    select pr.id pid, coalesce('c:' || (select min(cu.id) from public.customers cu where cu.converted_from_prospect_id = pr.id), 'p:' || pr.id) key
      from public.prospects pr;
    create index on _inv_map (pid);

    -- people
    create temp table _inv_p on commit drop as
    select 'c:' || cu.id key, cu.converted_from_prospect_id pid, cu.id cid, cu.full_name nm,
           cu.responsible_agent_id agent0,
           coalesce(nullif(regexp_replace(coalesce(cu.phone, pr.phone, ''), '\D', '', 'g'), ''), '') <> '' phone_ok,
           coalesce(cu.do_not_invite, false) or coalesce(pr.do_not_invite, false) dni,
           coalesce(cu.prefers_call, false) or coalesce(pr.prefers_call, false) pcall,
           coalesce(pr.unable_to_serve, false) uts, ''::text grade, coalesce(pr.cps_next_step, '') cps_next,
           lower(concat_ws(' ', cu.cps_interest, cu.interests, cu.pain_points, pr.cps_interest, pr.interests, pr.pain_points)) interest,
           coalesce(pr.open_potential_rm, 0) open_pot, true is_cust, coalesce(cu.converted_to_agent, false) is_agent,
           coalesce(pr.cooldown_until > v_today, false) cooling
      from public.customers cu left join public.prospects pr on pr.id = cu.converted_from_prospect_id
    union all
    select 'p:' || pr.id, pr.id, null, pr.full_name, pr.responsible_agent_id,
           coalesce(nullif(regexp_replace(coalesce(pr.phone, ''), '\D', '', 'g'), ''), '') <> '',
           coalesce(pr.do_not_invite, false), coalesce(pr.prefers_call, false),
           coalesce(pr.unable_to_serve, false), coalesce(pr.manual_grade, ''), coalesce(pr.cps_next_step, ''),
           lower(concat_ws(' ', pr.cps_interest, pr.interests, pr.pain_points)),
           coalesce(pr.open_potential_rm, 0), false, false, coalesce(pr.cooldown_until > v_today, false)
      from public.prospects pr
     where coalesce(pr.status, '') <> 'converted'
       and not exists (select 1 from public.customers cu where cu.converted_from_prospect_id = pr.id);
    if p_only is not null then delete from _inv_p where key <> p_only; end if;
    delete from _inv_p x where x.is_agent
        or exists (select 1 from public.users u where coalesce(u.role_level, 99) <= 11 and coalesce(u.status, 'active') = 'active'
                     and (lower(btrim(u.full_name)) = lower(btrim(x.nm)) or (x.cid is not null and u.customer_id = x.cid)));
    alter table _inv_p add column agent bigint, add column moved boolean default false;
    update _inv_p x set agent = case when coalesce(u.status, 'active') = 'active' then x.agent0 else u.reporting_to end,
                        moved = coalesce(u.status, 'active') <> 'active'
      from public.users u where u.id = x.agent0;
    create index on _inv_p (key);

    -- meetings + calls + event notes (2 years, up to today)
    create temp table _inv_a on commit drop as
    select coalesce(case when a.customer_id is not null then 'c:' || a.customer_id end, m.key) key, a.id, a.activity_type t, a.activity_date d,
           lower(coalesce(a.opportunity_potential, '')) tick, lower(coalesce(a.quoted_prices::text, '')) quote,
           lower(concat_ws(' ', a.note_key_points, a.summary, a.discussion_summary, a.note_needs, a.note_pain_points,
                           a.next_action, a.core_problem, a.note_outcome, a.meeting_minutes::text)) notes,
           a.event_id
      from public.activities a left join _inv_map m on m.pid = a.prospect_id
     where (a.customer_id is not null or a.prospect_id is not null)
       and a.activity_date between v_today - 730 and v_today
       and a.activity_type in ('CPS', 'FTF', 'FSA', 'SITE', 'GR', 'XG', 'CALL', 'WHATSAPP', 'EVENT', 'EVENT_CLOSING')
    union all
    select case when ea.attendee_type = 'customer' then 'c:' || coalesce(ea.entity_id, ea.attendee_id) else m.key end,
           s.id, 'EVNOTE', s.activity_date,
           lower(coalesce(ea.opportunity_potential, '')), lower(coalesce(ea.quoted_prices::text, '')),
           lower(concat_ws(' ', ea.note_key_points, ea.summary, ea.note_needs, ea.note_pain_points, ea.next_action, ea.meeting_minutes::text)),
           s.event_id
      from public.event_attendees ea
      join public.activities s on s.id = ea.activity_id
      left join _inv_map m on m.pid = coalesce(ea.entity_id, ea.attendee_id) and ea.attendee_type = 'prospect'
     where ea.attendee_type in ('prospect', 'customer') and s.activity_date between v_today - 730 and v_today
       and coalesce(nullif(btrim(concat_ws('', ea.opportunity_potential, ea.note_key_points, ea.summary, ea.note_needs,
                                            ea.note_pain_points, ea.next_action)), ''), nullif(ea.quoted_prices::text, '{}')) is not null;
    delete from _inv_a where key is null or key not in (select key from _inv_p);
    create index on _inv_a (key);

    -- events attended / registered (sessions up to 2 years back)
    create temp table _inv_e on commit drop as
    select case when ea.attendee_type = 'customer' then 'c:' || coalesce(ea.entity_id, ea.attendee_id) else m.key end key,
           s.id act_id, s.activity_date d,
           lower(concat_ws(' ', e.title, e.categories, e.category, s.activity_title)) etxt,
           concat_ws(' ', e.title, e.categories, e.category, s.activity_title) ~ '汇[集聚]|匯集' huiji,
           (coalesce(ea.attended, false) or ea.attendance_status in ('Attended', 'Late')) went,
           ea.attendance_status = 'No Show' noshow,
           coalesce(nullif(btrim(e.title), ''), s.activity_title, '') title
      from public.event_attendees ea
      join public.activities s on s.id = ea.activity_id
      left join public.events e on e.id = s.event_id
      left join _inv_map m on m.pid = coalesce(ea.entity_id, ea.attendee_id) and ea.attendee_type = 'prospect'
     where ea.attendee_type in ('prospect', 'customer') and s.activity_date >= v_today - 730
    union all   -- older style: the EVENT activity's own person
    select a.key, a.id, a.d, lower(concat_ws(' ', e.title, e.categories, e.category)),
           concat_ws(' ', e.title, e.categories, e.category) ~ '汇[集聚]|匯集', a.d <= v_today, false, coalesce(e.title, '')
      from _inv_a a left join public.events e on e.id = a.event_id
     where a.t = 'EVENT';
    delete from _inv_e where key is null or key not in (select key from _inv_p);
    create index on _inv_e (key);

    -- purchases (cancelled sales do not count)
    create temp table _inv_b on commit drop as
    select coalesce(case when pu.customer_id is not null then 'c:' || pu.customer_id end, m.key) key,
           lower(coalesce(pu.item, '')) item, coalesce(pu.date, pu.created_at::date) d, coalesce(pu.item, '') item_raw,
           pu.bujishu_catalog_id is not null bjs, coalesce(pu.is_agent_package, false) agent_pkg
      from public.purchases pu left join _inv_map m on m.pid = pu.prospect_id
     where coalesce(pu.status, '') !~* 'cancel|refund|void'
       and not exists (select 1 from public.sale_cancellations sc where sc.purchase_id = pu.id
                         and sc.status in ('refunding', 'completed'));
    delete from _inv_b where key is null or key not in (select key from _inv_p);
    create index on _inv_b (key);

    -- open prescriptions + open deals
    create temp table _inv_x on commit drop as
    select m.key, 'prescription'::text kind, lower(coalesce(r.product, '')) what, coalesce(r.product, '') what_raw, r.created_at::date d
      from public.audit_prescriptions r join _inv_map m on m.pid = r.prospect_id
     where r.status in ('proposed', 'accepted')
    union all
    select m.key, 'deal', lower(coalesce(dl.product, '')), coalesce(dl.product, ''), coalesce(dl.updated_at, dl.created_at)::date
      from public.pipeline_deals dl join _inv_map m on m.pid = dl.prospect_id
     where dl.stage in ('interested', 'proposal', 'prescribed', 'closing');
    create index on _inv_x (key);

    -- earlier invitations (other sessions)
    create temp table _inv_h on commit drop as
    select i.person_key key, i.activity_id, s.activity_date d, i.objectives, i.reply, i.decline_reason, i.reinvite,
           i.replied_at, i.sent_at, coalesce(i.no_show, false) no_show, coalesce(i.attended, false) attended
      from public.event_invites i join public.activities s on s.id = i.activity_id
     where i.activity_id is distinct from p_activity and i.state <> 'removed';
    create index on _inv_h (key);

    -- people already on this session's attendee list
    create temp table _inv_reg on commit drop as
    select distinct public.inv_person_key(ea.attendee_type, coalesce(ea.entity_id, ea.attendee_id)) key
      from public.event_attendees ea
     where p_activity is not null and ea.activity_id = p_activity and ea.attendee_type in ('prospect', 'customer');

    -- per person (not per objective)
    create temp table _inv_g on commit drop as
    select x.key,
           (select max(d) from (select a.d from _inv_a a where a.key = x.key and a.t in ('CPS', 'FTF', 'FSA', 'SITE', 'GR', 'XG')
                                union all select e.d from _inv_e e where e.key = x.key and e.went and e.d <= v_today) z) last_touch,
           (select count(*) from _inv_a a where a.key = x.key and a.t in ('CALL', 'WHATSAPP') and a.d >= v_today - 90) calls90,
           (select count(distinct e.act_id) from _inv_e e where e.key = x.key and e.went and e.d >= v_today - 180) ev180,
           (select count(*) from _inv_a a where a.key = x.key and a.t in ('CPS', 'FTF', 'FSA', 'SITE', 'GR', 'XG') and a.d >= v_today - 365) meets365,
           (select count(*) from _inv_a a where a.key = x.key and a.t in ('CPS', 'FTF', 'FSA', 'SITE', 'GR', 'XG') and a.d >= v_today - 365
                and (a.tick <> '' or regexp_replace(a.notes, '[[:space:]{}",:]|\[|\]|null|false|true', '', 'g') <> '')) meets365_noted,
           (select max(a.d) from _inv_a a where a.key = x.key and a.t = 'CPS' and a.d >= v_today - 60) cps60,
           exists (select 1 from _inv_x r where r.key = x.key and r.kind = 'prescription') rx_any,
           exists (select 1 from _inv_x r where r.key = x.key and r.kind = 'deal') deal_any,
           exists (select 1 from _inv_a a where a.key = x.key and a.quote not in ('', '{}', 'null') and a.d >= v_today - 90) quote90,
           exists (select 1 from public.journey_touchpoints t
                    where ((x.pid is not null and t.prospect_id = x.pid) or (x.cid is not null and t.customer_id = x.cid))
                      and t.status in ('pending', 'overdue') and t.due_date <= v_today) task_due,
           (select count(*) from _inv_h h where h.key = x.key and h.sent_at >= now() - make_interval(days => v_lim_days)) sent_recent,
           (select count(*) from _inv_h h where h.key = x.key and h.reply = 'coming') coming_n,
           (select array_agg(case when h.no_show then 'no_show' when h.reply = 'no_reply' then 'no_reply'
                                  when h.reply = 'declined' then coalesce(h.decline_reason, 'other') else coalesce(h.reply, '-') end
                             order by h.d desc)
              from _inv_h h where h.key = x.key and (h.sent_at is not null or h.reply is not null)) hist
      from _inv_p x;
    create index on _inv_g (key);

    -- per person × objective: the facts
    create temp table _inv_f on commit drop as
    select x.key, o.ord, o.okey, o.line, o.goal, o.complete_count, o.fsa_is_rung, o.focus_kw <> '{}' has_focus,
           w.id wait_id, w.created_at::date wait_d,
           tk.id tick_id, tk.d tick_d, tk.hit tick_what, tk.quoted,
           (select a.d from _inv_a a where a.key = x.key and o.kw <> '{}' and public.inv_hit(a.tick, o.kw) is not null order by a.d desc limit 1) tick_ever_d,
           rx.kind rx_kind, rx.what_raw rx_what, rx.d rx_d,
           fo.id focus_id, fo.d focus_d, fo.hit focus_what,
           ow.n owns_n, ow.last_d owns_d, ow.what owns_what,
           exists (select 1 from _inv_b b where b.key = x.key and o.focus_kw <> '{}' and public.inv_hit(b.item, o.focus_kw) is not null) owns_focus,
           fsa.id fsa_id, fsa.d fsa_d,
           fd.d feeder_d, fd.what feeder_what,
           ev.n ev_n, ev.last_d ev_d, ev.last_id ev_id, ev.last_title ev_title, ev.huiji ev_huiji,
           (select count(distinct e.act_id) from _inv_e e where e.key = x.key and e.went and e.d < v_today - 180
                and (o.ekw = '{}' or public.inv_hit(e.etxt, o.ekw) is not null)) old_ev_n,
           tl.n talk_n, tl.d talk_d, tl.id talk_id,
           case when o.kw <> '{}' then public.inv_hit(x.interest, o.kw) end interest_hit,
           sv.what service_what,
           pz.why paused
      from _inv_p x cross join _inv_o o
      left join lateral (select w.id, w.created_at from public.class_waitlist w
                          where p_activity is not null and w.status = 'waiting'
                            and (w.prospect_id = x.pid or w.customer_id = x.cid)
                            and public.class_cat_match(w.category, v_cats)
                          order by w.created_at limit 1) w on true
      left join lateral (select a.id, a.d, public.inv_hit(a.tick, o.kw) hit,
                                a.quote not in ('', '{}', 'null') and public.inv_hit(a.quote, o.kw) is not null quoted
                           from _inv_a a where a.key = x.key and a.d >= v_today - 183 and o.kw <> '{}'
                            and public.inv_hit(a.tick, o.kw) is not null
                          order by a.d desc, a.id desc limit 1) tk on true
      left join lateral (select r.kind, r.what_raw, r.d from _inv_x r where r.key = x.key and o.kw <> '{}'
                            and public.inv_hit(r.what, o.kw) is not null order by (r.kind = 'prescription') desc, r.d desc limit 1) rx on true
      left join lateral (select z.id, z.d, z.hit from (
                              select a.id, a.d, public.inv_hit(a.tick || ' ' || a.quote || ' ' || a.notes, o.focus_kw) hit
                                from _inv_a a where a.key = x.key and a.d >= v_today - 365
                              union all
                              select e.act_id, e.d, public.inv_hit(e.etxt, o.focus_kw) from _inv_e e
                               where e.key = x.key and e.went and e.d >= v_today - 365) z
                          where o.focus_kw <> '{}' and z.hit is not null order by z.d desc, z.id desc limit 1) fo on true
      left join lateral (select count(*) n, max(b.d) last_d,
                                (array_agg(b.item_raw order by b.d desc))[1] what
                           from _inv_b b where b.key = x.key
                            and case o.line when 'general' then true
                                            when 'bujishu' then b.bjs or public.inv_hit(b.item, o.kw) is not null
                                            when 'business' then b.agent_pkg or public.inv_hit(b.item, o.kw) is not null
                                            else public.inv_hit(b.item, o.kw) is not null end) ow on true
      left join lateral (select a.id, a.d from _inv_a a where a.key = x.key and a.t = 'FSA' order by a.d desc limit 1) fsa on o.fsa_is_rung
      left join lateral (select max(b.d) d, (array_agg(b.item_raw order by b.d desc))[1] what from _inv_b b
                          where b.key = x.key and o.fkw <> '{}' and public.inv_hit(b.item, o.fkw) is not null) fd on true
      left join lateral (select count(distinct e.act_id) n, max(e.d) last_d,
                                (array_agg(e.act_id order by e.d desc))[1] last_id,
                                (array_agg(e.title order by e.d desc))[1] last_title, bool_or(e.huiji) huiji
                           from _inv_e e where e.key = x.key and e.went and e.d between v_today - 180 and v_today
                            and (o.ekw = '{}' or public.inv_hit(e.etxt, o.ekw) is not null)) ev on true
      left join lateral (select count(*) n, max(a.d) d, (array_agg(a.id order by a.d desc))[1] id from _inv_a a
                          where a.key = x.key and a.t not in ('EVENT', 'CALL', 'WHATSAPP')
                            and case when o.line = 'general' then a.d >= v_today - 90
                                     else a.d >= v_today - 365 and o.kw <> '{}' and public.inv_hit(a.notes, o.kw) is not null end) tl on true
      left join lateral (select coalesce(
                              (select 'Item ready to collect: ' || di.item_name from public.delivery_items di
                                where di.status = 'pending' and coalesce(di.legacy_closed, false) = false
                                  and ((x.cid is not null and di.customer_id = x.cid) or (x.pid is not null and di.prospect_id = x.pid))
                                  and o.kw <> '{}' and public.inv_hit(lower(di.item_name), o.kw) is not null
                                  and di.expected_ready_date <= v_today + 14 order by di.expected_ready_date limit 1),
                              (select '黄金一路 ' || t.seq || '/' || t.seq_total || ' due' from public.journey_touchpoints t
                                where o.line = 'ring' and t.seq is not null and t.status = 'pending'
                                  and ((x.cid is not null and t.customer_id = x.cid) or (x.pid is not null and t.prospect_id = x.pid))
                                order by t.due_date limit 1)) what) sv on true
      left join lateral (select case
                when h.decline_reason = 'has_it' then 'has_it'
                when h.decline_reason = 'not_interested' and h.replied_at > now() - make_interval(days => coalesce((c #>> '{pause_days,not_interested}')::int, 180))
                     and not exists (select 1 from _inv_a a where a.key = x.key and a.d > h.replied_at::date
                                       and (public.inv_hit(a.tick, o.kw) is not null or public.inv_hit(a.notes, o.kw) is not null)) then 'not_interested'
                when h.decline_reason = 'budget' and o.goal in ('decide', 'upgrade')
                     and h.replied_at > now() - make_interval(days => coalesce((c #>> '{pause_days,budget}')::int, 90)) then 'budget'
                when h.decline_reason = 'other' and h.reinvite is false
                     and h.replied_at > now() - make_interval(days => coalesce((c #>> '{pause_days,other_no}')::int, 180)) then 'other'
                end why
             from _inv_h h where h.key = x.key and h.reply = 'declined' and o.okey = any (h.objectives)
            order by h.replied_at desc nulls last limit 1) pz on true;

    -- fit per objective (each goal has its own recipe; capped at 100)
    create temp table _inv_s on commit drop as
    select f.*,
        case f.goal
          when 'decide' then case when coalesce(f.owns_n, 0) > 0 then 0 else
                 (case when f.wait_d is not null then (p ->> 'wait')::int else 0 end)
               + (case when f.tick_d is not null then (p ->> 'tick')::int + case when f.quoted then (p ->> 'quoted')::int else 0 end else 0 end)
               + (case when f.rx_kind is not null then (p ->> 'rx')::int else 0 end)
               + (case when f.focus_d is not null then (p ->> 'focus')::int else 0 end)
               + ev_pts + talk_pts
               + (case when f.interest_hit is not null then (p ->> 'interest')::int else 0 end)
               + (case when f.feeder_d is not null then (p ->> 'feeder')::int + case when f.feeder_d >= v_today - 60 then (p ->> 'feeder_recent')::int else 0 end else 0 end)
               + (case when f.fsa_d is not null then (p ->> 'fsa_decide')::int else 0 end) end
          when 'upgrade' then case when coalesce(f.owns_n, 0) = 0 and f.fsa_d is null then 0 else
                 (p ->> 'rung')::int + (case when f.fsa_d is not null then (p ->> 'rung_audited')::int else 0 end)
               + (case when f.wait_d is not null then (p ->> 'wait')::int else 0 end)
               + (case when f.tick_d is not null then (p ->> 'tick_upgrade')::int else 0 end)
               + (case when f.rx_kind is not null then (p ->> 'rx')::int else 0 end)
               + (case when f.focus_d is not null then (p ->> 'focus')::int else 0 end)
               + ev_pts + talk_pts end
          when 'introduce' then case when coalesce(f.owns_n, 0) > 0 and f.line <> 'general' then 0 else
                 (case when g.cps60 is not null then (p ->> 'new_cps')::int else 0 end)
               + (case when f.feeder_d is not null then (p ->> 'feeder')::int + case when f.feeder_d >= v_today - 60 then (p ->> 'feeder_recent')::int else 0 end else 0 end)
               + (case when f.wait_d is not null then (p ->> 'wait')::int else 0 end)
               + (case when f.focus_d is not null then (p ->> 'focus')::int else 0 end)
               + (case when f.interest_hit is not null then (p ->> 'interest')::int else 0 end)
               + ev_pts + talk_pts end
          when 'service' then case when coalesce(f.owns_n, 0) = 0 then 0 else
                 (p ->> 'owns_service')::int
               + (case when f.service_what is not null then (p ->> 'service_due')::int else 0 end)
               + (case when f.wait_d is not null then (p ->> 'wait')::int else 0 end)
               + (case when f.focus_d is not null then (p ->> 'focus')::int else 0 end)
               + ev_pts + talk_pts end
          when 'comeback' then case when g.last_touch >= v_today - 180 then 0 else
                 (case when coalesce(f.owns_n, 0) > 0 then (p ->> 'owns_comeback')::int else 0 end)
               + (case when f.interest_hit is not null then (p ->> 'interest')::int else 0 end)
               + (case when f.tick_ever_d is not null then (p ->> 'tick_ever')::int else 0 end)
               + least(coalesce(f.old_ev_n, 0) * (p ->> 'old_ev')::int, (p ->> 'old_ev_max')::int)
               + (case when f.focus_d is not null then (p ->> 'focus')::int else 0 end) end
        end raw_fit,
        case when f.paused is not null then 'paused'
             when f.goal in ('decide', 'upgrade') and (
                    (f.has_focus and f.owns_focus)
                 or (not f.has_focus and f.complete_count is not null and coalesce(f.owns_n, 0) >= f.complete_count)) then 'complete'
        end blocked
      from (select f0.*,
                   case when coalesce(f0.ev_n, 0) = 0 then 0
                        else (case when f0.ev_n = 1 then (p ->> 'ev1')::int when f0.ev_n = 2 then (p ->> 'ev2')::int else (p ->> 'ev3')::int end)
                             + case when f0.ev_huiji then (p ->> 'huiji')::int else 0 end end ev_pts,
                   least(coalesce(f0.talk_n, 0) * (p ->> 'talk')::int, (p ->> 'talk_max')::int) talk_pts
              from _inv_f f0) f
      join _inv_g g on g.key = f.key;

    return query
    with best as (
        select distinct on (s.key) s.*, least(s.raw_fit, 100) fit_c
          from _inv_s s where s.blocked is null
         order by s.key, least(s.raw_fit, 100) desc, s.ord
    ),
    blocked_best as (
        select distinct on (s.key) s.key, s.blocked from _inv_s s
         where s.blocked is not null and least(s.raw_fit, 100) >= v_pot
         order by s.key, s.raw_fit desc, s.ord
    ),
    cand as (
        select x.key, x.pid, x.cid, x.nm, x.agent, x.moved, x.dni, x.uts, x.grade, x.cooling, x.cps_next, x.phone_ok, x.pcall, x.open_pot,
               b.okey, b.line, b.goal, coalesce(b.fit_c, 0) fit, bb.blocked,
               b.wait_d, b.wait_id, b.tick_d, b.tick_id, b.tick_what, b.quoted, b.tick_ever_d, b.rx_kind, b.rx_what, b.rx_d,
               b.focus_id, b.focus_d, b.focus_what, b.owns_n, b.owns_d, b.owns_what, b.fsa_id, b.fsa_d, b.feeder_d, b.feeder_what,
               b.ev_n, b.ev_d, b.ev_id, b.ev_title, b.old_ev_n, b.talk_n, b.talk_d, b.talk_id, b.interest_hit, b.service_what,
               g.last_touch, g.calls90, g.ev180, g.meets365, g.meets365_noted, g.cps60, g.rx_any, g.deal_any, g.quote90, g.task_due,
               g.sent_recent, g.coming_n, g.hist
          from _inv_p x
          join _inv_g g on g.key = x.key
          left join best b on b.key = x.key
          left join blocked_best bb on bb.key = x.key
         where coalesce(b.fit_c, 0) >= v_pot or bb.blocked is not null
    )
    select cd.key, cd.pid, cd.cid, cd.nm, cd.agent, cd.moved, cd.okey, null::int,
           cd.fit::int,
           greatest(0, least(100,
               (case when cd.last_touch >= v_today - 30 then 40 when cd.last_touch >= v_today - 90 then 25
                     when cd.last_touch >= v_today - 180 then 10 else 0 end)
             + least(cd.ev180 * 10, 30)
             + (case when cd.calls90 > 0 then 10 else 0 end)
             + (case when cd.coming_n > 0 then 10 else 0 end)
             - (case when coalesce(cd.hist[1], '') in ('no_show', 'no_reply') and coalesce(cd.hist[2], '') in ('no_show', 'no_reply') then 20 else 0 end)))::int,
           least(100,
               (case when cd.rx_any then 40 else 0 end) + (case when cd.quote90 then 30 else 0 end)
             + (case when cd.deal_any then 30 else 0 end) + (case when cd.task_due then 20 else 0 end)
             + (case when cd.open_pot >= 10000 then 10 else 0 end))::int,
           case when cd.fit >= v_strong then 'strong' else 'potential' end,
           -- held back (not suggested; counted)
           case when cd.dni then 'do_not_invite'
                when cd.uts then 'unable_to_serve'
                when cd.grade = 'F' then 'grade_f'
                when cd.cooling then 'cooldown'
                when exists (select 1 from _inv_reg rg where rg.key = cd.key) then 'registered'
                when cd.fit < v_pot then coalesce(cd.blocked, 'paused')
                when cd.sent_recent >= v_lim then 'limit'
           end,
           -- needs a person to look first (shown to the upline, not in the agent's list)
           case when cd.agent is null then 'no_agent'
                when cd.cps_next = 'not_interested' then 'said_not_interested'
                when coalesce(cd.hist[1], '') = 'no_time' and coalesce(cd.hist[2], '') = 'no_time' and coalesce(cd.hist[3], '') = 'no_time'
                     and coalesce((c #>> '{review,no_time}')::int, 3) <= 3 then 'no_time_3x'
                when coalesce(cd.hist[1], '') = 'no_show' and coalesce(cd.hist[2], '') = 'no_show' then 'no_show_2x'
                when coalesce(cd.hist[1], '') = 'no_reply' and coalesce(cd.hist[2], '') = 'no_reply' then 'no_reply_2x'
           end,
           -- top 3 reasons (strongest first)
           (select coalesce(jsonb_agg(r order by (r ->> 'p')::int desc, r ->> 'd' desc nulls last), '[]'::jsonb) from (
              select r from jsonb_array_elements(jsonb_build_array(
                case when cd.wait_d is not null then jsonb_build_object('p', 60, 't', 'Waiting for this class (agent recommended)', 'd', cd.wait_d, 'ref', 'wait', 'id', cd.wait_id) end,
                case when cd.tick_d is not null and cd.goal <> 'comeback' then jsonb_build_object('p', 40, 't', 'Discussed ' || cd.tick_what || case when cd.quoted then ' · price quoted' else '' end, 'd', cd.tick_d, 'ref', 'act', 'id', cd.tick_id) end,
                case when cd.rx_kind is not null and cd.goal in ('decide', 'upgrade') then jsonb_build_object('p', 40, 't', case when cd.rx_kind = 'prescription' then 'Audit prescribed: ' else 'Open deal: ' end || left(cd.rx_what, 40), 'd', cd.rx_d, 'ref', 'person') end,
                case when cd.focus_d is not null and cd.focus_id is distinct from cd.ev_id and cd.focus_id is distinct from cd.tick_id
                     then jsonb_build_object('p', 30, 't', 'Mentioned ' || cd.focus_what, 'd', cd.focus_d, 'ref', 'act', 'id', cd.focus_id) end,
                case when coalesce(cd.owns_n, 0) > 0 and cd.goal in ('upgrade', 'service', 'comeback') and cd.line <> 'general' then jsonb_build_object('p', 35, 't', 'Owns ' || left(cd.owns_what, 40), 'd', cd.owns_d, 'ref', 'person') end,
                case when cd.fsa_d is not null and cd.goal in ('decide', 'upgrade') then jsonb_build_object('p', case when cd.goal = 'decide' then 40 else 15 end, 't', 'Feng shui audit done', 'd', cd.fsa_d, 'ref', 'act', 'id', cd.fsa_id) end,
                case when cd.feeder_d is not null and cd.goal in ('decide', 'introduce') then jsonb_build_object('p', 35, 't', 'Bought ' || left(cd.feeder_what, 40) || ' — this is the next step', 'd', cd.feeder_d, 'ref', 'person') end,
                case when coalesce(cd.ev_n, 0) > 0 and cd.goal <> 'comeback' then jsonb_build_object('p', 30 + cd.ev_n, 't', 'Came to ' || left(cd.ev_title, 40) || case when cd.ev_n > 1 then ' (+' || (cd.ev_n - 1) || ' more)' else '' end, 'd', cd.ev_d, 'ref', 'act', 'id', cd.ev_id) end,
                case when coalesce(cd.talk_n, 0) > 0 and cd.goal <> 'comeback' and not (cd.talk_n = 1 and cd.talk_id is not distinct from cd.tick_id) then jsonb_build_object('p', 15, 't', case when cd.line = 'general' then 'Met ' || cd.talk_n || '× in 3 months' else 'Talked about it in ' || cd.talk_n || ' meeting' || case when cd.talk_n > 1 then 's' else '' end end, 'd', cd.talk_d, 'ref', 'act', 'id', cd.talk_id) end,
                case when cd.interest_hit is not null then jsonb_build_object('p', 15, 't', 'Profile interest: ' || cd.interest_hit, 'ref', 'person') end,
                case when cd.cps60 is not null and cd.goal = 'introduce' then jsonb_build_object('p', 30, 't', 'New friend · CPS', 'd', cd.cps60, 'ref', 'person') end,
                case when cd.service_what is not null and cd.goal = 'service' then jsonb_build_object('p', 20, 't', cd.service_what, 'ref', 'person') end,
                case when cd.goal = 'comeback' and cd.tick_ever_d is not null then jsonb_build_object('p', 30, 't', 'Discussed it before', 'd', cd.tick_ever_d, 'ref', 'person') end,
                case when cd.goal = 'comeback' and coalesce(cd.old_ev_n, 0) > 0 then jsonb_build_object('p', 10, 't', 'Came to ' || cd.old_ev_n || ' related event' || case when cd.old_ev_n > 1 then 's' else '' end || ' before', 'ref', 'person') end
              )) r where jsonb_typeof(r) = 'object'
              order by (r ->> 'p')::int desc, r ->> 'd' desc nulls last limit 3) q),
           -- data-quality warnings (shown, never guessed)
           (select coalesce(jsonb_agg(w), '[]'::jsonb) from unnest(array[
                case when cd.meets365 = 0 and cd.ev180 > 0 then 'only_events' end,
                case when cd.meets365 > 0 and cd.meets365_noted = 0 then 'no_notes' end,
                case when not cd.phone_ok then 'no_phone' end,
                case when cd.last_touch is null or cd.last_touch < v_today - 180 then 'no_contact_6m' end,
                case when cd.moved then 'agent_inactive' end]) w where w is not null),
           cd.last_touch, cd.phone_ok, cd.pcall
      from cand cd;
end $$;
revoke execute on function public.inv_compute(jsonb, bigint, text) from public, anon, authenticated;

-- ── 6. Who may act on an invite row ─────────────────────────────────────────
create or replace function public.inv_can_act(p_agent bigint, p_added_by bigint default null) returns boolean
language sql stable security definer set search_path = public as $$
    select coalesce(public.current_user_level(), 99) <= 2
        or p_agent in (select public.current_user_visible_ids())
        or (p_added_by is not null and p_added_by = public.current_user_row_id())
$$;

-- ── 7. Fill / refresh one session ───────────────────────────────────────────
create or replace function public.event_invite_refresh(p_activity bigint, p_force boolean default false)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
    c jsonb := public.inv_cfg(); a record; e record; v_today date := public.journey_today();
    v_slots int; v_objs jsonb; v_keys text[]; v_run timestamptz; v_stop int; v_new int := 0; v_sum jsonb; v_rev int;
begin
    if auth.uid() is not null and public.current_user_row_id() is null then
        raise exception 'Not permitted' using errcode = '42501';
    end if;
    select s.id, s.event_id, s.activity_date, s.activity_title into a from public.activities s
     where s.id = p_activity and s.activity_type = 'EVENT';
    if a.id is null then return jsonb_build_object('ok', false, 'why', 'not_event'); end if;
    select * into e from public.events where id = a.event_id;
    v_objs := e.invite_objectives;
    if v_objs is null or jsonb_typeof(v_objs) <> 'array' or jsonb_array_length(v_objs) = 0 then
        return jsonb_build_object('ok', false, 'why', 'no_objectives');
    end if;
    if a.activity_date < v_today then return jsonb_build_object('ok', false, 'why', 'past'); end if;
    select run_at into v_run from public.event_invite_runs where activity_id = p_activity;
    if not p_force and v_run is not null and v_run > now() - interval '10 minutes' then
        return jsonb_build_object('ok', true, 'cached', true);
    end if;
    perform pg_advisory_xact_lock(hashtext('event_invite:' || p_activity));

    v_slots := least(greatest(coalesce(e.invite_slots, (c ->> 'slots')::int, 9), 1), 20);
    v_stop := coalesce((c ->> 'refill_stop_days')::int, 2);
    v_keys := public.inv_obj_keys(v_objs);

    drop table if exists _inv_c;
    create temp table _inv_c on commit drop as select * from public.inv_compute(v_objs, p_activity, null);

    -- people now held back who are still only "suggested" → out of the list
    update public.event_invites i set state = 'removed', removed_reason = 'excluded',
           removed_note = x.excl, removed_at = now(), updated_at = now()
      from _inv_c x
     where i.activity_id = p_activity and i.person_key = x.person_key and i.state = 'suggested'
       and i.source = 'engine' and x.excl in ('do_not_invite', 'unable_to_serve', 'grade_f', 'cooldown');

    -- keep the list stable: refresh the numbers and reasons of rows already shown
    update public.event_invites i set fit = x.fit, engagement = x.engagement, readiness = x.readiness,
           reasons = x.reasons, warnings = x.warnings, objective = x.objective, updated_at = now()
      from _inv_c x
     where i.activity_id = p_activity and i.person_key = x.person_key and i.state <> 'removed';

    -- fill each agent's open slots (first fill always; refills stop N days before)
    with ranked as (
        select x.*,
               row_number() over (partition by x.agent_id, x.objective
                                  order by x.fit desc, x.engagement desc, x.readiness desc, x.last_touch desc nulls last, x.person_key) rr_obj
          from _inv_c x
         where x.excl is null and x.review is null and x.agent_id is not null
           and not exists (select 1 from public.event_invites i where i.activity_id = p_activity and i.person_key = x.person_key)
    ),
    ordered as (
        select r.*, row_number() over (partition by r.agent_id
                                       order by (r.grp = 'strong') desc, r.rr_obj, r.engagement desc, r.fit desc,
                                                r.readiness desc, r.last_touch desc nulls last, r.person_key) pos
          from ranked r
    ),
    used as (
        select i.agent_id, count(*) n
          from public.event_invites i
         where i.activity_id = p_activity and i.source = 'engine' and i.grp in ('strong', 'potential')
           and i.state <> 'removed' and coalesce(i.reply, '') <> 'declined'
         group by i.agent_id
    ),
    ever as (select distinct i.agent_id from public.event_invites i where i.activity_id = p_activity and i.source = 'engine')
    insert into public.event_invites (activity_id, event_id, person_key, prospect_id, customer_id, agent_id, objectives, objective,
                                      grp, fit, engagement, readiness, slot_rank, reasons, warnings, source)
    select p_activity, a.event_id, o.person_key, case when o.customer_id is null then o.prospect_id end, o.customer_id, o.agent_id,
           v_keys, o.objective, o.grp, o.fit, o.engagement, o.readiness, o.pos, o.reasons, o.warnings, 'engine'
      from ordered o
      left join used u on u.agent_id = o.agent_id
     where o.pos <= v_slots - coalesce(u.n, 0)
       and (o.agent_id not in (select agent_id from ever where agent_id is not null) or a.activity_date - v_today >= v_stop)
    on conflict (activity_id, person_key) do nothing;
    get diagnostics v_new = row_count;

    -- people who need a look first → upline's review list (max 30 per session)
    select 30 - count(*) into v_rev from public.event_invites where activity_id = p_activity and grp = 'review';
    insert into public.event_invites (activity_id, event_id, person_key, prospect_id, customer_id, agent_id, objectives, objective,
                                      grp, fit, engagement, readiness, reasons, warnings, review_reason, source)
    select p_activity, a.event_id, x.person_key, case when x.customer_id is null then x.prospect_id end, x.customer_id,
           x.agent_id, v_keys, x.objective, 'review', x.fit, x.engagement, x.readiness, x.reasons, x.warnings, x.review, 'engine'
      from _inv_c x
     where x.excl is null and x.review is not null and x.fit >= 50
       and not exists (select 1 from public.event_invites i where i.activity_id = p_activity and i.person_key = x.person_key)
     order by x.fit desc, x.person_key
     limit greatest(v_rev, 0)
    on conflict (activity_id, person_key) do nothing;

    -- held-back counts (good matches only) for the summary
    select jsonb_build_object(
             'excluded', coalesce((select jsonb_object_agg(excl, n) from (select excl, count(*) n from _inv_c where excl is not null group by excl) z), '{}'::jsonb),
             'matches', (select count(*) from _inv_c where excl is null),
             'objectives', v_keys, 'slots', v_slots)
      into v_sum;
    insert into public.event_invite_runs (activity_id, run_at, summary) values (p_activity, now(), v_sum)
    on conflict (activity_id) do update set run_at = excluded.run_at, summary = excluded.summary;

    -- one phone notification per agent when their names first appear
    insert into public.notification_outbox (user_id, kind, priority, title, body, url, activity_id, dedupe_key, due_at)
    select i.agent_id, 'event_invite', 'normal',
           '🎯 ' || count(*) || case when count(*) = 1 then ' person' else ' people' end || ' to invite for ' || coalesce(nullif(btrim(e.title), ''), a.activity_title, 'the event'),
           to_char(a.activity_date, 'Dy FMDD Mon') || ' · open the event to see why each one fits, then invite and record the reply.',
           './index.html', p_activity, 'event_invite:' || p_activity, now()
      from public.event_invites i
     where i.activity_id = p_activity and i.source = 'engine' and i.grp in ('strong', 'potential') and i.agent_id is not null
     group by i.agent_id
    on conflict (user_id, dedupe_key) do nothing;

    return jsonb_build_object('ok', true, 'added', v_new) || v_sum;
end $$;
revoke execute on function public.event_invite_refresh(bigint, boolean) from public, anon;
grant execute on function public.event_invite_refresh(bigint, boolean) to authenticated;

-- ── 8. Read the list (agent: own · upline: team · L1–2: all · others: counts) ─
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
               'attended', i.attended, 'no_show', i.no_show)
             order by (i.agent_id = v_me) desc, u.full_name, (i.grp = 'review'), i.state = 'removed',
                      (i.grp = 'strong') desc, i.slot_rank nulls last, i.fit desc nulls last, i.id), '[]'::jsonb)
      into v_rows
      from public.event_invites i
      left join public.customers cu on cu.id = i.customer_id
      left join public.prospects pr on pr.id = i.prospect_id
      left join public.prospects pr2 on pr2.id = cu.converted_from_prospect_id
      left join public.users u on u.id = i.agent_id
     where i.activity_id = p_activity
       and (v_lvl <= 2 or i.agent_id in (select public.current_user_visible_ids()) or i.added_by = v_me)
       -- an agent sees their own names; "needs a look" rows are for the upline
       and not (i.grp = 'review' and i.agent_id = v_me and v_lvl > 5);
    -- counts per agent: everyone may see these (no customer names)
    select coalesce(jsonb_agg(z order by z ->> 'agent_name'), '[]'::jsonb) into v_agents from (
        select jsonb_build_object('agent_id', i.agent_id, 'agent_name', coalesce(u.full_name, '—'),
                 'suggested', count(*) filter (where i.grp in ('strong', 'potential', 'manual') and i.state <> 'removed'),
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
revoke execute on function public.event_invite_list(bigint) from public, anon;
grant execute on function public.event_invite_list(bigint) to authenticated;

-- ── 9. Set what an event is for (topic-level; every session uses it) ────────
create or replace function public.event_invite_set_objectives(p_event bigint, p_objs jsonb, p_slots int default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_me bigint := public.current_user_row_id(); v_clean jsonb := '[]'::jsonb; o jsonb; s record; v_n int := 0;
begin
    if v_me is null or coalesce(public.current_user_level(), 99) > 12 then
        raise exception 'Not permitted' using errcode = '42501';
    end if;
    if jsonb_typeof(p_objs) <> 'array' then raise exception 'Objectives must be a list'; end if;
    for o in select * from jsonb_array_elements(p_objs) loop
        continue when not exists (select 1 from public.invite_lines l where l.key = o ->> 'line' and l.active);
        continue when (o ->> 'goal') not in ('introduce', 'decide', 'upgrade', 'service', 'comeback');
        v_clean := v_clean || jsonb_build_array(jsonb_build_object(
            'line', o ->> 'line', 'goal', o ->> 'goal',
            'focus', coalesce((select jsonb_agg(distinct pr.id) from public.products pr
                                where pr.id in (select (jsonb_array_elements_text(case when jsonb_typeof(o -> 'focus') = 'array' then o -> 'focus' else '[]'::jsonb end))::bigint)),
                              '[]'::jsonb)));
        v_n := v_n + 1;
        exit when v_n = 2;
    end loop;
    update public.events set invite_objectives = case when v_n = 0 then null else v_clean end,
           invite_slots = case when p_slots between 1 and 20 then p_slots else invite_slots end, updated_at = now()
     where id = p_event;
    if not found then raise exception 'Event not found'; end if;
    insert into public.audit_trail (actor_auth_id, actor_user_id, actor_role_level, category, action, target_table, target_id, detail)
    values (auth.uid(), v_me, public.current_user_level(), 'event_invite', 'set_objectives', 'events', p_event::text,
            jsonb_build_object('objectives', v_clean, 'slots', p_slots));
    -- every upcoming session of this topic gets its list now
    for s in select id from public.activities where event_id = p_event and activity_type = 'EVENT'
               and activity_date >= public.journey_today() order by activity_date limit 10 loop
        perform public.event_invite_refresh(s.id, true);
    end loop;
    return jsonb_build_object('ok', true, 'objectives', v_clean);
end $$;
revoke execute on function public.event_invite_set_objectives(bigint, jsonb, int) from public, anon;
grant execute on function public.event_invite_set_objectives(bigint, jsonb, int) to authenticated;

-- ── 10. Act on a name: prepared / sent / reply / remove / undo ──────────────
create or replace function public.event_invite_act(p_id bigint, p_action text, p_data jsonb default '{}')
returns jsonb language plpgsql security definer set search_path = public as $$
declare i public.event_invites%rowtype; v_me bigint := public.current_user_row_id(); s record; v_reason text; v_name text;
        v_kind text; v_eid bigint; v_att bigint; v_channel text;
begin
    select * into i from public.event_invites where id = p_id for update;
    if i.id is null then raise exception 'Invite not found'; end if;
    if v_me is null or not public.inv_can_act(i.agent_id, i.added_by) then
        raise exception 'Not permitted' using errcode = '42501';
    end if;
    v_channel := nullif(p_data ->> 'channel', '');
    if v_channel is not null and v_channel not in ('whatsapp', 'call', 'in_person') then v_channel := null; end if;

    if p_action = 'prepared' then
        update public.event_invites set prepared_at = now(), channel = coalesce(v_channel, channel, 'whatsapp'), updated_at = now() where id = p_id;

    elsif p_action = 'sent' then
        update public.event_invites set state = 'sent', sent_at = coalesce(sent_at, now()), sent_by = v_me,
               channel = coalesce(v_channel, channel, 'whatsapp'), updated_at = now() where id = p_id;

    elsif p_action = 'reply' then
        if (p_data ->> 'reply') = 'coming' then
            select s2.id, s2.event_id into s from public.activities s2 where s2.id = i.activity_id;
            v_kind := case when i.customer_id is not null then 'customer' else 'prospect' end;
            v_eid := coalesce(i.customer_id, i.prospect_id);
            select coalesce((select full_name from public.customers where id = i.customer_id),
                            (select full_name from public.prospects where id = i.prospect_id)) into v_name;
            select ea.id into v_att from public.event_attendees ea
             where ea.activity_id = s.id and public.inv_person_key(ea.attendee_type, coalesce(ea.entity_id, ea.attendee_id)) = i.person_key limit 1;
            if v_att is null then
                v_att := (extract(epoch from clock_timestamp()) * 1000000)::bigint;
                insert into public.event_attendees (id, event_id, activity_id, attendee_id, entity_id, entity_name, attendee_type,
                                                    attendance_status, added_by_agent_id, created_at)
                values (v_att, s.event_id, s.id, v_eid, v_eid, coalesce(v_name, ''), v_kind, 'Registered', v_me, now());
            end if;
            update public.event_invites set reply = 'coming', decline_reason = null, reply_note = nullif(p_data ->> 'note', ''),
                   replied_at = now(), replied_by = v_me, attendee_id = v_att,
                   state = 'sent', sent_at = coalesce(sent_at, now()), sent_by = coalesce(sent_by, v_me),
                   channel = coalesce(channel, v_channel, 'in_person'), updated_at = now()
             where id = p_id;
        elsif (p_data ->> 'reply') = 'declined' then
            v_reason := p_data ->> 'reason';
            if v_reason is null or v_reason not in ('no_time', 'away', 'not_interested', 'budget', 'has_it', 'stop', 'other') then
                raise exception 'Please pick a reason';
            end if;
            if v_reason = 'other' and nullif(btrim(coalesce(p_data ->> 'note', '')), '') is null then
                raise exception 'Please type the reason';
            end if;
            update public.event_invites set reply = 'declined', decline_reason = v_reason, reply_note = nullif(p_data ->> 'note', ''),
                   reinvite = case when v_reason = 'other' then coalesce((p_data ->> 'reinvite')::boolean, true) end,
                   replied_at = now(), replied_by = v_me,
                   state = 'sent', sent_at = coalesce(sent_at, now()), sent_by = coalesce(sent_by, v_me),
                   channel = coalesce(channel, v_channel, 'in_person'), updated_at = now()
             where id = p_id;
            if v_reason = 'stop' then
                update public.customers set do_not_invite = true where id = i.customer_id;
                update public.prospects set do_not_invite = true
                 where id = coalesce(i.prospect_id, (select converted_from_prospect_id from public.customers where id = i.customer_id));
            end if;
            insert into public.audit_trail (actor_auth_id, actor_user_id, actor_role_level, category, action, target_table, target_id, detail)
            values (auth.uid(), v_me, public.current_user_level(), 'event_invite', 'declined', 'event_invites', p_id::text,
                    jsonb_build_object('reason', v_reason, 'note', p_data ->> 'note', 'person', i.person_key, 'session', i.activity_id));
            perform public.event_invite_refresh(i.activity_id, true);   -- next best name fills the slot
        else
            raise exception 'Unknown reply';
        end if;

    elsif p_action = 'remove' then
        v_reason := p_data ->> 'reason';
        if v_reason is null or v_reason not in ('not_fit', 'handled', 'wrong_objective', 'missing_info', 'other') then
            raise exception 'Please pick a reason';
        end if;
        if v_reason = 'other' and nullif(btrim(coalesce(p_data ->> 'note', '')), '') is null then
            raise exception 'Please type the reason';
        end if;
        update public.event_invites set state = 'removed', removed_reason = v_reason, removed_note = nullif(p_data ->> 'note', ''),
               removed_by = v_me, removed_at = now(), updated_at = now() where id = p_id;
        insert into public.audit_trail (actor_auth_id, actor_user_id, actor_role_level, category, action, target_table, target_id, detail)
        values (auth.uid(), v_me, public.current_user_level(), 'event_invite', 'not_suitable', 'event_invites', p_id::text,
                jsonb_build_object('reason', v_reason, 'note', p_data ->> 'note', 'person', i.person_key, 'session', i.activity_id));
        perform public.event_invite_refresh(i.activity_id, true);

    elsif p_action = 'undo' then
        update public.event_invites set
               state = case when state = 'removed' then case when sent_at is not null then 'sent' else 'suggested' end else state end,
               removed_reason = null, removed_note = null, removed_by = null, removed_at = null,
               reply = case when reply = 'declined' then null else reply end,
               decline_reason = case when reply = 'declined' then null else decline_reason end,
               reply_note = case when reply = 'declined' then null else reply_note end,
               updated_at = now()
         where id = p_id;
        insert into public.audit_trail (actor_auth_id, actor_user_id, actor_role_level, category, action, target_table, target_id, detail)
        values (auth.uid(), v_me, public.current_user_level(), 'event_invite', 'undo', 'event_invites', p_id::text,
                jsonb_build_object('person', i.person_key, 'session', i.activity_id));
    else
        raise exception 'Unknown action';
    end if;
    return jsonb_build_object('ok', true);
end $$;
revoke execute on function public.event_invite_act(bigint, text, jsonb) from public, anon;
grant execute on function public.event_invite_act(bigint, text, jsonb) to authenticated;

-- ── 11. Add someone the list missed ─────────────────────────────────────────
create or replace function public.event_invite_add(p_activity bigint, p_prospect bigint default null, p_customer bigint default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_me bigint := public.current_user_row_id(); v_key text; a record; e record; v_agent bigint; v_id bigint;
        v_obj text; v_fit int; v_eng int; v_rdy int; v_rsn jsonb; v_wrn jsonb;
begin
    if v_me is null then raise exception 'Not permitted' using errcode = '42501'; end if;
    if p_customer is not null then
        if not (public.customer_is_visible(p_customer) or coalesce(public.current_user_level(), 99) <= 2) then
            raise exception 'Not permitted' using errcode = '42501'; end if;
        v_key := 'c:' || p_customer;
        select responsible_agent_id into v_agent from public.customers where id = p_customer;
    elsif p_prospect is not null then
        if not public.prospect_is_visible(p_prospect) then raise exception 'Not permitted' using errcode = '42501'; end if;
        v_key := public.inv_person_key('prospect', p_prospect);
        if v_key like 'c:%' then
            p_customer := substr(v_key, 3)::bigint; p_prospect := null;
            select responsible_agent_id into v_agent from public.customers where id = p_customer;
        else
            select responsible_agent_id into v_agent from public.prospects where id = p_prospect;
        end if;
    else
        raise exception 'Pick a person';
    end if;
    select s.id, s.event_id into a from public.activities s where s.id = p_activity and s.activity_type = 'EVENT';
    if a.id is null then raise exception 'Not an event'; end if;
    select invite_objectives into e from public.events where id = a.event_id;
    if exists (select 1 from public.event_invites where activity_id = p_activity and person_key = v_key) then
        update public.event_invites set state = case when state = 'removed' then 'suggested' else state end,
               removed_reason = null, removed_at = null, updated_at = now()
         where activity_id = p_activity and person_key = v_key returning id into v_id;
        return jsonb_build_object('ok', true, 'id', v_id, 'existing', true);
    end if;
    if e.invite_objectives is not null then
        select x.objective, x.fit, x.engagement, x.readiness, x.reasons, x.warnings into v_obj, v_fit, v_eng, v_rdy, v_rsn, v_wrn
          from public.inv_compute(e.invite_objectives, p_activity, v_key) x limit 1;
    end if;
    insert into public.event_invites (activity_id, event_id, person_key, prospect_id, customer_id, agent_id, objectives, objective,
                                      grp, fit, engagement, readiness, reasons, warnings, source, added_by)
    values (p_activity, a.event_id, v_key, p_prospect, p_customer, coalesce(v_agent, v_me), public.inv_obj_keys(e.invite_objectives),
            v_obj, 'manual', v_fit, v_eng, v_rdy, coalesce(v_rsn, '[]'::jsonb), coalesce(v_wrn, '[]'::jsonb),
            'manual', v_me)
    returning id into v_id;
    insert into public.audit_trail (actor_auth_id, actor_user_id, actor_role_level, category, action, target_table, target_id, detail)
    values (auth.uid(), v_me, public.current_user_level(), 'event_invite', 'manual_add', 'event_invites', v_id::text,
            jsonb_build_object('person', v_key, 'session', p_activity));
    return jsonb_build_object('ok', true, 'id', v_id);
end $$;
revoke execute on function public.event_invite_add(bigint, bigint, bigint) from public, anon;
grant execute on function public.event_invite_add(bigint, bigint, bigint) to authenticated;

-- ── 11b. Event results (Reports → Name List): suggested → sent → came → closed
-- A sale counts only through event_attendees.closing_activity_id (a documented
-- link), never by date guessing. Scope: own / downline / L1–2.
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
                 'suggested', count(*), 'sent', count(*) filter (where r.sent_at is not null),
                 'replied', count(*) filter (where r.reply in ('coming', 'declined')),
                 'coming', count(*) filter (where r.reply = 'coming'), 'declined', count(*) filter (where r.reply = 'declined'),
                 'came', count(*) filter (where r.attended), 'no_show', count(*) filter (where r.no_show),
                 'closed', count(*) filter (where r.closed),
                 'reasons', coalesce((select jsonb_object_agg(q.k, q.n) from (select r2.decline_reason k, count(*) n from rows r2
                                       where r2.activity_id = r.activity_id and r2.reply = 'declined' group by r2.decline_reason) q), '{}'::jsonb),
                 'by_agent', (select jsonb_agg(jsonb_build_object('agent', coalesce(u.full_name, '—'), 'suggested', q.s, 'sent', q.t, 'coming', q.c, 'came', q.m) order by u.full_name)
                                from (select r3.agent_id, count(*) s, count(*) filter (where r3.sent_at is not null) t,
                                             count(*) filter (where r3.reply = 'coming') c, count(*) filter (where r3.attended) m
                                        from rows r3 where r3.activity_id = r.activity_id group by r3.agent_id) q
                                left join public.users u on u.id = q.agent_id)) z
          from rows r
         group by r.activity_id, r.activity_date, r.title, r.invite_objectives) x;
    return v_out;
end $$;
revoke execute on function public.event_invite_results(int) from public, anon;
grant execute on function public.event_invite_results(int) to authenticated;

-- ── 12. Smart list (Reports → Name List): same engine, no session ───────────
create or replace function public.invite_smart_list(p_line text, p_goal text, p_focus jsonb default '[]', p_limit int default 200)
returns table (person_key text, prospect_id bigint, customer_id bigint, name text, agent_id bigint, agent_name text,
               grp text, fit int, engagement int, readiness int, reasons jsonb, warnings jsonb, last_touch date, held text)
language plpgsql security definer set search_path = public as $$
declare v_lvl int := coalesce(public.current_user_level(), 99);
begin
    if public.current_user_row_id() is null then raise exception 'Not permitted' using errcode = '42501'; end if;
    return query
    select x.person_key, x.prospect_id, x.customer_id, x.name, x.agent_id, u.full_name, x.grp, x.fit, x.engagement, x.readiness,
           x.reasons, x.warnings, x.last_touch, coalesce(x.excl, x.review)
      from public.inv_compute(jsonb_build_array(jsonb_build_object('line', p_line, 'goal', p_goal, 'focus', coalesce(p_focus, '[]'::jsonb))), null, null) x
      left join public.users u on u.id = x.agent_id
     where (v_lvl <= 2 or x.agent_id in (select public.current_user_visible_ids()))
       and coalesce(x.excl, '') not in ('do_not_invite', 'unable_to_serve', 'grade_f')
     order by (x.grp = 'strong') desc, x.fit desc, x.engagement desc, x.person_key
     limit least(greatest(coalesce(p_limit, 200), 1), 500);
end $$;
revoke execute on function public.invite_smart_list(text, text, jsonb, int) from public, anon;
grant execute on function public.invite_smart_list(text, text, jsonb, int) to authenticated;

-- ── 13. Attendance → invites (registered / came / no-show) ──────────────────
create or replace function public.event_invite_attendee_trg() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_key text; r record;
begin
    if tg_op = 'DELETE' then
        update public.event_invites set reply = null, attendee_id = null, attended = null, no_show = null, updated_at = now()
         where attendee_id = old.id and reply = 'coming';
        return null;
    end if;
    if new.attendee_type not in ('prospect', 'customer') or new.activity_id is null then return null; end if;
    v_key := public.inv_person_key(new.attendee_type, coalesce(new.entity_id, new.attendee_id));
    update public.event_invites i set
           attendee_id = new.id,
           reply = case when i.reply is null or i.reply = 'no_reply' then 'coming' else i.reply end,
           replied_at = coalesce(i.replied_at, now()),
           attended = coalesce(new.attended, false) or new.attendance_status in ('Attended', 'Late'),
           no_show = new.attendance_status = 'No Show',
           updated_at = now()
     where i.activity_id = new.activity_id and i.person_key = v_key and i.state <> 'removed';
    return null;
exception when others then
    return null;
end $$;
drop trigger if exists trg_event_invite_attendee on public.event_attendees;
create trigger trg_event_invite_attendee after insert or update of attended, attendance_status or delete on public.event_attendees
    for each row execute function public.event_invite_attendee_trg();

-- ── 14. Daily: fill upcoming lists, remind, close past sessions, follow-ups ─
create or replace function public.event_invite_daily() returns jsonb
language plpgsql security definer set search_path = public as $$
declare s record; v_today date := public.journey_today(); v_n int := 0; v_tasks int := 0; rw record;
begin
    -- upcoming sessions whose topic has objectives (next 30 days)
    for s in select a.id from public.activities a join public.events e on e.id = a.event_id
              where a.activity_type = 'EVENT' and a.activity_date between v_today and v_today + 30
                and e.invite_objectives is not null and jsonb_array_length(e.invite_objectives) > 0 loop
        begin perform public.event_invite_refresh(s.id, true); v_n := v_n + 1;
        exception when others then null; end;
    end loop;

    -- 3 days before: remind agents who still have names not invited
    insert into public.notification_outbox (user_id, kind, priority, title, body, url, activity_id, dedupe_key, due_at)
    select i.agent_id, 'event_invite', 'normal',
           '🎯 ' || count(*) || ' still to invite for ' || coalesce(nullif(btrim(e.title), ''), a.activity_title, 'the event'),
           to_char(a.activity_date, 'Dy FMDD Mon') || ' · invite them today and record each reply.',
           './index.html', a.id, 'event_invite_remind:' || a.id, now()
      from public.event_invites i join public.activities a on a.id = i.activity_id
      left join public.events e on e.id = a.event_id
     where a.activity_date = v_today + 3 and i.state = 'suggested' and i.grp in ('strong', 'potential', 'manual') and i.agent_id is not null
     group by i.agent_id, a.id, a.activity_date, a.activity_title, e.title
    on conflict (user_id, dedupe_key) do nothing;

    -- the session is over: sent with no reply → "no reply"
    update public.event_invites i set reply = 'no_reply', updated_at = now()
      from public.activities a
     where a.id = i.activity_id and a.activity_date < v_today and i.sent_at is not null and i.reply is null and i.state <> 'removed';

    -- follow-ups (one task per person; skipped if the journey already made one)
    for rw in select ei.*, a.activity_date, coalesce(nullif(btrim(e.title), ''), a.activity_title, 'the event') ev_title
               from public.event_invites ei join public.activities a on a.id = ei.activity_id
               left join public.events e on e.id = a.event_id
              where a.activity_date between v_today - 7 and v_today - 1 and not ei.followup_done
                and ei.state <> 'removed' and (ei.attended or ei.no_show) loop
        if not exists (select 1 from public.journey_touchpoints t
                        where t.status in ('pending', 'overdue', 'snoozed')
                          and ((rw.customer_id is not null and t.customer_id = rw.customer_id) or (rw.prospect_id is not null and t.prospect_id = rw.prospect_id))
                          and t.created_at >= rw.activity_date and t.stage_name like 'post%') then
            insert into public.journey_touchpoints (prospect_id, customer_id, stage_name, track, touchpoint_type, title, due_date, priority,
                                                    status, assigned_to, assigned_to_id, follow_mode, auto_created, source_kind, source_invite_id)
            values (rw.prospect_id, rw.customer_id, case when rw.attended then 'event_followup' else 'event_noshow' end, 'active', 'task',
                    left(case when rw.attended then '🎯 Follow up after ' || rw.ev_title || ' — what did they like? book the next step'
                              else '🎯 Missed ' || rw.ev_title || ' — ask why, offer the next date' end, 200),
                    v_today + case when rw.attended then 1 else 0 end, case when rw.attended then 'high' else 'normal' end, 'pending',
                    public.task_agent_uuid(rw.agent_id), rw.agent_id, 'active', true, 'event_invite', rw.id);
            v_tasks := v_tasks + 1;
        end if;
        update public.event_invites set followup_done = true, updated_at = now() where id = rw.id;
    end loop;
    return jsonb_build_object('refreshed', v_n, 'tasks', v_tasks);
end $$;
revoke execute on function public.event_invite_daily() from public, anon, authenticated;

do $$ begin
    perform cron.unschedule('event-invite-daily') where exists (select 1 from cron.job where jobname = 'event-invite-daily');
    perform cron.schedule('event-invite-daily', '20 0 * * *', 'select public.event_invite_daily()');
end $$;

-- ── 15. Old automatic event-invite drafts are retired (owner OK). Six of their
--      templates had their Chinese text saved as '???' and could never match;
--      switch those six off (the browser dispatchers are switched off in code).
update public.follow_up_templates set is_active = false
 where trigger_type in ('cps_fengshui_plan', 'cps_power_ring', 'cps_painting', 'cps_agent_package', 'cps_bujishu', 'cps_formula')
   and event_keywords like '%???%';
