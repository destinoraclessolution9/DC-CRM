# Owner Action Checklist

These steps require a dashboard, billing, or a third-party account — they **cannot** be
automated from the repo. Every related code change ships **inert** (env-gated / config-driven),
so nothing breaks before you do these. Tick them off when ready; the code activates automatically.

## P2 — Observability
- [ ] **Sentry** — create a project (Browser + Node), copy the DSN.
  - Set Vercel env `SENTRY_DSN` (Production + Preview). FE reads `window.__SENTRY_DSN`
    (injected from env at build) — until set, the Sentry init **no-ops**, zero overhead.
- [ ] **Uptime monitor** — the repo ships a free GitHub Action probe (no account needed).
      Optional: import `monitoring/checkly.config.json` into Checkly / Better Stack for a
      public status page + multi-region checks + SMS alerts.
- [ ] **Alert routing** — add a Slack incoming-webhook URL as repo secret `OPS_SLACK_WEBHOOK`
      so the synthetic-probe Action and backup workflow can page on failure.

## P3 — CI/CD gating
- [ ] **Branch protection** on `main`: require checks `gates`, `regression`, `lighthouse`,
      `migration-ledger` before merge (GitHub → Settings → Branches). See `CICD.md` + `DEPLOY_DISCIPLINE.md`.
- [ ] **Gated promotion (optional, stronger):** turn off Vercel auto-deploy-to-production,
      create a **Deploy Hook**, store its URL as repo secret `VERCEL_PROD_DEPLOY_HOOK`.
      `.github/workflows/deploy.yml` then promotes only on green.
- [ ] **Migration ledger** — apply `migrations/ledger_schema_migrations_2026-06-19.sql` once via the
      Supabase SQL Editor (creates `public.schema_migrations` + backfills 62 applied rows).
      Thereafter `ci/test-migration-ledger.js` (auto-runs in the regression gate) reports drift.

## P4 — Edge security
- [ ] **Vercel WAF / BotID** — enable managed ruleset + a rate-limit rule on `/api/*`
      (dashboard → Firewall). The in-function limiter ships as defense-in-depth regardless.
  - [ ] **Enable the shipped in-function limiter** — set Vercel env `RATE_LIMIT_PER_MIN`
        to a positive integer (start ~240 — office users share one NAT'd IP — and tune down
        only if abuse appears). See `SECURITY_EDGE.md` for the full perimeter playbook.

## P5 — Scaling (the biggest reliability lever)
- [ ] **Supabase compute** — upgrade NANO → Small/Medium and confirm **Pro + Cost-Control**
      (NANO is the documented 521-outage root cause; it auto-reverts unless billed properly).
- [ ] **Supavisor pooler** — enable the transaction pooler (port `6543`). Set Vercel env
      `SUPABASE_POOLER_URL` to the pooled connection string. BFF prefers it when present,
      else falls back to the direct URL — no code change needed to switch.
- [ ] **DB metric alerts** — in Supabase, alert on CPU > 80 %, connections > 80 % of pool,
      disk > 80 % → route to `OPS_SLACK_WEBHOOK`.

## P6 — (no owner action; reference artifacts only)
- Docker / compose / k8s files are for local parity or a future self-host; not wired to prod.
