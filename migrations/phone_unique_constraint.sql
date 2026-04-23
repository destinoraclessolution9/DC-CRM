-- ============================================================================
-- Unique constraint on prospects.phone
-- ============================================================================
-- Purpose: prevent duplicate prospect entries with the same phone number.
--   Real-world policy: the primary holder of a shared household phone keeps
--   the number; family members without their own line leave phone blank
--   (NULL) — the partial index below ignores NULLs and empty strings so
--   multiple blank-phone rows still coexist.
--
-- Prerequisites:
--   - All existing duplicates must be resolved before applying this. The app
--     exposes a "Phone Duplicates Review" tool (Settings → Data Quality) for
--     Super Admin to clear them.
--   - verify: SELECT phone, COUNT(*) FROM prospects
--             WHERE phone IS NOT NULL AND btrim(phone) <> ''
--             GROUP BY phone HAVING COUNT(*) > 1;
--     must return zero rows.
--
-- CONCURRENTLY lets it build without taking an ACCESS EXCLUSIVE lock, so
--   writes to prospects keep succeeding during the ~seconds build.
--   Note: CONCURRENTLY cannot run inside a transaction block — the Supabase
--   Management API executes each statement in its own transaction anyway, so
--   this is fine via that endpoint but cannot be run as part of a larger
--   multi-statement migration.
--
-- If the constraint fails with "could not create unique index" (23505), it
-- means a duplicate snuck in between the last verify and this run. Drop the
-- partial index and re-run the Data Quality review:
--   DROP INDEX IF EXISTS idx_prospects_phone_unique;
--
-- Date: 2026-04-23
-- ============================================================================

CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS idx_prospects_phone_unique
    ON prospects (phone)
    WHERE phone IS NOT NULL AND phone <> '';

-- Verify: this should return 0 rows.
SELECT phone, COUNT(*) AS cnt
FROM prospects
WHERE phone IS NOT NULL AND btrim(phone) <> ''
GROUP BY phone
HAVING COUNT(*) > 1;
