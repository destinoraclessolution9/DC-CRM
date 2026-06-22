# Humane Follow-Up Cadence System — Autonomous Build Plan

Goal: build the full grade-driven follow-up cadence system designed across the
2026-06 design sessions, **replacing** the existing "lousy" reminder dispatchers
where features overlap and **merging** where they differ, while fixing the 22
verified live bugs. Each phase ships to live (source-only, no CACHE_VERSION bump
unless a runtime change must reach all clients) and is bug-tested before the next.

Owner mandate (2026-06-22): fully automatic — build → done → push to live → test →
next phase, until 100% done. Parallelize with subagents where there is no file
interlock. Additive DDL pre-authorized; avoid destructive DDL (disable/supersede
old code rather than delete, for reversibility).

## Architecture
- One unified follow-up engine in `chunks/script-calendar.js` generating
  `follow_up_drafts`, surfaced in a daily "Today's list" (5 prospects + 2 customers
  + birthdays). Grade (`prospects.manual_grade` A–F) sets urgency; the event
  calendar sets rhythm. Customers get a 90-day check-in via a new
  `customers.last_contact_date` (trigger-maintained, like prospects).
- New per-entity state (`follow_mode`, `cooldown_until`, `silence_count`) drives
  cool-downs and silence back-off. Comfort caps (≤1 proactive/7d, ≤6/30d, min-gap,
  one-open-reminder, quiet hours, festival suppression) are hard floors.
- Old dispatchers (naive re-engagement, painting-only solution drip) are absorbed
  into the engine; event-invite path is kept + fixed; birthday/refill kept + merged.

## Phases (status: TODO / WIP / SHIPPED)

### Phase 1 — Foundation + stop-the-bleeding  [SHIPPED 1856341]
- [x] F1.1 Cap the re-engagement flood (bug #1): RE_ENGAGE_MAX_OPEN=5, oldest-quiet first.
- [x] F1.2 Lifecycle guards: solution dispatcher (#6) + refill scope (#10, calendar+bell) skip converted/lost/unable.
- [x] F1.3 UTC→MYT "today" fix (#20) in re-engagement dispatcher (local date).
- [x] F1.4 Additive DB: `customers.last_contact_date` + trg_sync_customer_last_contact + backfill (30/30).
- [x] F1.5 Verified (CI green, render-baseline 60) → shipped → re_engagement template not yet seeded so no flood occurred (prevented).

### Phase 2 — Grade A–F capture + cadence config  [WIP — core shipped]
- [x] Editable header picker narrowed A–G→A–F with labels + cadence hints (Close now/Warming/Half-half/Very far/Drop).
- [x] Additive cols: prospects.follow_mode, cooldown_until, silence_count, last_grade_change_at.
- [x] F-exclusion (partial): manual_grade==='F' skip in re-engagement + solution dispatchers.
- [x] F-exclusion: birthday dispatcher now skips grade-F prospects (no birthday wish).
- [ ] ungraded handled by cadence default C (no DB write needed); REQUIRED-at-CPS picker deferred.
- [x] F grey-out in prospect list (table row + card): grade-F prospects render greyed with a "Dropped (F)" badge, mirroring unable-to-serve.
- [ ] Complete F-exclusion remainder: notification bell birthday/refill (cps.js).

### Phase 3 — Unified cadence engine  [WIP — grade-driven core shipped]
- [x] Re-engagement nudge is now GRADE-DRIVEN: per-grade interval (A=3/B=10/C=21/D=30, ungraded→C, F dark) via GRADE_CADENCE; replaces the flat 14-day threshold. Grade sets the rhythm.
- [x] one-open-reminder: skip any prospect already holding ANY pending outreach (fixes double-fire #12); grade-ranked cap surfaces high-value quiet leads first.
- [x] Generic (non-画作) proposal drip (#7): every proposal type now gets day-1/3/7/14 via sol_day* fallback templates; dispatcher prefers a specific solution_match over the generic catch-all.
- [ ] Decaying intervals (gap widens per un-converted touch) + touch-type ladder.
- [ ] Reconcile/absorb the proposed_solutions drip into the unified engine (avoid double-book) + cross-source comfort caps (≤1/7d, ≤6/30d) + purpose merge.

### Phase 4 — Daily "Today's 5+2" list + contacted-feedback loop  [TODO]
- "Today" surface; WhatsApp-click + manual tick = contacted (log touch + advance clock);
  roll-over "overdue Nd"; 3-day escalation.

### Phase 5 — 90-day customer monitor  [WIP — core shipped]
- [x] dispatchCustomerCheckins: customers idle CUSTOMER_CHECKIN_DAYS(90)+ → warm "let's catch up" draft, capped 2/day (CUSTOMER_MAX_OPEN), highest-LTV first, one-open-reminder, episode-keyed on last_contact_date. Fixes bug #11 (CRM went silent post-conversion). cust_checkin template + wired into _runSecondary + dedup + export.
- [ ] cadence-health badge on customer card; "due this week" heads-up.

### Phase 6 — Event cool-downs + silence back-off + event-invite bug fixes  [WIP]
- [x] #3 inert match filter — empty template criteria now NEUTRAL not vacuously-true (was inviting EVERY tier-eligible prospect instead of the matching ones). Both twin sites.
- [x] #4 category lookup falls back to the solution string (`productCatMap[name] || name`) so 'Power Ring'-style category proposals match. Both twin sites.
- [x] #5 catalog-only events: proactive scan now ALSO includes catalog events with a future events.date in window (deduped vs logged activities by event_id), so a published class invites people even without a separately-logged EVENT activity.
- [ ] event_attended cool-down: largely handled already — attendance logs an EVENT activity → trigger bumps last_activity_date → grade cadence measures from the event date (natural cool-down). Explicit cooldown_until + forced-debrief touch deferred as refinement.
- [ ] silence tally → auto-slow → seasonal-only (needs the contacted-loop's silence_count wiring).

### Phase 7 — APU express lane + e-voucher monitoring  [TODO]
- APU tickbox + next-day ack + reserve slots + referred leads; voucher lifecycle monitor + reminders.

### Phase 8 — 5-year journey auto-advance + retire lousy bits + remaining bug fixes  [TODO]
- Journey step progression + 2nd-product cross-sell; disable superseded dispatchers.
- Remaining bugs: #2 (list filter converted) #8 (protection badge) #9 (bell refill column)
  #11 (customer-side) #12–22.

## Verify-per-phase recipe
1. `node --check` edited files + `node ci/regression.js` (green except pre-existing admin red).
2. SQL replay of the changed dispatcher's trigger logic against live data (read-only).
3. Commit SOURCE ONLY → push main → Vercel auto-builds. No CACHE_VERSION bump unless required.
4. Re-run the relevant bug-replay query post-deploy to confirm fixed.
