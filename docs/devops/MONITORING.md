# Monitoring Strategy

Part of the production-hardening effort on **destinoraclessolution.com** — see
[DEVOPS_PLAN.md](./DEVOPS_PLAN.md) (P2 — Observability). Owner-side switches live in
[OWNER_ACTION_CHECKLIST.md](./OWNER_ACTION_CHECKLIST.md).

## Philosophy

**Detect before users do.** On a static SPA + Supabase, the failure that actually pages
people is the backend going dark — historically NANO compute exhaustion → HTTP 521. So the
**canonical health signal is the auth probe**: `POST {SUPABASE_URL}/auth/v1/token` →
**400 = up** (GoTrue rejected the empty credential, i.e. it answered), **521 = down** (edge
can't reach origin). Everything else (FE errors, function logs, DB metrics) is corroborating
detail layered on top of that one synthetic truth. Every layer ships **inert by default** —
no external account = no-op, zero runtime cost — and activates the moment the owner sets an
env var or imports a config.

## Layered monitoring

| Layer | Tool | What it watches | Alert trigger |
|-------|------|-----------------|---------------|
| Uptime / synthetic | `.github/workflows/uptime.yml` (free GH Action probe); optional Checkly / Better Stack | Auth probe + live `index.html` reachability, multi-region if Checkly | Auth `521` (or non-`400`) on N consecutive runs; probe timeout |
| Front-end errors | Sentry via `obs-init.js`, gated on `SENTRY_DSN` (inert until set) | Uncaught JS exceptions + unhandled rejections in the SPA + React island | New issue / error-rate spike (Sentry-side rule) |
| API / function errors | BFF structured JSON logs → Vercel Log Drain → Axiom / Better Stack | `api/customers.mjs`, `api/prospects.mjs` outcomes + latency | `lvl:"error"` rate, `5xx`, sustained high `ms` |
| Function / access logs | Vercel Log Drain (platform) | All function invocations, cold starts, platform `5xx` | Invocation-error rate; runtime exceptions |
| Database | Supabase metric alerts (dashboard) | CPU, **connections**, disk, slow queries | CPU > 80 %, **connections > 80 % of pool** (NANO-tier killer), disk > 80 % |
| Backups | `.github/workflows/backup.yml` (on-failure) | Weekly GPG dump + **monthly restore test** | Job failure → page (dump too small, GPG/restore fails) |
| Status page | Checkly / Better Stack public page (optional) | Aggregated probe history, public incident comms | Manual / auto on sustained probe failure |

## How to turn each layer on

All steps cross-referenced in [OWNER_ACTION_CHECKLIST.md](./OWNER_ACTION_CHECKLIST.md):

1. **Front-end errors** — set Vercel env `SENTRY_DSN` (Production + Preview). `build.mjs`
   injects `window.__SENTRY_DSN`; `obs-init.js` self-activates. Empty DSN = full no-op.
2. **Alert routing** — add repo secret `OPS_SLACK_WEBHOOK` (Slack incoming webhook) so
   `uptime.yml` and `backup.yml` can page on failure.
3. **Status page + multi-region** — import `monitoring/checkly.config.json` into Checkly or
   Better Stack for SMS alerts + a public status page (optional; the GH probe needs no account).
4. **Database** — in Supabase, enable metric alerts on CPU / connections / disk → route to
   `OPS_SLACK_WEBHOOK`.
5. **API / function logs** — add a **Vercel Log Drain** (dashboard → project → Log Drains)
   pointing at Axiom / Better Stack; alert on the JSON fields the BFF already emits (below).

## What the BFF already emits

`api/customers.mjs` and `api/prospects.mjs` log **one single-line JSON record per terminal
response** (drainable, never thrown into the request path):

```json
{"t":"2026-06-19T...","lvl":"error","ev":"auth_unavailable","fn":"customers","status":503,"ms":812,"reqId":"...","upstream":521}
```

- **Fields:** `t` (ISO time), `lvl` (`info`/`warn`/`error`, derived from status), `ev`, `fn`,
  `status`, `ms` (**latency**), plus optional `reqId` (`x-vercel-id`), `upstream`, `rows`, `count`.
- **Events:** `ok` (2xx), `auth_unavailable`, `scope_unavailable`, `query_unavailable`
  (all `503` — upstream Supabase failed/timed out), `caller_unresolved` (`409` — empty scope).
- **Alert on:** any `lvl:"error"` rate, repeated `auth_unavailable` (corroborates the auth
  probe), or `ms` p95 climbing (early NANO-saturation tell, before 521).

## Alert thresholds

- **Auth `521` sustained** — N consecutive probe failures (not a single blip) → page. The one
  signal that maps directly to a user-visible outage.
- **`5xx` rate** — function/BFF error ratio above baseline over a rolling window.
- **DB CPU > 80 %** — sustained; precedes query timeouts.
- **DB connections > 80 % of pool** — the NANO-tier killer; the failure mode behind past 521s.
  Enable the Supavisor pooler (see checklist P5) before this even becomes measurable headroom.
- **LCP regression** — Lighthouse CI (already in `ci/regression.js`) regressing past budget on a PR.
