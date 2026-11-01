-- Rollback of migrations/2026-11-01_new_friends.sql. Tagged prospects keep
-- their source; open Book CPS tasks stay until done by hand.
do $$ begin
    perform cron.unschedule('new-friend-daily') where exists (select 1 from cron.job where jobname = 'new-friend-daily');
end $$;
drop trigger if exists trg_new_friend_cps on public.activities;
drop function if exists public.new_friend_cps_trg();
drop function if exists public.new_friend_daily();
drop function if exists public.new_friend_list();
drop function if exists public.nf_rows(date);
drop index if exists public.prospects_new_friend_idx;

do $$
declare v_def text; v_new text;
begin
    select pg_get_functiondef(p.oid) into strict v_def from pg_proc p
     where p.pronamespace = 'public'::regnamespace and p.proname = 'inv_compute';
    v_new := replace(v_def, '''Recent CPS''', '''New friend · CPS''');
    if v_new <> v_def then execute v_new; end if;
end $$;
