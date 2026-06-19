# CRM — Living Roadmap

## Status as of 2026-06-20
Repo tip `9c9dbf3`. Improvement program R1–R6: **all 6 shipped** (commits `7db7b54`→`349221f`,
incl. R3 arch-freeze decision). Owner/external section: **2 cleared** (RLS BACK-1 applied
`fbc6e6b`; edge functions deployed `9c9dbf3`) — **4 still owner-gated** (compute upgrade,
full OAuth, fude redeem DB wiring + admin role promotion, monthly_focus UNIQUE apply).

_Canonical program tracker. Supersedes the per-initiative plan docs now in `docs/archive/`
(AUTOPILOT_PLAN, OUTSTANDING, REACT_MIGRATION_PLAN, REFACTOR_PLAN, UPGRADE)._

_Last updated: 2026-06-19. Live tip: `origin/main` (Vercel auto-builds from it)._

---

## Current architecture (truthful, post-split)

- **Dual-stack SPA.** A vanilla IIFE (`script.js`, ~5,000 LOC, exposed as `window.app`) +
  **33 lazy chunks** (`chunks/script-*.js`) own the business logic. A **React island layer**
  (`src/react/` — ~36 UI components + ~32 view islands, bundled to `react-dist/react-island.js`
  via vite) mounts on top. **All standalone views + modal forms are migrated to React islands
  and promoted default-on**; most are React *shells* that render chunk-generated HTML via
  `dangerouslySetInnerHTML` — the chunks remain the source of truth for view logic.
- **Data layer:** `data.js` (~3,560 LOC) = `AppDataStore` over Supabase (SWR + delta-sync +
  in-flight dedup); `data-helpers.js` holds extracted pure helpers. A small BFF lives in `api/`.
- **Build/deploy:** `node build.mjs` writes content-hashed `*.min.*` copies + `.br` brotli +
  `dist-manifest.json` (all gitignored; the canonical non-hashed `*.min.*` stay committed as SoT).
  Vercel re-runs `build.mjs` on every push to `origin/main`. **`sw.js` `CACHE_VERSION` is the only
  thing that forces every client to reload+re-auth — bump it deliberately** (see R2 below).
- **Gate:** `node ci/regression.js` (build check, ghost-call audit, onclick resolution,
  view-derive parity, size budgets).

---

## Architecture decision — D-goal frozen (R3)

**Decision (2026-06-19): the React migration is "done enough." Freeze further full-JSX
componentization** of the passthrough/scaffold views. "React-shell over chunk-logic" is the
**target architecture**, not a way-station. Rationale: the remaining componentization yields
*zero user-facing change*, carries real regression risk on working views (several with silent
data-mutation paths that can't be safely click-tested unattended), and its only concrete benefit
(closing the manual-escaping XSS surface) was already delivered by the SW-104 escaping sweep.
Effort goes to correctness (tests) and stability (deploy choreography) instead.

---

## Improvement program (R1–R6) — senior-review backlog

| Phase | Item | Deploys? | Status |
|-------|------|----------|--------|
| 0 | **R4** repo hygiene · **R6** docs refresh · **R3** arch-freeze decision | No | ✅ DONE (`7db7b54`) |
| 1 | **R1** business-logic test oracle (money/authz/dormancy/reconcile/matcher) | No (CI) | ✅ DONE (`7bebc4f`) |
| 2 | **R2** deploy-storm fix — stagger SW reload + preserve session | **Yes** (1 bump) | ✅ DONE (`e1d198f` — repaired dead reload edit-guard modal selector; R2 runtime already live) |
| 3 | **R5** migration discipline — applied-ledger + dup-number CI check | No | ✅ DONE (`349221f`) |

**Why this order:** only R2 force-deploys; the rest land as quiet source commits (no
`CACHE_VERSION` bump → no fleet-reload storm). The test net (R1) is built before the one risky
runtime change (R2). Each phase gates on `node ci/regression.js` + live bundle-marker verify.
Verification ceiling: structural (build/CI/marker), **not** authenticated click-testing.

---

## External / owner-gated (cannot be done from code — folded from OUTSTANDING.md)

> Status note (2026-06-20): two items previously here are now CLOSED — RLS per-row SELECT
> scoping (BACK-1) was applied to prod (`fbc6e6b`) and all 7 edge functions were deployed
> (`9c9dbf3`). The items below remain genuinely owner-gated.

- **Supabase compute Nano → Micro/Small** (billing) — the durable fix for repeat 521 outages;
  R2 only mitigates the client-side stampede. Confirm project id before changing.
- **Full OAuth integrations** (Outlook/GitHub/Drive) — need a server OAuth backend + secrets;
  infeasible client-side. Only Google Calendar is real; others show an honest "needs backend" card.
- **fude "Redeem Points" → DB-backed queue** — migration prepared
  (`migrations/redemption_requests_2026-06-17.sql`); apply via Supabase dashboard, then wire the client.
- **fude admin role levels** — set the 3 legacy-allowlist admins to L1/L2 in the DB, then delete
  the `[fude-authz]` email fallback.
- **`UNIQUE(user_id,month,prospect_id)` on `monthly_focus_archive`** — optional belt-and-suspenders
  DDL (`migrations/monthly_focus_archive_unique_2026-06-17.sql`); dashboard apply.

---

## History

Per-initiative plans and the detailed shipped-log (SW-43 … SW-107, UI Phases 0–5) are archived
under `docs/archive/`. This file is the single forward-looking tracker.
