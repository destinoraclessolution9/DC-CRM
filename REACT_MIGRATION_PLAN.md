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
- [ ] home (#24) — main dashboard ← NEXT (assess: likely composite read-render; defer if it embeds interactive widgets like journey)
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
