-- Rollback of migrations/2026-11-03_team_birthdays_rpc.sql. Deploy the client
-- rollback first: the Team Birthday lists read my_team_birthdays() and show no
-- colleagues without it.
drop function if exists public.my_team_birthdays();

do $$
declare v_def text; v_new text;
begin
    select pg_get_functiondef(p.oid) into strict v_def from pg_proc p
     where p.pronamespace = 'public'::regnamespace and p.proname = 'calendar_dashboard_payload';
    v_new := replace(v_def, 'reporting_to, created_at', 'reporting_to, date_of_birth, created_at');
    if v_new <> v_def then execute v_new; end if;
end $$;
