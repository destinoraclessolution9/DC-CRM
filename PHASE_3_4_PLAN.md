# Phases 3 & 4 — Implementation Plan (CRM upgrade items #7, #8, #9, #13, #15)

Status: **plan only, no code.** Phase 1 (server pagination/aggregation) and the Phase 2 BFF are done/deployed. This plan sequences the remaining modernization. The headline decision drives everything:

> **Do Phase 4's framework first, then Phase 3's teardown falls out of it.**
> The bespoke sync layer (#8) only exists because there's no framework-level data cache. Introduce **React + TanStack Query** and the delta-cursor/tombstone/full-reconcile machinery becomes dead code you *delete*, rather than a layer you carefully rewrite in place. Tearing it down standalone (Phase 3 before Phase 4) means rebuilding a cache by hand — wasted work and the exact surface behind the 2026-06-11 outage. So the real order is **4 → 3**, interleaved per view.

---

## Guiding constraints
- **Strangler-fig, never big-bang.** The `window.app` IIFE + 29 lazy chunks keep running. New/migrated views mount as React **islands** inside `#content-viewport`; everything else is untouched.
- **One view at a time, each independently revertible** behind a flag, same discipline as Phase 1's `__SERVER_TABLES`.
- **The contract tests + `ci/regression.js` ghost-call audit are the safety net** for every step — they must stay green.
- **Reads are already server-paginated/RPC-backed**, so React Query wraps the existing `AppDataStore` methods and the BFF — no new server work to start.

---

## Phase 4 — Modernize the client

### 4.0  Tooling beachhead (#9 build) — ~0.5–1 session
- Add **Vite** alongside the current pipeline (do NOT rip out `build.mjs` yet). Vite builds a single new entry (`src/react/main.tsx`) into one hashed bundle that `index.html` loads with a `<script type="module">`, exactly like today's hashed bundles.
- Keep `build.mjs` minifying the legacy IIFE + chunks. Two build steps coexist: `vite build` (React island bundle) + `node build.mjs` (legacy). The Vercel `buildCommand` runs both.
- **Exit check:** a trivial React island renders into a throwaway `<div>` in `#content-viewport` in dev + prod. No legacy behavior changes.
- Risk: low. Pure additive tooling.

### 4.1  Data layer = TanStack Query (#13 foundation, sets up #8) — ~1 session
- Add `@tanstack/react-query`. Create `src/react/data/` hooks that wrap **existing** `AppDataStore`/BFF calls:
  - `useCustomers({cursor,q,gua})` → `ApiClient.getCustomers` (BFF, already built) or `AppDataStore.queryAdvanced` fallback.
  - `useProspectsPage(...)` → the `prospects_page` RPC (already live).
  - `useReportKpis(range)` → the `kpi_*` RPCs (already live).
- Query keys encode the server filters; React Query owns caching, dedup, background refetch, and invalidation — **replacing** what the bespoke SWR/delta-sync layer does for these views.
- **Exit check:** the hooks return identical data to the legacy calls (reuse the Phase-1 parity approach). Still no UI swap.

### 4.2  First migrated island — Customers list — ~1–2 sessions
- Rebuild `renderCustomersTable` as a React `<CustomersTable>` island: `useCustomers` (keyset pagination via the BFF), typed row components, component `onClick` handlers replacing inline `app.fn()`.
- Mount behind a flag (`__REACT_CUSTOMERS`); flag-off keeps the legacy table. Flip per-environment after parity is verified against live.
- **This is the template** for every subsequent view. Nail the patterns here: island mount/unmount, auth/session access, toast/modal bridges to the existing `UI.*`, error boundaries.
- Risk: medium. Customers is high-traffic — verify carefully, keep the legacy fallback until confident.

### 4.3  Roll the island pattern outward (#13, #15) — ongoing, several sessions
Order by (traffic × isolation), reusing 4.2's template:
1. Prospects list (already RPC-backed) → `<ProspectsTable>`.
2. Reporting dashboard (KPIs + drill-downs already RPC-backed) → `<Reports>` — the cleanest migration since the data is pure server aggregates now.
3. Import preview, pipeline, calendar (largest chunks) last.
- As each view migrates, **delete its `window.app` entries + inline `onclick` handlers** (#15) and its slice of legacy chunk code.
- **#15 interim (can start anytime, independent):** split the 606 KB `script-prospects` and the calendar/marketing mega-chunks into feature modules; promote shared helpers (`_serverPage`, the `_try*` RPC wrappers) into a real `lib/`.

### 4.4  Consolidate (#9 finish, #13 finish) — after most views are React
- Once the majority of `#content-viewport` is React islands, fold them into a **Next.js App Router** shell (or keep Vite SPA if Next's server features aren't needed — decide then based on whether SSR/RSC buys anything for an internal CRM; likely keep Vite to avoid scope).
- Retire `build.mjs` and the hashed-bundle hand-rolling; Vite/Turbopack owns the build (tree-shaking, HMR, code-split for free; stop committing hashed bundles to git — the 2026-06-11 note already wants this).
- Retire `window.app` once nothing inline references it.

---

## Phase 3 — Cut the bespoke complexity (happens *during* 4.1–4.3)

### 3.1  #8 sync teardown — per migrated view
- The moment a view reads through React Query (4.1+), its data no longer flows through `AppDataStore`'s delta-cursor + tombstone + full-reconcile path. **Delete that machinery view-by-view** as each migrates:
  - Drop the `__*_active_*` / `__latact_` derived caches and the `_swr*` revalidation for migrated tables.
  - Keep ONLY a thin page+reference cache for any still-legacy view until it too migrates.
- The `data.js` **contract tests guard this teardown** — they lock the offline-queue classification (incl. the 23503→`fk` bounded-retry) so you can delete sync code without regressing writes.
- **Hard constraint:** keep the `hasLiveSession()` guard and the poison-queue dead-letter (both from the 2026-06-11 incident) until the very end — they protect the write path, not the read cache.

### 3.2  #7 offline — narrow, then keep
- Keep the offline write-queue ONLY for the one path that needs it: **agents logging activities offline in the field**. Everything else (which only needed offline because reads were client-cached) drops out naturally once reads are server-paginated + React-Query-cached.
- Keep the SW asset cache + cache-version reload (works well; don't touch).

---

## Sequencing summary & rough effort
| Step | Item | Effort | Risk | Gate |
|------|------|--------|------|------|
| 4.0 | Vite beachhead | 0.5–1 sess | low | island renders in prod |
| 4.1 | React Query data hooks | 1 sess | low | hooks parity vs legacy |
| 4.2 | Customers island | 1–2 sess | med | live parity, flag-gated |
| 3.1 | Delete sync for customers | (within 4.2) | med | contract tests green |
| 4.3 | Prospects → Reports → rest | several sess | med | per-view parity + flag |
| 3.1 | Delete sync per view | (within 4.3) | med | contract tests green |
| 3.2 | Narrow offline queue | 0.5 sess | low | field-activity write works offline |
| 4.4 | Vite owns build, retire window.app | 1–2 sess | med-high | full regression + e2e |

**Total:** a multi-session program (realistically 10–15 focused sessions), each shippable and revertible. No single step is a big-bang.

## What to NOT do
- Don't tear down the sync layer before React Query exists to replace its caching (rebuilds a hand-rolled cache → wasted + risky).
- Don't introduce React + a full rewrite at once — islands only, behind flags.
- Don't remove `hasLiveSession()` / dead-letter queue / SW asset cache during the teardown — those are incident fixes, not bespoke complexity.
- Don't migrate calendar/import (largest, most stateful chunks) first — prove the pattern on customers/prospects/reports.
