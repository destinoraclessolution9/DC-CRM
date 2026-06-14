# CRM Scalability Upgrade — Program of Record (items 6–15)

Branch: `upgrade/phases-6-15` · target: 3,000 users / 500k customer base · **strangler-fig, no big-bang, nothing ships to live without approval.**

This is a multi-session program. Each phase ships behind a flag and is independently revertible. Status legend: ✅ done & verified · 🟡 scaffolded (ready to wire) · ⬜ planned.

---

## Phase 0 — Safety net (#10)  ✅
The net that must stay green before any later refactor ships.
- ✅ `tsconfig.json` — incremental `checkJs` over the typed surface (`types/`, `api/`). `tsc --noEmit` is clean.
- ✅ `tests/contract/data-store.contract.test.mjs` — loads `data.js` in a VM and locks the offline-queue/sync classification (incl. the 23503→`fk` bounded-retry fix and `_snapshotsDiffer`). `node --test` → 6/6 pass.
- ✅ `tests/e2e/critical-flows.spec.ts` — Playwright specs for the 8 critical flows; authed specs skip until a **TEST Supabase project** + seeded account is wired (never point at prod data). Some bodies are `test.fixme` pending seed.
- ✅ `ci/test.mjs` — runs tsc + contract suite. (Keep `ci/regression.js` running separately.)
- ⬜ Next: provision a seeded Supabase test project; fill the `fixme` specs; add `npm run test:e2e` to CI.

## Phase 1 — Server-paginated reads (#12)  ✅ customers + prospects
The scale unlock. 255 `getAll('<bigtable>')` full-table fetches → server-side filter/sort/paginate via the existing `queryAdvanced`.
- ✅ Shared **`_serverPage(table, opts)`** helper (`chunks/script-prospects.js`): runs `queryAdvanced` with role-visibility scope injected server-side (`scopeBy:[cols]`), returns `{data,count,used}` or `{used:false}` → caller falls back. (Promote to `_crmUtils`/`lib` when a 3rd chunk adopts it.)
- ✅ **Customers list** (`renderCustomersTable`) behind `window.__SERVER_TABLES` (default OFF → identical legacy behavior). Server-handled: search, `ming_gua`, `house_audit_status`, VIP (`gte lifetime_value`), Agent-Eligible, scope. Client fallback: `Regular` (null edge), `deficiency` (array), `min-events` (aggregation). Fixed unescaped `full_name`/`customer_since`/`ming_gua` XSS.
- ✅ **Prospects list** (`renderProspectsTable`) behind the same flag. Server-handled: search, `ming_gua`, agent, scope, column sort (name/score/activity), paginated. Client fallback: score-grade + protection-status filters (derived, not columns) and protection sort. **Dormancy caveat:** the flagged `queryAdvanced` path is not dormancy-curated (it shows all matching, paginated; never-contacted prospects are correctly NOT hidden) — exact hide-dormant-by-default parity is the job of **`migrations/prospects_page_rpc_2026-06-14.sql`**.
- ✅ **`prospects_page` RPC — APPLIED to live 2026-06-14.** SECURITY DEFINER, does dormancy + scope + filter + sort-ordered page in one call. Corrected against the real schema before applying: params are `bigint` (not `uuid`); no `deleted_at` filter (column doesn't exist — the legacy list filters only by dormancy); search covers full_name/nickname/phone/email; pagination row_number() carries the sort (the scaffold's unordered row_number() paged arbitrarily — fixed). Verified live: 339 active vs 361 all (22 dormant correctly hidden), page boundaries monotonic + non-overlapping, scope 100=100, search 31=31. **Not yet wired into the client** (renderProspectsTable still uses `queryAdvanced`); wiring is the next step to activate dormancy-curated server paging.
- ⬜ **Activities** has no standalone full-table list view to migrate — activities surface through the calendar feed (already server-windowed via `get_calendar_window` RPC) and per-entity timelines (`getActivitiesForProspect`, indexed). Not the `getAll`-whole-table anti-pattern.
- ⬜ Next, in traffic order: **import preview (25 `getAll`) → reporting (70, mostly aggregations → RPCs) → agents / purchases_history lists.**
- ⬜ Enablement: flip `window.__SERVER_TABLES = true` per-view via a config flag after each view is verified against live data (with login).

## Phase 2 — Centralize the server seam (#11 BFF, #6 RBAC)  🟡
- 🟡 **#11 BFF** — `api/customers.mjs` Vercel serverless scaffold (browser → `/api` → Postgres; scoping + service role server-side; RLS becomes defense-in-depth). Helpers are `not_wired` stubs (typed). Needs: Vercel `/api` provisioning, `SUPABASE_SERVICE_ROLE_KEY` env (server-only), a `lib/api-client.js` adapter, Upstash rate-limit.
- ✅ **#6 RBAC — `role_level` migration APPLIED to live 2026-06-14** (staged: add column + backfill → verified 0 nulls / 0 out-of-range → NOT NULL + check(1–15) + index). All 22 users backfilled correctly from `"Level N"` strings (Level 1–11 present). Authoritative numeric `users.role_level` now exists server-side. **Still client-display-only** — no read path uses it yet. Follow-up migration: `custom_access_token_hook` to stamp `role_level` into the JWT so RLS reads it directly; then deprecate client-side `_getUserLevel` parsing (display-only).
- ⬜ Sequence: apply migration (dual-read) → wire BFF reads with server-side scope → flip source of truth → drop string parsing.

## Phase 3 — Cut the bespoke complexity (#8 sync, #7 offline)  ⬜
*Do after Phase 1 — server pagination is what makes most of this unnecessary.*
- ⬜ **#8** — once reads are server-paginated, delete the delta-cursor/tombstone/full-reconcile machinery for paginated views; keep a small page+reference cache. When the framework lands (P4), replace the whole layer with **React Query**. The `data.js` contract tests guard this teardown.
- ⬜ **#7** — keep the offline write-queue only for the narrow field path that needs it (agents logging activities offline); drop it elsewhere. Keep the SW asset cache + cache-version reload (works well).

## Phase 4 — Modernize the client (#14 types, #13 framework, #15 maintainability, #9 build)  🟡 #14 done
- ✅ **#14 Type safety** — `tsconfig` (checkJs) + `types/crm.d.ts` (domain rows + `AppDataStore`/`queryAdvanced`/`window.*`). New code is type-checked; expand coverage file-by-file with `// @ts-check`.
- ⬜ **#13 Framework** — React + Vite. Strangler-fig: mount React **islands** into `#content-viewport` for new/migrated views (start with the P1-paginated ones — they're now just typed tables), behind the existing shell. Consolidate into Next.js App Router once most views are React; retire `window.app`.
- ⬜ **#15 Maintainability** — replace the `window.app` god-object + inline `onclick="app.fn()"` with typed modules + component handlers as views migrate. Interim: split the largest chunks (prospects 606 KB, calendar, marketing) into feature modules.
- ⬜ **#9 Build** — replace bespoke `build.mjs` with **Vite/Turbopack** once React lands (tree-shaking, HMR, code-split for free); stop committing hashed bundles to git (let Vercel build from source).

---

## This session delivered (on `upgrade/phases-6-15`, NOT pushed)
| Item | Status | Verified by |
|------|--------|-------------|
| #10 tests/CI | ✅ | `node ci/test.mjs` (tsc + 6/6 contract) green |
| #12 customers pagination | ✅ first slice | `queryAdvanced` paginates live; flag-off = legacy; regression green |
| #14 TypeScript infra | ✅ | `tsc --noEmit` exit 0 |
| #11 BFF / #6 RBAC | 🟡 scaffold | `api/customers.mjs`, `role_level` migration (typed, not wired) |
| #8 sync / #7 offline / #13 / #15 / #9 | ⬜ planned | specced above |

Run locally: `node ci/test.mjs` · `node ci/regression.js` · (e2e) `npx playwright test`.
