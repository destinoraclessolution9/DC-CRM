# Auto-Pilot Refactor Plan — finish ALL outstanding (100%)

**Baseline:** live `main` = `2d729ef` (Vercel-deployed). Authorization: **all-in** — intentional behavior fixes + data-core refactor accepted, with maximum verification. Mode: **auto-pilot** — I run each phase, push live, bug-check, then auto-advance to the next, repeating until every phase is done. No per-phase approval needed once this plan is approved.

> Concurrency note: the orchestrator runs ~16 subagents *simultaneously* and queues the rest (hard cap 1000/run), so "100 in parallel" = I hand it 100 units and they all complete, ~16 at a time. Phases that touch **shared closure state** (4.3, 4.2) are intentionally **sequential**, not fanned out — parallel edits there would crash prod (see Phase 4/5 risk notes).

---

## Per-phase protocol (the loop, applied to every phase)

1. **Fan out** — one subagent per independent unit (file / view / module). Parallel where units share no mutable state; sequential pass where they do.
2. **Merge** — subagents edit disjoint files in the working tree; master (me) collects. Conflict-prone units use isolated git worktrees, merged back by master.
3. **Gate** — `node ci/regression.js` (ghost-call audit → build → snapshot-vs-baseline → lint → size budgets) must be green.
4. **Adversarial verify** — one skeptic subagent per changed file: byte-diff (behavior-preserving phases) or correctness proof (fix/behavior-change phases). Blocks anything not provably correct.
5. **Live runtime check** — load production app, exercise affected views as Super Admin: 0 console errors + reachability/parity probes specific to the phase.
6. **Push** — source-only commit → fast-forward `main` → push → Vercel rebuilds → confirm `--keep-names` markers present in the live hashed bundles.
7. **Quick bug check** — multi-agent regression hunt on the phase's cumulative diff (find → adversarially verify); fix any confirmed regression before advancing.
8. **All clear → auto-advance** to the next phase. Else fix the one file and re-verify (never push a red phase).

Each phase updates `REFACTOR_PLAN.md` + this file's checklist as it lands.

---

## Phase 1 — Perf & scalability (parallel, medium risk)

Directly serves the original brief's "performance bottlenecks / scalability risks." File-disjoint → **parallel fan-out**.

- **1a · 2.6 trim predictive prefetch** (`script.js`) — keep Tier-1 chunks eager; make Tier-2 idle/interaction-driven. *Behavior tradeoff (loses some pre-warm), authorized.* Verify: views still load on nav, no console error.
- **1b · 2.4 pipeline counts from memory — ONLINE PATH ONLY** (`chunks/script-pipeline.js`) — replace the per-row note/activity count N+1 with in-memory derivation from already-loaded activities + one batched notes query. **Scope strictly to the online live-session path** (the adversarial cross-check proved it byte-identical there); **leave the JSX + legacy `renderFocusRow`/`renderSystemRow` paths untouched** (they diverge). Verify: pipeline count badges identical before/after on live for the same prospects.
- **1c · 2.8 KPI dashboard → RPC** (`chunks/script-performance.js` / reporting) — the 9 sequential full-table aggregations → one server-side `kpi_target_comparison` RPC. **Additive DDL (`CREATE FUNCTION`) — pre-authorized**; applied via the Supabase Management API. Verify: RPC numbers === current client-computed numbers on live (Super Admin, before/after), for each KPI cell.

**Verify phase:** gate + 3 byte/parity skeptics + live parity (pipeline badges, KPI numbers) + bug check. **Push.**

---

## Phase 2 — View-registry consolidation (3.1c) — staged, authz-critical

Collapse the 5 drifting view tables into ONE `VIEWS[id]` map (single source of truth). **Authz-critical** — a key-space slip silently over/under-grants nav.

- **2.0 · Authz fixed-point oracle FIRST** (`ci/authz-fixedpoint.js`, additive) — compute `(chunkLoadAllowed, navVisible, renderGateOutcome)` for **every (viewId × role-class)** including `Level 1..15`, named roles (`super_admin`/`manager`/…), and Chinese roles, from the CURRENT 5 tables; snapshot a baseline. *This is the regression oracle — it would have caught the 1.2 authz bug.* Must be authored + frozen before any table edit.
- **2.1 · Merge tables** (sequenced, `script.js`): carry BOTH `viewId` (underscore) and `navId` (dash) per row. Order: `VIEW_TITLES` → `_VIEW_REFRESH` → `_VIEW_RENDER`(+3 aliases, keep render-fn bodies verbatim incl. inline authz gates) → `_CHUNK_VIEWS.exactLevels/minLevel` → `levelPermissions` **last and alone**. **Do NOT touch** the 3rd, intentionally-divergent mobile `levelPermissions` copy (`script-mobile.js`).
- **Verify:** the oracle re-run on the merged map must be **byte-identical** to baseline (mathematical authz-preservation proof) + gate + live per-band nav walk (L1 sees all; a mid agent; a Chinese-role customer bounces correctly). **Push.**

---

## Phase 3 — onclick → delegation (4.4) — net + clean-subset migration

Full uniform delegation is **infeasible** (21% of 1359 handlers are irreducibly complex: multi-arg / inline expressions). Re-scoped to a safe, valuable subset:

- **3.0 · Verification net FIRST** (`ci/action-map.js`, additive) — assert every `data-action="fn"` maps to a registered `app.fn` (closes the "silent dead button" blind spot the structural design flagged).
- **3.1 · Delegation helper** — one per-container `data-action`/`data-args` delegator with `stopPropagation` + async parity.
- **3.2 · Migrate CLEAN handlers** (parallel, one subagent per view) — only single-id / no-arg handlers (~the clean ~79%), view by view.
- **Leave the complex 21% inline** (documented in code). *Residual: CSP `'unsafe-inline'` for scripts can't be dropped until those are hand-migrated — flagged, not attempted blind.*
- **Verify:** net green (no dead actions) + gate + live click-through of each migrated view (every migrated control does the identical thing) + bug check. **Push.**

---

## Phase 4 — Prospects god-file split (4.3) — SEQUENTIAL, atomic, high-risk

Split `chunks/script-prospects.js` (10,281 lines / 233 exports) into prospects-core + customers + agents + approvals + settings chunks. **Primary risk: a missed bare cross-chunk call → `ReferenceError` white-screen that CI does NOT catch** (audit.js only scans `script.js`, not chunk→chunk) — a documented past incident. **Therefore: ONE careful sequential pass, not a parallel fan-out** (the 233 exports share one closure).

- **4.0 · Scaffolding** — add new chunk paths to `build.mjs` JS_TARGETS + `ci/size-budgets.json`; repoint `_CHUNK_VIEWS` + the 5 self-loading stubs in `script.js` to the chunk that now owns each fn.
- **4.1 · State promotion** — promote the ONE genuinely-crossing mutable var `_purchasesHistoryCache` to `window._appState` (`_state.phc`).
- **4.2 · Extract** — agents / customers / approvals / settings modules; **duplicate the 60-line shared header** at the top of each; convert **every** SEAM-2 bare cross-chunk call (~40 sites: `renderProspectsTable`, `showProspectDetail`, `renderApprovalQueue`, `approveProspectConversion`, `renderCustomersTable`, `renderAgentsTable`, `openProspectModal`, …) to `window.app.fn()` shims. Keep the dead block-comment fences (8503-8682 / 8822-8845) balanced.
- **Verify (extra-strict, atomic — can't ship partial):** gate + **manual per-chunk seam grep** (the audit.js blind spot) + **live `Object.keys(window.app)` 233-key reachability diff** (pre vs post, byte-identical set) after forcing every chunk to load + full 32-view live sweep, 0 errors + a dedicated bug-check. Only push if **all** green; otherwise revert wholesale.

---

## Phase 5 — Data-core hardening (4.2 + 2.1 + 2.2) — HIGHEST risk, last

`AppDataStore` (`data.js`, ~3329 lines) sits behind **both documented past outages** (RLS empty-read cache-wipe, sync-queue 400/409 storm). Done last, with the strongest net.

- **5.0 · Incident-replay + live-parity harness FIRST** — reproduce the two incident conditions + snapshot read/write parity across roles, as a pre/post oracle.
- **5.1 · 2.1 bound `queryAdvanced` fallback** — distinguish no-session (retry server path) from hard error (bounded client fallback, cap ~500) + telemetry marker.
- **5.2 · 2.2 `_autoSync` off the read hot-path** — trigger queue drain on `dataChanged`/`online` instead of awaiting inside `_getAllImpl`; batch into one upsert. Public API unchanged.
- **5.3 · 4.2 split** — staged: (a) extract stateless classifiers/helpers; (b) group Storage/signed-URL + Journey-RPC methods; (c) only then the Net/Cache/Sync/Queue collaborator split behind the IDENTICAL public API, preserving the `hasLiveSession` guard, queue dead-letter, in-flight dedup, and delta-sync ordering.
- **Verify:** incident-replay harness passes pre===post + gate + full live app exercise (login, reads across roles, a write, calendar/pipeline parity) + bug check. **Push.** *If any sub-step can't pass the incident-replay oracle, it stays held and I report exactly why — this is the one layer where "can't prove it" means "don't ship it," all-in or not.*

---

## Phase 6 — Referral-tree (2.7), re-approached

The simple client-side cap is infeasible (the tree is a runtime transitive closure needing full tables). Re-scope to a **server-side recursive tree RPC** (additive DDL) that returns the bounded subtree directly — same rendered tree, one call instead of 6 full-table fetches. Verify: rendered tree identical for several roots on live. **Push.** *(If the recursive RPC can't reproduce the exact tree, mark held with reason.)*

---

## Done = 100%

All phases pushed live + bug-checked clean. Items honestly **out of scope even all-in** (will be stated, not silently skipped): the complex 21% of inline handlers (Phase 3 residual) and any data-core sub-step that fails its incident-replay oracle (Phase 5). Everything else ships.

**Awaiting approval to begin Phase 1.**
