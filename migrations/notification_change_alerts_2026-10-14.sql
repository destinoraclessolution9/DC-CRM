-- Phase 2 notifications: alerts when an activity's date / time / venue / title
-- changes, or it is cancelled / deleted. Additive + idempotent. Applied live 2026-10-14.
--
--   activities AFTER UPDATE (only when those columns really change)
--   activities AFTER DELETE
--     → notify-on-activity { type, record, old_record, editor_id }
--   notification-dispatch cron (every minute) delivers due outbox rows, so
--   held/merged change alerts go out ~2–3 min after the last edit.

-- 1. Outbox: change-merge metadata + atomic claim for concurrent dispatchers.
ALTER TABLE public.notification_outbox ADD COLUMN IF NOT EXISTS meta jsonb;
ALTER TABLE public.notification_outbox ADD COLUMN IF NOT EXISTS claimed_at timestamptz;
ALTER TABLE public.notification_outbox DROP CONSTRAINT IF EXISTS notification_outbox_status_check;
ALTER TABLE public.notification_outbox ADD CONSTRAINT notification_outbox_status_check
    CHECK (status IN ('pending','sending','sent','no_device','failed','merged'));
CREATE INDEX IF NOT EXISTS notification_outbox_pending_activity_idx
    ON public.notification_outbox (activity_id) WHERE status = 'pending';

-- 2. Headers for edge-function calls from triggers. Copied (inside the DB, never
--    printed) from the existing trigger_notify_activity_push so both triggers
--    use the same server credential.
DO $$
DECLARE
    v_def  text;
    v_auth text;
BEGIN
    SELECT pg_get_functiondef(p.oid) INTO v_def
      FROM pg_proc p WHERE p.proname = 'trigger_notify_activity_push' LIMIT 1;
    v_auth := substring(v_def FROM '''Authorization'',\s*''([^'']+)''');
    IF v_auth IS NULL THEN
        RAISE EXCEPTION 'could not read Authorization from trigger_notify_activity_push';
    END IF;
    EXECUTE format($f$
        CREATE OR REPLACE FUNCTION public._edge_fn_headers()
        RETURNS jsonb LANGUAGE sql IMMUTABLE SECURITY DEFINER SET search_path = public AS
        $b$ SELECT jsonb_build_object('Content-Type','application/json','Authorization',%L) $b$
    $f$, v_auth);
END $$;
REVOKE ALL ON FUNCTION public._edge_fn_headers() FROM PUBLIC, anon, authenticated;

-- 3. Change / delete trigger.
CREATE OR REPLACE FUNCTION public.trigger_notify_activity_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'net'
AS $function$
DECLARE
    v_today date := (now() AT TIME ZONE 'Asia/Kuala_Lumpur')::date;
    v_old   date := CASE WHEN TG_OP IN ('UPDATE','DELETE') THEN OLD.activity_date END;
    v_new   date := CASE WHEN TG_OP = 'UPDATE' THEN NEW.activity_date END;
    v_editor bigint;
BEGIN
    -- Edits/deletes of past records are housekeeping, not news.
    IF COALESCE(v_old, v_today - 1) < v_today AND COALESCE(v_new, v_today - 1) < v_today THEN
        RETURN NULL;
    END IF;
    BEGIN
        v_editor := public.current_user_row_id();   -- NULL for service/cron writes
    EXCEPTION WHEN OTHERS THEN
        v_editor := NULL;
    END;
    PERFORM net.http_post(
        url     := 'https://remuwhxvzkzjtgbzqjaa.supabase.co/functions/v1/notify-on-activity',
        headers := public._edge_fn_headers(),
        body    := jsonb_build_object(
            'type',       TG_OP,
            'record',     CASE WHEN TG_OP = 'UPDATE' THEN to_jsonb(NEW) END,
            'old_record', to_jsonb(OLD),
            'editor_id',  v_editor)
    );
    RETURN NULL;
END;
$function$;

DROP TRIGGER IF EXISTS on_activity_change ON public.activities;
CREATE TRIGGER on_activity_change
    AFTER UPDATE ON public.activities
    FOR EACH ROW
    WHEN (OLD.activity_date    IS DISTINCT FROM NEW.activity_date
       OR OLD.start_time       IS DISTINCT FROM NEW.start_time
       OR OLD.venue            IS DISTINCT FROM NEW.venue
       OR OLD.location_address IS DISTINCT FROM NEW.location_address
       OR OLD.activity_title   IS DISTINCT FROM NEW.activity_title
       OR (OLD.status IS DISTINCT FROM NEW.status AND lower(COALESCE(NEW.status, '')) = 'cancelled'))
    EXECUTE FUNCTION public.trigger_notify_activity_change();

DROP TRIGGER IF EXISTS on_activity_delete ON public.activities;
CREATE TRIGGER on_activity_delete
    AFTER DELETE ON public.activities
    FOR EACH ROW
    EXECUTE FUNCTION public.trigger_notify_activity_change();

-- 4. Deliver due outbox rows every minute (held change alerts, retries).
--    Reuses the reminder job's request (same function + secret header), with
--    mode=dispatch: a cheap due-row check, then delivery only if needed.
DO $$
DECLARE v_cmd text;
BEGIN
    IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'notification-dispatch') THEN
        SELECT replace(command, 'body := ''{}''::jsonb', 'body := ''{"mode":"dispatch"}''::jsonb')
          INTO v_cmd FROM cron.job WHERE jobname = 'activity-reminders';
        IF v_cmd IS NULL OR position('"mode":"dispatch"' IN v_cmd) = 0 THEN
            RAISE EXCEPTION 'could not derive dispatch command from activity-reminders job';
        END IF;
        PERFORM cron.schedule('notification-dispatch', '* * * * *', v_cmd);
    END IF;
END $$;
