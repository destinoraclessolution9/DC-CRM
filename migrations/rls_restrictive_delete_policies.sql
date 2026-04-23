-- ============================================================================
-- RESTRICTIVE delete policies for high-value tables
-- ============================================================================
-- Mirrors the prospects_delete_lead_only pattern (commit 48f5462):
--   Adds a RESTRICTIVE overlay on top of the existing permissive
--   auth_full_access policy, so agents cannot bypass the client-side
--   role check by calling supabase.from('x').delete() from DevTools.
--
-- Uses current_user_level() (SECURITY DEFINER helper shipped earlier).
-- Level ≤ 5 means: Super Admin, Marketing Manager, Manager, or above.
-- ============================================================================

-- customers: only managers can delete
DROP POLICY IF EXISTS customers_delete_lead_only ON customers;
CREATE POLICY customers_delete_lead_only ON customers
    AS RESTRICTIVE FOR DELETE TO authenticated
    USING (current_user_level() IS NOT NULL AND current_user_level() <= 5);

-- activities: only managers can delete (protect audit + commission trail)
DROP POLICY IF EXISTS activities_delete_lead_only ON activities;
CREATE POLICY activities_delete_lead_only ON activities
    AS RESTRICTIVE FOR DELETE TO authenticated
    USING (current_user_level() IS NOT NULL AND current_user_level() <= 5);

-- transactions: only Super Admin can delete (financial records are ~~never~~
-- deleted — they should be soft-voided, but this catches misuse)
DROP POLICY IF EXISTS transactions_delete_admin_only ON transactions;
CREATE POLICY transactions_delete_admin_only ON transactions
    AS RESTRICTIVE FOR DELETE TO authenticated
    USING (current_user_level() IS NOT NULL AND current_user_level() <= 2);

-- users: only Super Admin can delete user accounts
DROP POLICY IF EXISTS users_delete_admin_only ON users;
CREATE POLICY users_delete_admin_only ON users
    AS RESTRICTIVE FOR DELETE TO authenticated
    USING (current_user_level() IS NOT NULL AND current_user_level() <= 2);

-- referrals: managers only
DROP POLICY IF EXISTS referrals_delete_lead_only ON referrals;
CREATE POLICY referrals_delete_lead_only ON referrals
    AS RESTRICTIVE FOR DELETE TO authenticated
    USING (current_user_level() IS NOT NULL AND current_user_level() <= 5);

-- audit_logs: IMMUTABLE ledger. Nobody (not even Super Admin) should be able
-- to delete audit entries via the client. If you genuinely need to purge old
-- audit rows for disk-space reasons, use a scheduled retention job that runs
-- via the Management API with the PAT (not the anon client).
DROP POLICY IF EXISTS audit_logs_no_delete ON audit_logs;
CREATE POLICY audit_logs_no_delete ON audit_logs
    AS RESTRICTIVE FOR DELETE TO authenticated
    USING (false);

-- audit_logs: IMMUTABLE fields. No UPDATE either — an audit row is written
-- once at mutation time and never edited.
DROP POLICY IF EXISTS audit_logs_no_update ON audit_logs;
CREATE POLICY audit_logs_no_update ON audit_logs
    AS RESTRICTIVE FOR UPDATE TO authenticated
    USING (false);
