-- approval_queue: let a submitter SELECT their OWN queue rows.
-- ✅ APPLIED to live (remuwhxvzkzjtgbzqjaa) 2026-07-27, verified in pg_policy.
--
-- WHY (this was a live revenue bug, not just a blocker for the new feature):
--   approval_queue_agent_insert_2026-07-14.sql granted agents INSERT
--     (with check: submitted_by = current_user_row_id() or level <= 2)
--   but SELECT stayed `admin_select` (level <= 2) from
--   rls_replace_allow_all_2026-04-24.sql.
--
--   Every write goes through AppDataStore.create(), which issues
--     .insert(row).select().single()          -- data.js:2293-2300
--   i.e. PostgREST `Prefer: return=representation`. RLS is applied to the
--   RETURNING rows, so for a level>=3 agent the representation came back EMPTY,
--   .single() raised PGRST116, and PostgREST ROLLED THE INSERT BACK.
--
--   Net effect: an agent could pass the INSERT policy and still lose the row.
--   saveMeetingOutcome caught it and set crSyncStatus='submitted_no_queue'
--   (chunks/script-calendar.js:6518-6520) -> "approval queue write failed",
--   with the sale sitting in prospects.closing_record but never reaching the
--   Manager Approval Queue -> never booked into `purchases` -> invisible revenue.
--   This matches the lost-sale pattern recorded in DATA_AUDIT_2026-07-17.md.
--
-- SCOPE: additive and minimal. Policies are OR-ed, so this only ADDS visibility
-- of rows the caller submitted themselves (data they authored). It does not
-- widen any other agent's or manager's view, and admin_select is untouched.

drop policy if exists approval_queue_agent_select on public.approval_queue;

create policy approval_queue_agent_select on public.approval_queue
  for select to authenticated
  using (
    submitted_by = public.current_user_row_id()
    or coalesce(public.current_user_level(), 99) <= 2
  );

notify pgrst, 'reload schema';
