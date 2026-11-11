-- 📋 Today's top 5 that moves (owner 2026-11-11: "why this list never get updated?")
--
-- The list was live, but the same 4 people sat on top of agent 1775637005921's
-- list every day from 21 Oct: Commit/Audit/Hot "nothing booked" rows and
-- "Collect" rows had no way off except doing the real thing, the score was
-- linear in RM (one RM168k audit beat every overdue call), and ignored rows
-- climbed. This migration:
--   1. ⏰ Later (back in 7 days) / ✕ Not now (30 days) on every row — per agent,
--      table todo_snoozes, RPCs journey_todo_hide / journey_todo_unhide.
--   2. Fairer ranking: the money part of the score stops at RM30k.
--   3. Fatigue: a row in your morning top 5 on 3+ of the last 7 days scores
--      ×0.5 per extra day, so others come up; it returns once it has rested.
--      History = todo_shown, written by the 08:30 push (queue_daily_todo_push),
--      backfilled from the last week's pushes so it works from day one.
--   4. "met 8 Jul" only for a real meeting; a call reads "last contact 8 Jul".
--   5. Leaders still see every row (journey_todo_list / journey_todo_counts),
--      with "hidden till …" on the ones the agent put away.
--
-- journey_todo_for keeps its signature (journey_daily_todo, the morning push,
-- queue_cps_no_next_push and the counts all call it). UNDO:
-- 2026-11-11_top5_later_UNDO.sql.
begin;

-- ── tables (no policies: only the SECURITY DEFINER functions below touch them) ──
create table if not exists public.todo_snoozes (
    user_id     bigint      not null,
    row_key     text        not null,
    kind        text        not null,
    prospect_id bigint,
    customer_id bigint,
    ref_id      bigint,
    action      text        not null check (action in ('later', 'not_now')),
    until       date        not null,
    created_at  timestamptz not null default now(),
    primary key (user_id, row_key)
);
alter table public.todo_snoozes enable row level security;
revoke all on table public.todo_snoozes from public, anon, authenticated;

create table if not exists public.todo_shown (
    user_id bigint not null,
    day     date   not null,
    row_key text   not null,
    primary key (user_id, day, row_key)
);
alter table public.todo_shown enable row level security;
revoke all on table public.todo_shown from public, anon, authenticated;

-- One row's identity: kind + customer + prospect + the thing it points at.
create or replace function public.journey_todo_key(p_kind text, p_pid bigint, p_cid bigint, p_ref bigint)
 returns text language sql immutable set search_path to 'public'
as $function$
    select coalesce(p_kind, '') || ':' || coalesce(p_cid::text, '-') || ':' || coalesce(p_pid::text, '-') || ':' || coalesce(p_ref::text, '-')
$function$;
revoke all on function public.journey_todo_key(text, bigint, bigint, bigint) from public, anon;

-- ── the list itself ──────────────────────────────────────────────────────────
-- p_agent_view = true  → what the agent sees: hidden rows left out, fatigue on.
-- p_agent_view = false → what a leader sees: every row, plain score, hidden_until set.
create or replace function public.journey_todo_rows(p_uid bigint, p_limit integer default 5, p_agent_view boolean default true)
 returns table(kind text, icon text, prospect_id bigint, customer_id bigint, name text, why text, rm numeric, due date,
               score numeric, ref_id bigint, row_key text, hidden_until date, hidden_action text, shown_days integer)
 language sql stable security definer set search_path to 'public'
as $function$
with t as (select public.journey_today() d),
c as (   -- ① collections: ready ≤ 7 days, not handed over
    select 'collect'::text kind, '📦'::text icon, cu.converted_from_prospect_id pid, cu.id cid, cu.full_name nm,
           case when di.expected_ready_date < t.d then 'Collect ' || left(di.item_name, 30) || ' · ready since ' || to_char(di.expected_ready_date, 'FMDD Mon')
                else 'Ready ' || to_char(di.expected_ready_date, 'FMDD Mon') || ' · book the collection + photo' end why,
           coalesce(pu.amount, 10000)::numeric rm, di.expected_ready_date due,
           greatest(coalesce(pu.amount, 10000), 3000)::numeric money,
           (case when di.expected_ready_date < t.d then 3 else 2 end
             * (1 + least(greatest(t.d - di.expected_ready_date, 0), 30) / 30.0))::numeric urg,
           di.purchase_id ref
      from public.delivery_items di cross join t
      join public.customers cu on cu.id = di.customer_id
      left join public.purchases pu on pu.id = di.purchase_id
     where di.status = 'pending' and di.expected_ready_date <= t.d + 7
       and di.expected_ready_date >= t.d - 120
       and coalesce(pu.agent_id, cu.responsible_agent_id) = p_uid
),
g as (   -- ② Golden Road session due
    select 'gr', '🟣', coalesce(tp.prospect_id, cu.converted_from_prospect_id), tp.customer_id, coalesce(cu.full_name, pr.full_name),
           'Golden Road ' || tp.seq || '/' || tp.seq_total || case when tp.due_date < t.d then ' · overdue' else ' · due ' || to_char(tp.due_date, 'FMDD Mon') end,
           coalesce(pu.amount, 10000), tp.due_date,
           greatest(coalesce(pu.amount, 10000), 3000),
           2 * (1 + least(greatest(t.d - tp.due_date, 0), 30) / 30.0),
           tp.purchase_id
      from public.journey_touchpoints tp cross join t
      left join public.customers cu on cu.id = tp.customer_id
      left join public.prospects pr on pr.id = tp.prospect_id
      left join public.purchases pu on pu.id = tp.purchase_id
     where tp.status = 'pending' and tp.seq is not null and tp.assigned_to_id = p_uid and tp.due_date <= t.d + 3
       and coalesce(tp.snooze_until, t.d) <= t.d
),
cps as ( -- ③ CPS with no 2nd meeting (A)
    select 'cps', '🆕', p.id, null::bigint, p.full_name,
           'CPS ' || to_char(x.d, 'FMDD Mon') || ' · no 2nd meeting booked',
           coalesce(nullif(p.open_potential_rm, 0), 5000), x.d,
           greatest(coalesce(p.open_potential_rm, 0), 5000),
           1.5 * case when t.d - x.d <= 14 then 1.2 else 0.8 end,
           null::bigint
      from public.prospects p cross join t
      cross join lateral (select max(a.activity_date) d from public.activities a where a.prospect_id = p.id and a.activity_type = 'CPS') x
     where p.responsible_agent_id = p_uid and x.d between t.d - 30 and t.d - 1
       and coalesce(p.status, '') not in ('converted', 'lost') and not coalesce(p.unable_to_serve, false)
       and coalesce(p.manual_grade, '') <> 'F' and coalesce(p.cps_next_step, '') <> 'not_interested'
       -- the CPS must have its minutes first (an empty one is the "minutes" row below)
       and exists (select 1 from public.activities a where a.prospect_id = p.id and a.activity_type = 'CPS'
                     and a.activity_date = x.d and public.activity_has_minutes(a))
       and not exists (select 1 from public.activities a where a.prospect_id = p.id and a.activity_date > x.d
                         and a.activity_type in ('CPS', 'FTF', 'FSA', 'SITE', 'GR', 'EVENT', 'EVENT_CLOSING'))
       and not exists (select 1 from public.event_attendees ea where ea.attendee_type = 'prospect' and ea.entity_id = p.id
                         and ea.created_at::date >= x.d)
),
hot as ( -- ④ Commit / Audit / Hot with nothing booked
    select 'book', case p.potential_tier when 'commit' then '🟢' when 'audit' then '🩺' else '🔥' end, p.id, null::bigint, p.full_name,
           initcap(p.potential_tier) || ' · RM' || round(p.open_potential_rm / 1000) || 'k · nothing booked'
             || coalesce(case when lm.met then ' · met ' else ' · last contact ' end || to_char(p.potential_last_met, 'FMDD Mon'), ''),
           p.open_potential_rm, p.potential_last_met,
           p.open_potential_rm,
           case p.potential_tier when 'commit' then 3 when 'audit' then 2 else 1.5 end
             * (1 + least(coalesce(t.d - p.potential_last_met, 60), 60) / 60.0),
           null::bigint
      from public.prospects p cross join t
      -- potential_last_met counts calls too: say "met" only for a real meeting
      cross join lateral (select p.potential_last_met is not null and (
               exists (select 1 from public.activities a
                        where a.prospect_id = p.id and a.activity_date::date = p.potential_last_met
                          and a.activity_type in ('CPS', 'FTF', 'FSA', 'SITE', 'EVENT', 'EVENT_CLOSING', 'AGENT_MEETING', 'GR'))
            or exists (select 1 from public.customers c2 join public.activities a on a.customer_id = c2.id
                        where c2.converted_from_prospect_id = p.id and a.activity_date::date = p.potential_last_met
                          and a.activity_type in ('CPS', 'FTF', 'FSA', 'SITE', 'EVENT', 'EVENT_CLOSING', 'AGENT_MEETING', 'GR'))
            or exists (select 1 from public.event_attendees ea join public.events e on e.id = ea.event_id
                        where ea.attendee_type = 'prospect' and ea.entity_id = p.id
                          and (ea.attended or ea.attendance_status = 'Attended')
                          and nullif(e.date::text, '')::date = p.potential_last_met)) met) lm
     where p.responsible_agent_id = p_uid and p.potential_tier in ('commit', 'audit', 'hot')
       and p.potential_next_booked is null and p.open_potential_rm > 0
),
tp as (  -- ⑤ any other journey step due today or overdue
    select 'touch', '🧭', coalesce(j.prospect_id, cu.converted_from_prospect_id), j.customer_id, coalesce(cu.full_name, pr.full_name),
           regexp_replace(j.title, '^\S+\s+', '') || case when j.due_date < t.d then ' · overdue' else '' end,
           coalesce(nullif(pr.open_potential_rm, 0), 3000), j.due_date,
           greatest(coalesce(pr.open_potential_rm, 0), 3000),
           case when j.priority = 'high' then 1.2 else 1 end * (1 + least(greatest(t.d - j.due_date, 0), 30) / 30.0),
           j.id
      from public.journey_touchpoints j cross join t
      left join public.customers cu on cu.id = j.customer_id
      left join public.prospects pr on pr.id = j.prospect_id
     where j.status = 'pending' and j.seq is null and j.assigned_to_id = p_uid and j.due_date <= t.d
       and j.due_date >= t.d - 60 and coalesce(j.snooze_until, t.d) <= t.d
),
pop as ( -- ⑥ POP charge lapsed → collect the manual bank-in receipt
    select 'pop', '💳', cu.converted_from_prospect_id, cu.id, cu.full_name,
           'POP lapsed · ' || to_char(i.due_date, 'FMMon') || ' RM' || round(i.amount) || ' — collect the bank-in receipt',
           i.amount, i.due_date,
           greatest(x.left_rm, 3000),
           2.5 * (1 + least(greatest(t.d - coalesce(i.lapsed_at, i.due_date), 0), 60) / 60.0),
           i.purchase_id
      from public.pop_installments i cross join t
      join public.customers cu on cu.id = i.customer_id
      cross join lateral (select coalesce(sum(j.amount) filter (where j.status in ('due', 'lapsed')), 0) left_rm
                            from public.pop_installments j where j.purchase_id = i.purchase_id) x
     where i.agent_id = p_uid and i.status = 'lapsed'
),
adv as ( -- ⑦ my own stock lent to a customer: office piece due → collect it back
    select 'advance', '↩', cu.converted_from_prospect_id, cu.id, cu.full_name,
           'Collect your ' || left(a.item_name, 24) || ' back · lent ' || to_char(a.given_date, 'FMDD Mon')
             || case when a.expected_back < t.d then ' · ' || (t.d - a.expected_back) || ' days late' else ' · office piece due' end,
           coalesce(pu.amount, 5000), a.expected_back,
           greatest(coalesce(pu.amount, 5000), 3000),
           1.5 * (1 + least(greatest(t.d - a.expected_back, 0), 60) / 60.0),
           a.id
      from public.delivery_advances a cross join t
      join public.customers cu on cu.id = a.customer_id
      left join public.delivery_items di on di.id = a.delivery_item_id
      left join public.purchases pu on pu.id = di.purchase_id
     where a.lender_agent_id = p_uid and a.status = 'owed' and a.expected_back <= t.d + 3
),
mins as ( -- ⓪ a CPS / FTF that already happened with no minutes yet (≤ 14 days)
    select 'minutes', '📝', a.prospect_id, null::bigint, pr.full_name,
           'Fill the ' || a.activity_type || ' minutes · ' || to_char(a.activity_date, 'FMDD Mon')
             || case when t.d - a.activity_date = 1 then ' (yesterday)' else ' (' || (t.d - a.activity_date) || ' days ago)' end,
           coalesce(nullif(pr.open_potential_rm, 0), 5000), a.activity_date,
           greatest(coalesce(pr.open_potential_rm, 0), 5000),
           2 * case when a.activity_type = 'CPS' then 1.2 else 1 end,
           a.id
      from public.activities a cross join t
      join public.prospects pr on pr.id = a.prospect_id
     where a.activity_type in ('CPS', 'FTF') and a.activity_date between t.d - 14 and t.d - 1
       and coalesce(a.lead_agent_id, pr.responsible_agent_id) = p_uid
       and coalesce(pr.status, '') not in ('converted', 'lost') and not coalesce(pr.unable_to_serve, false)
       and not public.activity_has_minutes(a)
       and not exists (select 1 from public.activities b where b.prospect_id = a.prospect_id and b.id <> a.id
                         and b.activity_date > a.activity_date and b.activity_date <= t.d
                         and b.activity_type in ('CPS', 'FTF', 'FSA', 'SITE', 'GR', 'EVENT_CLOSING'))
),
ofp as ( -- ⑧ a closing saved without its order-form photo (attach later — owner 2026-10-22)
    select 'photo', '📸', a.prospect_id, cu.id, coalesce(cu.full_name, pr.full_name),
           'Attach the order form photo · closed ' || to_char(a.activity_date, 'FMDD Mon'),
           coalesce(nullif(a.closing_amount, 0), 5000), a.activity_date,
           greatest(coalesce(a.closing_amount, 0), 5000),
           3 * (1 + least(greatest(t.d - a.activity_date, 0), 30) / 30.0),
           a.id
      from public.activities a cross join t
      join public.prospects pr on pr.id = a.prospect_id
      left join lateral (select c2.id, c2.full_name from public.customers c2
                          where c2.converted_from_prospect_id = a.prospect_id order by c2.id limit 1) cu on true
     where a.is_closing and coalesce(a.lead_agent_id, pr.responsible_agent_id) = p_uid
       -- owner 2026-10-22: every closing from 1 Jan 2026
       and a.activity_date >= date '2026-01-01' and a.activity_date <= t.d
       and not exists (select 1 from public.prospect_attachments pa
                        where pa.prospect_id = a.prospect_id and pa.attachment_type = 'order_form'
                          and pa.metadata->>'activity_id' = a.id::text)
       -- before 22 Oct photos were not tagged with their closing: any order-form
       -- photo or invoice on the prospect's closing record counts as attached
       and not (a.activity_date < date '2026-10-22' and (
                exists (select 1 from public.prospect_attachments pa
                         where pa.prospect_id = a.prospect_id and pa.attachment_type = 'order_form')
             or nullif(pr.closing_record->>'invoice_file', '') is not null
             or exists (select 1 from jsonb_array_elements(case when jsonb_typeof(pr.closing_records_history) = 'array'
                                                               then pr.closing_records_history else '[]'::jsonb end) h
                         where nullif(h->>'invoice_file', '') is not null)))
),
allx as (select * from c union all select * from mins union all select * from g union all select * from cps union all select * from hot
         union all select * from tp union all select * from pop union all select * from adv union all select * from ofp),
k as (select x.*, public.journey_todo_key(x.kind, x.pid, x.cid, x.ref) rk from allx x where x.nm is not null),
hid as ( -- rows I put away that are still away
    select z.row_key, z.until, z.action from public.todo_snoozes z cross join t
     where z.user_id = p_uid and z.until > t.d
),
seen as ( -- days each row was in my morning top 5 over the last week (today not counted)
    select h.row_key, count(*)::int n from public.todo_shown h cross join t
     where h.user_id = p_uid and h.day between t.d - 7 and t.d - 1
     group by h.row_key
),
scored as (
    select k.*, hid.until h_until, hid.action h_action, coalesce(seen.n, 0) n,
           -- money counts up to RM30k, then urgency decides; fatigue only in the agent's own view
           least(k.money, 30000) * k.urg
             * case when p_agent_view and coalesce(seen.n, 0) >= 3 then power(0.5, coalesce(seen.n, 0) - 2) else 1 end sc
      from k
      left join hid on hid.row_key = k.rk
      left join seen on seen.row_key = k.rk
     where not (p_agent_view and hid.row_key is not null)
),
best as (
    select distinct on (coalesce('c' || cid::text, 'p' || pid::text)) * from scored
     order by coalesce('c' || cid::text, 'p' || pid::text), sc desc
)
select kind, icon, pid, cid, nm, why, rm, due, round(sc), ref, rk, h_until, h_action, n
  from best order by sc desc, rk limit greatest(coalesce(p_limit, 5), 1)
$function$;
revoke all on function public.journey_todo_rows(bigint, integer, boolean) from public, anon, authenticated;

-- Same signature as before; now the agent's view of journey_todo_rows.
create or replace function public.journey_todo_for(p_uid bigint, p_limit integer DEFAULT 5)
 RETURNS TABLE(kind text, icon text, prospect_id bigint, customer_id bigint, name text, why text, rm numeric, due date, score numeric, ref_id bigint)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
    select r.kind, r.icon, r.prospect_id, r.customer_id, r.name, r.why, r.rm, r.due, r.score, r.ref_id
      from public.journey_todo_rows(p_uid, p_limit, true) r
     order by r.score desc, r.row_key
$function$;
revoke all on function public.journey_todo_for(bigint, integer) from public, anon, authenticated;

-- ── ⏰ Later / ✕ Not now ───────────────────────────────────────────────────────
-- Hides one row from the signed-in agent's own list (and their morning push).
create or replace function public.journey_todo_hide(p_kind text, p_prospect_id bigint, p_customer_id bigint, p_ref_id bigint,
                                                    p_action text default 'later', p_days integer default null)
 returns date language plpgsql security definer set search_path to 'public'
as $function$
declare
    v_uid bigint := public.current_user_row_id();
    v_action text := coalesce(p_action, 'later');
    v_until date;
begin
    if v_uid is null then raise exception 'not signed in' using errcode = '42501'; end if;
    if p_kind is null or p_kind not in ('collect', 'gr', 'cps', 'book', 'touch', 'pop', 'advance', 'minutes', 'photo') then
        raise exception 'unknown to-do kind: %', p_kind using errcode = '22023';
    end if;
    if v_action not in ('later', 'not_now') then raise exception 'unknown action: %', v_action using errcode = '22023'; end if;
    v_until := public.journey_today()
             + least(greatest(coalesce(p_days, case v_action when 'later' then 7 else 30 end), 1), 90);
    insert into public.todo_snoozes (user_id, row_key, kind, prospect_id, customer_id, ref_id, action, until)
    values (v_uid, public.journey_todo_key(p_kind, p_prospect_id, p_customer_id, p_ref_id),
            p_kind, p_prospect_id, p_customer_id, p_ref_id, v_action, v_until)
    on conflict (user_id, row_key) do update
        set action = excluded.action, until = excluded.until, created_at = now();
    return v_until;
end
$function$;
revoke all on function public.journey_todo_hide(text, bigint, bigint, bigint, text, integer) from public, anon;
grant execute on function public.journey_todo_hide(text, bigint, bigint, bigint, text, integer) to authenticated, service_role;

-- Undo: the row comes back now.
create or replace function public.journey_todo_unhide(p_kind text, p_prospect_id bigint, p_customer_id bigint, p_ref_id bigint)
 returns boolean language plpgsql security definer set search_path to 'public'
as $function$
declare v_uid bigint := public.current_user_row_id(); v_n int;
begin
    if v_uid is null then raise exception 'not signed in' using errcode = '42501'; end if;
    delete from public.todo_snoozes
     where user_id = v_uid and row_key = public.journey_todo_key(p_kind, p_prospect_id, p_customer_id, p_ref_id);
    get diagnostics v_n = row_count;
    return v_n > 0;
end
$function$;
revoke all on function public.journey_todo_unhide(text, bigint, bigint, bigint) from public, anon;
grant execute on function public.journey_todo_unhide(text, bigint, bigint, bigint) to authenticated, service_role;

-- ── leaders: every row, hidden ones marked ─────────────────────────────────────
drop function if exists public.journey_todo_list(bigint[], integer);
create function public.journey_todo_list(p_uids bigint[], p_limit integer DEFAULT 50)
 RETURNS TABLE(agent_id bigint, kind text, icon text, prospect_id bigint, customer_id bigint, name text, why text, rm numeric,
               due date, score numeric, ref_id bigint, hidden_until date, hidden_action text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
    select u.id, t.kind, t.icon, t.prospect_id, t.customer_id, t.name, t.why, t.rm, t.due, t.score, t.ref_id, t.hidden_until, t.hidden_action
      from unnest(p_uids) u(id)
      cross join lateral public.journey_todo_rows(u.id, greatest(coalesce(p_limit, 50), 1), false) t
     where u.id in (select public.pop_scope_ids())
     order by t.score desc
     limit greatest(coalesce(p_limit, 50), 1) * 2
$function$;
revoke all on function public.journey_todo_list(bigint[], integer) from public, anon;
grant execute on function public.journey_todo_list(bigint[], integer) to authenticated, service_role;

create or replace function public.journey_todo_counts(p_uids bigint[])
 RETURNS TABLE(agent_id bigint, todo_n integer, overdue_n integer, last_activity date)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
    with t as (select (now() at time zone 'Asia/Kuala_Lumpur')::date d),
    u as (select x.id from unnest(p_uids) x(id) where x.id in (select public.pop_scope_ids()))
    select u.id,
           (select count(*) from public.journey_todo_rows(u.id, 200, false))::int,
           (select count(*) from public.journey_todo_rows(u.id, 200, false) j cross join t
             where j.due < t.d and j.kind in ('collect', 'gr', 'touch', 'pop', 'advance', 'photo'))::int,
           (select max(a.activity_date) from public.activities a cross join t
             where a.lead_agent_id = u.id and a.activity_date <= t.d
               and a.activity_type not in ('PERSONAL', 'AGENT_MEETING'))
      from u
$function$;

-- ── 08:30 push: also remember what each agent was shown (fatigue history) ──────
create or replace function public.queue_daily_todo_push()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_today date := public.journey_today(); v_n int;
begin
    drop table if exists pg_temp._todo_today;
    create temp table _todo_today on commit drop as
    select u.id uid, r.kind, r.icon, r.name, r.why, r.score, r.row_key
      from public.users u
      cross join lateral public.journey_todo_rows(u.id, 5, true) r
     where u.role_level between 3 and 12
       and coalesce(u.status, 'active') !~* 'inactive|deleted|resign|terminat';

    insert into public.todo_shown (user_id, day, row_key)
    select uid, v_today, row_key from pg_temp._todo_today
    on conflict do nothing;
    delete from public.todo_shown where day < v_today - 30;
    delete from public.todo_snoozes where until < v_today - 30;

    insert into public.notification_outbox (user_id, kind, priority, title, body, url, dedupe_key, due_at)
    select x.uid, 'daily_todo', 'normal',
           '📋 Today''s top ' || x.n || ': ' || x.first_nm,
           left(x.body, 220), './index.html', 'daily_todo:' || v_today, now()
      from (select uid, count(*) n, (array_agg(name order by score desc, row_key))[1] first_nm,
                   string_agg(icon || ' ' || name || ' — ' || why, ' · ' order by score desc, row_key) body
              from pg_temp._todo_today group by uid) x
    on conflict (user_id, dedupe_key) do nothing;
    get diagnostics v_n = row_count;
    return v_n;
end $function$;

-- ── backfill: the last week's morning pushes → todo_shown, so fatigue starts now ──
insert into public.todo_shown (user_id, day, row_key)
select distinct u.id, (o.created_at at time zone 'Asia/Kuala_Lumpur')::date, r.row_key
  from public.users u
  cross join lateral public.journey_todo_rows(u.id, 30, false) r
  join public.notification_outbox o
    on o.user_id = u.id and o.kind = 'daily_todo'
   and o.created_at >= now() - interval '8 days'
   and (o.created_at at time zone 'Asia/Kuala_Lumpur')::date between public.journey_today() - 7 and public.journey_today() - 1
   and strpos(o.body, r.icon || ' ' || r.name || ' — ') > 0
 where u.role_level between 3 and 12
on conflict do nothing;

commit;
