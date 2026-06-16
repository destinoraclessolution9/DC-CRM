# CRM — Outstanding / Backlog

_Last updated: 2026-06-16. **SW-98 + SW-100 + SW-102 are all LIVE + verified-present on production.** This file tracks what remains._

> **Critical bugs (SW-98) AND tier-2 bug fixes (SW-100) are DONE + LIVE.**
> Legend — **Effort:** S (≤1h) · M (a few h) · L (day+). **Priority:** P1 (do next) · P2 · P3.

---

## ✅ SHIPPED + LIVE in SW-102 (independently verified present on production 2026-06-16)
Pushed (commits `9fa1b31` additive + `a528976` 3.1-deletion, deployed via the parallel `7271b3f` push, then `84fd0b3` bumped sw→102 to force a clean reload). A 4-agent audit confirmed every marker is live; only **runtime UI behavior** wasn't exercised by me (no login) — a quick interactive spot-check is still worthwhile (kill-switch `?react_<x>=0` per view, or `git revert a528976` for just the deletions, are the rollback levers):
- **Migration tail (§2):** kb-slot editors + journey aux → React. Rebuilt `react-island.js` also **re-synced `mountFudeContent` + `mountJourneyContent`** (were stale/inert) — fude dashboard + journey timeline now run on React. _Spot-check: capture Ctrl+Enter save; detail/daily autosave; fude carousel; journey timeline._
- **AI Insights (§5):** real deterministic heuristics + real React cards/timeline/predictions. _Spot-check: open AI Insights — real numbers, no NaN._ ⚠️ **Partial — see §5 below: the dashboard's secondary action buttons are still "coming soon."**
- **Export KPI (§5):** real CSV/XLSX export of the 福气 leaderboard.
- **Integrations (§5):** webhook notifications (Slack/Discord) config + Test; OAuth-only services honest "needs backend". ⚠️ **`dispatchWebhookEvent` has NO callers → configured webhooks fire nothing until wired into save paths (open follow-up).**
- **Mobile calendar (§5):** Week/Day/Agenda tabs + the cold-load repaint-guard fix.
- **Batch DMS actions (§5):** Move/Share/Download wired into the real file-explorer toolbar (`script-documents.js`) + `confirmDeleteFolder` no-op fixed.
- **getAll cleanup (§3.3):** CI defineProperty canary + guard-comment demote. Root cause pinned (esbuild es2020 RQ lowering, fixed via vite es2022).
- **§3.1 legacy-fallback deletion:** ~1,500 LOC of dead renderers removed for 13 views; off/error → reload card. Audit confirmed every view's React mount is intact and `customers`/`prospects`/Class-B legacy was NOT touched.

## ⏳ Genuinely still outstanding (honest list, post-SW-102)
- **§4.1 Supabase compute Nano → Micro/Small** — _your action_ (billing; can't be done from code). The real fix for repeat 521 outages. ⚠️ Confirm project id before upgrading: `OUTSTANDING.md` said `remuwhxvzkzjtgbzqjaa`, memory references org `umqvztwprplcfpvrshsn`.
- **Wire `dispatchWebhookEvent`** into the new-lead / closed-deal / new-activity save handlers — _me, small_. Webhook config+Test are live but inert until this is done.
- **AI Insights secondary action buttons (~17)** — still `_aiSoon` "coming soon" toasts (Export/Segment/Schedule/Share/view-details inside the Lead-Scoring/Forecast/Churn/Performance modals). The 4 core dashboards now show **real data**; these secondary actions need real net-new features (segment builder, bulk scheduler, share infra). _Build only if wanted._
- **Full OAuth integrations** (Outlook/GitHub/Drive) — _infeasible_ client-side (need a server OAuth backend + secrets). Honest "needs backend" card shipped.
- **§3.2 full JSX componentization** of the passthrough/legal forms — _deferred by design_ ("when touched"); leaves a manual-escaping XSS surface — a dedicated escaping pass is the cheaper interim.
- **Minor me-followups:** optional `UNIQUE(user_id,month,prospect_id)` on `monthly_focus_archive` (1.1+, belt-and-suspenders); DB role-fix for the 3 fude legacy-allowlist admins then delete the `[fude-authz]` fallback (1.2+); `esc()` the `a.solution_sold` + boss-report `<option>` labels (pre-existing low-risk).
- **Pre-existing unbuilt stubs** (out of scope, not regressions): fude "Redeem Points" button (`app.todo`); journey prospect→customer auto-conversion (console TODO only).

---

## ✅ Already fixed + live this session (for context — do NOT redo)
- **Login outage** — Supabase project was down (NANO compute exhausted, HTTP 521); restarted from dashboard, recovered + hardened (offline-poll backoff, SW-96).
- **5 critical bugs (SW-98):** stored-XSS sweep (forms, calendar month+week, import, pipeline) · calendar week-view client-name privacy leak · silent activity-save failure (now shows error) · leaderboard always-zero (now resolves sales via customer's agent) · AI `generateId` ReferenceError.
- **4 tier-2 bugs (SW-100)** — each adversarially verified before deploy:
  - **1.1 Pipeline auto-archive** — was un-awaited / non-idempotent / errors swallowed on every view-open. Now a guarded async routine: concurrency + per-session once-guard, archive-then-delete ordering (never deletes without a confirmed archive), idempotency check against `monthly_focus_archive`, all failures logged (`[pipeline-archive]`) not swallowed, off the synchronous render path.
  - **1.2 Fude authz** — hardcoded email allowlist + inline role regex replaced with the canonical `isSystemAdmin || isMarketingManager` (exactly reproduces the old `level<=2` gate, no privilege change). Email allowlist kept only as a **logged deprecated fallback** so no admin loses access; warns `[fude-authz]` when the fallback is the sole grantor. (Bonus: now correctly resolves L13/L14 for Chinese-only role names.)
  - **1.3 Calendar card-builder dedup** — the ~60-line month-grid card builder, duplicated and drifted across `_renderCalendarLegacy` + main `renderCalendar`, is now one shared `buildAppointmentCardHtml(a, ctx)` (richer main-path behavior — optimistic ⏳/⚠ badges — used by both). XSS escaping preserved.
  - **1.4 Calendar week-view perf** — replaced the per-cell `.filter` over all activities (~1M iterations at 10k+ rows) with a one-pass bucket Map keyed by `date hour` → O(1) per cell. Ownership masking + escaping unchanged.
- **React migration:** all 29 standalone views + 9 modal forms + fude dashboard + journey timeline — migrated & promoted default-on. `getAll()` crash-guard (SW-94), carousel dots (SW-95).

---

## 1. Tier-2 bugs — ✅ all addressed (SW-100)

- **1.1–1.4** — DONE + LIVE (see above).
- **1.5 Boss-report React fallback** — **VERIFIED NON-BUG, no change needed.** The mount at `script-boss-report.js` is gated by `_reactBossReportOn()`, which returns true ONLY when `typeof window.CRMReact.mountBossReport === 'function'` — so a mount-before-ready race is impossible (a retry/poll would be dead code) and matches the codebase-wide convention (~35 chunk sites). The legacy fallback is reachable two clean ways (flag off → full scaffold builds; mount throws → caught, falls through to an unconditional `container.innerHTML` rebuild) and the React view is a 1:1 id-for-id reproduction with identical `app.*` wiring. Nothing to fix.

**Tiny optional follow-ups surfaced during the fixes (all low/no urgency):**
- **1.1+** add a server-side `UNIQUE(user_id, month, prospect_id)` constraint on `monthly_focus_archive` for cross-tab race-proofing (additive DDL, pre-authorized). The client in-flight guard + DB idempotency check already cover correctness.
- **1.2+** assign the correct canonical role level (L1/L2) to the 3 legacy-allowlist admins in the DB; once their roles are right, the `[fude-authz]` warn stops firing and the deprecated email fallback can be deleted. Watch consoles for that warn to catch any *other* stale-role admins first.
- **1.3+ / 1.4+ latent (pre-existing, NOT introduced):** `a.solution_sold` (calendar closed-product div) and the boss-report run-`<option>` labels are interpolated without `esc()`. Low risk (admin-gated / controlled data) — fold into a future escaping pass, not urgent.

---

## 2. React migration — last 2 render paths (plans now READY)

> Both are **safe to implement** per the deep-dive. Both touch `src/react/main.jsx` (additive exports only) so they need a **vite react rebuild + `?v=` bump**, and they must ship **opt-in (default-off) → authenticated-verify → promote default-on** (the established migration protocol). Bundle them into ONE react-inclusive deploy.

> **⚠️ READ FIRST — the committed `react-dist/react-island.js` is STALE.** It's missing `mountFudeContent` (SW-92) and `mountJourneyContent` (SW-93/97) — those promotions flipped the chunk flags but the rebuilt bundle was never committed. So **on live, the fude main dashboard and the journey timeline currently run their LEGACY render path, not React** (no user-visible breakage — the passthrough renders the same HTML). A local working-tree rebuild already has both mounts but is uncommitted. **The next react deploy MUST `npx vite build` from committed `src/react` and commit the fresh bundle** — doing so will *activate* the fude-view + journey React passthrough on live for the first time, so **verify those two alongside** whatever ships (low risk — identical HTML). Lesson: a chunk flag flip ≠ live activation; the mount fn must be in the committed bundle (Vercel build = `node build.mjs` only; it does NOT run vite).

### 2.1 Knowledge kb-slot editors — **P2, M** (full-capture / daily-notes / detail)
- **Key fact:** `kb-slot` is NOT a React root. The already-React dashboard/all-entries islands mount onto their OWN child nodes (`#kb-dash-react-root`, `#kb-all-react-root`) that the chunk inserts into `kb-slot`. So the "clobber the dashboard island" hazard only arises if you mount editors onto `kb-slot` itself or reuse the dashboard's node/root — **avoid that.**
- **Plan (design a — dedicated root):**
  1. `src/react/main.jsx`: add `let _kbEditorRoot` + `mountKbEditor(container,{html,onReady})` (clone of `mountJourneyContent`: unmount-prior → `createRoot` → `flushSync(render(<ModalContentIsland html onReady/>))`) + `unmountKbEditor()`. Reuse the existing `ModalContentIsland` (no new view). Register both on `window.CRMReact`.
  2. `chunks/script-knowledge.js`: add `_reactKbEditorsOn()` gate (clone `_reactKbModalsOn`, own kill-switch `?react_kbeditors=0` / `crm_react_kbeditors='0'` / `__REACT_KBEDITORS===false` + global, require `mountKbEditor` is a fn) + a `_kbMountEditor(slot, html, onReady)` helper that mounts into a fresh `#kb-editor-react-root` child (try/catch → legacy `slot.innerHTML=html` fallback). Route the **3 editors** through it; **leave dashboard + all-entries unchanged.**
  3. **Preserve wiring:** detail editor is all inline `oninput`/`onchange` + inline `debounceCall` link-search → survives `dangerouslySetInnerHTML` with no `onReady`. **Capture** (Ctrl+Enter `keydown`) and **daily-notes** (`input` autosave + `await _kbLoadDaily()`) use `addEventListener` → MUST be re-bound inside `onReady` or they silently break.
- **Verify (behind `?react_kbeditors=1`):** capture Ctrl+Enter save; detail autosave status flip + type/convert/link add+remove; daily date-nav + load + autosave + promote-selection; repeated Dashboard↔All↔editor switches with NO double-mount/detached-root console warnings. Then drop the flag (promote).
- **Files:** `src/react/main.jsx`, `chunks/script-knowledge.js`, `react-dist/react-island.js` (rebuild) + `index.html` `?v=` bump. **Risk:** low-med.

### 2.2 Journey aux widgets — **P3, S** (`showAgentJourneyDashboard` / `showAgentJourneyLoad`)
- **Key fact:** these are small **read-only** widgets. `showAgentJourneyDashboard` has ONE caller (Journey view → `#content-viewport`). **`showAgentJourneyLoad` has NO live caller — it is effectively dead code** (parity-only; can't be UI-verified without adding a caller). The "two on-screen at once" caveat is forward-looking, not a current bug.
- **Plan:** use the **multi-root** `_mountSimple`/`_roots` WeakMap (keyed by container) — NOT the singleton `_journeyContentRoot` (that's the timeline's; reusing it would cause the very collision warned about). Add `mountJourneyAux(container,{html}) = _mountSimple(container, <ModalContentIsland html/>)` + `unmountJourneyAux = _unmountSimple` to `main.jsx`; add `_reactJourneyAuxOn()` + `_rxRenderAux(container, html)` to `chunks/script-journey.js`; swap the ~5 `innerHTML` sites in the two widgets. Inline `onclick="app.navigateTo(...)"` survives `dangerouslySetInnerHTML`; no `onReady`/`flushSync` needed.
- **Files:** `src/react/main.jsx`, `chunks/script-journey.js`, react + chunk rebuild. **Risk:** low. **(Could legitimately be DEFERRED — no live correctness bug, pure migration-uniformity.)**

---

## 3. Architecture — the "D" goal (god-object retirement). Biggest, lowest-urgency.

### 3.1 Delete legacy fallback renderers — **P2, L** (multi-session; the real shrink)
- **Reachability model (verified):** each migrated view does `if (_reactXOn()){ mount; return } ` then a self-contained legacy block. `_reactXOn()` is false only on the 3 kill-switches (`__REACT_X===false` / `?react=0` / `crm_react_off='1'`), enforced at **bundle load** in `index.html` — so in normal default-on operation the legacy blocks are dead, reachable only via the debug kill-switch or a caught mount-throw.
- **⚠️ PREREQUISITE (do FIRST, or rollback breaks):** the kill-switch is the documented instant-rollback path. If you delete legacy WITHOUT reworking it, turning React off → blank screen for every migrated view (no legacy to fall to). Rework each Class-A gate to `if(_reactXOn()){ try{mount;return}catch{ render minimal inline error card; return } }` and drop the per-view `__REACT_X`/`?react=0`/`crm_react_off` branch (or route it to the same error card). Verify `?react=0` no longer blanks.
- **SAFE to delete (Class-A — React owns render via props, legacy is a standalone dead renderer), tiered, one deploy + live-verify each:**
  1. `security` (`script-admin.js`, placeholder — safest, do first alone)
  2. `monthly_promotion` (`script-marketing.js`), `org_chart` (`script-org.js`), `ranking` + `noticeboard` (`script-performance.js`)
  3. `lead_forms`/`surveys`/`contracts` (`script-forms.js`), `purchases_history` (`script-prospects.js`), `custom_fields`+`milestones` (`script-features2.js`), `booking_settings` (`script-cps.js`), `knowledge_dashboard`+`knowledge_all_entries` (`script-knowledge.js`)
  4. `cases` (`script-cases.js`) — delete the two legacy else-branches; then delete `buildCard` ONLY after grep-confirming no other caller; KEEP `cardModel`+`applySharedFilters`
  5. `agents` (`script-prospects.js`, largest Class-A block — deploy alone)
- **❌ DO NOT delete (reachable / shared / not default-on):** `customers` + `prospects` legacy — REACHABLE in normal use via unsupported-filter fall-through (Regular/deficiency/min-events/purchase-status/house-audit/Agent-Eligible) + prospects card view, and entangled with `__USE_BFF_CUSTOMERS`/`__SERVER_TABLES`. Class-B scaffold/passthrough legacy (calendar/pipeline/reports/stock_take/egg/formula/marketing_automation/referrals/home/mobile/boss_report/protection + marketing_lists promotions/special_programs) — shares by-id population logic. `journey` (opt-in, not default-on). `ai`/`search`/`fude`/`modal-content` (dangerouslySetInnerHTML passthrough — the "legacy" IS the live HTML).
- **Risk:** MEDIUM (the prerequisite, and misclassification). Mitigate: tiered deploys, `node ci/regression.js` gate, live `?react=0` smoke-test after each batch. ~1.5–2.5k LOC removable.

### 3.2 Full JSX componentization of the passthrough forms — **P3, L (multi-week)**
- Unchanged recommendation: do this **only when you're already changing a given form** ("componentize when touched"). The signature/print legal forms (cps/apu/destiny) are fine left as passthrough. `dangerouslySetInnerHTML` keeps the manual-escaping XSS surface alive on those — a dedicated escaping pass is cheaper than full componentization.

### 3.3 `getAll()` "Property description must be an object" — **✅ ROOT CAUSE PINNED** (was: masked/unknown)
- **Finding (verified read-only):** the throw is **NOT in `data.js`** — the entire `_getAllImpl` read path has zero `Object.defineProperty`/`Object.create(proto,desc)` calls, and `data.min.js`'s only `defineProperty` is the esbuild keepNames helper with a *literal* descriptor (can't throw). The real source is esbuild **es2020 lowering of React Query v5 private class fields** inside `react-island.js`, which emitted `Object.defineProperty(obj,key,null)` in the `QueryObserver` ctor — **already fixed** via `vite.config.mjs target:'es2022'`. The legacy "_getAllImpl crash" was a **misattributed async stack frame** (V8 stitched the island's sync throw onto the nearest keepNames-wrapped frame in the awaiting data path).
- **Remaining (cheap, low-risk) cleanup:** (a) optional sourcemapped repro to confirm; (b) add a CI canary in `ci/regression.js` that fails the build if `react-dist/react-island.js` matches `/defineProperty\([^)]*,\s*(null|void 0|undefined)\)/`; (c) **keep** the SW-94 `getAll().catch` guard but demote its comment to "defense-in-depth; root cause = esbuild es2020 private-field lowering, fixed via vite es2022"; (d) optional: set `target:'es2022'` in `build.mjs` too. **No live read-path change needed.**

---

## 4. Infrastructure — **YOUR action** (billing; I can't purchase)

### 4.1 Upgrade Supabase compute Nano → Micro/Small — **P1 (operational)**
- **Where:** Supabase dashboard → project `remuwhxvzkzjtgbzqjaa` → Settings → Compute and Disk.
- **Why:** NANO can't sustain the reconnect load — it caused the 2026-06-16 outage (a restart recovers it but won't durably hold). The real fix to prevent repeat 521 outages. **Until then, deploys are spaced/batched** (each forces a full-fleet client reload that spikes the small DB).

---

## 5. Unbuilt "coming soon" features (placeholders — build only if you actually want them)
These show a "coming soon" toast and do nothing. They were never implemented — not bugs.
- **AI Insights dashboard** (entire feature: Lead Scoring, Sales Forecast, Churn Risk, Performance Insights + ~22 action buttons, `chunks/script-ai.js`) — currently mock data + stubs. Largest effort if you want it real.
- **Export KPI Dashboard** button (`chunks/script-fude.js` ~992).
- **Batch Move / Share / Download** (Marketing, `chunks/script-marketing.js` ~4314).
- **3rd-party integrations** — Outlook/Slack/GitHub/etc. (`chunks/script-gcal.js` ~399); only Google Calendar is real.
- **Mobile calendar Week/Day/Agenda tabs** (`chunks/script-mobile.js` ~1812) — only Month works on mobile.

---

## Deploy-cadence reminder
Each production deploy bumps `sw.js` CACHE_VERSION → every open client/PWA reloads + re-auths at once. On the current **NANO** compute that reconnect spike can exhaust the DB (it did on 2026-06-16). **Batch changes into fewer deploys; ideally upgrade compute (4.1) first.**
