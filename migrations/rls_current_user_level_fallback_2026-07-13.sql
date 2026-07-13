-- =====================================================================
-- FIX: successful login but completely EMPTY app for users whose row can't
-- be mapped to a session by the RLS helpers.
-- Date: 2026-07-13  (APPLIED to live remuwhxvzkzjtgbzqjaa via Management API)
--
-- ROOT CAUSE (two independent gaps, both fail to "no visible rows"):
--   (a) current_user_level() parsed the role string with the bare regex
--       'Level\s+(\d+)' and NO fallback for Chinese-only role names
--       (传福大使 / 改命客户 / 准传福大使). The client's _getUserLevel()
--       (script.js ~:577) HAS that fallback, so JS said "level 12" while
--       SQL said NULL -> current_user_visible_ids() returned nothing ->
--       every RLS-scoped read came back empty despite a valid session.
--       The canonical server mirror _role_to_level(p_role)
--       (users_role_level_sync_2026-06-22.sql) already contains the full
--       fallback — current_user_level() just never used it.
--   (b) 3 non-deleted users rows had auth_user_id = NULL, so
--       users.auth_user_id = auth.uid() matched nothing at all:
--         id 2             seed "Marketing Manager" — no auth.users account
--                          exists for its email; cannot log in; left as-is.
--         id 1782303114813 Level 11 agent — auth account exists (recent
--                          sign-ins) but was never linked.
--         id 1782721410358 传福大使 — auth account exists (recent sign-ins);
--                          hit BOTH (a) and (b).
--
-- FIX:
--   (1) current_user_level() delegates role parsing to _role_to_level(),
--       so SQL and client agree. Still returns NULL when no users row maps
--       to auth.uid() — RLS keeps failing closed for unknown sessions.
--   (2) Backfill auth_user_id for rows whose auth.users account is found
--       by exact (case/space-insensitive) email match. Idempotent: only
--       fires while the link is still NULL; scoped to the two audited ids.
--
-- NOT changed (checked, intentionally left alone):
--   - prospects_delete_lead_only policy parses 'Level' inline; NULL level
--     means no DELETE grant — correct fail-closed for L12-14 roles.
--   - kpi_user_summary / kpi_target_comparison / queue_action_plan_reminders
--     also parse 'Level' inline (reporting only, out of scope here).
--
-- VERIFIED after apply (simulated request.jwt.claims per user):
--   id 1782721410358 -> level 12, row_id resolves, visible_ids count 1 (self)
--   id 1782303114813 -> level 11, row_id resolves, visible_ids count 1 (self)
--   Health over 24 non-deleted users: dangling_auth 0, backfillable 0,
--   role_level column drift 0, roles unmapped by fallback 0; null_auth 1
--   (the unlinkable seed row id 2 only). EXECUTE ACL on the function
--   (anon/authenticated/service_role) preserved by CREATE OR REPLACE.
-- =====================================================================

begin;

-- (1) SQL/JS agreement: same fallback the client uses, via the canonical
--     server mirror. NULL only when the session maps to no users row.
CREATE OR REPLACE FUNCTION public.current_user_level()
 RETURNS integer
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
    lvl integer;
BEGIN
    SELECT public._role_to_level(role)::integer
      INTO lvl
      FROM users
     WHERE auth_user_id = auth.uid()
     LIMIT 1;
    RETURN lvl;
END;
$function$;

-- (2) Backfill the two orphaned-but-active accounts by deriving the link
--     from an exact email match against auth.users (verified unique for
--     both emails before apply). Idempotent and re-runnable.
update public.users u
   set auth_user_id = a.id,
       updated_at = now()
  from auth.users a
 where u.id in (1782303114813, 1782721410358)
   and u.auth_user_id is null
   and lower(trim(a.email)) = lower(trim(u.email));

commit;

-- VERIFY (run after apply):
--   select count(*) filter (where u.auth_user_id is null) as null_auth,
--          count(*) filter (where u.auth_user_id is not null and au.id is null) as dangling
--   from public.users u left join auth.users au on au.id = u.auth_user_id
--   where u.status is distinct from 'deleted';
--   -- expect: null_auth = 1 (seed id 2 only), dangling = 0
