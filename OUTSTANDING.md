# CRM — Outstanding / Backlog

_Last updated: 2026-06-16. Pick these up whenever you have time — none are user-blocking right now._

> **Critical bugs are already DONE + LIVE (SW-98).** This file is everything **not** yet done.
> Legend — **Effort:** S (≤1h) · M (a few h) · L (day+). **Priority:** P1 (do next) · P2 · P3.

---

## ✅ Already fixed + live this session (for context — do NOT redo)
- **Login outage** — Supabase project was down (NANO compute exhausted, HTTP 521); restarted from dashboard, recovered + hardened (offline-poll backoff, SW-96).
- **5 critical bugs (SW-98):** stored-XSS sweep (forms, calendar month+week, import, pipeline) · calendar week-view client-name privacy leak · silent activity-save failure (now shows error) · leaderboard always-zero (now resolves sales via customer's agent) · AI `generateId` ReferenceError.
- **React migration:** all 29 standalone views + 9 modal forms + fude dashboard + journey timeline — migrated & promoted default-on. `getAll()` crash-guard (SW-94), carousel dots (SW-95).

---

## 1. Tier-2 bugs — real, but lower-urgency (recommended order)

### 1.1 Pipeline view auto-archives on open — **P1, M** ⚠️ data integrity
- **File:** `chunks/script-pipeline.js` (~line 701-730, `showPipelineView`).
- **Problem:** merely OPENING the pipeline view fires an un-awaited, non-idempotent migration — loops expired focus items, creates rows in `monthly_focus_archive`, deletes from `my_potential_list`, all with `catch(e){}` swallowing errors. A partial failure (archive created but delete fails) leaves orphaned/duplicate rows; repeated/concurrent opens race each other. A read action is mutating data.
- **Fix:** move archiving out of the render path into an explicit, awaited routine (scheduled job or explicit user action). Confirm the archive row exists before deleting the source. Replace `catch(e){}` with a logged warning + counter.
- **Why P1:** the only leftover with real data-corruption risk.

### 1.2 Fude admin via hardcoded email allowlist — **P2, M** (authz drift)
- **File:** `chunks/script-fude.js` (~line 36-40).
- **Problem:** admin power in the fude view is partly governed by three literal emails baked into shipped client code (`mianformula@gmail.com`, `destinyoracles@gmail.com`, `shilynateh7689@gmail.com`) + an inline non-canonical role-regex, divorced from the numeric role system. Stale on email change / departures; admin data reads gated only client-side, not RLS.
- **Fix:** replace with the canonical `_getUserLevel` helper + `isManagement` predicate; treat special elevation as a real role/level in the DB; ensure RLS covers admin data so client gating isn't load-bearing.

### 1.3 Calendar appointment-card builder duplicated — **P2, M** (drift)
- **File:** `chunks/script-calendar.js` — `_renderCalendarLegacy` (~1742-1818) vs main `renderCalendar` (~2205-2321).
- **Problem:** ~60-line per-cell card builder exists twice and has already drifted (legacy lacked optimistic-badge handling + escaping). Every card change must be made twice. (Note: the XSS escaping was applied to BOTH paths in SW-98, but the duplication remains.)
- **Fix:** extract one `buildAppointmentCardHtml(activity, ctx)` helper called by both paths.

### 1.4 Calendar week-view O(n) per-cell filter — **P3, M** (perf, only at scale)
- **File:** `chunks/script-calendar.js` (~3349-3353).
- **Problem:** week view re-filters the entire activities array for each of 91 hour-cells (~1M iterations at 10k+ activities), blocking the main thread.
- **Fix:** pre-bucket activities by `${dateStr} ${hour}` once, then O(1) lookup per cell.

### 1.5 Boss Report React-island fallback — **P3, S** (suspected, unverified)
- **File:** `chunks/script-boss-report.js` (~154-164).
- **Problem (suspected):** if the React island fails to mount (CRMReact not loaded), the legacy fallback may not render correctly.
- **Fix:** validate the legacy fallback renders, or queue the mount if CRMReact isn't ready yet.

---

## 2. React migration — last 2 render paths (everything else is done)

### 2.1 Knowledge kb-slot editors — **P2, M**
- **What:** full-capture, daily-notes, and detail editors (`chunks/script-knowledge.js`) still render via vanilla `kb-slot.innerHTML` (the quick-capture *modal* IS migrated, SW-90).
- **Caveat:** `kb-slot` is shared with the already-React Knowledge dashboard/all-entries islands — route ALL kb-slot renders through one passthrough without clobbering the dashboard island, or componentize properly.
- **Note:** these have autosave (debounce) + link-search wiring — preserve it.

### 2.2 Journey aux widgets — **P3, S/M**
- **What:** `showAgentJourneyDashboard` + `showAgentJourneyLoad` (`chunks/script-journey.js` ~1073/1124) — small read-only dashboard widgets, still vanilla. (The journey *timeline* is migrated + promoted.)
- **Note:** two widgets can be on-screen at once → needs separate React roots (or a keyed map), not the single modal/journey root.

---

## 3. Architecture — the "D" goal (god-object retirement). Biggest, lowest-urgency.

### 3.1 Delete legacy fallback renderers — **P2, M-L** (highest-value slice of D)
- **What:** the migration *added* React on top but kept the old render code as fallback (e.g., `buildCard`, `_renderCalendarLegacy`, the passthrough-built HTML). The codebase is currently *larger*, not smaller. Removing the now-proven legacy fallbacks is what actually shrinks the god-object / chunks and delivers the payoff that justified the migration.
- **Risk:** verify each React path is solid before deleting its fallback.

### 3.2 Full JSX componentization of the passthrough forms — **P3, L (multi-week)**
- **What:** cps/apu/destiny/survey forms, fude view, journey, the 9 modals currently render through React via `dangerouslySetInnerHTML` (the chunk still builds the HTML — a thin wrapper, not real components).
- **Recommendation:** do this **only when you're already changing a given form** ("componentize when touched"). For the signature/print legal forms specifically (cps/apu/destiny), the passthrough is genuinely fine to leave — full JSX rewrite is high-effort/low-reward.
- **Caveat:** `dangerouslySetInnerHTML` bypasses React's auto-escaping, so the manual-escaping XSS surface persists on those forms — worth a dedicated escaping pass (cheaper than full componentization).

### 3.3 `getAll()` root cause — **P3, M** (masked, not pinned)
- **What:** the `_getAllImpl` "Property description must be an object: undefined" crash is **masked** by the SW-94 defensive guard (getAll degrades to cache/[] instead of throwing) — so it's not user-facing. The exact construct was never pinned (both bundles statically had only valid `Object.defineProperty` calls → likely a misattributed async stack frame).
- **Fix:** reproduce under a sourcemapped debug session to find the real throwing construct, then fix at source so the guard becomes belt-and-suspenders.

---

## 4. Infrastructure — **YOUR action** (billing; I can't purchase)

### 4.1 Upgrade Supabase compute Nano → Micro/Small — **P1 (operational)**
- **Where:** Supabase dashboard → project `remuwhxvzkzjtgbzqjaa` → Settings → Compute and Disk.
- **Why:** NANO compute can't sustain the reconnect load — it's what caused the 2026-06-16 outage (a restart recovers it but won't durably hold). This is the real fix to prevent repeat 521 outages. **Until then, deploys should be spaced/batched** (each deploy forces a full-fleet client reload that spikes the small DB).

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
