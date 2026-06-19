# Production Architecture

System map for **destinoraclessolution.com** — what runs where, how a request flows,
how a change reaches production, and how we watch it. Companion to
[DEVOPS_PLAN.md](./DEVOPS_PLAN.md); for the *why* of each phase see
[README.md](./README.md).

The app is a **dual-stack SPA** served static from the repo root: a vanilla IIFE
(`window.app`) + 33 role-gated lazy chunks own the logic, with a React island
(`src/react/*` → `react-dist/react-island.js`) mounted on top. No framework
bundler — `build.mjs` (esbuild) handles minify/brotli/hashing; `vite build`
produces only the island. Backend is Supabase. Host is Vercel, git-integrated.

## 1. Current production topology

```
                          GitHub (origin/main)
                                  │  push
                  ┌───────────────┴────────────────┐
                  │  Vercel build (node build.mjs   │
                  │   + vite) → hashed+brotli assets │
                  │   + dist-manifest.json           │
                  └───────────────┬─────────────────┘
                                  │ deploy
   ┌──────────────────────────────────────────────────────────────────┐
   │                       VERCEL EDGE (CDN)                            │
   │  static: index.html (no-cache) · *.js/*.css (immutable, brotli)   │
   │  CSP / HSTS / COOP / frame-deny  (vercel.json headers)            │
   │                                                                    │
   │  Vercel Functions (Fluid Compute) — the BFF:                      │
   │    /api/customers.mjs   /api/prospects.mjs                        │
   │    service-key · JWT verify · server-side scope · PostgREST       │
   └───────────────┬───────────────────────────────┬──────────────────┘
                   │ service-key (RLS-bypass)       │ anon key (RLS-on)
                   │ PostgREST / RPC                 │ realtime · auth · storage
                   ▼                                 ▼
   ┌──────────────────────────────────────────────────────────────────┐
   │                          SUPABASE                                  │
   │  Postgres (RLS, row-scope RPCs) · Auth/GoTrue (JWT + native MFA   │
   │  TOTP/AAL2) · Storage · Realtime · 8 Edge Functions (Deno)        │
   └──────────────────────────────────────────────────────────────────┘

           CLIENT  ─────────────────────────────────────────────
   IIFE app (window.app) + 33 lazy chunks + React island
   Service Worker (sw.js): offline cache + jittered de-herd reload
   obs-init.js: env-gated Sentry · sw-init.js: SW registration

   GitHub Actions (out of band): ci · lighthouse · uptime · deploy · backup
```

The 8 Supabase Edge Functions: `admin-auth-ops`, `notify-on-activity`,
`send-activity-push`, `send-activity-reminders`, `send-journey-whatsapp`,
`send-2fa-sms`, `order-form-ocr`, `cps-form-ocr` — see
[SECURITY_EDGE.md](./SECURITY_EDGE.md).

## 2. Request paths

```
(a) STATIC ASSET           browser ──▶ Vercel CDN ──▶ hashed *.min.js[.br]
                           immutable (max-age=31536000); index.html no-cache.
                           SW serves the cached copy when offline.

(b) AUTHED DATA READ       browser ──▶ /api/customers|prospects (BFF)
   (list/search views)        1. verify Supabase JWT  → /auth/v1/user
                              2. scope RPC            → bff_visible_agent_ids
                              3. service-key query    → PostgREST / *_page RPC
                              4. { rows, count }      → RLS = defense-in-depth
                           Fail-fast: 8s upstream timeout → retryable 503;
                           unresolved caller → 409 (never caches an empty list).

(c) REALTIME / AUTH        browser ──▶ Supabase directly (anon/publishable key)
                           login, token refresh, realtime, storage. RLS enforced
                           in-DB. SW treats these as network-only (no caching).
```

The BFF is the only path that uses the **secret** key, and it never trusts a
client-supplied scope — the visible agent-id set is computed server-side from the
verified JWT, so RLS bypass is safe. The in-page client calls the same `*_page`
RPCs with the anon key for views not yet routed through the BFF.

## 3. Build & deploy flow

```
edit SOURCE only ──▶ git push origin/main ──▶ Vercel auto-build
   (script.js, chunks/*, data.js, src/react/*, api/*, *.css)
                                  │
     node build.mjs:  esbuild minify (keep-names) ─▶ *.min.js/css
                      brotli-11 pre-compress       ─▶ *.br
                      sha256 content-hash + copy   ─▶ *.<hash>.min.js
                      write dist-manifest.json
                      rewrite index.html → hashed names + __ASSET_MANIFEST
     npx vite build:  src/react/* ─▶ react-dist/react-island.js (committed)
                                  │
                          deploy to edge
```

**Never commit `.min.*` / `.br` / hashed copies** — they are build outputs Vercel
regenerates (Vercel mints its own hashes, so local hashes won't match live; verify
via the live `__ASSET_MANIFEST`). Bumping `sw.js` `CACHE_VERSION` forces every open
client to reload at once — only do it for a runtime SW change, per
[DEPLOY_DISCIPLINE.md](./DEPLOY_DISCIPLINE.md).

## 4. Observability & ops plane

- **Sentry** — `obs-init.js`, env-gated: a no-op until the owner sets `SENTRY_DSN`
  (injected by `build.mjs` as `window.__SENTRY_DSN`, release = commit SHA). PII
  scrubbed in `beforeSend`. CSP already allows the Sentry ingest origin.
- **Uptime probe** — `.github/workflows/uptime.yml` pings `POST /auth/v1/token`
  (400 = Auth up, 521 = down) to catch the compute-exhaustion outage class.
- **BFF logs** — each `/api/*` return emits one structured JSON line
  (`{t,lvl,ev,fn,status,ms,…}`) for a Vercel Log Drain to ingest and alert on.
- **Supabase metric alerts + backups** — weekly `pg_dump` → GPG → Drive with a
  weekly automated restore test (`.github/workflows/backup.yml`).

See [MONITORING.md](./MONITORING.md) and [INCIDENT_RUNBOOK.md](./INCIDENT_RUNBOOK.md).

## 5. Target hardening (this effort)

| Phase | What changed |
|-------|--------------|
| P0 | Committed DevOps plan + owner checklist; documented stack reality. |
| P1 | SW reload **de-herd** (jitter 0–60 s + edit-guard) — already live; doc only. |
| P2 | **Observability** added: env-gated Sentry, uptime probe, BFF JSON logs, alert wiring. |
| P3 | **CI/CD** gates the deploy (not report-only) + a migration ledger. |
| P4 | **Edge security**: per-IP `/api` rate-limit backstop, CSP Sentry origin, edge-fn auth. |
| P5 | **Scaling**: connection pooling config + keyset pagination path for deep scroll. |
| P6 | **Containers + runbooks**: self-host reference under `../deploy/`, consolidated runbook. |
