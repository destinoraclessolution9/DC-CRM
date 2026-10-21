-- ci/sql/cps-minutes-check.sql — run AFTER migrations/2026-10-21_cps_minutes.sql; read-only dry run
-- (RAISE at the end → nothing is kept): pushes queued, to-do minutes rows, Monday line.
do $$ declare j json; n int; w int; begin
 n := queue_minutes_push(); w := queue_pipeline_weekly_push();
 select json_build_object(
  'minutes_pushes', n,
  'sample', (select json_agg(json_build_object('t',title,'b',body,'u',url)) from (select * from notification_outbox where kind='meeting_minutes' order by id desc limit 4) x),
  'todo_minutes', (select json_agg(t.name||' — '||t.why) from journey_todo_for(1775541962294, 50) t where t.kind='minutes'),
  'todo_cps', (select count(*) from journey_todo_for(1775541962294, 50) t where t.kind='cps'),
  'weekly_kean', (select body from notification_outbox where kind='pipeline_weekly' and user_id=1775637005921 order by id desc limit 1),
  'filled_last30', (select count(*) filter (where activity_has_minutes(a))||'/'||count(*) from activities a where activity_type in ('CPS','FTF') and activity_date between current_date-30 and current_date-1)) into j;
 raise exception 'DRY %', j; end $$;
