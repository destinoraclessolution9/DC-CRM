-- Pipeline v8.4 — Audit Prescription + lead grades (2026-10-20). Additive.
--  1. audit_prescriptions: the solutions proposed after a Feng Shui audit
--     (product, qty, quoted RM, priority, status). Keyed by the prospect id
--     (customers keep their audits on the linked converted prospect).
--  2. pipeline_deals gains stage 'prescribed' (80%) + audit_id. One open deal per
--     (prospect, audit) is kept in sync by trigger: amount = open Must +
--     Recommended lines; nothing open + something bought → won; all declined → lost.
--     No expiry: a prescription stays open until it is bought or declined.
--  3. Sales: auto-won now resolves the prospect through customers too, and marks
--     matching prescription lines bought (partial purchases reduce the deal).
--  4. agent_labels (High Closer) and vip_referral_asks.
--  5. audit-reports storage bucket: 25 MB, PDF / Word / images, staff only.

create table if not exists public.audit_prescriptions (
    id             bigint generated always as identity primary key,
    prospect_id    bigint not null,
    audit_id       bigint not null,
    product        text   not null,
    product_id     bigint,
    qty            integer not null default 1 check (qty > 0),
    quoted_amount  numeric not null default 0 check (quoted_amount >= 0),
    priority       text not null default 'recommended' check (priority in ('must','recommended','optional')),
    status         text not null default 'proposed' check (status in ('proposed','accepted','bought','declined')),
    notes          text,
    purchase_id    bigint,
    bought_at      timestamptz,
    created_by     bigint,
    created_at     timestamptz not null default now(),
    updated_at     timestamptz not null default now()
);
create index if not exists audit_prescriptions_prospect_idx on public.audit_prescriptions (prospect_id, audit_id);
alter table public.audit_prescriptions enable row level security;
drop policy if exists apx_select on public.audit_prescriptions;
create policy apx_select on public.audit_prescriptions for select to authenticated
    using (coalesce(public.current_user_level(), 99) <= 12 and public.prospect_is_visible(prospect_id));
drop policy if exists apx_write on public.audit_prescriptions;
create policy apx_write on public.audit_prescriptions for all to authenticated
    using (coalesce(public.current_user_level(), 99) <= 12 and public.prospect_is_visible(prospect_id))
    with check (coalesce(public.current_user_level(), 99) <= 12 and public.prospect_is_visible(prospect_id));
grant select, insert, update, delete on public.audit_prescriptions to authenticated;

-- 'prescribed' stage + audit link on deals
alter table public.pipeline_deals drop constraint if exists pipeline_deals_stage_check;
alter table public.pipeline_deals add constraint pipeline_deals_stage_check
    check (stage in ('interested','proposal','prescribed','closing','won','lost'));
alter table public.pipeline_deals add column if not exists audit_id bigint;
create unique index if not exists pipeline_deals_one_open_per_audit
    on public.pipeline_deals (prospect_id, audit_id)
    where audit_id is not null and stage in ('interested','proposal','prescribed','closing');
-- open-stage lists used by the v8.2 auto-draft index + weekly push include 'prescribed'
drop index if exists public.pipeline_deals_one_open_auto_per_prospect;
create unique index if not exists pipeline_deals_one_open_auto_per_prospect
    on public.pipeline_deals (prospect_id)
    where auto_created and stage in ('interested','proposal','prescribed','closing');

-- Does sale item p_item name catalogue product p_product? The item must hold
-- the product's full name, its full CJK half (>=2 chars) or its full Latin half
-- (>=10 chars, multi-word). A generic fragment ("Power Ring") never matches.
create or replace function public.pipeline_name_match(p_item text, p_product text) returns boolean
language sql immutable as $$
    with v as (
        select lower(coalesce(p_item, '')) as item,
               lower(btrim(coalesce(p_product, ''))) as prod,
               regexp_replace(coalesce(p_product, ''), '[^一-鿿]', '', 'g') as cjk,
               lower(btrim(regexp_replace(regexp_replace(coalesce(p_product, ''), '[一-鿿]', ' ', 'g'), '\s+', ' ', 'g'))) as latin
    )
    select item <> '' and prod <> '' and (
           position(prod in item) > 0
        or (length(cjk) >= 2 and position(cjk in item) > 0)
        or (length(latin) >= 10 and position(' ' in latin) > 0 and length(cjk) > 0 and position(latin in item) > 0))
    from v
$$;

-- Keep the audit's deal in step with its prescription lines.
create or replace function public.pipeline_sync_prescription(p_prospect bigint, p_audit bigint) returns void
language plpgsql security definer set search_path = public as $$
declare
    v_open numeric; v_bought int; v_declined int; v_total int; v_label text;
    v_deal record; v_agent bigint; v_src text; v_srcd text; v_ref text;
    v_end date := (date_trunc('month', (now() at time zone 'Asia/Kuala_Lumpur')::date) + interval '1 month - 1 day')::date;
    v_last_purchase bigint; v_bought_amt numeric; v_open_opt numeric;
begin
    select coalesce(sum(quoted_amount) filter (where status in ('proposed','accepted') and priority in ('must','recommended')), 0),
           count(*) filter (where status = 'bought'), count(*) filter (where status = 'declined'), count(*),
           string_agg(product, ', ' order by (priority = 'must') desc, id) filter (where status in ('proposed','accepted')),
           max(purchase_id) filter (where status = 'bought'),
           coalesce(sum(quoted_amount) filter (where status = 'bought'), 0),
           coalesce(sum(quoted_amount) filter (where status in ('proposed','accepted') and priority = 'optional'), 0)
      into v_open, v_bought, v_declined, v_total, v_label, v_last_purchase, v_bought_amt, v_open_opt
      from public.audit_prescriptions where prospect_id = p_prospect and audit_id = p_audit;
    -- only Optional lines left open → they are the remaining potential
    if v_open = 0 and v_open_opt > 0 then v_open := v_open_opt; end if;

    select * into v_deal from public.pipeline_deals
     where prospect_id = p_prospect and audit_id = p_audit and stage in ('interested','proposal','prescribed','closing')
     order by id limit 1;

    if v_open > 0 then
        if v_deal.id is not null then
            update public.pipeline_deals
               set amount = v_open, product = left(coalesce(v_label, product), 160),
                   stage = case when stage = 'closing' then 'closing' else 'prescribed' end,
                   expected_close_date = greatest(expected_close_date, v_end), updated_at = now()
             where id = v_deal.id;
        else
            select responsible_agent_id, lower(coalesce(referred_by_type, '')), referred_by, status
              into v_agent, v_ref, v_srcd, v_src from public.prospects where id = p_prospect;
            if v_agent is null then return; end if;
            insert into public.pipeline_deals (prospect_id, agent_id, product, amount, expected_close_date, stage,
                                               source, source_detail, next_step, audit_id, created_by, updated_at)
            values (p_prospect, v_agent, left(coalesce(v_label, 'Audit prescription'), 160), v_open, v_end, 'prescribed',
                    case when v_src = 'converted' then 'repeat_customer'
                         when v_ref = 'customer' then 'customer_referral'
                         when v_ref in ('consultant','agent') then 'agent_referral'
                         when v_ref = 'prospect' then 'prospect_referral' else null end,
                    case when v_src = 'converted' then null else v_srcd end,
                    'Follow up the audit prescription', p_audit, null, now());
        end if;
    elsif v_deal.id is not null then
        if v_total = 0 then
            delete from public.pipeline_deals where id = v_deal.id; -- every line removed
        elsif v_bought > 0 then
            update public.pipeline_deals set stage = 'won', won_at = now(), amount = greatest(v_bought_amt, 0), purchase_id = coalesce(purchase_id, v_last_purchase), updated_at = now() where id = v_deal.id;
        elsif v_total > 0 and v_declined = v_total then
            update public.pipeline_deals set stage = 'lost', lost_reason = 'Prescription declined', updated_at = now() where id = v_deal.id;
        end if;
    end if;
end $$;
revoke all on function public.pipeline_sync_prescription(bigint, bigint) from public, anon, authenticated;

create or replace function public.audit_prescriptions_after_change() returns trigger
language plpgsql security definer set search_path = public as $$
begin
    if tg_op = 'DELETE' then
        perform public.pipeline_sync_prescription(old.prospect_id, old.audit_id);
        return old;
    end if;
    perform public.pipeline_sync_prescription(new.prospect_id, new.audit_id);
    return new;
exception when others then
    if tg_op = 'DELETE' then return old; end if;
    return new; -- never block saving a prescription
end $$;
drop trigger if exists trg_audit_prescriptions_sync on public.audit_prescriptions;
create trigger trg_audit_prescriptions_sync after insert or update or delete on public.audit_prescriptions
    for each row execute function public.audit_prescriptions_after_change();

-- Sales → prescriptions + deals. Resolves the prospect via the customer link
-- (most sales carry only customer_id).
create or replace function public.pipeline_deal_autowon() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_pid bigint; v_audit bigint; d_id bigint;
begin
    v_pid := new.prospect_id;
    if v_pid is null and new.customer_id is not null then
        select converted_from_prospect_id into v_pid from public.customers where id = new.customer_id;
    end if;
    if v_pid is null then return new; end if;

    -- 1. prescription lines this sale fulfils
    for v_audit in
        update public.audit_prescriptions
           set status = 'bought', purchase_id = new.id, bought_at = now(), updated_at = now()
         where prospect_id = v_pid and status in ('proposed','accepted')
           and public.pipeline_name_match(new.item, product)
        returning audit_id
    loop
        perform public.pipeline_sync_prescription(v_pid, v_audit);
    end loop;

    -- 2. otherwise one ordinary open deal (best product match, then earliest)
    if not found then
        select id into d_id from public.pipeline_deals
         where prospect_id = v_pid and audit_id is null and stage in ('interested','proposal','prescribed','closing')
         order by (case when public.pipeline_name_match(new.item, product) then 0 else 1 end), expected_close_date, id
         limit 1;
        if d_id is not null then
            update public.pipeline_deals set stage = 'won', purchase_id = new.id, won_at = now(), updated_at = now() where id = d_id;
        end if;
    end if;
    return new;
exception when others then
    return new; -- never block a sale because of pipeline bookkeeping
end $$;

-- 'prescribed' is an open stage for the proposal trigger too (only interested moves).
-- Weekly push: open stages include prescribed.
create or replace function public.queue_pipeline_weekly_push() returns integer
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    v_today date := (now() at time zone 'Asia/Kuala_Lumpur')::date;
    v_month text := to_char(v_today, 'YYYY-MM');
    v_end   date := (date_trunc('month', v_today) + interval '1 month - 1 day')::date;
    v_n     integer;
begin
    insert into public.notification_outbox (user_id, kind, priority, title, body, url, dedupe_key, due_at)
    select s.user_id, 'pipeline_weekly', 'normal',
           '🎯 ' || s.lbl || ': RM' || round(s.won / 1000) || 'k of RM' || round(s.goal / 1000) || 'k',
           case when s.goal - s.won <= 0 then 'Goal reached 🎉 keep closing'
                when s.pipe = 0 then 'No deals closing this month · add deals'
                else 'Pipeline ' || to_char(s.pipe / greatest(s.goal - s.won, 1), 'FM990.0') || '× (need 3×)'
           end
           || case when s.rx > 0 then ' · ' || s.rx || ' prescription' || case when s.rx = 1 then '' else 's' end || ' open' else '' end
           || case when s.idle > 0 then ' · ' || s.idle || ' idle' else '' end,
           './index.html#pipeline',
           'pipeline_weekly:' || v_today,
           now()
      from (
        select u.id as user_id,
               case when u.role_level between 3 and 5 then 'Team' else 'You' end as lbl,
               coalesce(g.target_amount, case when u.role_level between 3 and 5 then 500000 else 100000 end) as goal,
               coalesce((select sum(p.amount) from public.purchases p
                          where p.agent_id in (select public.pipeline_tree_ids(u.id, u.role_level between 3 and 5))
                            and left(p.date::text, 7) = v_month
                            and coalesce(p.status, '') !~* 'cancel|refund|void' and p.amount > 0), 0) as won,
               coalesce((select sum(d.amount) from public.pipeline_deals d
                          where d.agent_id in (select public.pipeline_tree_ids(u.id, u.role_level between 3 and 5))
                            and d.stage in ('interested','proposal','prescribed','closing')
                            and d.expected_close_date <= v_end), 0) as pipe,
               (select count(*) from public.pipeline_deals d
                 where d.agent_id in (select public.pipeline_tree_ids(u.id, u.role_level between 3 and 5))
                   and d.stage = 'prescribed') as rx,
               (select count(*) from public.pipeline_deals d left join public.prospects pr on pr.id = d.prospect_id
                 where d.agent_id in (select public.pipeline_tree_ids(u.id, u.role_level between 3 and 5))
                   and d.stage in ('interested','proposal','prescribed','closing')
                   and greatest(d.updated_at, coalesce(pr.last_activity_date::timestamptz, d.updated_at)) < now() - interval '14 days') as idle
          from public.users u
          left join public.pipeline_goals g
                 on g.user_id = u.id and g.month = v_month
                and g.scope = case when u.role_level between 3 and 5 then 'team' else 'personal' end
         where u.role_level between 3 and 12
           and coalesce(u.status, 'active') !~* 'inactive|deleted|resign|terminat'
      ) s
    on conflict (user_id, dedupe_key) do nothing;
    get diagnostics v_n = row_count;
    return v_n;
end $$;
revoke all on function public.queue_pipeline_weekly_push() from public, anon, authenticated;

-- High Closer label (Super Admin / Marketing Manager set it; all staff read).
create table if not exists public.agent_labels (
    user_id     bigint primary key references public.users(id) on delete cascade,
    high_closer boolean not null default false,
    set_by      bigint,
    updated_at  timestamptz not null default now()
);
alter table public.agent_labels enable row level security;
drop policy if exists al_select on public.agent_labels;
create policy al_select on public.agent_labels for select to authenticated using (coalesce(public.current_user_level(), 99) <= 12);
drop policy if exists al_write on public.agent_labels;
create policy al_write on public.agent_labels for all to authenticated
    using (coalesce(public.current_user_level(), 99) <= 2) with check (coalesce(public.current_user_level(), 99) <= 2);
grant select, insert, update, delete on public.agent_labels to authenticated;

-- "Asked for a referral" log for VIP customers.
create table if not exists public.vip_referral_asks (
    id          bigint generated always as identity primary key,
    customer_id bigint not null,
    asked_by    bigint,
    note        text,
    asked_at    timestamptz not null default now()
);
create index if not exists vip_referral_asks_customer_idx on public.vip_referral_asks (customer_id, asked_at desc);
alter table public.vip_referral_asks enable row level security;
drop policy if exists vra_select on public.vip_referral_asks;
create policy vra_select on public.vip_referral_asks for select to authenticated
    using (coalesce(public.current_user_level(), 99) <= 12 and public.customer_is_visible(customer_id));
drop policy if exists vra_insert on public.vip_referral_asks;
create policy vra_insert on public.vip_referral_asks for insert to authenticated
    with check (coalesce(public.current_user_level(), 99) <= 12 and public.customer_is_visible(customer_id)
                and (asked_by is null or asked_by = public.current_user_row_id()));
grant select, insert on public.vip_referral_asks to authenticated;

-- Audit report storage: private, 25 MB, PDF / Word / images, staff only.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('audit-reports', 'audit-reports', false, 26214400,
        array['application/pdf','application/msword','application/vnd.openxmlformats-officedocument.wordprocessingml.document',
              'image/jpeg','image/png','image/webp'])
on conflict (id) do update set file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;
drop policy if exists audit_reports_staff_select on storage.objects;
create policy audit_reports_staff_select on storage.objects for select to authenticated
    using (bucket_id = 'audit-reports' and coalesce(public.current_user_level(), 99) <= 12);
drop policy if exists audit_reports_staff_insert on storage.objects;
create policy audit_reports_staff_insert on storage.objects for insert to authenticated
    with check (bucket_id = 'audit-reports' and coalesce(public.current_user_level(), 99) <= 12);
drop policy if exists audit_reports_staff_delete on storage.objects;
create policy audit_reports_staff_delete on storage.objects for delete to authenticated
    using (bucket_id = 'audit-reports' and coalesce(public.current_user_level(), 99) <= 12);
