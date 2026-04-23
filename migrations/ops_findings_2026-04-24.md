# Ops Findings — 2026-04-24

Hands-off diagnostics run via the Supabase Management API. Action items
for the Super Admin are called out; no code or DB changes applied in this
round except the additive RLS prep (auth_user_id column + helper
functions — see `rls_helpers.sql`).

## 1. Backup / disaster recovery

From `GET /v1/projects/remuwhxvzkzjtgbzqjaa/database/backups`:

```
{
  "region": "ap-south-1",
  "pitr_enabled": false,
  "walg_enabled": true,
  "backups": [],
  "physical_backup_data": {}
}
```

**Findings:**
- ✅ WAL-G is enabled — Supabase takes a daily physical backup automatically.
- ✅ Weekly Supabase → Google Drive backup workflow is now in place (commit
  `1e9e160`). That's a solid second line of defence against Supabase-side
  failures.
- ⚠️ **Point-in-time recovery (PITR) is DISABLED.** If something destructive
  happens mid-day (accidental DROP TABLE, mass-delete bug), you can only
  restore to the last daily snapshot, losing up to 24 h of data. The Google
  Drive weekly backup is even coarser — up to 7 days RPO. For a CRM that
  gets continuous writes from agents, the gap between PITR-off and agent
  writes is real risk.
- The `backups` array is empty in the API response. That usually means no
  *manual* on-demand backups have been taken (manual backups are a separate
  feature from WAL-G). Automated daily backups are retained by Supabase and
  restorable via the dashboard, even though they don't appear here.

**Action items for the Super Admin:**
1. **Enable PITR** — Supabase dashboard → Project → Database → Backups →
   Enable PITR. (Pro plan or higher. Once you have 100K+ prospects this
   is non-optional insurance.)
2. **Run a restore drill once** before you need it. Dashboard → Backups →
   pick yesterday's snapshot → "Restore to a new project" (don't overwrite
   prod). Verify the restored project has the expected row counts for
   `prospects` / `activities` / `users`. Takes ~30 min. Do it on a quiet
   Sunday.
3. Take a manual on-demand backup before any big migration (e.g. the RLS
   hardening rollout).

## 2. Slow queries (pg_stat_statements)

Top 15 by total execution time. After stripping Supabase internal plumbing
(auth session setup, jwt config, pg_timezone_names introspection), no app
queries appear in the hot list. That's a good sign — the indexes shipped
earlier this week are doing their job.

Notable items:

| query | calls | mean | notes |
|---|---|---|---|
| `set_config('search_path', ...)` | 3988 | 2.4 ms | Standard per-request auth setup, not app code. Baseline for Supabase. |
| `SELECT name FROM pg_timezone_names` | 9 | 849 ms | Supabase dashboard introspection, not app code. `pg_timezone_names` is notoriously slow and uncached. Ignore. |
| `compute_refill_reminders()` | 5 | 520 ms | Your batch function. Acceptable for a batch job. |
| auth session INSERTs | normal | 10–50 ms | Healthy |

**Action item:** none right now. Re-run the query below weekly once you're
past 10K prospects; if any app query (anything `FROM prospects` /
`FROM activities` without an obvious plan) shows up with high `total_s`,
that's the signal to revisit indexing.

```sql
SELECT LEFT(regexp_replace(query, '\s+', ' ', 'g'), 140) AS q,
       calls, ROUND(total_exec_time::numeric/1000, 2) AS total_s,
       ROUND(mean_exec_time::numeric, 2) AS mean_ms
FROM pg_stat_statements
WHERE query NOT ILIKE '%pg_stat_statements%'
  AND query NOT ILIKE '%information_schema%'
  AND query NOT ILIKE '%pg_catalog%'
ORDER BY total_exec_time DESC LIMIT 20;
```

## 3. RLS prep (additive, already applied)

Ran today:
- Added `users.auth_user_id uuid` + `idx_users_auth_user_id` (partial
  unique). Backfilled from `auth.users` via `LOWER(email)` match — 21 of
  22 active users linked (the unlinked one is a role-placeholder
  "Marketing Manager" account without an auth entry).
- Created `current_user_level()`, `current_user_row_id()`,
  `current_user_visible_ids()` — SECURITY DEFINER STABLE. Zero effect on
  the app until you reference them from a policy.

**Next step when you want to proceed with RLS hardening:** follow
`migrations/rls_hardening_plan.md`, Step 3 onward. Schedule a window
with a DBA ready to roll back.

## 4. What's still waiting on you

| Item | Why it can't be done programmatically | What to do |
|---|---|---|
| Sentry DSN | I can't create a Sentry project for you | Sign up at sentry.io (free tier), paste DSN into `index.html` `<head>` as `<script>window.SENTRY_DSN='https://...';</script>` — the lazy-loader in `script.js` is already wired |
| Enable PITR | Paid feature, needs dashboard click | Supabase dashboard → Database → Backups |
| Backup restore drill | Needs your actual click in the dashboard | 30 min, any quiet Sunday |
| Apply RLS policies | Risk of locking the app out; needs a DBA watching | Follow `rls_hardening_plan.md` in a dedicated session |
