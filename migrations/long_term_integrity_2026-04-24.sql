-- ============================================================================
-- Long-term data integrity hardening
-- Date: 2026-04-24
-- ----------------------------------------------------------------------------
-- Addresses audit findings #7 (FKs, NOT NULL, money checks) and #10
-- (server-side audit trail, retention purge, TIMESTAMPTZ).
-- Every change is guarded by DO blocks so this file is idempotent and safe
-- to re-run.
-- ============================================================================

-- ── 1. Money columns: NOT NULL + non-negative CHECK ────────────────────────
do $$
begin
    -- transactions.amount
    if exists (select 1 from information_schema.columns
               where table_schema='public' and table_name='transactions' and column_name='amount') then
        update public.transactions set amount = 0 where amount is null;
        alter table public.transactions alter column amount set not null;
        alter table public.transactions alter column amount set default 0;
        alter table public.transactions
            drop constraint if exists transactions_amount_nonneg_chk;
        alter table public.transactions
            add  constraint transactions_amount_nonneg_chk check (amount >= 0);
    end if;

    -- activities.closing_amount
    if exists (select 1 from information_schema.columns
               where table_schema='public' and table_name='activities' and column_name='closing_amount') then
        update public.activities set closing_amount = 0 where closing_amount is null;
        alter table public.activities alter column closing_amount set not null;
        alter table public.activities alter column closing_amount set default 0;
        alter table public.activities
            drop constraint if exists activities_closing_amount_nonneg_chk;
        alter table public.activities
            add  constraint activities_closing_amount_nonneg_chk check (closing_amount >= 0);
    end if;
end $$;

-- ── 2. Foreign keys with ON DELETE CASCADE where appropriate ───────────────
-- Only add FKs for columns whose referenced parent actually exists and where
-- every current value already resolves — otherwise we'd fail to add the constraint.
create or replace function _add_fk_if_valid(
    child_table text, child_col text,
    parent_table text, parent_col text,
    on_delete_action text
) returns void language plpgsql as $$
declare
    fk_name text := format('fk_%s_%s_%s', child_table, child_col, parent_table);
    bad_count bigint;
begin
    if not exists (select 1 from information_schema.tables
                   where table_schema='public' and table_name=child_table) then return; end if;
    if not exists (select 1 from information_schema.tables
                   where table_schema='public' and table_name=parent_table) then return; end if;
    if not exists (select 1 from information_schema.columns
                   where table_schema='public' and table_name=child_table and column_name=child_col) then return; end if;

    execute format(
        'select count(*) from public.%I c where c.%I is not null
           and not exists (select 1 from public.%I p where p.%I = c.%I)',
        child_table, child_col, parent_table, parent_col, child_col
    ) into bad_count;
    if bad_count > 0 then
        raise notice 'Skipping FK %->%: % orphan rows', child_table, parent_table, bad_count;
        return;
    end if;
    execute format('alter table public.%I drop constraint if exists %I', child_table, fk_name);
    execute format(
        'alter table public.%I add constraint %I foreign key (%I) references public.%I(%I) on delete %s',
        child_table, fk_name, child_col, parent_table, parent_col, on_delete_action
    );
end $$;

select _add_fk_if_valid('activities',     'prospect_id',    'prospects',  'id', 'set null');
select _add_fk_if_valid('activities',     'customer_id',    'customers',  'id', 'set null');
select _add_fk_if_valid('activities',     'lead_agent_id',  'users',      'id', 'set null');
select _add_fk_if_valid('transactions',   'prospect_id',    'prospects',  'id', 'set null');
select _add_fk_if_valid('event_attendees','entity_id',      'users',      'id', 'cascade');
select _add_fk_if_valid('notes',          'prospect_id',    'prospects',  'id', 'cascade');
select _add_fk_if_valid('documents',      'prospect_id',    'prospects',  'id', 'cascade');
select _add_fk_if_valid('purchases',      'customer_id',    'customers',  'id', 'cascade');
select _add_fk_if_valid('prospects',      'responsible_agent_id','users', 'id', 'set null');
select _add_fk_if_valid('prospects',      'cps_agent_id',   'users',      'id', 'set null');
select _add_fk_if_valid('customers',      'responsible_agent_id','users', 'id', 'set null');
select _add_fk_if_valid('assignments',    'agent_id',       'users',      'id', 'cascade');
select _add_fk_if_valid('assignments',    'prospect_id',    'prospects',  'id', 'cascade');
select _add_fk_if_valid('referrals',      'referred_by_id', 'users',      'id', 'set null');

-- ── 3. Migrate DATE columns that should be TIMESTAMPTZ ─────────────────────
-- DATE columns drop timezone info; over 50 years, DST and zone-rule drift
-- causes silent off-by-hours bugs. Convert to TIMESTAMPTZ (UTC) where safe.
do $$
declare r record;
begin
    for r in
        select table_name, column_name
          from information_schema.columns
         where table_schema = 'public'
           and data_type = 'date'
           and column_name in (
               'estimated_finish_date','cps_assignment_date','protection_deadline',
               'expected_close_date','closed_date','closing_date','mfa_enabled_at'
           )
    loop
        begin
            execute format(
                'alter table public.%I alter column %I type timestamptz
                   using (case when %I is null then null
                               else (%I::timestamp at time zone ''UTC'') end)',
                r.table_name, r.column_name, r.column_name, r.column_name
            );
        exception when others then
            raise notice 'Skip % %: %', r.table_name, r.column_name, sqlerrm;
        end;
    end loop;
end $$;

-- ── 4. Server-side audit log — the canonical record of admin actions ───────
create table if not exists public.audit_trail (
    id               bigserial primary key,
    at               timestamptz not null default now(),
    actor_auth_id    uuid,
    actor_user_id    bigint,
    actor_role_level integer,
    category         text not null,
    action           text not null,
    target_table     text,
    target_id        text,
    detail           jsonb,
    ip_address       inet,
    user_agent       text
);

create index if not exists audit_trail_at_idx              on public.audit_trail (at desc);
create index if not exists audit_trail_actor_idx           on public.audit_trail (actor_user_id);
create index if not exists audit_trail_target_idx          on public.audit_trail (target_table, target_id);

alter table public.audit_trail enable row level security;
-- Admins (level <= 2) can read the audit trail; nobody (including admins)
-- can UPDATE or DELETE through RLS. Inserts come only via the record_audit()
-- function below, which runs with SECURITY DEFINER.
drop policy if exists "audit_trail_admin_select" on public.audit_trail;
create policy "audit_trail_admin_select" on public.audit_trail
    for select to authenticated
    using (coalesce(current_user_level(), 99) <= 2);

revoke insert, update, delete on public.audit_trail from authenticated;

create or replace function public.record_audit(
    p_category text,
    p_action   text,
    p_target_table text default null,
    p_target_id text default null,
    p_detail   jsonb default null
) returns bigint
language plpgsql security definer set search_path = public as $$
declare
    new_id bigint;
begin
    insert into public.audit_trail (
        actor_auth_id, actor_user_id, actor_role_level,
        category, action, target_table, target_id, detail
    )
    values (
        auth.uid(), current_user_row_id(), current_user_level(),
        p_category, p_action, p_target_table, p_target_id, p_detail
    )
    returning id into new_id;
    return new_id;
end $$;
grant execute on function public.record_audit(text,text,text,text,jsonb) to authenticated;

-- Automatic audit triggers for high-stakes tables: transactions, contracts,
-- users, approval_queue. Record every INSERT / UPDATE / DELETE server-side
-- so no client bug can skip logging.
create or replace function public._audit_trigger() returns trigger
language plpgsql security definer set search_path = public as $$
begin
    insert into public.audit_trail (
        actor_auth_id, actor_user_id, actor_role_level,
        category, action, target_table, target_id, detail
    ) values (
        auth.uid(), current_user_row_id(), current_user_level(),
        'DATA', TG_OP, TG_TABLE_NAME,
        coalesce((case when TG_OP = 'DELETE' then old.id else new.id end)::text, null),
        jsonb_build_object(
            'old', case when TG_OP in ('UPDATE','DELETE') then to_jsonb(old) else null end,
            'new', case when TG_OP in ('INSERT','UPDATE') then to_jsonb(new) else null end
        )
    );
    return case when TG_OP = 'DELETE' then old else new end;
end $$;

do $$
declare t text;
begin
    foreach t in array array['transactions','contracts','users','approval_queue'] loop
        if exists (select 1 from information_schema.tables
                   where table_schema='public' and table_name=t) then
            execute format('drop trigger if exists trg_audit_%I on public.%I', t, t);
            execute format(
                'create trigger trg_audit_%I after insert or update or delete on public.%I
                   for each row execute function public._audit_trigger()',
                t, t
            );
        end if;
    end loop;
end $$;

-- ── 5. Retention / purge job for archived_records ──────────────────────────
-- Soft-deletes sit in archived_records forever by default. For GDPR-style
-- compliance and to keep the table bounded over 50 years, purge anything
-- older than 7 years. Runs on-demand; wire to a cron trigger if desired.
create or replace function public.purge_old_archives(retention_years integer default 7)
returns integer
language plpgsql security definer set search_path = public as $$
declare
    removed integer;
begin
    if retention_years < 1 then retention_years := 1; end if;
    if not exists (select 1 from information_schema.tables
                   where table_schema='public' and table_name='archived_records') then
        return 0;
    end if;
    with deleted as (
        delete from public.archived_records
         where coalesce(archived_at, created_at, now()) < now() - (retention_years || ' years')::interval
        returning 1
    )
    select count(*) into removed from deleted;
    perform public.record_audit('RETENTION', 'PURGE_ARCHIVES', 'archived_records',
                                null, jsonb_build_object('years', retention_years, 'removed', removed));
    return removed;
end $$;
grant execute on function public.purge_old_archives(integer) to authenticated;

-- ── 6. Uniqueness & NOT NULL hardening on identity columns ─────────────────
-- Prevent silent duplicates on users.username / users.email.
do $$
begin
    if exists (select 1 from information_schema.columns
               where table_schema='public' and table_name='users' and column_name='username') then
        alter table public.users drop constraint if exists users_username_key;
        create unique index if not exists users_username_lower_uidx
            on public.users (lower(username)) where username is not null;
    end if;
    if exists (select 1 from information_schema.columns
               where table_schema='public' and table_name='users' and column_name='email') then
        create unique index if not exists users_email_lower_uidx
            on public.users (lower(email)) where email is not null;
    end if;
end $$;
