-- ✎ POP amount edit (2026-10-21): an agent can correct a month's amount when
-- the real card charge differs from the CRM's calculation. Edited months are
-- flagged so a later edit of the sale never rebuilds the schedule over them.
alter table public.pop_installments add column if not exists amount_edited boolean not null default false;

create or replace function public.pop_plan_sync(p_purchase bigint) returns integer
language plpgsql security definer set search_path = public as $$
declare
    pu record; tm record; k int; v_due date; v_n int := 0; v_cust bigint; v_agent bigint;
    v_today date := (now() at time zone 'Asia/Kuala_Lumpur')::date;
begin
    select * into pu from public.purchases where id = p_purchase;
    if pu.id is null then return 0; end if;
    tm := public.pop_plan_terms(p_purchase);
    if not coalesce(tm.is_plan, false) then
        delete from public.pop_installments where purchase_id = p_purchase and status in ('due', 'auto', 'assumed') and not amount_edited;
        return 0;
    end if;
    if exists (select 1 from public.pop_installments where purchase_id = p_purchase)
       and not exists (select 1 from public.pop_installments where purchase_id = p_purchase
                        and (status in ('lapsed', 'paid_manual', 'waived') or amount_edited))
       and ((select count(*) from public.pop_installments where purchase_id = p_purchase) <> tm.tenure
            or exists (select 1 from public.pop_installments where purchase_id = p_purchase and amount <> tm.monthly)
            or exists (select 1 from public.pop_installments where purchase_id = p_purchase and seq = 1
                        and due_date <> (pu.date + interval '1 month')::date)) then
        delete from public.pop_installments where purchase_id = p_purchase;
    end if;
    v_cust := coalesce(pu.customer_id, (select c.id from public.customers c where c.converted_from_prospect_id = pu.prospect_id limit 1));
    v_agent := coalesce(pu.agent_id, (select responsible_agent_id from public.customers where id = v_cust));
    if exists (select 1 from public.pop_installments where purchase_id = p_purchase) then
        update public.pop_installments set customer_id = v_cust, agent_id = v_agent
         where purchase_id = p_purchase and (customer_id is distinct from v_cust or agent_id is distinct from v_agent);
        return 0;
    end if;
    for k in 1 .. tm.tenure loop
        v_due := (pu.date + make_interval(months => k))::date;
        insert into public.pop_installments (purchase_id, customer_id, agent_id, seq, due_date, amount, status, note)
        values (p_purchase, v_cust, v_agent, k, v_due, tm.monthly,
                case when v_due < date '2026-10-01' then 'assumed' when v_due < v_today then 'auto' else 'due' end,
                case when v_due < date '2026-10-01' then 'before tracking began' end);
        v_n := v_n + 1;
    end loop;
    return v_n;
exception when others then
    return 0;
end $$;
revoke all on function public.pop_plan_sync(bigint) from public, anon, authenticated;
