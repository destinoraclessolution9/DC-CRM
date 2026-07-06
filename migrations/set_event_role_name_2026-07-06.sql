-- set_event_role_name_2026-07-06.sql
-- Free-text variant of the event-role setter. Per owner feedback the five 活动负责人
-- roles are now plain text fields (type any name, incl. an external speaker) instead
-- of a consultant dropdown, and are editable by anyone who can see the event (same as
-- the ungated + Add Attendee / + Add Consultant actions in the same modal).
-- Still an atomic single-key jsonb `||` merge so concurrent edits never clobber each
-- other's roles; stores {name:"..."} (or null when cleared); mirrors 主讲老师→speaker;
-- returns the merged event_roles so the client confirms the write landed.
-- Additive: the older set_event_role(bigint,text,bigint) id-based function is left in
-- place (now unused) rather than dropped.

CREATE OR REPLACE FUNCTION public.set_event_role_name(
    p_event_id BIGINT,
    p_role_key TEXT,
    p_name     TEXT DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
    v_roles JSONB;
    v_val   JSONB;
    v_clean TEXT;
BEGIN
    IF p_role_key NOT IN ('main_organizer','venue_lead','registration_lead','speaker','emcee') THEN
        RAISE EXCEPTION 'invalid event role key: %', p_role_key USING ERRCODE = '22023';
    END IF;

    v_clean := NULLIF(btrim(COALESCE(p_name, '')), '');
    IF v_clean IS NULL THEN
        v_val := 'null'::jsonb;
    ELSE
        v_val := jsonb_build_object('name', v_clean);
    END IF;

    UPDATE public.events
       SET event_roles = COALESCE(event_roles, '{}'::jsonb) || jsonb_build_object(p_role_key, v_val),
           speaker = CASE WHEN p_role_key = 'speaker' THEN v_clean ELSE speaker END
     WHERE id = p_event_id
     RETURNING event_roles INTO v_roles;

    IF v_roles IS NULL THEN
        RAISE EXCEPTION 'event not found: %', p_event_id USING ERRCODE = 'P0002';
    END IF;

    RETURN v_roles;
END;
$$;

REVOKE ALL ON FUNCTION public.set_event_role_name(BIGINT, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_event_role_name(BIGINT, TEXT, TEXT) TO authenticated;
