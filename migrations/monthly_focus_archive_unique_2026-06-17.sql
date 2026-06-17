-- ============================================================================
-- OPTIONAL belt-and-suspenders UNIQUE constraint on public.monthly_focus_archive
--   UNIQUE (user_id, month, prospect_id)
-- ============================================================================
-- OUTSTANDING.md item 1.1+ — race-proofing for the monthly pipeline auto-archive.
--
-- WHY THIS IS OPTIONAL
--   Correctness is ALREADY covered by:
--     (a) the client in-flight / per-session once-guard in the archive routine
--         (SW-100, see script-features.js), and
--     (b) the explicit idempotency read before every insert —
--         AppDataStore.query('monthly_focus_archive',
--             { user_id, month, prospect_id })  then create only if .length === 0
--         (script-features.js ~line 5608).
--   This DDL is a pure DEFENSE-IN-DEPTH layer: it makes the database itself
--   reject a duplicate if two tabs / two devices race the check-then-insert
--   window. It is additive (no behavior change for the happy path) and is the
--   kind of additive DDL pre-authorized for the CRM. Skipping it is fine; the
--   app already behaves correctly without it.
--
-- WHY A BARE `ADD CONSTRAINT` IS NOT ENOUGH
--   The table already has live data. If ANY duplicate
--   (user_id, month, prospect_id) rows exist (e.g. created before SW-100
--   hardened the routine), a bare ADD CONSTRAINT fails with 23505 and aborts.
--   So this migration FIRST de-duplicates (keeping ONE row per key — the
--   lowest id, i.e. the earliest/original insert), THEN adds the constraint —
--   all inside a single transaction so it is all-or-nothing.
--
-- IDEMPOTENT / GUARDED
--   Wrapped in a DO block that checks pg_constraint first; if the constraint
--   already exists it is a no-op. Safe to re-run.
--
-- Date: 2026-06-17
-- ============================================================================


-- ----------------------------------------------------------------------------
-- PRE-CHECK (run this FIRST, on its own — does NOT modify anything).
--   Counts how many duplicate groups exist and how many rows would be deleted.
--   If it returns zero rows, the de-dup step below is a no-op and you can apply
--   the constraint with zero data loss.
-- ----------------------------------------------------------------------------
-- SELECT user_id, month, prospect_id,
--        COUNT(*)            AS row_count,
--        COUNT(*) - 1        AS rows_to_delete
-- FROM public.monthly_focus_archive
-- GROUP BY user_id, month, prospect_id
-- HAVING COUNT(*) > 1
-- ORDER BY rows_to_delete DESC;
--
-- Total rows that would be deleted (single number):
-- SELECT COALESCE(SUM(c - 1), 0) AS total_rows_to_delete
-- FROM (
--   SELECT COUNT(*) AS c
--   FROM public.monthly_focus_archive
--   GROUP BY user_id, month, prospect_id
--   HAVING COUNT(*) > 1
-- ) d;


-- ----------------------------------------------------------------------------
-- MIGRATION (transactional: de-dup, then add constraint, then verify)
-- ----------------------------------------------------------------------------
BEGIN;

-- 1) De-duplicate: keep exactly ONE row per (user_id, month, prospect_id).
--    We keep MIN(id) = the lowest / earliest-inserted / original row, and
--    delete the later duplicates. (If your `id` is not monotonic and you would
--    rather keep the MOST-RECENT row, swap `MIN(id)` for `MAX(id)` below.)
--    NULL prospect_id rows are left untouched — a UNIQUE constraint treats
--    NULLs as distinct, so they never conflict and must not be collapsed.
DELETE FROM public.monthly_focus_archive a
USING (
    SELECT user_id, month, prospect_id, MIN(id) AS keep_id
    FROM public.monthly_focus_archive
    WHERE prospect_id IS NOT NULL
    GROUP BY user_id, month, prospect_id
    HAVING COUNT(*) > 1
) dup
WHERE a.user_id    = dup.user_id
  AND a.month      = dup.month
  AND a.prospect_id = dup.prospect_id
  AND a.id <> dup.keep_id;

-- 2) Add the UNIQUE constraint, guarded so re-runs are a no-op.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'monthly_focus_archive_user_month_prospect_uniq'
          AND conrelid = 'public.monthly_focus_archive'::regclass
    ) THEN
        ALTER TABLE public.monthly_focus_archive
            ADD CONSTRAINT monthly_focus_archive_user_month_prospect_uniq
            UNIQUE (user_id, month, prospect_id);
    END IF;
END
$$;

COMMIT;


-- ----------------------------------------------------------------------------
-- VERIFY (run after COMMIT — should report the constraint exists, 0 dup groups)
-- ----------------------------------------------------------------------------
-- SELECT conname
-- FROM pg_constraint
-- WHERE conrelid = 'public.monthly_focus_archive'::regclass
--   AND conname = 'monthly_focus_archive_user_month_prospect_uniq';
--
-- SELECT COUNT(*) AS remaining_dup_groups FROM (
--   SELECT 1 FROM public.monthly_focus_archive
--   GROUP BY user_id, month, prospect_id HAVING COUNT(*) > 1
-- ) d;   -- expect 0


-- ----------------------------------------------------------------------------
-- ROLLBACK (to remove the constraint later; this does NOT restore deleted dups)
-- ----------------------------------------------------------------------------
-- ALTER TABLE public.monthly_focus_archive
--     DROP CONSTRAINT IF EXISTS monthly_focus_archive_user_month_prospect_uniq;
