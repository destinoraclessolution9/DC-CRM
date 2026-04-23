-- ============================================================================
-- RLS Helper Functions — SAFE, ADDITIVE
-- ============================================================================
-- These functions are SECURITY DEFINER + STABLE. They expose a clean API for
-- future per-row RLS policies to scope data by the caller's role level +
-- reporting tree. They have NO effect on the app today — policies still use
-- auth_full_access — so creating them is a no-op risk-wise.
--
-- When you're ready to harden RLS, follow migrations/rls_hardening_plan.md.
-- ============================================================================

-- Caller's level (1-14) parsed from users.role, or NULL if not linked.
CREATE OR REPLACE FUNCTION current_user_level() RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER STABLE AS $func$
DECLARE
    lvl integer;
BEGIN
    SELECT (regexp_matches(role, 'Level\s+(\d+)'))[1]::integer
      INTO lvl
      FROM users
     WHERE auth_user_id = auth.uid()
     LIMIT 1;
    RETURN lvl;
END;
$func$;

GRANT EXECUTE ON FUNCTION current_user_level() TO authenticated, anon;

-- Caller's users.id (bigint).
CREATE OR REPLACE FUNCTION current_user_row_id() RETURNS bigint
LANGUAGE sql SECURITY DEFINER STABLE AS $func$
    SELECT id FROM users WHERE auth_user_id = auth.uid() LIMIT 1;
$func$;

GRANT EXECUTE ON FUNCTION current_user_row_id() TO authenticated, anon;

-- Set of user IDs the caller is allowed to see. Uses reporting_to to walk
-- the org tree; adapt when the hierarchy changes.
CREATE OR REPLACE FUNCTION current_user_visible_ids() RETURNS SETOF bigint
LANGUAGE plpgsql SECURITY DEFINER STABLE AS $func$
DECLARE
    lvl integer := current_user_level();
    me bigint := current_user_row_id();
BEGIN
    IF lvl IS NULL THEN RETURN; END IF;
    IF lvl <= 2 THEN
        -- Super Admin / Marketing Manager: see everyone
        RETURN QUERY SELECT id FROM users WHERE status IS DISTINCT FROM 'deleted';
    ELSIF lvl <= 10 THEN
        -- Manager levels: self + direct + indirect reports (via reporting_to)
        RETURN QUERY
        WITH RECURSIVE tree AS (
            SELECT id FROM users WHERE id = me
            UNION
            SELECT u.id FROM users u JOIN tree t ON u.reporting_to = t.id
        )
        SELECT id FROM tree;
    ELSE
        -- Agents (11+): self only
        RETURN QUERY SELECT me;
    END IF;
END;
$func$;

GRANT EXECUTE ON FUNCTION current_user_visible_ids() TO authenticated, anon;
