# Meet Ups & Events — One Section (Merge Plan)

**Date:** 2026-08-16 · **Status:** PROPOSAL (plan only, nothing implemented)
**Goal:** The prospect profile's "Meet Up History" (③) and "Activities and Events" (④) look and behave the same and confuse the user. Merge them into ONE section — compact one-line rows (date · type · title · status), tap a row to expand full details. **Presentation only: every data path, calculation, button, and permission stays exactly as-is.**

Visual mockup: see the "Meet Up Timeline" artifact (interactive collapsed/expanded demo in the CRM's own theme).

---

## 1. What the user sees after the merge

ONE accordion section: **③ Meet Ups & Events** (replaces both ③ and ④).

```
┌─ ③ 🤝 Meet Ups & Events ──────────────────────────────┐
│  [All] [Meet Ups] [Events]        ⟲ Past Record  + Add │
│  ▸ 15/08/2026  CPS    CPS With Koid Wei Gaik           │
│  ▾ 15/08/2026  EVENT  家居小物件隱藏大禍害  ✓ attended   │
│      ATTENDANCE  — Paid  — Ticket  ✓ Attended          │
│      [Post Event Notes] [Details]                      │
│  ▸ 08/08/2026  EVENT  汇集专案-Condo ✓ attended 🤝 Closed│
│  ▸ 26/07/2026  CALL   Follow-up call            📷 2   │
└────────────────────────────────────────────────────────┘
```

- **Collapsed row (default):** caret · date · colored type chip (CPS/FTF/CALL/EVENT/…) · title · status badges right (`✓ attended`, `🤝 Sale Closed` in green, `📷 n`, `+pts`). One line, ~40px.
- **Expanded row:** the EXACT current card body — Discussion Notes fields, attendance chips (Paid/Ticket/Attended), and the full action row (`Attach Photo`, `Minutes`, `Close Sale`/`Sale Closed`, `Post Event Notes`, `Photos`, `Details`) with the same handlers.
- **Header:** filter chips All / Meet Ups / Events (client-side show-hide, no data change) + `Past Record` + ONE `+ Add` button — today's "Add Meet Up" and "Add Activity" are literally the same call, `app.openActivityModal('', id)`, so one button loses nothing.
- Newest first. Optionally auto-expand the newest row.
- Registrations that have no attendance card keep rendering at the bottom (same `events-table`, unchanged logic).

## 2. Why this is safe (verified by 6-agent code sweep, 2026-08-16)

| Fact | Evidence |
|---|---|
| Mobile + PWA reuse the desktop builder — no fork to update | `script-mobile.js:4106-4108` calls `app.showProspectDetail`; zero accordion code in mobile chunk |
| React island never renders the detail page | zero hits in `src/react/**`; tables call `app().showProspectDetail` — **no react-island rebuild, no `?v=` bump** |
| All section CSS lives in the chunk's injected `<style>` block | `script-prospects.js:1968-2018` — no styles*.css edit, **no CACHE_VERSION bump** |
| Nothing reads the events section's DOM | exhaustive grep: zero readers of `acc-body-events-*` / `acc-events-*` — section ④ can be deleted |
| 5 refresh sites read `acc-body-activity-${id}` | `script-prospects.js:4251,4337`; `script-activities.js:5165,5170,6209` — merged section MUST keep tab key `'activity'` |
| Bonus fix | keeping key `'activity'` means EVENT-type saves now auto-refresh the merged section via `_refreshActivityEntityTabs` — the old events tab never refreshed after a save |

## 3. Implementation steps (single file: `chunks/script-prospects.js`)

1. **Skeleton** (`buildProspectDetailTabsHtml:2056`): retitle section ③ to "Meet Ups & Events" (keep id `acc-activity-…`, tab key `'activity'`, `data-loaded` contract); delete section ④ (`acc-events`, lines 2087-2094).
2. **Builder** (`switchProspectTab`): in the `tab === 'activity'` branch, run BOTH existing pipelines **moved, not rewritten**:
   - Meet-up pipeline (2550-2567): `MEETUP_TYPES` filter incl. `EVENT_CLOSING`, `getActivitiesForProspect(id,{limit:500})`, fresh `photo_urls` enrichment query.
   - Events pipeline (2649-2690): `EVENT_TYPES` filter, `getProspectAttendeeNotes(id,{includeWithoutNotes:true})`, owner-wins dedup, `coveredEventIds` + `VALID_REG_STATUSES` registrations dedup.
   - Merge the two arrays (type sets are disjoint — no double counting) and render compact rows; expanded body = current card markup per row type (3-way: meetup card / own-event card / attendee card).
3. **Expand/collapse:** native `<details>/<summary>` (or a class toggle) — **no new `app.*` functions**, so `ci/baseline.json` untouched. Keep `event.stopPropagation()` on every action button (already present).
4. **CSS:** add `.mu-row/.mu-chip/...` rules to the SAME injected style block (1989-2005 area). Old `meet-card` classes stay for the expanded bodies.
5. Delete the now-dead `tab === 'events'` branch (2648-2776) after its logic is absorbed.

## 4. Traps checklist (from adversarial review — DO NOT skip)

- [ ] **Sort comparator:** use the events tab's NaN guard `_ts = Date.parse(d||''); NaN→0` (2673) for the merged list, plus a NaN-safe tiebreak — attendee rows have STRING ids (`att3`), so `b.id - a.id` (2567) becomes NaN. Use `String(b.id).localeCompare(String(a.id))`.
- [ ] **Attended + Closed at the same event:** attendee row and its `EVENT_CLOSING` child become adjacent near-duplicates in one list. Group them into ONE row via the only correct join key: `String(attendeeRow.closing_activity_id) === String(closingChild.id)` (calendar.js:7297 exposes it). NEVER match by date/title; NEVER drop the `EVENT_CLOSING` row (it carries the sale — money path).
- [ ] **`includeWithoutNotes: true` must survive** — attendance without notes IS the record (comment at 2655-2658).
- [ ] **`String()` coercion on every id comparison**; attendee `photo_urls` come from `event_attendees` — the activities `photo_urls` enrichment must not overwrite them.
- [ ] `coveredEventIds` over the merged list will also suppress registrations for EVENT_CLOSING-covered events — accepted (registrations are the weaker duplicate record).
- [ ] **Escaping:** keep `escapeHtml`/`_esc`/`UI.escJsAttr` on all user text exactly as today.
- [ ] **CI:** run `node ci/onclick-check.js` and `node ci/regression.js` after the change; no registered functions are added/removed, so no baseline regen expected.

## 5. Out of scope (untouched)

- **`openMeetupHistoryModal`** (header 🕐 button → `script-calendar.js:7446`) — a third, already-merged view of the same data. Stays as-is in phase 1; optional later: reuse the new compact renderer (note: it currently EXCLUDES note-less attendance and has the NaN tiebreak bug — fixing it is a separate task).
- **Customer profile** (`script-customers.js`: "Activity History" 742-749 + "Events Attended" 751-758, ids `cust-acc-body-*`) — same duplication pattern; apply the same merge as **Phase 2** after the prospect version is approved live. (The `acc-*` style block is DUPLICATED there at 649-663 — any shared-class restyle must edit both copies.)
- All scoring/weights (Name List mentions, 汇集 1.5×, KPI counts), RLS, activity visibility — none of it reads this DOM; nothing changes.

## 6. Deploy & verify

- Chunk-only change → edit un-minified `chunks/script-prospects.js`, push; Vercel `build.mjs` regenerates `.min`. No CACHE_VERSION bump, no migration.
- Content-verify live at `/chunks/script-prospects.min.js` via ASCII-anchor slice (root path serves HTML fallback; min escapes CJK).
- Live UI test per standing approval: desktop profile + mobile via Chrome MCP; TEST-labeled activity create → verify rows/expand/buttons → delete.

**Estimate:** one session. **Risk:** low — one file, presentation-layer only, all invariants enumerated above.
