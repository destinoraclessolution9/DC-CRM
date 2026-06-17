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
  - [x] 3.1b navigateTo render if/else (37 branches) → `_VIEW_RENDER` map + 2-line lookup. DONE + DEPLOYED (da7b6b1, Ready). Verified 4 ways: programmatic diff (fn names/_currentView/guards/mobile/6 authz bounces all preserved), gate (script.js 5092→4954, no exports dropped), smoke 9/10 errors=0, 6-agent adversarial (41/41 views equivalent, 0 divergences). All nuances preserved (fire-forget pipeline/reports/referrals, workflows side-effect, settings no-await, org_chart fallback, aliases).
  - [ ] 3.1c (final consolidation) merge `_VIEW_RENDER` + `_VIEW_REFRESH` + VIEW_TITLES (script.js:3200ish) + _CHUNK_VIEWS authz gate + updateNavVisibility.levelPermissions into ONE `VIEWS[id] = {chunk, exactLevels, render, refresh, title, canonical}`. NOTE authz consolidation can change access for legacy/Chinese roles — preserve exact level sets. The two dispatchers (the core #39 duplication) are ALREADY resolved; 3.1c is the title/authz-table dedup.
- [x] 3.2 gcal: `dataChanged` listener, not method monkey-patch (#7/#44) — DONE + DEPLOYED (commit dcb4b09). Behavior-equivalent (add→record.type, update→getById, delete→sync; filtered to add/update/delete to ignore realtime/revalidate echoes). Gate green, smoke 9/10 (flaky Calendar only, 0 errors).
- [x] 3.3 Extract god-functions (#36) — DONE + DEPLOYED (0a89230, Ready). 3 PARALLEL agents extracted 4 god-fns; adversarially verified 4/4 equivalent + gate + smoke 9/10. saveActivity (4 post-save helpers; persist region w/ early-returns deliberately NOT extracted), renderProspectsTable (3), showProspectDetail (316→75 +2), showPipelineView (441→257 +5). Removed 15-line inert comment.
- [x] 3.3b Extract render monoliths in 4 MORE chunks (#36) — DONE + DEPLOYED (eb8ddea). 4 PARALLEL agents + 4-agent adversarial verify: 9/10 equivalent first pass; renderAnalyticsTab's reverted-extraction left 2 separator lines missing 12 spaces → fixed byte-identical to HEAD. calendar (renderCalendar/renderWeekView/renderTodayActivities, 4 builders), marketing (renderAutomationTab 184→39, 5 builders), reporting (showKPIDashboard 207→89 +renderTargetOverview+renderPerformanceTable), features (showRankingPerformanceView, showNoticeboardView). ⚠️ LESSON: an agent "revert" can leave whitespace residue inside template literals → ALWAYS adversarially verify byte-equivalence after extraction (gate+smoke miss visually-inert whitespace diffs).
- [x] 3.3c Extract render shells in 7 MORE chunks (#36) — DONE + DEPLOYED (3739fdb). 8 PARALLEL agents + 7-agent adversarial verify (12/12 equivalent; showReferralsView had 11 whitespace-trim residue lines → fixed byte-identical). fude(401→250), import(showImportDashboard 74→3 + showProtectionMonitoringView), egg/stock-take/formula (static legacy shells), referrals(252→72), documents(110→19). script-ai.js left untouched (nothing safely extractable). ⚠️ whitespace-trim-on-extract recurs ~1/batch → adversarial byte-verify is MANDATORY.
- [x] 3.3d Extract render shells in 8 MORE chunks (#36) — DONE + DEPLOYED (a74f386). 8 PARALLEL agents + adversarial byte-verify.
- [x] 3.3e Extract REMAINING render monoliths in 6 chunks (#36) — DONE (source-only commit; Vercel rebuilds artifacts). 8 PARALLEL agents → 12 helpers; gate green; 7-agent adversarial byte-verify **7/7 pass, 0 blockers** (template bodies md5-identical per file). activities (openActivityModal→buildActivityModalContent 345→99), calendar (viewActivityDetails→buildActivityDetailsContent, 12-param, 346→211), marketing (renderPackagesTab/renderMonthlyPromotionsTab/renderTemplatesTab — 3 builders; 2 JS lines lost a trailing space OUTSIDE any template literal → confirmed cosmetic), features2 (renderSpecialPrograms/renderSpecialProgramsTable/openSpecialProgramModal — 3 builders), performance (showWorkflowAutomationView/showNoticeboardView — 2 builders), admin (showAdminDashboard 86→21), whatsapp (showWhatsAppIntegration 78→12). forms.js had nothing pure (React-island orchestrators); admin showSecurityView does not exist.
- [x] **Full post-refactor bug check** — 6-dimension regression hunt (routing / register / extractions-a / extractions-b / data-perf / runtime) + adversarial verify over the ENTIRE session diff `b72d4ea..HEAD`: **0 suspected, 0 confirmed regressions**. The 14 deployed waves are clean.
- [ ] 3.4 Silent-catch sweep (~175 no-op `catch{}`) (#40) — low value + behavior-change risk; recommend skipping or doing last

## Wave 4 — Largest refactors (explicit go each)
- [x] 4.1 God-object ownership registry (#1) — DONE + DEPLOYED (0774b24). All 30 `Object.assign(window.app,{...})` → `app.register('domain',{...})` across 29 chunks; register() (with dup-key warn + _registry) added top of script.js (loads before chunks). ci/audit.js + ci/snapshot.js parsers updated to recognize register() (verified 1303 exports still detected). Validated incrementally (gcal first), gate green, smoke 9/10 (only pre-existing Calendar get_calendar_window error — confirmed identical on HEAD via stash-compare). Runtime-equivalent. ⚠️ CI tooling now parses BOTH Object.assign AND app.register forms.
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
- 2026-06-17: Wave 3.1a (view-registry START) — refreshCurrentView → _VIEW_REFRESH map, deployed (211c210, Ready). Branch note: after the f62fa90 push I was left on main, so 211c210 landed on main directly; resynced refactor/quality→main.
- 2026-06-17: ⚠️ found UNCOMMITTED mobile WIP in working tree mid-session (chunks/script-mobile.js +246 / src/react/views/MobileHomeView.jsx = "mobile dashboard tile sheets SW-109", NOT in HEAD, not mine). Stashed it during the 3.1b commit (clean isolation), then `git stash pop` to restore it. It's back in the working tree, uncommitted, untouched. Repo is multi-session — working tree can carry others' WIP; check `git status` before assuming a diff is yours.
- 2026-06-17: Wave 3.1b (router dispatch → _VIEW_RENDER) deployed (da7b6b1, Ready). Used a Python anchor-based replace (file is CRLF — `\n` markers fail). Verified 4 ways incl. 6-agent adversarial workflow (41/41 equivalent). VIEW-REGISTRY CORE DONE (both dispatchers declarative).
- 2026-06-17: ⚠️ MULTIPLE uncommitted WIP pieces keep appearing in the working tree (multi-session env): mobile-tiles (script-mobile.js + MobileHomeView.jsx) AND entity-search-cache (script-activities.js _getSearchEntitiesCached) — neither in HEAD/deployed. Plus 4 old stashes. ALWAYS `git status` + `git diff --stat <file>` before assuming a diff is yours; stash user WIP (by pathspec) before a big refactor, restore after. Owner chose "park my WIP, do full extraction."
- 2026-06-17: Wave 3.3 (god-fn extraction) deployed (0a89230, Ready) via 3 PARALLEL subagents + 4-agent adversarial verify (4/4 equivalent). 8 prod deploys this session, all Ready. Pattern for agent-driven refactor on prod: parallel extract (one agent per disjoint file, in-place, no git/build) → gate → smoke → adversarial verify (diff HEAD vs refactored) → push only clean → restore WIP. NEXT options: 3.1c (table merge), 3.4 (silent-catch, low value), or Wave 4 (god-object namespacing #1, data split #5, prospects split, onclick→delegation #6 — the big parallel win but needs delegation infra prep).
