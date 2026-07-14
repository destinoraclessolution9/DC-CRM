-- RLS helper gaps (2026-07-14)
-- Context: every RLS helper (current_user_row_id / current_user_visible_ids /
-- current_user_level) maps the session via users.auth_user_id = auth.uid().
-- Health check 2026-07-13 found, among 24 non-deleted users: 3 rows with NULL
-- auth_user_id (those staff log in successfully yet see a COMPLETELY EMPTY
-- CRM) and 1 row whose role string doesn't match 'Level N' (the SQL parser
-- had no fallback, unlike the client's _getUserLevel at script.js:577).
-- Companion client fix (same day): login + session-restore now self-heal
-- users.auth_user_id, so admin-created rows link on first login.

-- 1) Backfill auth_user_id where a matching auth account exists (email match).
--    Additive: only fills NULLs, never overwrites an existing link.
UPDATE public.users u
   SET auth_user_id = au.id
  FROM auth.users au
 WHERE u.auth_user_id IS NULL
   AND u.email IS NOT NULL AND btrim(u.email) <> ''
   AND lower(btrim(au.email)) = lower(btrim(u.email))
   AND u.status IS DISTINCT FROM 'deleted'
   -- never produce TWO rows claiming one auth account (current_user_row_id()
   -- is LIMIT 1 without ORDER BY — ambiguity there is the ghost-row bug):
   AND NOT EXISTS (SELECT 1 FROM public.users u3 WHERE u3.auth_user_id = au.id)
   -- and skip emails shared by multiple non-deleted rows (needs human review):
   AND NOT EXISTS (SELECT 1 FROM public.users u2
                    WHERE u2.id <> u.id
                      AND u2.email IS NOT NULL
                      AND lower(btrim(u2.email)) = lower(btrim(u.email))
                      AND u2.status IS DISTINCT FROM 'deleted');

-- 2) current_user_level(): client-parity role parsing.
--    Mirrors _getUserLevel (script.js:577): case-insensitive "Level N",
--    english snake_case names, and the three Chinese role names.
--    Unknown roles still return NULL (strict: RLS grants nothing) — the
--    client defaults to 99, but widening DB visibility for unrecognised
--    strings is not desirable; the named fallbacks below cover every role
--    the app can actually assign.
--    CREATE OR REPLACE preserves the existing EXECUTE grants.
CREATE OR REPLACE FUNCTION public.current_user_level()
 RETURNS integer
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
    r   text;
    lvl integer;
BEGIN
    SELECT role INTO r FROM users WHERE auth_user_id = auth.uid() LIMIT 1;
    IF r IS NULL OR btrim(r) = '' THEN RETURN NULL; END IF;
    lvl := NULLIF(substring(r FROM '(?i)Level\s+([0-9]+)\y'), '')::integer;
    IF lvl IS NOT NULL THEN RETURN lvl; END IF;
    -- english named roles (client parity)
    CASE lower(btrim(r))
        WHEN 'super_admin'      THEN RETURN 1;
        WHEN 'admin'            THEN RETURN 1;
        WHEN 'marketing_manager' THEN RETURN 2;
        WHEN 'manager'          THEN RETURN 4;
        WHEN 'team_leader'      THEN RETURN 5;
        WHEN 'consultant'       THEN RETURN 7;
        WHEN 'agent'            THEN RETURN 10;
        WHEN 'stock_take_staff' THEN RETURN 15;
        WHEN 'stock_take'       THEN RETURN 15;
        WHEN 'customer'         THEN RETURN 13;
        WHEN 'referrer'         THEN RETURN 14;
        ELSE NULL; -- fall through
    END CASE;
    -- Chinese-only role names (client parity: L12/13/14)
    CASE btrim(r)
        WHEN '传福大使'   THEN RETURN 12;
        WHEN '改命客户'   THEN RETURN 13;
        WHEN '准传福大使' THEN RETURN 14;
        ELSE RETURN NULL; -- unknown role: strict
    END CASE;
END;
$function$;

-- 3) Verification (run after):
-- SELECT count(*) FILTER (WHERE auth_user_id IS NULL) AS still_null,
--        count(*) FILTER (WHERE NOT EXISTS (SELECT 1 FROM auth.users au WHERE au.id = users.auth_user_id)) AS dangling
--   FROM users WHERE status IS DISTINCT FROM 'deleted';
-- (still_null > 0 is OK only for staff with no auth account yet — the client
--  backfill links them on their first login.)
