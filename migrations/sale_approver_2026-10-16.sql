-- Sale approvers below Level 2 (owner ask 2026-10-16).
--
-- Until now only L1/L2 could read or update approval_queue (admin_select /
-- admin_write), so a sale submitted by an agent waited for Super Admin or the
-- Marketing Manager. The owner wants Oo Kean Cherng (Level 5 Team Leader) to
-- approve the sales of HIS OWN TEAM and to be notified the moment one is
-- submitted. Sales and KPIs keep counting approved sales only.
--
-- Grant mechanism: user_view_overrides.functions (jsonb, reserved for per-user
-- function grants since 2026-08-07) → {"approve_sales": true}. Only L1 can write
-- that table (uvo_write), so nobody can grant themselves.
--
-- Scope = the approver's own reporting tree (current_user_visible_ids()), types
-- new_sale + new_customer only (a first sale books through the conversion).

-- 1. Is the current user a sale approver?
create or replace function public.can_approve_sales()
returns boolean
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
    select coalesce(public.current_user_level(), 99) <= 2
        or exists (
            select 1 from public.user_view_overrides o
            where o.user_id = public.current_user_row_id()
              and coalesce(o.functions ->> 'approve_sales', 'false') = 'true'
        );
$$;
grant execute on function public.can_approve_sales() to authenticated;

-- 2. Approvers see and decide their team's sale / conversion requests.
drop policy if exists approval_queue_approver_select on public.approval_queue;
create policy approval_queue_approver_select on public.approval_queue
    for select to authenticated
    using (
        public.can_approve_sales()
        and approval_type in ('new_sale', 'new_customer')
        and submitted_by in (select public.current_user_visible_ids())
    );

drop policy if exists approval_queue_approver_update on public.approval_queue;
create policy approval_queue_approver_update on public.approval_queue
    for update to authenticated
    using (
        public.can_approve_sales()
        and approval_type in ('new_sale', 'new_customer')
        and submitted_by in (select public.current_user_visible_ids())
    )
    with check (
        public.can_approve_sales()
        and approval_type in ('new_sale', 'new_customer')
        and submitted_by in (select public.current_user_visible_ids())
    );

-- 3. The prospects guard let only L1-4 convert a prospect / archive a submitted
--    closing record. Approvers need the same bypass; RLS (auth_write_update)
--    still limits which prospects they can write to their own team.
create or replace function public.prospects_approval_guard()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
declare
  caller_level int := coalesce(public.current_user_level(), 99);
  old_cr_status text := coalesce(old.closing_record->>'status', 'draft');
begin
  -- Service-role / edge functions / direct DB (no end-user JWT), management, and
  -- granted sale approvers bypass.
  if auth.uid() is null or caller_level <= 4 or public.can_approve_sales() then
    return new;
  end if;

  -- A non-manager may not self-grant the approved conversion state.
  if new.conversion_status is distinct from old.conversion_status
     and new.conversion_status = 'approved' then
    raise exception 'prospects_guard: not authorized to approve a conversion';
  end if;

  -- ...nor flip the prospect to a converted customer directly.
  if new.status is distinct from old.status
     and new.status = 'converted' then
    raise exception 'prospects_guard: not authorized to mark a prospect converted';
  end if;

  -- ...nor edit a closing_record that is already submitted/approved (lock bypass).
  -- Draft -> submitted (the normal auto-submit) is allowed because OLD is 'draft'.
  if old_cr_status in ('submitted', 'approved')
     and new.closing_record is distinct from old.closing_record then
    raise exception 'prospects_guard: closing record is locked (%) — cannot edit', old_cr_status;
  end if;

  return new;
end;
$function$;

-- 4. Notify the submitter's approvers when a sale is submitted. One outbox row
--    per approver whose reporting tree contains the submitter; the
--    every-minute notification-dispatch cron pushes it to their phones and it
--    shows in the bell. Never blocks the submit.
create or replace function public.notify_sale_approvers()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
    r record;
    agent_name text;
    client_name text;
    amt_txt text;
begin
    if new.approval_type <> 'new_sale' or new.status <> 'pending' then
        return new;
    end if;
    select full_name into agent_name from public.users where id = new.submitted_by;
    client_name := coalesce(nullif(new.snapshot_after ->> 'prospect_name', ''), nullif(new.snapshot_after ->> 'full_name', ''), '');
    amt_txt := new.snapshot_after ->> 'sale_amount';
    amt_txt := case when amt_txt ~ '^\s*-?[0-9]+(\.[0-9]+)?\s*$'
                    then to_char(amt_txt::numeric, 'FM999,999,990') else '' end;

    for r in
        select o.user_id
        from public.user_view_overrides o
        where coalesce(o.functions ->> 'approve_sales', 'false') = 'true'
          and new.submitted_by in (
              with recursive tree as (
                  select o.user_id as id
                  union
                  select u.id from public.users u join tree t on u.reporting_to = t.id
              )
              select id from tree
          )
    loop
        insert into public.notification_outbox (user_id, kind, priority, title, body, url, dedupe_key, meta)
        values (
            r.user_id,
            'sale_approval',
            'normal',
            'Sale to approve' || case when amt_txt <> '' then ' · RM ' || amt_txt else '' end,
            trim(both ' |' from coalesce(agent_name, '') || ' | ' || client_name),
            './index.html?approve=1#customers',
            'approval:' || new.id,
            jsonb_build_object('approval_id', new.id, 'prospect_id', new.prospect_id)
        )
        on conflict (user_id, dedupe_key) do nothing;
    end loop;
    return new;
exception when others then
    raise warning 'notify_sale_approvers failed: %', sqlerrm;
    return new;
end;
$$;

drop trigger if exists trg_notify_sale_approvers on public.approval_queue;
create trigger trg_notify_sale_approvers
    after insert on public.approval_queue
    for each row execute function public.notify_sale_approvers();

-- 5. The grant itself: Oo Kean Cherng (users.id 1775637005921).
--    Empty grants/revokes = his tabs stay exactly as his role gives them.
insert into public.user_view_overrides (user_id, grants, revokes, functions, updated_by)
values (1775637005921, '{}', '{}', '{"approve_sales": true}'::jsonb, 9999)
on conflict (user_id) do update
    set functions = public.user_view_overrides.functions || '{"approve_sales": true}'::jsonb,
        updated_by = 9999, updated_at = now();
