# CI/CD Pipeline

How code reaches `destinoraclessolution.com`, what verifies it, and how to make a
red check actually block a bad deploy.

## The pipeline at a glance

| Workflow | Trigger | Role | Gates the deploy? |
|----------|---------|------|-------------------|
| [`ci.yml`](../../.github/workflows/ci.yml) | PR + push to `main` | Correctness gates: `gates` (audit + tsc + contract) and `regression` (build + snapshot + lint + size) | **No** — reporting-only |
| [`lighthouse.yml`](../../.github/workflows/lighthouse.yml) | PR + push to `main` | Core Web Vitals budgets (preview on PR, prod on `main`) | **No** — reporting-only |
| [`uptime.yml`](../../.github/workflows/uptime.yml) | every 10 min (cron) | Black-box availability probe: homepage 200 + Supabase auth health | n/a — observe-only |
| [`backup.yml`](../../.github/workflows/backup.yml) | weekly cron + monthly restore test | GPG-encrypted `pg_dump` → Google Drive | n/a |
| [`deploy.yml`](../../.github/workflows/deploy.yml) | push to `main` + dispatch | **New.** Post-deploy smoke + optional gated promotion | optional (dispatch path) |

## The gap

Vercel is git-integrated and **auto-builds `main` on every push, independent of CI
status**. So a commit that turns `ci.yml` red still ships to production. The CI
checks surface the regression — they do not stop it. `deploy.yml` adds an
*immediate post-deploy* verification on top, but verification after the fact is not
prevention. To actually prevent a red commit from shipping, the owner picks one of
the two options below.

## Two hardening options (owner chooses one)

See [`OWNER_ACTION_CHECKLIST.md`](OWNER_ACTION_CHECKLIST.md) → "P3 — CI/CD gating".

### (A) Branch protection — keep Vercel auto-deploy (simplest)

Require CI to pass **before merge**, so nothing reaches `main` red.

1. GitHub → **Settings → Branches → Add rule** for `main`.
2. Enable **Require status checks to pass before merging** and select:
   `gates`, `regression`, `lighthouse`, plus the migration check once the ledger
   is applied (see checklist).
3. Enable **Require a pull request before merging** (direct pushes bypass checks).
4. Leave Vercel auto-deploy ON — protected merges are inherently green.

Trade-off: relies on the PR flow. A direct push to `main` (if allowed) still
auto-deploys before checks finish; require PRs to close that.

### (B) Gated promotion — strongest

Turn production deploy into a manual, post-green action.

1. Vercel → Project → **Settings → Git** → turn **off** production auto-deploy
   (keep preview deploys for PRs).
2. Vercel → **Settings → Git → Deploy Hooks** → create a hook for the production
   branch; copy its URL.
3. GitHub → **Settings → Secrets → Actions** → add `VERCEL_PROD_DEPLOY_HOOK` = that URL.
4. To ship: after `ci.yml` is green, **Actions → Deploy gate + post-deploy smoke →
   Run workflow** (`workflow_dispatch`). The `promote` job POSTs the hook and the
   `post_deploy_smoke` job verifies the result.

The `promote` job is **inert until both** conditions hold (dispatch event **and**
the secret set), so adding `deploy.yml` changes nothing for the current setup.

## Post-deploy smoke vs. uptime

| | `deploy.yml` smoke | `uptime.yml` probe |
|--|--|--|
| When | once, ~2 min after each push | every 10 min, continuously |
| Purpose | did *this* deploy stay healthy? | is production up *right now*? |
| Checks | homepage 200 + auth health (400=up, 521/5xx=down) | same two checks |
| Alerting | Slack on `OPS_SLACK_WEBHOOK` if set, else red check | identical |

Smoke gives an immediate per-deploy signal; uptime is the standing watch. Both are
read-only and cannot affect the live site.

## When smoke fails → rollback

A failed `post_deploy_smoke` means production may be down. Roll back via Vercel
Instant Rollback to the prior good deploy — full procedure (under 60 s) in
[`DEPLOY_DISCIPLINE.md`](DEPLOY_DISCIPLINE.md). Never auto-revert a migration; the
DB restore path is the GPG dump from `backup.yml`.
