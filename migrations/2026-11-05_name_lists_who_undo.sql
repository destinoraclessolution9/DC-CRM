-- Rollback for migrations/2026-11-05_name_lists_who.sql.
-- 1. Run this file. 2. Re-run migrations/2026-11-03_name_lists.sql (puts back
--    nl_generate / name_list_create / _set / _index / _get as they were), then
--    migrations/2026-11-04_name_lists_local_dates.sql (Malaysia days).
-- ⚠ Dropping the columns loses each list's who / bought-between / offer.

-- the engine back to its plain ≥ 50 rule
do $$
declare d text := pg_get_functiondef('public.inv_compute(jsonb,bigint,text)'::regprocedure);
begin
    if position('inv.min_fit' in d) = 0 then return; end if;
    d := replace(d, 'v_pot := coalesce(nullif(current_setting(''inv.min_fit'', true), '''')::int, (c ->> ''potential'')::int, 50);',
                    'v_pot := coalesce((c ->> ''potential'')::int, 50);');
    d := replace(d, 'when cd.fit < v_pot or (cd.okey is null and cd.blocked is not null) then coalesce(cd.blocked, ''paused'')',
                    'when cd.fit < v_pot then coalesce(cd.blocked, ''paused'')');
    execute d;
end $$;
revoke execute on function public.inv_compute(jsonb, bigint, text) from public, anon, authenticated;

drop function if exists public.name_list_preview(jsonb);
drop function if exists public.nl_parse(jsonb);
drop function if exists public.nl_pool(bigint, text, text, text, jsonb, text, date, date);
drop function if exists public.nl_line_sales(text);

alter table public.name_lists drop constraint if exists name_lists_who_chk;
alter table public.name_lists drop constraint if exists name_lists_offer_len;
alter table public.name_lists drop column if exists who;
alter table public.name_lists drop column if exists bought_from;
alter table public.name_lists drop column if exists bought_to;
alter table public.name_lists drop column if exists offer;
