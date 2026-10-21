-- Mute the old follow-up drafts (2026-10-21). 1,416 were still "pending" —
-- 1,386 older than 14 days, mostly event invites for events long past — so
-- agents tuned the whole panel out. The 📋 Today's top 5 is the daily list
-- now. Drafts are never deleted: they get status 'expired' (hidden from the
-- panel, still on record). Nightly: pending drafts due > 14 days ago, or for
-- an event that already happened, expire.
alter table public.follow_up_drafts drop constraint if exists follow_up_drafts_status_check;
alter table public.follow_up_drafts add constraint follow_up_drafts_status_check
    check (status in ('pending', 'sent', 'dismissed', 'expired'));

create or replace function public.expire_old_follow_up_drafts() returns integer
language plpgsql security definer set search_path = public as $$
declare v_today date := (now() at time zone 'Asia/Kuala_Lumpur')::date; v_n int;
begin
    update public.follow_up_drafts set status = 'expired', updated_at = now()
     where status = 'pending'
       and (due_date < v_today - 14 or (event_date is not null and event_date < v_today));
    get diagnostics v_n = row_count;
    return v_n;
end $$;
revoke all on function public.expire_old_follow_up_drafts() from public, anon, authenticated;
select public.expire_old_follow_up_drafts();
select cron.unschedule('expire-old-drafts') where exists (select 1 from cron.job where jobname = 'expire-old-drafts');
select cron.schedule('expire-old-drafts', '20 19 * * *', 'select public.expire_old_follow_up_drafts();');
