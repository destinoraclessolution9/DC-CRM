# CRM Audit Remediation — 2026-07-03

Automated fix of the 385 confirmed findings from FULL_AUDIT_REPORT_2026-07-03.md. One agent per file (parallel), each diff-reviewed. **Not pushed / not committed** — working-tree only, for review.

## Result
- **314 fixes applied** across 49 source files (311 by the fleet + 3 post-review corrections).
- **Build green:** node build.mjs (exit 0) + vite react-island rebuild (exit 0).
- **CI gate: 12/12 pass** — ghost-call audit clean, onclick-check clean, views-derive-check green, and 302 unit assertions (authz-roles 63, view-authz 35, money-import 28, formatters 55, data-helpers 32, reconcile 8, matcher 38, migrations, no-getall-render 56<=60).
- **1 pre-existing test failure** (test-dormancy) — confirmed failing before these edits (fragile eval-slice test), not a regression.

## Headline fixes verified in source
- CRITICAL data.js add()/update() now split network-vs-permanent errors (no more false-success on RLS/constraint rejects); query()/getAllSince() paginate the 1000-row cap.
- 38 cross-chunk dead buttons → self-loading stubs in script.js (3 self-recursing stubs fixed); notification bell inits on login.
- XSS sinks escaped; UTC->local date fixes; id-collision composite keys; false-success toasts awaited/checked; missing authz gates added (ranking/ai_prediction view gates + baseline updated).

## Deferred (need owner / migration / RPC — NOT auto-fixed)
- **chunks/script-customers.js** — #15 Delivery Listing re-fetches full purchases/prospects/users on every keystroke
- **data.js** — #4 HIGH — sync-queue terminal outcomes invisible (dead-letter key nothing reads; 23505 unique-index hits silently DELETE the queued record)
- **data.js** — #21 LOW — spawnTouchpointsForStage writes numeric CRM ids into journey_touchpoints.assigned_to declared UUID in the checked-in migration
- **chunks/script-calendar.js** — 17. viewActivityDetails attendee section fetches five whole tables on every EVENT modal open
- **chunks/script-activities.js** — 7 (event-category sub-branch) — _evaluateActivityJourneyRules reads activity.event_category which is never set
- **chunks/script-activities.js** — 9 — CPS save is non-atomic: prospect+referral created before the activity; hard-duplicate check then blocks retry
- **chunks/script-pipeline.js** — 3. Primary view paths still pull whole HIGH_VOLUME tables via getAll (purchases at 968/1466)
- **chunks/script-pipeline.js** — 4. Team sections + focus rows: sequential per-user queries and per-row getById/getNoteCount N+1
- **chunks/script-pipeline.js** — 5. Pipeline team section runs one sequential my_potential_list query per subordinate (N+1)
- **chunks/script-pipeline.js** — 6. Default JSX path shows a blank view while the entire payload builds — STEP-1 skeleton is bypassed
- **chunks/script-import.js** — #8 Protection view + reassignment modals download the entire activities table and run O(prospects x activities) loops
- **chunks/script-import.js** — #9 Configure Alerts thresholds/auto-reassign saved to localStorage but never read
- **chunks/script-import.js** — #10 Step-3/step-5 import option checkboxes dead (backup, stop-on-error, notify, audit-log)
- **chunks/script-mobile.js** — #1 Merged prospect+customer person map keyed by bare id resolves the wrong person on id collision
- **chunks/script-fude.js** — 6. Highlight push-notification fan-out silently skipped when the activities chunk is not loaded
- **chunks/script-egg.js** — #5 Commit performs one awaited insert per row (slow, non-atomic)
- **chunks/script-agents.js** — #4 Agents legacy-table fallback removed — kill-switch/React-bundle failure dead-ends on error page
- **chunks/script-documents.js** — 3 — Every folder render pulls the entire documents table including base64 file blobs via AppDataStore.getAll('documents')
- **chunks/script-order-form-extract.js** — 6. entityType check tests status 'customer' which never exists — customer branch is dead, customers always mislabeled Prospect
- **chunks/script-ai.js** — 3 (secondary) — coaching activity carries no link to the coached agent (no co_agents/attendee), so the agent it concerns still cannot see it
- **chunks/script-performance.js** — 6. computeNineMethodStatuses pulls five entire tables to answer one subject's status (performance)
- **chunks/script-gcal.js** — 4. Synced Google events always get an empty description because the activities light-select omits discussion_summary
- **chunks/script-features2.js** — 1. addScoreToCustomer writes to customers.score, a column that does not exist in production
- **chunks/script-journey.js** — 1. Touchpoint spawn paths have no dedup — repeated triggers create duplicate task sets
- **chunks/script-journey.js** — 2. role_upgrade rule writes a 'role' column prospects/customers don't have — silent no-op behind a success toast
- **chunks/script-formula.js** — 4. Index-based fpExecuteTransfer onclick goes stale while another transfer is in flight (app.fpExecuteTransfer(${i}) bakes the array index; a splice re-indexes neighbours)
- **two-factor.js** — 2. TOTP secret stored in cleartext when the Encryption module is absent (fail-closed guard only fires on exception, not on absence)
- **two-factor.js** — 6. 2FA login verification queries users table before any Supabase session exists — RLS returns zero rows so a correct code is always rejected
- **chunks/script-whatsapp.js** — 2. Template sends from the modal always pass empty variables — parameterized templates fail and stored content keeps raw {{placeholders}}
- **chunks/script-npo.js** — 2. [MEDIUM/performance] _renderOrdersList calls getAll('customers') and getAll('npo_installments') unbounded just to label rows and count paid installments.
- **chunks/script-cases.js** — 1 (remaining) — copied deep link ?view=cases&id=... is never consumed at app boot, so opening it lands on the default view instead of the case.
- **vercel.json** — 4. buildCommand swallows vite failures (|| echo) and brotli-compresses react-island.js before vite overwrites it; contradicts documented build model
- **index.html** — 2. [MEDIUM/perf] line ~648 — eager third-party PapaParse from cdnjs sits mid defer-chain, gating script.min.js/app-init, yet only used by lazy chunks
- **build.mjs** — MEDIUM/performance line ~158 — brotli-11 pre-compression stage is dead in production because Vercel does not serve the sibling .br files (wasted build CPU + deploy weight; promised ~300 KB first-load saving never materializes)
- **styles-login-v2.css** — line ~252 — ~105 app-wide rules duplicated between styles-mobile.css and styles-login-v2.css; later copy silently overrides edits to the first (LOW/bug)

## Review notes (low, accepted)
data.js delete() local-only edge case; getAllSince ordering by updated_at (idempotent merge); CSV formula-guard quotes negative numbers as text in stock-take/referrals exports (OWASP-standard tradeoff). All reviewer-confirmed safe.

## To review / revert
- Review: git diff -- <file>  (pre-edit snapshot of all 50 files in scratchpad/pre_edit/).
- Nothing was committed or pushed. Rebuild before deploy: node build.mjs; npx vite build; bump react-island ?v= (do NOT bump sw.js CACHE_VERSION casually — fleet-reload/521 risk).