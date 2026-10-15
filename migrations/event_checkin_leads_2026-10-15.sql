-- event_checkin_leads_2026-10-15.sql
-- 报到负责人 (check-in lead) gets a second slot and becomes a gated role.
--   * New role key registration_lead_2 (报到负责人 2) next to registration_lead (报到负责人 1).
--   * Only that session's 主要负责人 (main_organizer) or an admin / marketing
--     manager (level <= 2) may assign or clear either check-in slot. The holder
--     sees every attendee's name for that session and runs the attendance ticks.
--   * The other four roles stay ungated (owner decision, unchanged).
--   * Bumps events.updated_at so other devices' delta-sync picks the change up.
-- Idempotent: CREATE OR REPLACE with the same signature + grants.

CREATE OR REPLACE FUNCTION public.set_event_session_role(p_event_id bigint, p_session_date text, p_role_key text, p_user_id bigint DEFAULT NULL::bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
    v_session JSONB;
    v_val     JSONB;
    v_name    TEXT;
    v_main    TEXT;
    v_level   INTEGER;
BEGIN
    IF p_role_key NOT IN ('main_organizer','venue_lead','registration_lead','registration_lead_2','speaker','emcee') THEN
        RAISE EXCEPTION 'invalid event role key: %', p_role_key USING ERRCODE = '22023';
    END IF;
    IF p_session_date IS NULL OR p_session_date !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN
        RAISE EXCEPTION 'invalid session date: %', p_session_date USING ERRCODE = '22023';
    END IF;

    -- Check-in slots: only this session's main organiser or level <= 2.
    IF p_role_key IN ('registration_lead','registration_lead_2') THEN
        v_level := current_user_level();
        IF v_level IS NULL OR v_level > 2 THEN
            SELECT event_roles -> p_session_date -> 'main_organizer' ->> 'id'
              INTO v_main
              FROM public.events WHERE id = p_event_id;
            IF v_main IS NULL OR v_main <> current_user_row_id()::text THEN
                RAISE EXCEPTION '只有主要负责人可以指派报到负责人 · Only the main organiser can assign the check-in lead'
                    USING ERRCODE = '42501';
            END IF;
        END IF;
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
              ),
           updated_at = now()
     WHERE id = p_event_id
     RETURNING event_roles -> p_session_date INTO v_session;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'event not found: %', p_event_id USING ERRCODE = 'P0002';
    END IF;

    RETURN COALESCE(v_session, '{}'::jsonb);
END;
$function$;
