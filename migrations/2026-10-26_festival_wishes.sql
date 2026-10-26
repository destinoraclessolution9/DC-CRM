-- Festival-day wishes (2026-10-26, owner): on 立春 and 冬至 every agent gets
-- a morning push ("🌱 立春 today — 48 people to wish") and a Home list of
-- their customers + active prospects, each with the WhatsApp message ready.
-- Nothing is sent by the CRM itself; the agent taps, WhatsApp opens, the row
-- ticks. Birthdays are untouched (they already have their own push + Send Wish).
--
-- Wording: journey_templates 139 (立春) / 141 (冬至) — {name} = full name.
-- Flying stars change yearly: the owner's text for a year goes into
-- festival_days.extra_message of that year's 立春 row and is added below the
-- greeting. Dates: sun at 315° (立春) / 270° (冬至), Malaysia time; 立春
-- matches the house Li Chun table used for Ming Gua.

create table if not exists public.festival_days (
    day            date primary key,
    kind           text not null check (kind in ('lichun', 'dongzhi')),
    label          text not null,
    extra_message  text
);
alter table public.festival_days enable row level security;
drop policy if exists festival_days_read on public.festival_days;
create policy festival_days_read on public.festival_days for select to authenticated using (true);

insert into public.festival_days (day, kind, label) values
    ('2026-12-22', 'dongzhi', '冬至'),
    ('2027-02-04', 'lichun', '立春'), ('2027-12-22', 'dongzhi', '冬至'),
    ('2028-02-04', 'lichun', '立春'), ('2028-12-21', 'dongzhi', '冬至'),
    ('2029-02-03', 'lichun', '立春'), ('2029-12-21', 'dongzhi', '冬至'),
    ('2030-02-04', 'lichun', '立春'), ('2030-12-22', 'dongzhi', '冬至'),
    ('2031-02-04', 'lichun', '立春'), ('2031-12-22', 'dongzhi', '冬至'),
    ('2032-02-04', 'lichun', '立春'), ('2032-12-21', 'dongzhi', '冬至'),
    ('2033-02-03', 'lichun', '立春'), ('2033-12-21', 'dongzhi', '冬至'),
    ('2034-02-04', 'lichun', '立春'), ('2034-12-22', 'dongzhi', '冬至'),
    ('2035-02-04', 'lichun', '立春'), ('2035-12-22', 'dongzhi', '冬至'),
    ('2036-02-04', 'lichun', '立春'), ('2036-12-21', 'dongzhi', '冬至'),
    ('2037-02-03', 'lichun', '立春'), ('2037-12-21', 'dongzhi', '冬至'),
    ('2038-02-04', 'lichun', '立春'), ('2038-12-22', 'dongzhi', '冬至'),
    ('2039-02-04', 'lichun', '立春'), ('2039-12-22', 'dongzhi', '冬至'),
    ('2040-02-04', 'lichun', '立春'), ('2040-12-21', 'dongzhi', '冬至')
on conflict (day) do nothing;

-- Who was wished (one row per person per festival day).
create table if not exists public.festival_wishes (
    id           bigserial primary key,
    festival_day date not null references public.festival_days(day) on delete cascade,
    prospect_id  bigint,
    customer_id  bigint,
    sent_by      bigint,
    sent_at      timestamptz not null default now(),
    check ((prospect_id is null) <> (customer_id is null))
);
create unique index if not exists festival_wishes_once
    on public.festival_wishes (festival_day, coalesce(prospect_id, 0), coalesce(customer_id, 0));
alter table public.festival_wishes enable row level security;
-- Read/write only through the SECURITY DEFINER functions below.

-- The festival whose list is open on p_day: the day itself and 3 catch-up days.
create or replace function public.festival_current(p_day date)
returns public.festival_days
language sql stable security definer set search_path = public as $$
    select f.* from public.festival_days f
     where f.day <= p_day and f.day >= p_day - 3
     order by f.day desc limit 1
$$;

-- An agent's people for a festival: their customers + prospects that are not
-- converted (status active or blank), with a phone number.
create or replace function public.festival_people_for(p_uid bigint, p_day date)
returns table (prospect_id bigint, customer_id bigint, name text, phone text, sent boolean)
language sql stable security definer set search_path = public as $$
    select null::bigint, c.id, c.full_name, c.phone,
           exists (select 1 from public.festival_wishes w where w.festival_day = p_day and w.customer_id = c.id)
      from public.customers c
     where c.responsible_agent_id = p_uid
       and coalesce(c.status, 'active') !~* 'inactive|deleted|deceased'
       and nullif(trim(c.phone), '') is not null
    union all
    select p.id, null::bigint, p.full_name, p.phone,
           exists (select 1 from public.festival_wishes w where w.festival_day = p_day and w.prospect_id = p.id)
      from public.prospects p
     where p.responsible_agent_id = p_uid
       and coalesce(nullif(trim(p.status), ''), 'active') = 'active'
       and nullif(trim(p.phone), '') is not null
$$;

-- Home list for the signed-in agent. Empty outside a festival window.
create or replace function public.festival_wish_list(p_day date default null)
returns table (festival_day date, label text, message text, prospect_id bigint, customer_id bigint,
               name text, phone text, sent boolean)
language plpgsql stable security definer set search_path = public as $$
declare
    v_day date := coalesce(p_day, public.journey_today());
    v_f public.festival_days;
    v_msg text;
begin
    v_f := public.festival_current(v_day);
    if v_f.day is null then return; end if;
    select t.message_template into v_msg from public.journey_templates t
     where t.id = case v_f.kind when 'lichun' then 139 else 141 end;
    v_msg := coalesce(v_msg, '') || coalesce(E'\n\n' || nullif(trim(v_f.extra_message), ''), '');
    return query
        select v_f.day, v_f.label, v_msg, x.prospect_id, x.customer_id, x.name, x.phone, x.sent
          from public.festival_people_for(public.current_user_row_id(), v_f.day) x
         where nullif(trim(x.phone), '') is not null
         order by x.sent, (x.customer_id is null), x.name;
end $$;

-- Tick a person as wished. Only the agent responsible for them.
create or replace function public.festival_wish_mark(p_day date, p_prospect_id bigint, p_customer_id bigint)
returns boolean
language plpgsql security definer set search_path = public as $$
declare v_uid bigint := public.current_user_row_id();
begin
    if v_uid is null or not exists (select 1 from public.festival_days where day = p_day) then return false; end if;
    if p_customer_id is not null then
        if not exists (select 1 from public.customers where id = p_customer_id and responsible_agent_id = v_uid) then return false; end if;
    elsif p_prospect_id is not null then
        if not exists (select 1 from public.prospects where id = p_prospect_id and responsible_agent_id = v_uid) then return false; end if;
    else
        return false;
    end if;
    insert into public.festival_wishes (festival_day, prospect_id, customer_id, sent_by)
    values (p_day, case when p_customer_id is null then p_prospect_id end, p_customer_id, v_uid)
    on conflict do nothing;
    return true;
end $$;

revoke all on function public.festival_people_for(bigint, date) from public, anon, authenticated;
revoke all on function public.festival_current(date) from public, anon;
grant execute on function public.festival_wish_list(date) to authenticated;
grant execute on function public.festival_wish_mark(date, bigint, bigint) to authenticated;

-- Morning push on the festival day itself (08:35 MYT, after the 📋 top-5 push).
create or replace function public.queue_festival_push()
returns integer
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_today date := public.journey_today(); v_f public.festival_days; v_n int;
begin
    select * into v_f from public.festival_days where day = v_today;
    if v_f.day is null then return 0; end if;
    insert into public.notification_outbox (user_id, kind, priority, title, body, url, dedupe_key, due_at)
    select u.id, 'festival', 'normal',
           case v_f.kind when 'lichun' then '🌱 ' else '🌙 ' end || v_f.label || ' today — ' || x.n
               || case when x.n = 1 then ' person' else ' people' end || ' to wish',
           left('Open Home: the ' || v_f.label || ' list has the WhatsApp message ready for each of your customers and prospects.', 220),
           './index.html', 'festival:' || v_f.day, now()
      from public.users u
      cross join lateral (select count(*) n from public.festival_people_for(u.id, v_f.day) p) x
     where x.n > 0
       and coalesce(u.status, 'active') !~* 'inactive|deleted|resign|terminat'
    on conflict (user_id, dedupe_key) do nothing;
    get diagnostics v_n = row_count;
    return v_n;
end $$;
revoke all on function public.queue_festival_push() from public, anon, authenticated;

select cron.unschedule('festival-wishes-push') where exists (select 1 from cron.job where jobname = 'festival-wishes-push');
select cron.schedule('festival-wishes-push', '35 0 * * *', 'select public.queue_festival_push()');
