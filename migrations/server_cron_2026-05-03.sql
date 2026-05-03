-- ============================================================================
-- Move browser-side cron + audit logging to the database
-- Date: 2026-05-03
-- ----------------------------------------------------------------------------
-- Why: nano compute hit 100 % of its daily disk-IO budget on 2026-05-03 after
-- yesterday's deploy reactivated several silent-no-op write paths. The CRM
-- shipped with multiple "cron loops" running inside every browser tab — every
-- tab × every agent × every interval = a multiplier on every write. On nano
-- (43 Mbps baseline IO, 30 min/day burst budget) that bursts within hours
-- and Postgres starts replying with 522 timeouts.
--
-- This migration moves all that work server-side:
--   1. Audit trail for score changes lives in a Postgres trigger now, so
--      bumping prospects.score / customers.score automatically writes one
--      row to score_history in the same transaction. Browser stops doing
--      a separate INSERT round trip.
--   2. Weekly inactivity scoring runs once globally on Sunday 18:00 UTC
--      (Monday 02:00 MYT) instead of once per Monday browser session per
--      agent — a single batched SQL update vs. N HTTP round trips.
--   3. Action-plan Monday-reminder check runs once globally Monday 01:00
--      UTC (09:00 MYT) instead of every-4-hours from every tab.
--
-- Idempotent: drop-then-create. Safe to re-run.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. score_history trigger — replaces client-side AppDataStore.create()
-- ---------------------------------------------------------------------------
-- The browser only sends an UPDATE to set the new score; the trigger captures
-- old/new and writes the audit row server-side. One transaction, no extra
-- HTTP round trip, no IO from the browser.
create or replace function public.log_score_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $func$
begin
    if (new.score is distinct from old.score) then
        insert into public.score_history(
            entity_type, entity_id, old_score, new_score, points_change, reason, created_at
        ) values (
            tg_argv[0],
            new.id,
            coalesce(old.score, 0),
            coalesce(new.score, 0),
            coalesce(new.score, 0) - coalesce(old.score, 0),
            -- The browser passes the reason via current_setting, so a single
            -- SET LOCAL app.score_reason = '...' before the UPDATE annotates
            -- the audit row. When unset (older clients) we fall back to a
            -- generic label.
            coalesce(current_setting('app.score_reason', true), 'score change'),
            now()
        );
    end if;
    return new;
end;
$func$;

drop trigger if exists prospects_score_audit on public.prospects;
create trigger prospects_score_audit
    after update of score on public.prospects
    for each row execute function public.log_score_change('prospect');

-- Note 2026-05-03: customers table has no `score` column (verified via
-- information_schema.columns), so addScoreToCustomer in script.js has been
-- a no-op-with-error since launch. No trigger is attached for customers
-- here. If a customer scoring system is ever added, copy the prospects
-- trigger and reuse log_score_change() with arg 'customer'.


-- ---------------------------------------------------------------------------
-- 2. Weekly inactivity scoring — server-side replacement for
--    _runWeeklyInactivityCheck() at script.js:39025
-- ---------------------------------------------------------------------------
-- A single batched UPDATE vs. the old N+1 loop the browser ran (getAll then
-- per-row update). Subtracts 5 from prospects with no activity in 7+ days,
-- excluding the same exit statuses the browser version excluded.
create or replace function public.apply_weekly_inactivity_scoring()
returns integer
language plpgsql
security definer
set search_path = public
as $func$
declare
    affected integer;
begin
    perform set_config('app.score_reason', 'Weekly inactivity — no activity for 7+ days', true);
    -- last_activity_date is type `date`; compare against current_date - 7
    -- (date - integer is date, no cast needed).
    update public.prospects p
       set score = greatest(0, coalesce(p.score, 0) - 5)
     where coalesce(p.unable_to_serve, false) = false
       and coalesce(p.status, '') not in ('converted','lost')
       and (
            p.last_activity_date is null
         or p.last_activity_date < current_date - 7
       );
    get diagnostics affected = row_count;
    return affected;
end;
$func$;


-- ---------------------------------------------------------------------------
-- 3. Action-plan Monday reminder — server-side replacement for
--    initActionPlanReminder() at script.js:29830
-- ---------------------------------------------------------------------------
-- Inserts one action_plan_checks row per active plan whose owning agent
-- hasn't been reminded today. The browser used to do this with N+1 reads
-- (getAll('users'), then per-user query('action_plans'), then per-plan
-- query('action_plan_checks')). One INSERT...SELECT replaces all of it.
-- action_plan_checks.id is bigint NOT NULL with no default — the original
-- browser code generated client-side IDs. Server-side INSERT...SELECT can't
-- do that, so attach a sequence first. Idempotent: only creates the sequence
-- if it doesn't already exist, then sets the default.
do $seq$
begin
    if exists (select 1 from information_schema.tables
               where table_schema='public' and table_name='action_plan_checks') then
        if not exists (select 1 from pg_class where relname='action_plan_checks_id_seq') then
            create sequence public.action_plan_checks_id_seq
                owned by public.action_plan_checks.id;
            perform setval(
                'public.action_plan_checks_id_seq',
                greatest(1, coalesce((select max(id) from public.action_plan_checks), 0))
            );
        end if;
        execute 'alter table public.action_plan_checks
                 alter column id set default nextval(''public.action_plan_checks_id_seq'')';
    end if;
end $seq$;

create or replace function public.queue_action_plan_reminders()
returns integer
language plpgsql
security definer
set search_path = public
as $func$
declare
    inserted integer;
begin
    if not exists (select 1 from information_schema.tables
                   where table_schema='public' and table_name='action_plans') then
        return 0;
    end if;
    if not exists (select 1 from information_schema.tables
                   where table_schema='public' and table_name='action_plan_checks') then
        return 0;
    end if;

    insert into public.action_plan_checks (plan_id, check_date, reminder_sent, created_at)
    select ap.id, current_date, true, now()
      from public.action_plans ap
      join public.users u on u.id = ap.user_id
     where ap.status = 'active'
       and (u.role ilike '%consultant%' or u.role ilike '%agent%'
            or u.role ilike '%team_leader%' or u.role ~ 'Level\s*[3-6]')
       and not exists (
           select 1 from public.action_plan_checks c
            where c.plan_id = ap.id
              and c.check_date = current_date
              and c.reminder_sent = true
       );
    get diagnostics inserted = row_count;
    return inserted;
end;
$func$;


-- ---------------------------------------------------------------------------
-- 4. Schedule the jobs with pg_cron
-- ---------------------------------------------------------------------------
-- Times in UTC. MYT = UTC+8.
do $sched$
declare jid bigint;
begin
    if not exists (select 1 from pg_extension where extname = 'pg_cron') then
        raise notice 'pg_cron not enabled — enable in Dashboard → Database → Extensions, then re-run.';
        return;
    end if;

    -- Weekly inactivity: Sundays 18:00 UTC = Monday 02:00 MYT
    for jid in select jobid from cron.job where jobname = 'weekly_inactivity_scoring' loop
        perform cron.unschedule(jid);
    end loop;
    perform cron.schedule(
        'weekly_inactivity_scoring',
        '0 18 * * 0',
        $job$select public.apply_weekly_inactivity_scoring();$job$
    );

    -- Action-plan reminder: Mondays 01:00 UTC = 09:00 MYT
    for jid in select jobid from cron.job where jobname = 'action_plan_monday_reminder' loop
        perform cron.unschedule(jid);
    end loop;
    perform cron.schedule(
        'action_plan_monday_reminder',
        '0 1 * * 1',
        $job$select public.queue_action_plan_reminders();$job$
    );
end $sched$;


-- ---------------------------------------------------------------------------
-- 5. Verification (run manually after applying)
-- ---------------------------------------------------------------------------
-- select jobname, schedule, command from cron.job
--   where jobname in ('weekly_inactivity_scoring','action_plan_monday_reminder');
-- select tgname, tgrelid::regclass from pg_trigger
--   where tgname in ('prospects_score_audit','customers_score_audit');
-- update public.prospects set score = coalesce(score,0) + 1
--   where id = (select id from public.prospects limit 1);
-- select * from public.score_history order by id desc limit 1;
