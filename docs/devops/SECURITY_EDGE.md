# Edge / Perimeter Security

The application core is already hardened: a prior security pass locked down Supabase **RLS**
(per-row scoping), moved privileged operations behind **edge-function auth** (no service-role key
in the client), and shipped **MFA** for staff logins. So the remaining attack surface is the
*perimeter* — the layers that sit in front of authenticated, RLS-scoped requests: **DDoS / WAF**,
**bot management**, **rate-limiting**, and the **header / CSP** posture. This document is the
playbook for those layers. Most of it is owner-gated (Vercel dashboard) because it needs the
billing-bound platform account; the code-side pieces ship **inert** until an env var enables them.

---

## 1. Vercel Firewall / WAF (owner)

Configured at **Vercel → Project → Firewall**. Automatic **DDoS mitigation is on by default** for
all projects — no action needed for volumetric L3/L4 floods. The owner actions that add real
control:

- **Managed ruleset** — enable Vercel's managed WAF rules (OWASP-style common exploits).
- **Custom rate-limit rule on `/api/*`** — **this is the real rate control.** The BFF endpoints
  (`api/customers.mjs`, `api/prospects.mjs`) are the only stateful surface; a Firewall rate-limit
  rule scoped to `/api/*` enforces a distributed limit at the edge (unlike the in-function limiter
  below, which is per-instance). Start generous; tighten if abuse appears.
- **IP allow / deny** — block specific abusive IPs/ASNs, or allow-list office egress if ever needed.
- **Attack Mode** — flip on **only during an active incident**; it adds an interstitial challenge to
  all traffic. Turn it back off once the incident passes (it impacts legitimate users).

## 2. Vercel BotID (owner)

Enable **BotID** (Vercel → Firewall → Bot management) for bot detection / verification on sensitive
routes — primarily `/api/*` and the login surface. Catches automated credential-stuffing and
scraping that slips past rate limits, without a CAPTCHA wall for normal users.

## 3. In-function rate limiter (shipped — defense-in-depth)

`api/customers.mjs` and `api/prospects.mjs` ship a per-IP, in-memory sliding-window limiter. It is
**inert by default** and a **backstop**, not the primary control (that's the WAF rule above).

**Enable it:** set the Vercel env var `RATE_LIMIT_PER_MIN` to a tuned **positive integer**
(Production + Preview), then redeploy.

```
RATE_LIMIT_PER_MIN = 240
```

- **Start generous (~240).** Office users sit behind a **single NAT'd IP**, so their requests all
  share one bucket — a tight limit throttles the whole office. Tune *down* only if abuse appears.
- **Per-instance.** With Fluid Compute each warm instance keeps its own window, so the effective
  global ceiling is `limit × live instances`. It stops a single-instance hammer, not a distributed
  flood — that's the WAF's job.
- **Fail-open.** Any internal error in the limiter → request is allowed (it never blocks legit
  traffic on its own bug).
- **Response:** over-limit requests get **HTTP 429** with `{ "error": "rate_limited" }`, logged via
  the BFF's structured single-line JSON logs (`ev: "rate_limited"`) for Log-Drain alerting.

## 4. Header & CSP posture

Shipped in [`../../vercel.json`](../../vercel.json), applied to every response. Audit table:

| Header | Value (summary) | Mitigates |
| --- | --- | --- |
| `Strict-Transport-Security` | `max-age=63072000; includeSubDomains; preload` | Protocol downgrade / SSL-strip; HSTS-preloaded |
| `Content-Security-Policy` | `default-src 'self'` + pinned CDN/Supabase/Sentry origins; `frame-src 'none'` | XSS, data exfiltration, clickjacking, mixed content |
| `X-Frame-Options` | `SAMEORIGIN` | Clickjacking (legacy browsers; CSP `frame-ancestors` is the modern control) |
| `X-Content-Type-Options` | `nosniff` | MIME-sniffing → script execution from non-JS responses |
| `Referrer-Policy` | `strict-origin-when-cross-origin` | Referer leakage of paths/query to third parties |
| `Permissions-Policy` | camera/mic/geo/payment/usb/bluetooth/cohort all `()` | Silent access to powerful device APIs; FLoC |
| `Cross-Origin-Opener-Policy` | `same-origin` | Cross-origin window references (XS-Leaks, Spectre) |
| `Cross-Origin-Resource-Policy` | `same-site` | Cross-origin resource inclusion |
| `X-XSS-Protection` | `1; mode=block` | Legacy reflected-XSS auditor (belt-and-braces) |
| `X-Permitted-Cross-Domain-Policies` | `none` | Adobe cross-domain policy abuse |

### Why `'unsafe-inline'` stays in `script-src`

The CSP's `script-src` includes `'unsafe-inline'`. This is a **deliberate, documented trade-off**,
not an oversight. The app's entire interaction model uses inline handlers
(`onclick="app.fn(id)"`) by convention (see `.claude/CLAUDE.md`), so removing `'unsafe-inline'`
would break every button until the app is rewritten to use event delegation / `addEventListener`.

- **Residual risk is bounded:** `default-src 'self'`, a pinned origin allow-list, `base-uri 'self'`,
  `form-action 'self'`, `frame-src 'none'`, and `frame-ancestors 'self'` still block the high-value
  XSS payoffs (remote script load, base-tag hijack, form/iframe injection). The app also escapes
  user-rendered HTML at the source layer.
- **Future path (out of scope here):** migrate inline handlers to delegated listeners, then drop
  `'unsafe-inline'` (ideally moving to a nonce/hash CSP). This is a full-app refactor and is *not*
  part of the edge-security work.

## 5. Secrets posture

- **`SUPABASE_SECRET_KEY`** — server-only; lives in Vercel env and is read **only** inside
  `api/*.mjs`. **Never** shipped in a client bundle. If unset, the BFF returns `503 not_configured`
  rather than degrading to an insecure path.
- **Supabase publishable (anon) key** — **public by design.** It's RLS-gated; exposure in the
  client bundle is expected and safe.
- **GPG signing key, Supabase PAT, webhook / Slack secrets** — held in **GitHub Secrets** (Actions),
  never committed. The repo's gitignore + the no-`git add -A` rule keep them out of source.

---

## Related

- [`OWNER_ACTION_CHECKLIST.md`](OWNER_ACTION_CHECKLIST.md) — **P4 (Edge security)** has the
  owner-side checkboxes for the WAF/BotID and the `RATE_LIMIT_PER_MIN` enablement above.
- [`DEPLOY_DISCIPLINE.md`](DEPLOY_DISCIPLINE.md) — how perimeter/env changes reach production
  safely (source-only deploys, no needless `CACHE_VERSION` bumps, live verification, rollback).
