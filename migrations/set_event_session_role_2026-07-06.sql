-- set_event_session_role_2026-07-06.sql
-- PER-SESSION event roles (owner decision: credit is per date, not per event series).
-- event_roles JSONB is now keyed by session date:
--   { "2026-07-18": { "main_organizer": {"id":123,"name":"..."}, ... }, "2026-07-23": {...} }
-- Keying by date (not by activity row) means every agent's activity row for the same
-- (event, date) resolves the same session roles, and the modal reads them straight off
-- the full-fetched events row. Storing the agent id makes future credit/attribution
-- ("agent X was 主讲老师 for N sessions") a simple query.
--
-- Atomic nested `||` merge — never clobbers another session's roles or another role in
-- the same session. Derives the name from users (rejects a forged/unknown id). Returns
-- the merged roles object for that date so the client confirms the write. SECURITY
-- INVOKER; ungated at the app layer per owner decision (any agent may assign).
-- Additive: the older flat set_event_role / set_event_role_name functions are left in
-- place (now unused) rather than dropped.

CREATE OR REPLACE FUNCTION public.set_event_session_role(
    p_event_id     BIGINT,
    p_session_date TEXT,
    p_role_key     TEXT,
    p_user_id      BIGINT DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
    v_session JSONB;
    v_val     JSONB;
    v_name    TEXT;
BEGIN
    IF p_role_key NOT IN ('main_organizer','venue_lead','registration_lead','speaker','emcee') THEN
        RAISE EXCEPTION 'invalid event role key: %', p_role_key USING ERRCODE = '22023';
    END IF;
    IF p_session_date IS NULL OR p_session_date !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN
        RAISE EXCEPTION 'invalid session date: %', p_session_date USING ERRCODE = '22023';
    END IF;

    IF p_user_id IS NULL THEN
        v_val := 'null'::jsonb;
    ELSE
        SELECT full_name INTO v_name FROM public.users WHERE id = p_user_id;
        IF v_name IS NULL THEN
            RAISE EXCEPTION 'unknown user id: %', p_user_id USING ERRCODE = '23503';
        END IF;
        v_val := jsonb_build_object('id', p_user_id, 'name', v_name);
    END IF;

    UPDATE public.events
       SET event_roles = COALESCE(event_roles, '{}'::jsonb)
           || jsonb_build_object(
                p_session_date,
                COALESCE(event_roles -> p_session_date, '{}'::jsonb) || jsonb_build_object(p_role_key, v_val)
              )
     WHERE id = p_event_id
     RETURNING event_roles -> p_session_date INTO v_session;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'event not found: %', p_event_id USING ERRCODE = 'P0002';
    END IF;

    RETURN COALESCE(v_session, '{}'::jsonb);
END;
$$;

REVOKE ALL ON FUNCTION public.set_event_session_role(BIGINT, TEXT, TEXT, BIGINT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_event_session_role(BIGINT, TEXT, TEXT, BIGINT) TO authenticated;
