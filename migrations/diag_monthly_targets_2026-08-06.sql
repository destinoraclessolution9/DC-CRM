-- WHY IS THE DDL NOT COMMITTING?
--
-- Established 2026-08-06 by running the ALTER and the check as SEPARATE submissions
-- (two transactions): the check returns 0. The ALTER reports success and is rolled
-- back. Everything else was already eliminated — right project, right schema, public
-- is the only exposed schema, PostgREST cache survived NOTIFY + a full restart.
--
-- NOTE the earlier version of this file was WRONG: it ran the ALTER and the
-- information_schema check in ONE submission, so the check read its own uncommitted
-- write and always reported success. It proved nothing about persistence.
--
-- STEP 1 — run this alone and read the row.
--   on_read_replica = true      -> the editor is pointed at a replica; DDL cannot commit
--   txn_read_only / default_read_only = on -> the session is read-only
--   event_triggers > 0          -> something may be aborting DDL; list them with the
--                                  query at the bottom

select current_user,
       session_user,
       current_setting('transaction_read_only')         as txn_read_only,
       current_setting('default_transaction_read_only') as default_read_only,
       pg_is_in_recovery()                              as on_read_replica,
       (select count(*) from pg_event_trigger)          as event_triggers;


-- STEP 2 — run ONLY this line, as its own submission, and read the editor's output
-- verbatim, including anything in red:
--
--   alter table public.monthly_targets add column if not exists is_manual boolean not null default false;
--
-- Then, as a THIRD separate submission, confirm whether it stuck:
--
--   select count(*) as is_manual_committed
--     from information_schema.columns
--    where table_schema='public' and table_name='monthly_targets' and column_name='is_manual';


-- If event_triggers > 0, list them:
--   select evtname, evtevent, evtenabled, p.proname
--     from pg_event_trigger e join pg_proc p on p.oid = e.evtfoid;
