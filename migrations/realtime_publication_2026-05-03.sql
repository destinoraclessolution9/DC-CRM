-- ============================================================================
-- Enable Realtime broadcast for the three tables the notification badge cares
-- about. After this, the browser can subscribe via supabase.channel(...) and
-- get push events instead of polling every 5 minutes.
--
-- Date: 2026-05-03
-- ----------------------------------------------------------------------------
-- Realtime broadcasts respect the row's SELECT RLS policy — only clients that
-- could SELECT the changed row receive the event. So enabling Realtime on a
-- table doesn't bypass any access control, it just routes change events
-- through the realtime websocket.
-- Idempotent: ALTER PUBLICATION ADD TABLE is wrapped in DO blocks so re-running
-- after a table is already in the publication is a no-op.
-- ============================================================================

do $rt$
declare
    t text;
begin
    foreach t in array array['cps_intake_requests','refill_reminders','activities']
    loop
        if not exists (
            select 1 from pg_publication_tables
            where pubname = 'supabase_realtime'
              and schemaname = 'public'
              and tablename = t
        ) then
            execute format('alter publication supabase_realtime add table public.%I', t);
            raise notice 'added % to supabase_realtime', t;
        else
            raise notice '% already in supabase_realtime, skipping', t;
        end if;
    end loop;
end $rt$;

-- Verification
-- SELECT tablename FROM pg_publication_tables
--   WHERE pubname='supabase_realtime' ORDER BY tablename;
