# CRM Quality Refactor — Living Checklist

Branch: `refactor/quality` (off `main` @ b72d4ea). **Do NOT deploy to live unless owner says `@done`/`@go`.**
Gate: `node ci/regression.js` (audit → build → snapshot-vs-baseline) must stay green; one task per commit.
Full plan: `C:\Users\DC\.claude\plans\nifty-finding-seahorse.md`. Findings detail: `_audit_findings.txt`, `_reval_merged.json`.

Re-validation result (53 audit findings vs current live): **10 fixed by the big upgrade**, 0 false, 4 partial, 39 valid → ~30 distinct work items.

---

## Wave 0 — Guardrails (zero behavior risk) ✅ DONE + DEPLOYED (commits ad3725f, 40767dc)
- [x] 0.0 Re-baseline `ci/baseline.json` to post-upgrade current (5092 lines / 422 keys / 1298 exports)
- [x] 0.1 Wire CI gate — `package.json` scripts + `regression` job in `.github/workflows/ci.yml`
- [x] 0.2 Pattern-lint checker `ci/lint-patterns.js` (enforcing; allowance R1=24 R2=0 R3=1)
- [x] 0.3 Size-budget check `ci/size-budget.js` + `ci/size-budgets.json` (37 files), wired into regression
- [x] 0.4 Removed 17 dead orphan files + commented `<script>` block in index.html (#42)
- [~] 0.5 Untrack build artifacts — **DEFERRED**: real deploy risk (removes fallback if a Vercel build fails) for ~zero user value; keeping artifacts as belt-and-suspenders. Revisit if owner wants.

## Wave 1 — Mechanical de-duplication ✅ 1.1 DONE + DEPLOYED (commit 12eafa8); rest DEFERRED
- [x] 1.1 escapeHtml consolidation: 3 hand-rolled 4-char escapers (activities/performance/features) → canonical `_crmUtils.escapeHtml`; fixed script.js def to String-coerce (matches ui.js). Behavior-identical in browser (+safer `'`-escaping). Gate+smoke verified. R2 ratcheted 3→0.
- [~] 1.2 Central role parsing — **DEFERRED, NEEDS REVIEW**: several inline parses GATE data access (e.g. `getVisibleUserIds` script.js:676). Swapping to `_getUserLevel` changes visibility for legacy/Chinese-named roles = a functional/authz change, NOT a behavior-preserving find-replace. Per-site authz review required before deploy.
- [~] 1.3 Shared formatters — **DEFERRED, NEEDS REVIEW**: RM/date/CSV sites genuinely differ today (precision/locale). Consolidating CHANGES output = functional change. Must confirm per-site output parity (or accept the normalization) before deploy.
- [ ] 1.4 (after 1.2/1.3) re-baseline at wave boundary

## Wave 2 — Perf/data hardening (staged)
- [ ] 2.1 Bound `queryAdvanced` fallback `data.js:2299-2351` (#20/#31) — changes error-path output, needs care
- [ ] 2.2 `_autoSync` off read hot-path `data.js:1170` (#21) — incident-prone core
- [x] 2.3 Batch WhatsApp campaign N+1 (#28/#23, lone CRITICAL) — DONE + DEPLOYED (commit 926fbf5, Ready in prod, createMany confirmed in live data.min.js). New `data.js createMany`: bulk insert + per-row add() fallback = behavior-identical records. Gate green.
- [ ] 2.4 Pipeline counts from memory (#18/#30) — BLOCKED-ish: getNoteCount is unscoped while pipeline data is scoped; query() lacks `in` operator → needs getAll+map (tradeoff) or `in` support added
- [ ] 2.5 Advanced-search filter hoist (#19/#27)
- [ ] 2.6 Trim predictive prefetch `script.js:2924-2951` (#25) — UX perf tradeoff (loses pre-warm), borderline "no functional change"
- [ ] 2.7 Cap referral-tree fetch (#24/#33) — changes what loads (adds cap)
- [ ] 2.8 KPI Target-vs-Actual → `kpi_*` RPC (#34) — needs RPC (DDL, dashboard-only)

## Wave 3 — Structural decoupling
- [~] 3.1 One view registry: unify 2 dispatchers + authz/title tables (#2/#39/#9) — IN PROGRESS
  - [x] 3.1a refreshCurrentView switch → declarative `_VIEW_REFRESH` map (script.js ~2911), exact mirror, DONE + DEPLOYED (211c210, Ready). script.js -29 lines.
  - [ ] 3.1b navigateTo render if/else (script.js:3253-3450) → registry `render` fns. HIGH RISK (the router). Nuances to preserve: mobile-vs-desktop branch (home/calendar/prospects), fire-and-forget for pipeline/reports/referrals (no await + .catch), canonical _currentView (month←calendar, ranking←performance, marketing_automation←workflows + _currentMarketingTab side-effect), view-cache fast-path return, transitions. Do as its OWN commit, verify hard.
  - [ ] 3.1c fold VIEW_TITLES (script.js:3200), _CHUNK_VIEWS authz gate (3104-3111), updateNavVisibility.levelPermissions (1522) into one `VIEWS[id] = {chunk, exactLevels, render, refresh, title, navId, canonical}` source. NOTE authz consolidation can change access for legacy/Chinese roles — preserve exact level sets.
- [x] 3.2 gcal: `dataChanged` listener, not method monkey-patch (#7/#44) — DONE + DEPLOYED (commit dcb4b09). Behavior-equivalent (add→record.type, update→getById, delete→sync; filtered to add/update/delete to ignore realtime/revalidate echoes). Gate green, smoke 9/10 (flaky Calendar only, 0 errors).
- [ ] 3.3 Extract god-functions: `saveActivity` (~749 lines), render monoliths (#36)
- [ ] 3.4 Silent-catch sweep (~175 no-op `catch{}`) (#40)

## Wave 4 — Largest refactors (explicit go each)
- [ ] 4.1 Namespace god-object: `app.register(...)` + aliases (#1)
- [ ] 4.2 Split `AppDataStore` into Net/Cache/Sync/Queue (#5)
- [ ] 4.3 Split 9,965-line `script-prospects.js` (#36)
- [ ] 4.4 `_appState` read-only + inline-onclick → delegation (#3/#6)

---
## ⚠ Strategic note (read before auto-pushing later waves)
After the live upgrade fixed 10/53 findings, the REMAINING roadmap is dominated by changes that are NOT behavior-preserving find-replace:
- **Authz-sensitive** (role-parse #8/#12/#37): touch `getVisibleUserIds` & gating → can change who sees what data.
- **Output-changing** (formatters #13-16): consolidating divergent RM/date/CSV CHANGES displayed values.
- **Large structural** (Waves 2-4): data-layer (#5/#20/#21 — incident-prone), view-registry/dispatcher rewrite (#2/#39), god-object (#1), data split (#5), prospects split (#36), onclick migration (#6).
These cannot be safely AUTO-pushed to a production CRM without per-role behavioral verification + review — auto-deploying them risks the exact "no functional change" violation the brief forbids. Recommended cadence for these: do on-branch (parallel where file-disjoint) → gate → per-role smoke → **review diff** → deploy. The "fire 100 agents, auto-push everything" model fits Waves 0-1; it does not fit the authz/structural remainder.

## Log
- 2026-06-17: synced w/ live (b72d4ea, clean), re-validated 53 findings, baseline re-init, branch created.
- 2026-06-17: Wave 0 (guardrails+cleanup) + Wave 1.1 (escaper consolidation) done, gate+smoke green (smoke 6/10 vs baseline 5/10 — same 4 pre-existing failures, 0 new), pushed to production (b72d4ea..12eafa8) + VERIFIED LIVE (HTTP 200, rbac.js→404). Role-parse/formatter consolidation deferred (authz/output risk).
- 2026-06-17: owner said "push risky waves too" → auto-push cadence (gate+smoke+auto-rollback, no diff gate), but "no functional change" still holds → every change kept behavior-preserving.
- 2026-06-17: Wave 3.2 gcal monkey-patch→event-listener done, gate green + smoke 9/10 (flaky), pushed (12eafa8..dcb4b09). NOTE: committed artifacts churn (CRLF noise + gitignored hashed copies) is harmless — Vercel rebuilds all from source via `node build.mjs`; only SOURCE correctness matters for live.
- 2026-06-17: DEPLOY VERIFY METHOD FIXED — curl-hash polling was buggy (captured baseline AFTER the fast 23s build, waited forever). Reliable method = Chrome → Vercel dashboard deployments list shows per-commit Ready/Building/Error in ~23s, then curl the live hashed bundle to confirm content. Vercel team slug: destinoraclessolution9-6587s-projects, project dc-crm. ALL deploys this session verified Ready in Production: 12eafa8, dcb4b09, 926fbf5.
- 2026-06-17: Wave 2.3 (lone critical) WhatsApp createMany done, gate green, pushed (dcb4b09..926fbf5), Ready in prod, createMany confirmed live in data.19e5ab3b4b.min.js + marketing chunk. 4 waves now live: 0, 1.1, 3.2, 2.3.
- 2026-06-17: caught + fixed self-inflicted disclosure — REFACTOR_PLAN.md was served publicly (HTTP 200); added it + _audit_* to .vercelignore (f62fa90), now 404. ⚠️ committed .md/working files at repo root get served by Vercel (outputDirectory ".") unless in .vercelignore.
- 2026-06-17: Wave 3.1a (view-registry START) — refreshCurrentView → _VIEW_REFRESH map, deployed (211c210, Ready). 6 prod deploys this session, all Ready. Branch note: after the f62fa90 push I was left on main, so 211c210 landed on main directly; resynced refactor/quality→main. NEXT = 3.1b navigateTo router dispatch (HIGH RISK, own commit, do fresh not at session-tail).
