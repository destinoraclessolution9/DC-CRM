-- set_event_role_rpc_2026-07-06.sql
-- Atomic assign/clear of one named event role on events.event_roles (JSONB).
-- Replaces the client read-modify-write in saveEventRole (which spread the whole
-- event_roles object off a possibly-stale getById cache and could lost-update a
-- concurrent editor). This RPC:
--   * validates the role key server-side,
--   * derives the display name from users (rejects unknown ids — no client-forged
--     names/ids get persisted),
--   * merges just the one key with `||` so other roles are never clobbered,
--   * mirrors 主讲老师 into events.speaker for the noticeboard,
--   * returns the merged event_roles so the caller can confirm the write landed.
-- SECURITY INVOKER: runs under the caller's RLS (same authorisation surface as the
-- previous direct UPDATE) — the app still gates the UI/handler to managers/creator.

CREATE OR REPLACE FUNCTION public.set_event_role(
    p_event_id BIGINT,
    p_role_key TEXT,
    p_user_id  BIGINT DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
    v_roles JSONB;
    v_name  TEXT;
    v_val   JSONB;
BEGIN
    IF p_role_key NOT IN ('main_organizer','venue_lead','registration_lead','speaker','emcee') THEN
        RAISE EXCEPTION 'invalid event role key: %', p_role_key USING ERRCODE = '22023';
    END IF;

    IF p_user_id IS NULL THEN
        v_val  := 'null'::jsonb;
        v_name := NULL;
    ELSE
        SELECT full_name INTO v_name FROM public.users WHERE id = p_user_id;
        IF v_name IS NULL THEN
            RAISE EXCEPTION 'unknown user id: %', p_user_id USING ERRCODE = '23503';
        END IF;
        v_val := jsonb_build_object('id', p_user_id, 'name', v_name);
    END IF;

    UPDATE public.events
       SET event_roles = COALESCE(event_roles, '{}'::jsonb) || jsonb_build_object(p_role_key, v_val),
           speaker = CASE WHEN p_role_key = 'speaker' THEN v_name ELSE speaker END
     WHERE id = p_event_id
     RETURNING event_roles INTO v_roles;

    IF v_roles IS NULL THEN
        RAISE EXCEPTION 'event not found: %', p_event_id USING ERRCODE = 'P0002';
    END IF;

    RETURN v_roles;
END;
$$;

REVOKE ALL ON FUNCTION public.set_event_role(BIGINT, TEXT, BIGINT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_event_role(BIGINT, TEXT, BIGINT) TO authenticated;
