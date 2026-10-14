-- Phase 1 notifications: one outbox table = queue + delivery log + bell inbox.
-- Every push (new activity, reminder, morning summary, co-agent invite/reply,
-- 福运相随 highlight, Settings test) is written here first, one row per
-- recipient, then delivered by send-activity-push. Rows exist even when the
-- user has no phone signed up, so the in-app bell is the fallback channel.
-- Additive + idempotent. Applied live 2026-10-14.

CREATE TABLE IF NOT EXISTS public.notification_outbox (
    id            bigserial   PRIMARY KEY,
    user_id       bigint      NOT NULL,                 -- recipient (users.id)
    kind          text        NOT NULL DEFAULT 'push',  -- activity_created | activity_reminder | daily_summary | coagent_invite | coagent_response | highlight | test | push
    priority      text        NOT NULL DEFAULT 'normal' CHECK (priority IN ('low','normal','high','urgent')),
    title         text        NOT NULL,
    body          text        NOT NULL DEFAULT '',
    url           text        NOT NULL DEFAULT './index.html#calendar',
    activity_id   bigint,
    dedupe_key    text,                                 -- same (user, key) is never queued twice
    due_at        timestamptz NOT NULL DEFAULT now(),
    status        text        NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','sent','no_device','failed','merged')),
    attempts      integer     NOT NULL DEFAULT 0,
    devices_sent  integer     NOT NULL DEFAULT 0,
    last_error    text,
    sent_at       timestamptz,
    read_at       timestamptz,
    created_at    timestamptz NOT NULL DEFAULT now()
);

-- Full (not partial) unique index so PostgREST on_conflict=user_id,dedupe_key
-- can infer it; NULL keys never conflict (NULLs are distinct).
CREATE UNIQUE INDEX IF NOT EXISTS notification_outbox_dedupe_uq
    ON public.notification_outbox (user_id, dedupe_key);
-- Dispatcher scan: only the rows still waiting / retryable.
CREATE INDEX IF NOT EXISTS notification_outbox_due_idx
    ON public.notification_outbox (due_at) WHERE status IN ('pending','failed');
-- Bell inbox + unread count.
CREATE INDEX IF NOT EXISTS notification_outbox_user_idx
    ON public.notification_outbox (user_id, created_at DESC);

ALTER TABLE public.notification_outbox ENABLE ROW LEVEL SECURITY;

-- Recipients read only their own rows. No client INSERT/UPDATE/DELETE policy:
-- rows are written by the edge functions (service role) and read state changes
-- only through mark_notifications_read() below.
DROP POLICY IF EXISTS notification_outbox_select_own ON public.notification_outbox;
CREATE POLICY notification_outbox_select_own ON public.notification_outbox
    FOR SELECT TO authenticated
    USING (user_id = public.current_user_row_id());

-- Mark the caller's notifications read (all unread when p_ids is NULL).
CREATE OR REPLACE FUNCTION public.mark_notifications_read(p_ids bigint[] DEFAULT NULL)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_uid bigint;
    v_n   integer;
BEGIN
    v_uid := public.current_user_row_id();
    IF v_uid IS NULL THEN RETURN 0; END IF;
    UPDATE public.notification_outbox
       SET read_at = now()
     WHERE user_id = v_uid
       AND read_at IS NULL
       AND (p_ids IS NULL OR id = ANY (p_ids));
    GET DIAGNOSTICS v_n = ROW_COUNT;
    RETURN v_n;
END;
$$;
REVOKE ALL ON FUNCTION public.mark_notifications_read(bigint[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mark_notifications_read(bigint[]) TO authenticated;

-- Live bell badge: Realtime pushes the recipient's new rows (RLS-filtered).
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_publication_tables
                   WHERE pubname = 'supabase_realtime' AND schemaname = 'public'
                     AND tablename = 'notification_outbox') THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE public.notification_outbox;
    END IF;
END $$;

-- Retention: keep 60 days (the bell shows the last 30).
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'notification-outbox-cleanup') THEN
        PERFORM cron.schedule('notification-outbox-cleanup', '15 19 * * *',  -- 03:15 MYT daily
            $c$DELETE FROM public.notification_outbox WHERE created_at < now() - interval '60 days'$c$);
    END IF;
END $$;
