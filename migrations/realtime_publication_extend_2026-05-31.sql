-- ============================================================================
-- Extend Realtime publication to the three core CRM tables.
--
-- Date: 2026-05-31
-- Builds on realtime_publication_2026-05-03.sql which added
--   cps_intake_requests, refill_reminders, activities.
--
-- Why now: the AppDataStore SWR layer currently delta-polls these three
-- tables (updated_at > lastSync) on every page reload — costs one round-trip
-- per table per reload even when nothing has changed. Realtime broadcasts
-- the deltas as they happen, so a connected client gets push events into the
-- in-memory + localStorage cache, and the cold-load delta poll becomes
-- unnecessary for clients that stayed connected.
--
-- Security: Realtime broadcasts RESPECT the row's SELECT RLS policy. Only
-- clients that could SELECT the changed row receive the event. Enabling
-- Realtime on a table does NOT bypass access control — it just routes change
-- events through the realtime websocket subject to the same auth checks.
--
-- Idempotent: wrapped in a DO block that checks pg_publication_tables before
-- ALTER PUBLICATION ADD, so re-running is a no-op.
-- ============================================================================

do $rt$
declare
    t text;
begin
    foreach t in array array['prospects', 'customers', 'users']
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
--   WHERE pubname='supabase_realtime' AND schemaname='public' ORDER BY tablename;
-- Should include (post-migration):
--   activities, cps_intake_requests, customers, prospects, refill_reminders, users
