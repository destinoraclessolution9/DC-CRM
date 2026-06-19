# DevOps Production-Readiness Plan

Durable source-of-truth for the production-hardening effort on **destinoraclessolution.com**.
Authored by the DevOps autopilot run (2026-06-19). Each phase ships independently to live.

## Stack reality (so we don't re-solve solved problems)

- **Frontend:** vanilla IIFE SPA (`window.app`) + 33 lazy chunks + a React island
  (`src/react/*` → `react-dist/react-island.js`). Served static from repo root.
- **Build:** custom `build.mjs` (esbuild minify + brotli-11 pre-compress + content-hash
  + manifest injection). `vite build` for the React island. **No framework bundler.**
- **Host:** Vercel, git-integrated, auto-builds `origin/main` on push. Edge CDN.
- **Backend:** Supabase (Postgres + Auth/GoTrue + Storage + Realtime + 8 Edge Functions).
- **BFF:** `api/customers.mjs`, `api/prospects.mjs` — Vercel Node functions, service-key,
  server-side visibility scoping, JWT-verified.

### Already production-grade — do NOT touch
- **Security:** RLS lockdown, edge-function auth, PII-table hardening, password-at-rest
  removed, **native Supabase MFA (TOTP / AAL2)** — shipped in the `db3ab85..60cbc84` pass.
- **Backups:** weekly `pg_dump` (public + auth) → GPG AES-256 → Google Drive, **with a
  weekly automated restore test** (`.github/workflows/backup.yml`). Best-in-class.
- **Edge delivery:** content-hashed immutable assets, brotli-11, hardened CSP/HSTS
  (`vercel.json`), real SW offline strategy (`sw.js`).
- **SW reload de-herd:** `sw-init.js` already jitters reloads 0–60 s + guards active edits
  + single-timer — the "HTTP 521 thundering herd" fix is **live**.
- **CI correctness:** `ci/regression.js` (build + snapshot + lint + size) + Lighthouse CI.

## The real gaps this effort closes

| Phase | Gap | Status |
|-------|-----|--------|
| P0 | No committed DevOps plan / owner checklist | this doc |
| P1 | SW reload de-herd already live → only deploy-discipline doc remains | mostly done |
| P2 | **No observability** — no error tracking, uptime monitor, log signal, alerting | **real** |
| P3 | **CI is reporting-only** — does not gate the deploy; no migration ledger | **real** |
| P4 | **No `/api` rate-limiting**; CSP needs Sentry ingest origin | **real** |
| P5 | No connection pooling config; offset pagination degrades at depth | real (owner-gated) |
| P6 | No container/self-host reference; runbooks scattered | **real** |

## Guardrails (every phase obeys these)
1. **Commit SOURCE ONLY** — never `.min.*`, `.br`, hashed copies, or scratch files. Vercel rebuilds.
2. **No `CACHE_VERSION` bump** unless SW *logic* changed (avoids the reload window). See `DEPLOY_DISCIPLINE.md`.
3. **CI gate before every push:** `node ci/audit.js` (always) + `node ci/regression.js` (when JS/CSS source changed).
4. **Inert-by-default:** anything needing an external account (Sentry DSN, pooler, monitor) ships
   gated behind an env var / config so it no-ops until the owner flips the switch — see `OWNER_ACTION_CHECKLIST.md`.
5. **Live-verify after push:** `__ASSET_MANIFEST` matches + `POST /auth/v1/token` returns 400 (Auth up).
6. **Rollback on failed verify:** Vercel Instant Rollback to the prior deploy, then stop and report.

## Owner-gated items (cannot be automated — see OWNER_ACTION_CHECKLIST.md)
Supabase compute tier + pooler · apply migrations via dashboard · Sentry project/DSN ·
uptime-monitor account · Vercel branch protection / deploy hook / log drain / WAF toggles.
