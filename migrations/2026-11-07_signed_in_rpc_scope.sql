-- Signed-in users: company-wide sales only for all-scope viewers; internal
-- writers off the public API; purge_old_archives works again.
--
-- Follow-up to 2026-11-06_definer_rpcs_revoke_anon.sql (signed-out callers).
-- That one left three things open for SIGNED-IN users (owner: "do what is left over",
-- 2026-11-07):
--
-- 1. purchase_sales_by_day / purchase_category_counts return COMPANY-WIDE sales
--    (daily RM totals, sales count per product line) to ANY signed-in user, agents
--    included. The app only calls them for all-scope viewers (_visibleUserIds ===
--    'all': Super Admin + Marketing Manager = role_level <= 2, the same rule as
--    bff_visible_agent_ids returning NULL) and computes a scoped version client-side
--    for everyone else, but an agent could call them straight from the browser.
--    Now: a signed-in caller who is not all-scope gets 42501. auth.uid() NULL
--    (service_role / postgres) is allowed; anon already has no EXECUTE.
--    Live check 2026-11-07: exactly 2 active users have role_level <= 2
--    (Level 1 Super Admin, Level 2 Marketing Manager), matching the client rule.
--    No other database function calls either of them.
--    App effect: none. The app only calls them as an all-scope viewer, and both
--    callers treat an error as "use the client path" anyway.
--
-- 2. Internal write functions that any signed-in user could call directly:
--      journey_spawn, journey_pr_sync, journey_sale_sync, journey_item_sync,
--      journey_gr_spawn  - create / skip / complete journey tasks for any person
--      class_wait_task   - creates a class-invite task
--      record_audit      - writes audit_trail rows with any content
--      purge_old_archives - deletes archived_records
--    Every caller in the database is a SECURITY DEFINER trigger or function
--    (journey_*_trg, class_wait_session_trg, class_wait_sync_rows, journey_*_sync,
--    purge_old_archives) and runs as the owner, so grants do not affect them.
--    No app, BFF, edge function, cron job or RLS policy calls them (git grep +
--    pg_proc / pg_policies / cron.job checked 2026-11-07). Revoked from
--    authenticated; service_role keeps EXECUTE.
--    next_evoucher_number stays callable by signed-in users: Generate E-Voucher
--    (chunks/script-prospects.js) calls it from the browser.
--
-- 3. purge_old_archives failed on every call: it used coalesce(archived_at,
--    created_at, now()) and archived_records has no created_at column. Fixed to
--    coalesce(archived_at, now()). Nothing schedules or calls it today (no cron
--    job), and archived_records is empty, so this deletes nothing now; it only
--    makes the function work if a retention job is wired up later.
--
-- Left as is on purpose: potential_tier_rates (win rate per pipeline tier, a
-- handful of aggregate rows, no names or amounts) feeds every agent's Pipeline
-- forecast, so signed-in users keep it.
--
-- CREATE OR REPLACE keeps existing grants (the anon revoke from 2026-11-06 stays).
-- Undo: 2026-11-07_signed_in_rpc_scope_UNDO.sql

begin;

-- 1. Company-wide sales: all-scope viewers only -------------------------------
create or replace function public.purchase_sales_by_day(p_from date, p_to date)
 returns table(sale_date date, total numeric)
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  if auth.uid() is not null and public.bff_visible_agent_ids(auth.uid()) is not null then
    raise exception 'Company-wide sales are only for Super Admin and Marketing Manager'
      using errcode = '42501';
  end if;
  return query
  select p.date as sale_date, coalesce(sum(p.amount), 0) as total
  from purchases p
  where p.date >= p_from and p.date <= p_to
    and coalesce(p.is_agent_package, false) = false
  group by p.date
  order by p.date;
end;
$function$;

create or replace function public.purchase_category_counts(p_from date, p_to date)
 returns table(category text, cnt bigint)
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  if auth.uid() is not null and public.bff_visible_agent_ids(auth.uid()) is not null then
    raise exception 'Company-wide sales are only for Super Admin and Marketing Manager'
      using errcode = '42501';
  end if;
  return query
  with cat as (
    select case
      when lower(coalesce(item,'')) like '%feng shui%' or lower(coalesce(item,'')) like '%fengshui%' then 'FengShui'
      when lower(coalesce(item,'')) like '%flexi%' or lower(coalesce(item,'')) like '%flexible feng shui%' then 'Flexi FengShui'
      when lower(coalesce(item,'')) like '%simplified%' or lower(coalesce(item,'')) like '%simple feng shui%' then 'Simplified Feng Shui'
      when lower(coalesce(item,'')) like '%power ring%' or lower(coalesce(item,'')) like '%pr4%' or lower(coalesce(item,'')) like '%pr3%' or lower(coalesce(item,'')) like '%pr5%' then 'Power Ring'
      when lower(coalesce(item,'')) like '%calligraphy%' then 'Calligraphy'
      when lower(coalesce(item,'')) like '%adornment%' or lower(coalesce(item,'')) like '%decoration%' then 'Adornment'
      when lower(coalesce(item,'')) like '%royal woodwork%' or lower(coalesce(item,'')) like '%woodwork%' then 'Royal Woodwork'
      when lower(coalesce(item,'')) like '%course%' or lower(coalesce(item,'')) like '%workshop%' or lower(coalesce(item,'')) like '%seminar%' then 'Courses'
      when lower(coalesce(item,'')) like '%book%' or lower(coalesce(item,'')) like '%publication%' then 'Book'
      else null
    end as category
    from purchases p
    where (p.date is null or (p.date >= p_from and p.date <= p_to))
  )
  select c.category, count(*) as cnt
  from cat c
  where c.category is not null
  group by c.category;
end;
$function$;

-- 2. Internal writers: owner (triggers) + service_role only --------------------
revoke execute on function public.journey_spawn(bigint, bigint, text, date, bigint, text, bigint, bigint, text[]) from authenticated;
revoke execute on function public.journey_pr_sync(bigint) from authenticated;
revoke execute on function public.journey_sale_sync(bigint) from authenticated;
revoke execute on function public.journey_item_sync(bigint) from authenticated;
revoke execute on function public.journey_gr_spawn(bigint) from authenticated;
revoke execute on function public.class_wait_task(bigint, bigint) from authenticated;
revoke execute on function public.record_audit(text, text, text, text, jsonb) from authenticated;
revoke execute on function public.purge_old_archives(integer) from authenticated;

-- 3. purge_old_archives: archived_records has no created_at ---------------------
create or replace function public.purge_old_archives(retention_years integer default 7)
 returns integer
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
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
         where coalesce(archived_at, now()) < now() - (retention_years || ' years')::interval
        returning 1
    )
    select count(*) into removed from deleted;
    perform public.record_audit('RETENTION', 'PURGE_ARCHIVES', 'archived_records',
                                null, jsonb_build_object('years', retention_years, 'removed', removed));
    return removed;
end $function$;

commit;

notify pgrst, 'reload schema';
