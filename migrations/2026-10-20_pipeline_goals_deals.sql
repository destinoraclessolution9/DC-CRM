-- Pipeline v8 — Goal Bar + Deal records (2026-10-20)
-- Additive only: two new tables, scoped RLS, one AFTER INSERT trigger on purchases.
--
-- pipeline_goals: per-person monthly RM goal. scope='personal' (agent RM100k
--   default) or 'team' (team leader RM500k default). Missing row → client default.
-- pipeline_deals: a real deal = prospect + product + RM + expected close + stage
--   + source. Many deals per prospect. Auto-marked WON when a sale is recorded.

create table if not exists public.pipeline_goals (
    id            bigint generated always as identity primary key,
    user_id       bigint not null references public.users(id) on delete cascade,
    month         text   not null check (month ~ '^[0-9]{4}-[0-9]{2}$'),
    scope         text   not null default 'personal' check (scope in ('personal','team')),
    target_amount numeric not null check (target_amount >= 0),
    updated_by    bigint,
    updated_at    timestamptz not null default now(),
    unique (user_id, month, scope)
);

create table if not exists public.pipeline_deals (
    id                  bigint generated always as identity primary key,
    prospect_id         bigint not null,
    agent_id            bigint not null references public.users(id),
    product             text   not null,
    product_id          bigint,
    amount              numeric not null default 0 check (amount >= 0),
    expected_close_date date   not null,
    stage               text   not null default 'interested'
                        check (stage in ('interested','proposal','closing','won','lost')),
    source              text,
    source_detail       text,
    next_step           text,
    next_step_date      date,
    lost_reason         text,
    purchase_id         bigint,
    won_at              timestamptz,
    created_by          bigint,
    created_at          timestamptz not null default now(),
    updated_at          timestamptz not null default now()
);
create index if not exists pipeline_deals_agent_close_idx on public.pipeline_deals (agent_id, expected_close_date);
create index if not exists pipeline_deals_prospect_idx on public.pipeline_deals (prospect_id);

alter table public.pipeline_goals enable row level security;
alter table public.pipeline_deals enable row level security;

-- Goals: everyone sees goals inside their visible tree. Super Admin / Marketing
-- Manager write any; Managers/Team Leaders (L4-L5) write their reports' goals
-- (not their own — the boss sets the leader's team goal).
drop policy if exists pg_select_scoped on public.pipeline_goals;
create policy pg_select_scoped on public.pipeline_goals for select to authenticated
    using (user_id in (select public.current_user_visible_ids()));
drop policy if exists pg_write_scoped on public.pipeline_goals;
create policy pg_write_scoped on public.pipeline_goals for all to authenticated
    using (coalesce(public.current_user_level(), 99) <= 2
           or (coalesce(public.current_user_level(), 99) <= 5
               and user_id <> public.current_user_row_id()
               and user_id in (select public.current_user_visible_ids())))
    with check (coalesce(public.current_user_level(), 99) <= 2
           or (coalesce(public.current_user_level(), 99) <= 5
               and user_id <> public.current_user_row_id()
               and user_id in (select public.current_user_visible_ids())));

-- Deals: owner + their upline (visible tree) read/write.
drop policy if exists pd_select_scoped on public.pipeline_deals;
create policy pd_select_scoped on public.pipeline_deals for select to authenticated
    using (agent_id in (select public.current_user_visible_ids()));
drop policy if exists pd_insert_scoped on public.pipeline_deals;
create policy pd_insert_scoped on public.pipeline_deals for insert to authenticated
    with check (agent_id in (select public.current_user_visible_ids())
                and (created_by is null or created_by = public.current_user_row_id()));
drop policy if exists pd_update_scoped on public.pipeline_deals;
create policy pd_update_scoped on public.pipeline_deals for update to authenticated
    using (agent_id in (select public.current_user_visible_ids()))
    with check (agent_id in (select public.current_user_visible_ids()));
drop policy if exists pd_delete_scoped on public.pipeline_deals;
create policy pd_delete_scoped on public.pipeline_deals for delete to authenticated
    using (agent_id in (select public.current_user_visible_ids()));

grant select, insert, update, delete on public.pipeline_goals, public.pipeline_deals to authenticated;

-- Auto-WON: a new sale for a prospect closes ONE open deal of that prospect —
-- the one whose product best matches the sale item, else the earliest-expected.
create or replace function public.pipeline_deal_autowon() returns trigger
language plpgsql security definer set search_path = public as $$
declare d_id bigint;
begin
    if new.prospect_id is null then return new; end if;
    select id into d_id from public.pipeline_deals
     where prospect_id = new.prospect_id and stage in ('interested','proposal','closing')
     order by (case when new.item is not null and (new.item ilike '%' || product || '%'
                    or product ilike '%' || new.item || '%') then 0 else 1 end),
              expected_close_date, id
     limit 1;
    if d_id is not null then
        update public.pipeline_deals
           set stage = 'won', purchase_id = new.id, won_at = now(), updated_at = now()
         where id = d_id;
    end if;
    return new;
exception when others then
    -- Never block a sale because of pipeline bookkeeping.
    return new;
end $$;

drop trigger if exists trg_pipeline_deal_autowon on public.purchases;
create trigger trg_pipeline_deal_autowon after insert on public.purchases
    for each row execute function public.pipeline_deal_autowon();
