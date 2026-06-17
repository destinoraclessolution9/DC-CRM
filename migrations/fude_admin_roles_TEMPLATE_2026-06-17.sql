-- ============================================================================
-- TEMPLATE — fix the 3 fude legacy-allowlist admins' DB role levels
-- ============================================================================
-- OUTSTANDING.md item 1.2+.
--
-- ⚠️  THIS IS A TEMPLATE. DO NOT RUN AS-IS. ⚠️
--   Claude intentionally did NOT guess the per-admin levels. You MUST decide,
--   for EACH email below, whether that person is:
--       L1  Super Admin        (role_level = 1,  role = 'Level 1 Super Admin')
--       L2  Marketing Manager  (role_level = 2,  role = 'Level 2 Marketing Manager')
--   then fill in BOTH columns to match before running. Set the `role` display
--   string and the numeric `role_level` CONSISTENTLY — the app reads role_level
--   as the source of truth (see migrations/role_level_2026-06-14.sql) and the
--   `role` string for UI labels.
--
-- WHY
--   The fude admin gate canonically grants access to L1 (isSystemAdmin) or
--   L2 (isMarketingManager). These three accounts currently rely on a
--   DEPRECATED hardcoded email allowlist fallback in chunks/script-fude.js
--   because their DB role level is unset/stale. Once their role_level is set
--   correctly here, the canonical gate grants them access on its own, the
--   `[fude-authz]` console warning stops firing, and the email fallback in the
--   code can be deleted (see the code-deletion noted in the task report).
--
--   ➜ BEFORE deleting the code fallback, also watch the browser console for any
--     OTHER `[fude-authz] falling back to legacy email allowlist for <email>`
--     warnings — those reveal additional stale-role admins NOT in this list who
--     would otherwise silently lose access. Fix those too.
--
-- The three emails are taken verbatim from the allowlist
--   _LEGACY_ADMIN_EMAILS in chunks/script-fude.js (line 130):
--     'mianformula@gmail.com'
--     'destinyoracles@gmail.com'
--     'shilynateh7689@gmail.com'
--
-- HOW TO USE
--   1. Run the PRE-CHECK to see each admin's CURRENT role / role_level.
--   2. Decide L1 vs L2 per person.
--   3. EITHER edit the single bulk UPDATE (only valid if they should ALL get the
--      SAME level), OR — recommended — use the per-email UPDATEs further down so
--      each can get its own level. Uncomment + fill the ones you use.
--   4. Run inside the transaction. Re-run the PRE-CHECK / VERIFY afterwards.
--
-- Date: 2026-06-17
-- ============================================================================


-- ----------------------------------------------------------------------------
-- PRE-CHECK — current state of the three admins (run first, modifies nothing)
-- ----------------------------------------------------------------------------
SELECT id, email, role, role_level
FROM public.users
WHERE lower(email) IN (
    'mianformula@gmail.com',
    'destinyoracles@gmail.com',
    'shilynateh7689@gmail.com'
)
ORDER BY email;


-- ----------------------------------------------------------------------------
-- OPTION A — bulk UPDATE. ⚠️ Only correct if ALL THREE should get the SAME
--   level. Replace <ROLE_STRING> and <ROLE_LEVEL> with a matching pair, e.g.
--   ('Level 2 Marketing Manager', 2) OR ('Level 1 Super Admin', 1).
--   Leave commented unless you are sure they are all identical.
-- ----------------------------------------------------------------------------
-- BEGIN;
-- UPDATE public.users
-- SET role       = '<ROLE_STRING>',   -- e.g. 'Level 2 Marketing Manager'
--     role_level = <ROLE_LEVEL>       -- e.g. 2   (MUST match the string above)
-- WHERE lower(email) IN (
--     'mianformula@gmail.com',
--     'destinyoracles@gmail.com',
--     'shilynateh7689@gmail.com'
-- );
-- COMMIT;


-- ----------------------------------------------------------------------------
-- OPTION B — per-admin UPDATE (recommended). Set EACH person's level
--   independently. Fill in the correct pair on each line, then uncomment the
--   ones you need. role_level MUST be 1 (Super Admin) or 2 (Marketing Manager)
--   and the `role` string MUST match it.
-- ----------------------------------------------------------------------------
-- BEGIN;
--
-- UPDATE public.users
-- SET role = '<ROLE_STRING>', role_level = <1_OR_2>     -- mianformula@gmail.com is L?_
-- WHERE lower(email) = 'mianformula@gmail.com';
--
-- UPDATE public.users
-- SET role = '<ROLE_STRING>', role_level = <1_OR_2>     -- destinyoracles@gmail.com is L?_
-- WHERE lower(email) = 'destinyoracles@gmail.com';
--
-- UPDATE public.users
-- SET role = '<ROLE_STRING>', role_level = <1_OR_2>     -- shilynateh7689@gmail.com is L?_
-- WHERE lower(email) = 'shilynateh7689@gmail.com';
--
-- COMMIT;


-- ----------------------------------------------------------------------------
-- VERIFY — re-run after the UPDATE; confirm role_level is 1 or 2 for all three
--   and that `role` string agrees. Then load the fude view as each admin and
--   confirm NO `[fude-authz]` warning appears in the console.
-- ----------------------------------------------------------------------------
-- SELECT id, email, role, role_level
-- FROM public.users
-- WHERE lower(email) IN (
--     'mianformula@gmail.com',
--     'destinyoracles@gmail.com',
--     'shilynateh7689@gmail.com'
-- )
-- ORDER BY email;
