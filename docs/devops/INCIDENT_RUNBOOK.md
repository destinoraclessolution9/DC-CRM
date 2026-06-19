# Incident & On-Call Runbook

When `destinoraclessolution.com` is down, slow, or misbehaving — this is the page you open
first. Optimised for the 3 a.m. read: confirm scope, run the matching playbook, communicate,
log. The one truth everything hangs off: **the auth probe — `400 = up`, `521 = down`.**

Cross-links: rollback in [DEPLOY_DISCIPLINE.md](./DEPLOY_DISCIPLINE.md), signals & thresholds
in [MONITORING.md](./MONITORING.md), compute tier in [SCALING.md](./SCALING.md), perimeter in
[SECURITY_EDGE.md](./SECURITY_EDGE.md), owner switches in
[OWNER_ACTION_CHECKLIST.md](./OWNER_ACTION_CHECKLIST.md).

---

## 1. First 60 seconds — confirm scope

Don't guess. Three checks tell you *what* is broken before you touch anything.

**1. Is the backend up?** Run the canonical auth probe (the same one `uptime.yml` runs):

```bash
curl -s -o /dev/null -w "%{http_code}\n" \
  -X POST "https://remuwhxvzkzjtgbzqjaa.supabase.co/auth/v1/token?grant_type=password" \
  -H "apikey: <publishable-anon-key>" \
  -H "Content-Type: application/json" \
  -d '{"email":"probe@example.com","password":"x"}'
```

- **`400`** → GoTrue answered (rejected the bad credential) = **backend UP**. The problem is
  the frontend or a deploy — go to §2 *Bad deploy* / *Front-end* / *Auth-RLS*.
- **`521`** (or timeout / 5xx) → edge can't reach origin = **backend DOWN**. Almost always
  compute exhaustion — go straight to §2 *521 / login hangs*.

**2. Is the homepage serving?**

```bash
curl -s -o /dev/null -w "%{http_code}\n" https://destinoraclessolution.com/
```

`200` = Vercel/CDN fine (isolates the fault to the backend or app JS). Non-`200` = frontend /
deploy fault → §2 *Bad deploy*.

**3. Pull the corroborating signals** (detail layered on the probe — see
[MONITORING.md](./MONITORING.md)):

- **Vercel** → Project → Logs / Deployments — most recent deploy, `5xx` rate, function errors.
- **BFF logs** (Log Drain) — grep the single-line JSON for `lvl:"error"`: `auth_unavailable`
  / `scope_unavailable` / `query_unavailable` (all `503`, upstream Supabase failed) and
  `caller_unresolved` (`409`, empty scope). Climbing `ms` p95 = NANO saturating *before* 521.
- **Sentry** (if `SENTRY_DSN` set) — new issue / FE error-rate spike = client-side or deploy.

---

## 2. Incident playbooks

| Scenario | Tell-tale | First move |
|---|---|---|
| **521 / login hangs** | probe `521`; "Still connecting…" | Supabase → Restart |
| **Bad deploy** | smoke red / Sentry spike post-push | Vercel Instant Rollback |
| **Auth / RLS regression** | empty lists / 401s; probe `400` | Inspect recent migration |
| **Front-end blank / CSP** | white screen; console CSP errors | Rollback offending deploy |
| **Data integrity** | wrong/missing/corrupted rows | GPG restore, forward-only |

### 521 / login hangs — compute exhaustion *(most likely)*
The documented #1 incident: NANO compute exhausts (connections at ceiling) → edge returns
**HTTP 521**, logins hang on "Still connecting…".

1. **Restart:** Supabase dashboard → Project → Settings → **Restart project**. Clears the
   connection pile-up; service usually returns in 1–2 min. Re-run the probe → expect `400`.
2. **Confirm recovery:** probe `400`, homepage `200`, a real login renders a scoped list.
3. **If it recurs** (restart buys minutes, not a fix): the fix is the **compute tier**.
   Upgrade **NANO → Small/Medium** and confirm **Pro + Cost-Control** so it sticks — see
   [SCALING.md](./SCALING.md) §1 and [OWNER_ACTION_CHECKLIST.md](./OWNER_ACTION_CHECKLIST.md)
   **P5**. (Owner/billing action — page the owner.)
4. **Watch the `connections` metric** in Supabase (the NANO killer; `> 80%` of pool is the
   leading indicator — [MONITORING.md](./MONITORING.md)). Capacity SQL in [SCALING.md](./SCALING.md) §6.

### Bad deploy — smoke red or error spike after a push
`deploy.yml` post-deploy smoke failed, or Sentry / `5xx` spiked right after a `main` push.

1. **Roll back first, diagnose second.** Vercel → Deployments → last known-good →
   **Instant Rollback** (every deploy is retained) — full procedure in
   [DEPLOY_DISCIPLINE.md](./DEPLOY_DISCIPLINE.md) §Rollback.
2. **Verify:** probe `400`, homepage `200`, login + a scoped list render, console clean.
3. **Then diagnose** the bad commit on a branch — never hot-fix forward on prod under pressure.
   Re-ship through the normal gated path.

### Auth / RLS regression — empty lists / 401s
Users authenticate but see **empty lists** or **401/403s** — RLS is over-scoping, not an outage
(probe still `400`).

1. **Suspect the most recent migration.** RLS/policy changes are the usual cause; DDL is
   forward-only, so **roll forward with a corrective migration** — never auto-revert.
2. **Check the BFF `caller_unresolved` (`409`) logs** — a spike means the caller's scope
   resolved empty (identity/claim broke), not that data vanished.
3. **Verify RLS policies** in Supabase for the affected table; confirm the JWT carries the
   expected role/claim. If a deploy shipped the regression, rollback (above) buys time.

### Front-end blank / CSP break
White screen or broken UI, homepage still `200`, probe `400` — it's the client bundle, often a
**CSP** change in [`vercel.json`](../../vercel.json).

1. **Open the browser console** — look for `Content-Security-Policy` violation lines (a newly
   pinned origin missing, or `'unsafe-inline'` dropped — see [SECURITY_EDGE.md](./SECURITY_EDGE.md) §4).
2. **Rollback the offending deploy** (Vercel Instant Rollback), then fix the header/bundle on a
   branch and re-ship gated.

### Data integrity — corrupted / lost rows
Last resort, highest blast radius. **Do not improvise UPDATEs on prod.**

1. **Restore path is the GPG dump** from [`backup.yml`](../../.github/workflows/backup.yml)
   (weekly dump, monthly restore-tested). Restore to a staging DB, validate, then cut over.
2. **DDL is forward-only** — fix data with a new forward migration; never hand-revert schema.
3. Snapshot the bad state first (for the post-mortem) before you overwrite anything.

---

## 3. Escalation & comms

- **On-call (you):** run §1 → §2. If a fix needs a dashboard/billing action (compute upgrade,
  WAF, secrets), **page the owner** — those are owner-gated by design
  ([OWNER_ACTION_CHECKLIST.md](./OWNER_ACTION_CHECKLIST.md)).
- **Alert routing:** failures fan out to Slack via `OPS_SLACK_WEBHOOK` (set on `uptime.yml`
  and `backup.yml`). Acknowledge in the channel so two people aren't fixing the same thing.
- **Public status update** — post when the outage is **user-visible and sustained**
  (probe `521` on multiple consecutive runs, not a single blip): update the status page
  (Checkly / Better Stack, if enabled) with *impact → cause if known → ETA*. Re-post on
  recovery. Don't go public for a blip that self-heals before users notice.
- **Attack-driven incident** (traffic flood / credential stuffing): flip Vercel **Attack Mode**
  on *only* for the duration, then off — [SECURITY_EDGE.md](./SECURITY_EDGE.md) §1.

---

## 4. Post-incident

Every paged incident gets a short write-up — same day, while it's fresh. Keep it to a timeline,
not blame.

- **Log:** timeline (detected → mitigated → resolved, with timestamps), **root cause**, the
  **fix applied**, and **follow-ups** (owner-gated items → file against
  [OWNER_ACTION_CHECKLIST.md](./OWNER_ACTION_CHECKLIST.md)).
- **Template:**

  ```md
  ## Incident YYYY-MM-DD — <one-line title>
  - Impact:      <who/what, duration, user-visible?>
  - Detected by: <probe / Sentry / BFF log / user>
  - Timeline:    HH:MM detected · HH:MM mitigated · HH:MM resolved
  - Root cause:  <what actually broke>
  - Fix:         <restart / rollback / migration / restore>
  - Follow-ups:  <prevention; link owner-checklist items>
  ```

---

## 5. Quick reference

**Auth probe** (the one signal — `400 = up`, `521 = down`):
```bash
curl -s -o /dev/null -w "%{http_code}\n" \
  -X POST "https://remuwhxvzkzjtgbzqjaa.supabase.co/auth/v1/token?grant_type=password" \
  -H "apikey: <publishable-anon-key>" -H "Content-Type: application/json" \
  -d '{"email":"probe@example.com","password":"x"}'
```

**Homepage reachability:** `curl -s -o /dev/null -w "%{http_code}\n" https://destinoraclessolution.com/` → `200`

**Frontend rollback:** Vercel → Deployments → last good → **Instant Rollback** (or
`vercel rollback <url>`). DB restore: GPG dump from
[`backup.yml`](../../.github/workflows/backup.yml), forward-only.

**Health semantics:** auth `400` = up · `521` = down · homepage `200` = CDN fine ·
`connections > 80%` of pool = NANO killer (pre-521 warning).

**Dashboards:** Vercel (deploys, logs, Firewall) · Supabase (Restart, metrics, SQL Editor) ·
Sentry (FE errors) · status page (Checkly / Better Stack).

**Docs:** [MONITORING.md](./MONITORING.md) · [SCALING.md](./SCALING.md) ·
[DEPLOY_DISCIPLINE.md](./DEPLOY_DISCIPLINE.md) · [SECURITY_EDGE.md](./SECURITY_EDGE.md) ·
[OWNER_ACTION_CHECKLIST.md](./OWNER_ACTION_CHECKLIST.md)
