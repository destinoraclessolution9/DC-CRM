# React Island Migration — Plan & Status

Path to **D** (god-object retirement / Vite build ownership / module extraction). Each screen becomes a React island (mounted by `window.CRMReact.mount<View>`), the chunk delegates behind a flag with the legacy render as fallback, promote = flip the flag default-on. Full playbook + gotchas in memory `project_react_migration.md`.

**Deploy rule:** every migration rebuilds ONE shared live bundle → build → deploy → live browser parity-verify → promote, sequentially. Batch at most 2-3 closely-related read-only M views per deploy; S/L/XL one-at-a-time. Bump `react-island.js ?v=` in index.html (line ~703) + `sw.js` whenever `src/react/*` changes.

## Done (full-screen view islands, all default-on + live parity-verified)
- ✅ customers, prospects (promoted 2026-06-14)
- ✅ **agents** (SW-43) · security (SW-44) · ranking + noticeboard (SW-45) · lead_forms + surveys + contracts (SW-46) · purchases_history (SW-47) · knowledge_dashboard + knowledge_all_entries (SW-48) · custom_fields + org_chart (SW-49) · booking_settings + milestones (SW-50) · **cases (SW-51, 2026-06-15)**

## AUTONOMOUS MODE (2026-06-15): work the pending list below end-to-end, no per-view approval; auto-resume after any pause/usage-limit (ScheduleWakeup heartbeat + this durable checklist). Tick each box on live parity-verify. Order = smallest/cleanest first to bank wins.

### Pending full-screen VIEWS (tick on deploy+verify)
- [x] boss_report (#34) — SW-52, 2026-06-15, mount-once scaffold island, parity-verified (ids+options+labels+handlers)
- [x] protection (#35) — SW-53, 2026-06-16, render-only island (chunk computes 4 model arrays); parity-identical (2 teams / 20 agents / 410 inactive / 9 reassign all match) + XSS-escaped
- [~] documents (#39) — script-documents.js (957L) — DEFERRED (interactive: recursive folder tree + per-element drag-drop file moves + list/grid toggle + versioning; drag-drop correctness not validatable by count-parity → do when user present for interactive verification)
- [~] journey (#33) — RE-CLASSIFIED: NOT a standalone screen. = renderJourneyTab (embedded timeline inside prospect/customer detail accordions, heavy touchpoint mutations) + showAgentJourneyDashboard/showAgentJourneyLoad (small dashboard widgets). Defer with the modal/embedded-component batch; do standalone screens first.
- [x] monthly_promotion (view 'promotions') — SW-54, 2026-06-16, clean read-only promo-card island; parity-identical (live empty-state) + synthetic populated/XSS/both-empty-variants verified
- [~] home (#24) — DEFERRED: showMobileHomeView (script-mobile.js) is a mobile, STATEFUL view (localStorage snapshot caching 8h TTL + pull-to-refresh + multi-tier cache loading + AI card) — cache/refresh correctness not count-parity-verifiable unattended.

- [x] marketing_lists (#22) — SW-55, 2026-06-16, tabbed island: React renders shell + 5 master tables (products/events/venues/bujishu/formula); promotions+special_programs = chunk legacy HTML passthrough (dangerouslySetInnerHTML). Parity-verified (products 66=66, tabs 7=7, all 5 tables + 2 passthroughs + action-btn labels correct) + XSS-escaped.

### ▶️ LOOP RESUMED 2026-06-16 — user said "keep going" (proceed unattended, kill-switch = safety net)
Strategy: count-verifiable views (full island) first; genuinely-interactive views via SCAFFOLD-SHELL (island static shell w/ stable ids + inline app.* handlers, chunk keeps ALL interactivity unchanged → byte-identical behavior). calendar/referrals LAST.
NEXT = marketing_automation. calendar/referrals last.
KEY LESSON (skeleton-then-fill scaffold-shells like pipeline/marketing_automation): the chunk must AWAIT an island useEffect-ready signal (onReady → resolves a promise the chunk awaits, + safety timeout) BEFORE its by-id fills. A bare requestAnimationFrame fires before React commits → getElementById returns null → fills skipped → skeleton stuck. (documents/stock/egg/formula used onReady from the start and were fine; pipeline needed it added.)
- [x] pipeline (#36) — SW-72, 2026-06-16, PROMOTED default-on. Scaffold-shell (static skeleton) + chunk STEP-2 fills #pl-* by id after awaiting island useEffect-ready (the rAF-too-early bug). Live-verified default-on: header 2 selects + enabled buttons, action-plan/focus filled, skeleton cleared, body genuine "0 qualified". Drag-drop/v6-scoring/filters/modals in chunk.
- (history) pipeline island BUILT + PUSHED (commit 1e1ef0c, opt-in, SW-70). PipelineView.jsx = pure static skeleton shell; chunk showPipelineView mounts it then its existing STEP-2 fetch+fill populates #pl-* by id (rAF-wait for commit). Drag-drop/v6-scoring/filters/modals stay in chunk. ⏳ Vercel SW-70 deploy SLOW (>20min, still v69 at last poll) — local vite/build.mjs/node-check all PASS, so it's a slow/queued Vercel build not a code issue. VERIFY opt-in (?react_pipeline=1: shell renders + #pl-header-controls/action-plan/focus-section/pipeline-list-body fill, drag-drop works) THEN promote default-on next tick once v70 is live.
- [~] reports (#38) — OPT-IN island shipped (SW-69), NOT promoted. showKPIDashboard scaffold-shell: shell + all containers + Chart.js canvas; _kpiPopulate (cached-snapshot + refreshKPIDashboard) via useEffect onReady. VERIFIED working opt-in: stats grid 11, **Chart.js canvas draws**, leaderboard 4448 / quarterly 10778 / cases 254 / headcount 85 all match legacy. ⚠️ KNOWN GAP blocking promotion: the agent-filter `<select id=kpi-agent-filter>` stays at 1 option (All Agents) on the React path — tried (a) chunk innerHTML fill [raced React commit], (b) pre-mount prop [getAll cold→empty], (c) island useState+loadAgents [still 1, even after users data confirmed available]. Needs React devtools to root-cause (likely effect/re-render interaction). All else works. Enable to debug: `?react_reports=1` or window.__REACT_REPORTS=true. REVISIT before promoting.
- [x] formula_purchaser (#41) — SW-65, 2026-06-16, PROMOTED default-on after opt-in verify. Scaffold-shell: shell (header + Import dropdown + Refresh + 6-tab bar + #fp-tab-content); useEffect onReady → chunk fpLoadData()+fpSwitchTab fills content + active styling. Imports/PO/transfers/reconcile in chunk. Live-verified: 6 tabs, dashboard 4598 = legacy, import-menu toggle + vendors tab-switch work.
- [~] search (#42) — DEFERRED to modal/overlay batch: showSearchPanel is an OVERLAY drawer (search-panel-overlay click-to-close), not a content-viewport view; very heavy (9-entity condition builder, dynamic filter sections, presets, saved searches, history, results, pagination).
- [x] egg_purchasing (#40) — SW-63, 2026-06-16, PROMOTED default-on after opt-in verify. Scaffold-shell: shell (header+Refresh+4-tab bar+#egg-tab-content); useEffect onReady → chunk eggSwitchTab fills content (3-phase Run wizard, urgent, history, config). File I/O/reconcile/webhook in chunk. Live-verified: 4 tabs, run content 4470 = legacy, tab-switch works.

- [x] stock_take (#37) — SW-61, 2026-06-16, PROMOTED default-on after opt-in verify. Scaffold-shell: island renders header + role-gated 9-tab bar + #st-session-chip + #st-tab-body; useEffect onReady → chunk stSwitchTab fills chip+body + active styling. All tabs/QR/reconcile/recount/realtime in chunk. Live-verified: 9 tabs, body 595/chip 76 match legacy, tab-switch works.

- [x] documents (#39) — SW-59, 2026-06-16, PROMOTED default-on after opt-in verify. Scaffold-shell: island renders shell, useEffect onReady → chunk renderFolderTree()+loadFolderContents() (drag-drop/tree/files unchanged). Fixed latent getFileIcon/formatFileSize/getFileExtension ReferenceErrors (aliased from _crmUtils / defined locally) — benefited legacy too. Recovered from the SW-56 incident via: useEffect (not chunk rAF) + opt-in→verify→promote.

⚠️ INCIDENT 2026-06-16 (documents SW-56 → rolled back SW-57): scaffold-shell shipped default-on but the chunk-side rAF populate did NOT reliably run renderFolderTree()/loadFolderContents() → live folder tree + file area came up EMPTY for ~1 deploy cycle. Caught by the folderItems count check; rolled back (_reactDocumentsOn()→false). LESSONS:
  1. Scaffold-shell populate MUST be driven from the island's useEffect (runs after React commit), NOT a chunk-side requestAnimationFrame. Pass onReady via opts; component calls it in useEffect(()=>{onReady()},[]).
  2. For scaffold-shell / interactive views: deploy OPT-IN first (flag NOT default-on), verify live via the flag, THEN promote to default-on in a follow-up. Never default-on an unverified populate/interaction.
  3. Pre-existing latent bug found: `getFileIcon is not defined` in renderFileListView (script-documents.js) — throws when files render (affects legacy too; root folder shows empty-state so normally masked). Fix alongside the documents retry.
- [~] fude (#31) — DEFERRED: large MIXED dashboard (render-only tiles/leaderboard/admin tables + fragile inline-IIFE carousel + DOM-manipulating story filter/search), one inline innerHTML (no populate fns) → neither full-island nor scaffold-shell fits; dangerouslySetInnerHTML wrapper = no value.

### (historical) AUTONOMOUS LOOP PAUSED 2026-06-16 — superseded by "keep going" above
All cleanly count/structure-parity-verifiable render views are DONE (18 shipped: …→ monthly_promotion SW-54). Every remaining standalone view is heavy/interactive/stateful and its CORRECTNESS cannot be validated by the unattended count-parity method (broken drag-drop / charts / wizard steps / carousels / QR / caching would pass structural parity yet ship behaviorally-broken to live users by default). Per the conservative unattended stance, these are NOT migrated without the user present to interactively verify:
- home (caching/refresh), fude (carousel + story/highlight CRUD), marketing_automation (workflow builder), reports (Chart.js + 11 drill-down modals), stock_take (9 tabs/QR/realtime/3-way reconciliation), egg_purchasing + formula_purchaser (reconciliation wizards), search (9-entity condition builder), pipeline (drag-drop + scoring), calendar+month (6-week grid, highest-risk — alone & last), referrals (D3 zoom/pan tree), marketing_lists (7-tab manager).
- Modals/embedded (always deferred): ai, journey, documents, knowledge_capture/daily_notes/detail, cps-analysis, apu-appraisal, destiny-blueprint, fude-redeem, story-detail, reward-crud, highlight-crud, customer-survey.
RESUME when user is available: do each heavy view with live interactive verification (exercise the drag/chart/wizard/scan), OR user explicitly authorizes proceeding unattended accepting that interactive behavior won't be fully verified pre-deploy.
- [~] ai (#30) — RE-CLASSIFIED: rendered via UI.showModal(...'fullscreen'), it's a MODAL not a navigable view (+ hardcoded placeholder data + custom chart) → defer to modal batch
- [ ] stock_take (#37) — script-stock-take.js (1888L), 9 tabs/QR/reconciliation
- [ ] egg_purchasing (#40) — script-egg.js (1963L) wizard
- [ ] formula_purchaser (#41) — script-formula.js (1646L) wizard
- [ ] search (#42) — script-search.js (1770L), showSearchPanel L153
- [ ] pipeline (#36) — script-pipeline.js (2736L) drag-drop + scoring
- [ ] fude (#31) — script-fude.js (2466L) multi-section dashboard
- [ ] marketing_automation (#32) — script-marketing.js (4097L) showMarketingAutomationView L1092
- [ ] marketing_lists (#22) — script-marketing.js, 7-tab manager (deferred-heavy)
- [ ] monthly_promotion/month (#44) — script-marketing.js showMonthlyPromotionView L997
- [ ] home (#24) — main dashboard
- [ ] reports (#38) — Chart.js + drill-down modals
- [ ] calendar (#43) + month — script-calendar.js (5280L), HIGHEST-risk, deploy ALONE last
- [ ] referrals D3 tree — script-referrals.js (1360L), showReferralTree L483, XL

Deferred (modals / form-editors, fold in opportunistically): knowledge_capture, knowledge_daily_notes, knowledge_detail, cps-analysis, apu-appraisal, destiny-blueprint, fude-redeem, story-detail, reward-crud, highlight-crud, customer-survey.

## Ordered roadmap (from the screen-map workflow, 2026-06-15) — 44 views

Note: ranks 2-5 (`fude-redeem`, `story-detail`, `reward-crud`, knowledge-capture) are **modals**, lower value for god-object retirement than full screen VIEWS — do the screen views first; fold modals in opportunistically.

**Wave 1 — S (read-only, harden the loop):** 1 security · 5 showKnowledgeCapture
**Wave 2 — M Agents-pattern list/table views:** 6 ranking · 7 noticeboard · 8 forms-tab · 9 purchases_history · 10 showKnowledgeAllEntries · 11 contracts · 12 lead_forms · 13 surveys
**Wave 3 — M broader surface:** 14 custom_fields · 15 booking_settings · 16 org_chart(list only) · 17 cases · 20 showKnowledgeDailyNotes · 21 milestones · 22 marketing_lists · 23 showKnowledgeDashboard · 34 boss_report
**Wave 4 — L dashboards/forms:** 24 home · 25 import · 26 showKnowledgeDetail · 27 cps-analysis · 28 apu-appraisal · 29 destiny-blueprint · 30 ai · 31 fude · 32 marketing_automation · 33 journey
**Wave 5 — XL (one-at-a-time, extra verification):** 35 protection · 36 pipeline · 37 stock_take · 38 reports · 39 documents · 40 egg_purchasing · 41 formula_purchaser · 42 search · 43 calendar · 44 month(alias→ship right after calendar) · + referrals D3 tree (XL, ~2-3wk)

Modal islands (defer): fude-redeem, story-detail, reward-crud, highlight-crud, customer-survey, cps-analysis, apu-appraisal, destiny-blueprint.

## Top risks (XL)
- **calendar/month** — 6-week grid, optimistic badges, inline invite accept/reject, snapshot SWR cache, RPC warm-up, race-guard. Highest-risk single bundle; deploy alone, last.
- **referrals** — D3 SVG zoom/pan tree (≤400 nodes), DOM-managed sidebar, nav stack. 2-3wk.
- **search** — 9-entity AND/OR condition builder, saved searches, role-visibility gating across 9 tables. Keep modal vanilla, isolate filter hooks.
- **pipeline** — drag-drop 100+ rows + v6 scoring engine; unit-test the algorithm before swapping.
- **documents** — drag-drop file moves, recursive folder tree, versioning, batch ops, nested modals.
- **egg_purchasing / formula_purchaser** — 1000+ line multi-tab reconciliation wizards (file I/O, Sheets webhook). Super-Admin gated (small blast radius) but each is a mini-app.
- **reports** — Chart.js + 11 drill-down modals + RPC fallbacks + print/CSV export.
- **stock_take** — 9 tabs, QR scanner, 3-way reconciliation, realtime + dual localStorage/Supabase state.
- **Cross-chunk coupling** — marketing_automation/fude/milestones/journey call functions in OTHER chunks (renderFormsTab, renderWorkflowCard, compute*Statuses); a missing alias = the documented post-split ReferenceError crash. Re-verify after each rebuild.

Full per-view specs: workflow output `tasks/wwt5nross.output` (run 2026-06-15).
