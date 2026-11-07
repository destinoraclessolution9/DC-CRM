-- UNDO for 2026-11-07_signed_in_rpc_scope.sql: restores the live definitions read
-- 2026-11-07 before it was applied (sales functions open to every signed-in user,
-- purge_old_archives with its created_at bug) and EXECUTE for authenticated on the
-- internal writers.
begin;
CREATE OR REPLACE FUNCTION public.purchase_category_counts(p_from date, p_to date)
 RETURNS TABLE(category text, cnt bigint)
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  select category, count(*) as cnt
  from cat
  where category is not null
  group by category;
$function$;
CREATE OR REPLACE FUNCTION public.purchase_sales_by_day(p_from date, p_to date)
 RETURNS TABLE(sale_date date, total numeric)
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select p.date as sale_date, coalesce(sum(p.amount), 0) as total
  from purchases p
  where p.date >= p_from and p.date <= p_to
    and coalesce(p.is_agent_package, false) = false
  group by p.date
  order by p.date;
$function$;
CREATE OR REPLACE FUNCTION public.purge_old_archives(retention_years integer DEFAULT 7)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
end $function$;
grant execute on function public.journey_spawn(bigint, bigint, text, date, bigint, text, bigint, bigint, text[]) to authenticated;
grant execute on function public.journey_pr_sync(bigint) to authenticated;
grant execute on function public.journey_sale_sync(bigint) to authenticated;
grant execute on function public.journey_item_sync(bigint) to authenticated;
grant execute on function public.journey_gr_spawn(bigint) to authenticated;
grant execute on function public.class_wait_task(bigint, bigint) to authenticated;
grant execute on function public.record_audit(text, text, text, text, jsonb) to authenticated;
grant execute on function public.purge_old_archives(integer) to authenticated;
commit;
notify pgrst, 'reload schema';
