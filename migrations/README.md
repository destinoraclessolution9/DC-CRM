# Database migrations — apply discipline

The CRM has **no automated migration runner**. DDL is applied **by hand** through the
Supabase dashboard, and there is no applied-ledger table — applied state is tracked by
git history + the naming convention below. This file is the source of truth for *how*
migrations are written and applied. A CI guard (`ci/test-migrations.js`, run by
`node ci/regression.js`) enforces the hard rule and reports hygiene warnings.

## How to apply a migration

1. Write the `.sql` file here following the conventions below.
2. Open the **Supabase dashboard → project `remuwhxvzkzjtgbzqjaa` → SQL Editor**.
3. Paste the file contents and **Run**. Verify the result.
4. Commit the `.sql` to git as the durable record that it was applied.

> **Why dashboard, not CLI:** the project's security rule forbids using the Supabase
> Personal Access Token on the command line for DDL. Do **not** pipe these through
> `supabase db push` / `psql` with a PAT. Claude cannot apply DDL — it can only author
> the SQL and ask the owner to run it.

## Conventions (enforced/encouraged by `ci/test-migrations.js`)

- **Naming:** `descriptive_snake_case_YYYY-MM-DD.sql`. The date stamp records when it was
  authored/applied and gives a natural apply order. (Missing stamp → CI warning.)
- **Idempotency (strongly preferred):** write so a re-run is a safe no-op —
  `CREATE TABLE IF NOT EXISTS`, `CREATE OR REPLACE FUNCTION`, `CREATE INDEX IF NOT EXISTS`,
  `DROP … IF EXISTS` before `CREATE`, `INSERT … ON CONFLICT DO NOTHING`. (No guard → CI
  warning.) A handful of legitimately one-shot migrations (FK-constraint swaps, autovacuum
  tuning, privilege grants, edit-me templates) are exempt and stay warnings, not failures.
- **Hard rule (CI fails the build):** no duplicate filename. Two migrations that create the
  same object must both be guarded (or the older one deleted) — the unguarded re-create is
  the classic "second apply errors out" migration-collision outage.
- **Not-for-direct-apply markers:** include `DRAFT`, `FUTURE`, `TEMPLATE`, or `_PLAN` in the
  filename for SQL that is a plan, a superseded draft, or a fill-in-the-blanks template
  (e.g. `rls_select_scoping_DRAFT_*` superseded by `…_APPLIED_*`). These are excluded from
  the hygiene checks.

## Currently pending (owner action — see ../ROADMAP.md)

These are written and ready but **must be applied from the dashboard by the owner**:

- `redemption_requests_2026-06-17.sql` — fude "Redeem Points" DB-backed queue (then wire `confirmRedeemPoints`).
- `monthly_focus_archive_unique_2026-06-17.sql` — optional `UNIQUE(user_id,month,prospect_id)` race-proofing.
- `fude_admin_roles_TEMPLATE_2026-06-17.sql` — set the 3 legacy-allowlist admins to L1/L2 (edit before running).
- `calendar_window_hide_birthday_auto_2026-06-24.sql` — exclude `source='birthday_auto'` touch-logs from `get_calendar_window` so birthday wish/gift logs stop leaking onto the desktop calendar as "00:00 CALL" cards. Pure `CREATE OR REPLACE` (no signature/return change); applying it immediately clears the leak with no client deploy.
