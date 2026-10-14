-- Referrer picker search (2026-10-14).
-- The "Referred By" picker searched only ACTIVE prospects + staff, through RLS —
-- so customers, converted prospects and any prospect outside the agent's team
-- could never be picked even though they exist. This SECURITY DEFINER function
-- searches customers + all prospects + staff for ANY signed-in user, but returns
-- only what the picker needs: id, kind, name and the LAST 4 phone digits.
-- No addresses, full phones, ICs or other fields leave the function.
-- Additive only.
CREATE OR REPLACE FUNCTION public.search_referrers(p_term text, p_limit int DEFAULT 8)
RETURNS TABLE (kind text, id bigint, full_name text, phone_last4 text, extra text, rank int)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    t      text := btrim(coalesce(p_term, ''));
    pat    text;
    digits text := regexp_replace(coalesce(p_term, ''), '\D', '', 'g');
    lim    int  := least(greatest(coalesce(p_limit, 8), 1), 20);
BEGIN
    -- Signed-in CRM users only (anon gets nothing).
    IF auth.uid() IS NULL OR current_user_row_id() IS NULL THEN
        RETURN;
    END IF;
    IF length(t) < 2 THEN
        RETURN;
    END IF;
    pat := '%' || replace(replace(replace(t, '\', '\'), '%', '\%'), '_', '\_') || '%';

    RETURN QUERY
    WITH c AS (
        SELECT 'Customer'::text AS kind, cu.id, cu.full_name,
               right(regexp_replace(coalesce(cu.phone, ''), '\D', '', 'g'), 4) AS phone_last4,
               NULL::text AS extra,
               CASE WHEN lower(cu.full_name) = lower(t) THEN 0
                    WHEN cu.full_name ILIKE t || '%' THEN 1 ELSE 2 END AS rank
        FROM customers cu
        WHERE cu.full_name ILIKE pat OR cu.nickname ILIKE pat
           OR (length(digits) >= 3 AND (regexp_replace(coalesce(cu.phone, ''), '\D', '', 'g') LIKE '%' || digits || '%'
                                        OR regexp_replace(coalesce(cu.ic_number, ''), '\D', '', 'g') LIKE '%' || digits || '%'))
        ORDER BY 6, 3
        LIMIT lim
    ), p AS (
        SELECT 'Prospect'::text, pr.id, pr.full_name,
               right(regexp_replace(coalesce(pr.phone, ''), '\D', '', 'g'), 4),
               NULL::text,
               CASE WHEN lower(pr.full_name) = lower(t) THEN 0
                    WHEN pr.full_name ILIKE t || '%' THEN 1 ELSE 2 END
        FROM prospects pr
        WHERE (pr.full_name ILIKE pat OR pr.nickname ILIKE pat
               OR (length(digits) >= 3 AND (regexp_replace(coalesce(pr.phone, ''), '\D', '', 'g') LIKE '%' || digits || '%'
                                            OR regexp_replace(coalesce(pr.ic_number, ''), '\D', '', 'g') LIKE '%' || digits || '%')))
          -- A converted prospect that already has its customer row shows once, as the Customer.
          AND NOT EXISTS (SELECT 1 FROM customers cx WHERE cx.converted_from_prospect_id = pr.id)
        ORDER BY 6, 3
        LIMIT lim
    ), u AS (
        SELECT 'Consultant'::text, us.id, us.full_name,
               NULL::text,
               us.agent_code,
               CASE WHEN lower(us.full_name) = lower(t) THEN 0
                    WHEN us.full_name ILIKE t || '%' THEN 1 ELSE 2 END
        FROM users us
        WHERE us.full_name ILIKE pat
          -- Same band the old picker used: everyone except Level 1/2 admins.
          AND coalesce(substring(us.role FROM 'Level\s*(\d+)')::int, 12) >= 3
        ORDER BY 6, 3
        LIMIT lim
    )
    SELECT * FROM c UNION ALL SELECT * FROM p UNION ALL SELECT * FROM u;
END;
$$;

REVOKE ALL ON FUNCTION public.search_referrers(text, int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.search_referrers(text, int) TO authenticated;
