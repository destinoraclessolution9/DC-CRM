# Deploy Discipline & Rollback

How to ship to `destinoraclessolution.com` without causing a self-inflicted outage.

## The golden rule: don't bump `CACHE_VERSION` for normal deploys

Assets are **content-hashed + immutable** (`build.mjs`) and the SW serves them
stale-while-revalidate. A normal source change therefore reaches clients **automatically**
on their next navigation — no `CACHE_VERSION` bump required.

Bumping `CACHE_VERSION` (`sw.js`) forces **every open client** to activate a new SW and
reload. The reload is already de-herded — `sw-init.js` jitters it 0–60 s and defers while
the user is mid-edit — but it still produces a fleet-wide auth re-validation wave. On the
current Supabase compute tier that wave is the documented **HTTP 521** trigger.

**Bump `CACHE_VERSION` only when SW *logic* itself changed** (fetch strategy, precache list,
cache-key shape). Pair any such bump with a low-traffic window and, if available, a Vercel
Rolling Release (canary %).

> Reminder from `CLAUDE.md`: bumping `sw.js` `CACHE_VERSION` forces every open client to
> reload + re-auth at once. Batch deploys; only bump when a runtime change must reach all
> clients immediately.

## Standard deploy (the autopilot loop)
1. Edit **source only** (`script.js`, `chunks/*.js`, `data.js`, `src/react/*`, `api/*`, `*.css`).
   Never edit `.min.*` / `.br` / hashed copies — `build.mjs` regenerates them on Vercel.
2. Gate locally: `node ci/audit.js` (always) + `node ci/regression.js` (when JS/CSS changed).
3. Commit **explicit source paths** (never `git add -A` — it would sweep scratch + build output).
4. `git push origin main` → Vercel auto-builds.
5. Verify live (see below).

## Live verification (post-push)
- **Build landed:** `curl -s https://destinoraclessolution.com/ | grep -o '__ASSET_MANIFEST'`
  and confirm a hashed bundle 200s. (Vercel mints its **own** hashes ≠ local build — verify
  against the live `index.html` manifest, never local hashes.)
- **Auth up:** `POST https://<project>.supabase.co/auth/v1/token` → **400 = up**, **521 = down**.
- **Smoke:** login renders; a scoped list loads (RLS + BFF path); no console error wave.

## Rollback (under 60 s)
1. **Frontend:** Vercel dashboard → Deployments → previous good → **Instant Rollback**
   (or `vercel rollback <url>`). Every deploy is retained.
2. **Verify:** `POST /auth/v1/token` → 400, login works.
3. **Database:** restore path is the GPG dump from `.github/workflows/backup.yml`
   (already restore-tested monthly). DDL is forward-only — never auto-revert a migration.
4. Log the incident in `INCIDENT_RUNBOOK.md`.
