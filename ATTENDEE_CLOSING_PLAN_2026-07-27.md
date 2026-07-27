# Per-Attendee "Closing" Button — Plan (@suggest, 2026-07-27)

**Ask:** add a **Closing** button to every attendee row in the Activity Details → *Attendees* list, because a
prospect *or an existing customer* may buy after an event. Each closing must land on **that attendee's own
profile**, not the shared event activity.

**Status: plan only. Nothing was edited.** Base commit `2ff239a`.

---

## 1. What exists today

| Piece | Where |
|---|---|
| Activity Details modal | `viewActivityDetails` [`chunks/script-calendar.js:4988`](chunks/script-calendar.js:4988) → `buildActivityDetailsContent` [`:4846`](chunks/script-calendar.js:4846) |
| Attendee row renderer | `renderProspectRow` [`chunks/script-calendar.js:5102-5141`](chunks/script-calendar.js:5102); control strip [`:5124`](chunks/script-calendar.js:5124); `Post Event` button [`:5137`](chunks/script-calendar.js:5137) |
| Actions-strip **Closing** button | `_outcomeBtn` [`chunks/script-calendar.js:4964-4966`](chunks/script-calendar.js:4964) |
| Closing modal / save | `openMeetingOutcomeModal` [`:6042`](chunks/script-calendar.js:6042) · `saveMeetingOutcome` [`:6098`](chunks/script-calendar.js:6098) |
| Shared form body | `buildMeetingOutcomeBlock` [`chunks/script-activities.js:1318`](chunks/script-activities.js:1318) · `collectMeetingOutcomeData` [`:1651`](chunks/script-activities.js:1651) |
| Per-attendee precedent | `openAttendeePostEventModal` / `saveAttendeePostEventNotes` [`chunks/script-calendar.js:6819`](chunks/script-calendar.js:6819) |

Two facts define the whole problem:

1. **The Closing button can never appear on an event today.** `_MEETUP_TYPES = ['CPS','FTF','FSA','GR','XG','CALL','EMAIL','WHATSAPP']`
   ([`:4943`](chunks/script-calendar.js:4943)) excludes `EVENT`, and `_outcomeBtn` is gated on `_isMeetup && _entityId`.
   Meanwhile `attendeeHtml` only renders *for* `EVENT`/`AGENT_MEETING`/`AGENT_TRAINING` ([`:5037-5038`](chunks/script-calendar.js:5037)).
   The two are mutually exclusive by construction. There is **no** existing path anywhere in the CRM to record a
   sale from event attendance.

2. **The entire money path is gated on `activity.prospect_id`** — one `if` at
   [`chunks/script-calendar.js:6306`](chunks/script-calendar.js:6306). An `EVENT` activity has no `prospect_id`, and it
   has *N* attendees, so the shared row is structurally the wrong place to hang a sale. Everything below that gate —
   `prospects.closing_record` mirror ([`:6472`](chunks/script-calendar.js:6472)), auto-submit ([`:6364`](chunks/script-calendar.js:6364)),
   `approval_queue` *new_sale* ([`:6494`](chunks/script-calendar.js:6494)) and *new_customer* ([`:6506`](chunks/script-calendar.js:6506)),
   `npo_sales`/`npo_sale_items`/`npo_installments` ([`:6415`](chunks/script-calendar.js:6415)–[`:6455`](chunks/script-calendar.js:6455)),
   the card-expiry reminder ([`:6534`](chunks/script-calendar.js:6534)) — is dead without it.

### How money actually becomes revenue

```
Closing form → activities row (is_closing, amount_closed…)   ← invisible to reporting
             → prospects.closing_record (status draft→submitted)
             → approval_queue 'new_sale'
             → manager Approve  →  purchases row + adjust_customer_ltv
                                   closing_record archived to closing_records_history, slot freed
```

Verified independently: **`is_closing` / `amount_closed` / `closing_amount` appear ZERO times** in
`script-reporting.js`, `script-performance.js`, `script-pipeline.js`, `script-boss-report.js`,
`script-quarter-review.js`. Revenue is read from `purchases` (+ `npo_sales` for PORT).
Purchase rows are minted at **five** sites — `savePurchase` [`chunks/script-customers.js:2183`](chunks/script-customers.js:2183),
`closeDealWon` [`chunks/script-pipeline.js:3094`](chunks/script-pipeline.js:3094), and three approval sites
[`chunks/script-approvals.js:364`](chunks/script-approvals.js:364)/`:542`/`:765`.

Because approval **archives** `closing_record` into `closing_records_history` and nulls the slot
([`chunks/script-approvals.js:386-389`](chunks/script-approvals.js:386)), the slot is reusable — **repeat sales for an
already-converted customer are a supported path**, with the `_alreadyConverted` guard
([`chunks/script-calendar.js:6313`](chunks/script-calendar.js:6313)) suppressing a duplicate *new_customer* request.
This is the key that makes the customer case work.

---

## 2. Design decision

| Option | Verdict |
|---|---|
| **A — store the closing on the `event_attendees` row** | ❌ `event_attendees` has no money columns, and **no aggregation anywhere reads it for money** — only headcount/attendance. The sale would be invisible to reporting, approvals, LTV and the prospect profile. Needs new DDL *and* a second booking mechanism. |
| **B — mint a child activity row per attendee, then reuse `openMeetingOutcomeModal` verbatim** | ✅ **Recommended.** Zero DDL. Reuses 100 % of the closing/approval/NPO/LTV path, so the sale shows on the right profile, in the approval queue, and in revenue — with no new money code to get wrong. |
| **C — fork `saveMeetingOutcome` into a `(activityId, prospectId)` variant** | ❌ Duplicates a 460-line money function that already carries three audit-hardened guards (`_moSaving` H2 lock, `npo_sale_id` H1 stamp, order-form gate). Guaranteed drift. And the closing would have no activity row, so it would not appear in the prospect's Meet Ups history. |

### Recommended flow

```
Attendee row  →  [Closing]  →  resolve the attendee to a PROSPECT id
                            →  find-or-create a child activity for (event, prospect)
                            →  app.openMeetingOutcomeModal(childActivityId)   ← unchanged
```

**Resolving the attendee** (branch on `att.attendee_type`, exactly as `showAttendeeDetails` does at
[`chunks/script-activities.js:3339`](chunks/script-activities.js:3339)):

- `attendee_type !== 'customer'` → `entity_id` **is** the prospect id.
- `attendee_type === 'customer'` → read `customers.converted_from_prospect_id`.
  - present → use it; the full approval-gated flow works for the repeat sale.
  - absent (imported customer, never a prospect) → **do not invent a path.** Open the existing
    *Add Purchase* modal (`savePurchase`, [`chunks/script-customers.js:2095`](chunks/script-customers.js:2095), already
    stubbed at `script.js:6128`) pre-filled from the event. That is the CRM's current repeat-purchase mechanism.
    ⚠️ It writes `purchases` directly with **no manager approval** — a deliberate disclosure, not a new hole.

**The child activity row**

```js
{
  activity_type: 'EVENT_CLOSING',      // ← sentinel; see §3
  activity_date: parentActivity.activity_date,
  start_time: parentActivity.start_time,
  end_time:   parentActivity.end_time,
  prospect_id: resolvedProspectId,
  event_id:    parentActivity.event_id,   // free event↔sale traceability, zero DDL
  lead_agent_id: _state.cu.id,            // the closer
  activity_title: `Closing — ${eventTitle}`,
  visibility: 'closed',
}
```

`activities` INSERT is unconditional for any authenticated user —
`create policy "auth_write_insert" … for insert to authenticated with check (true)`
([`migrations/rls_select_scoping_APPLIED_2026-06-18.sql:58`](migrations/rls_select_scoping_APPLIED_2026-06-18.sql:58), **ledger-proven applied**),
so an agent can mint this even for another agent's prospect.

**Idempotency.** Re-opening Closing must reuse the same child, or repeat clicks mint duplicate
`approval_queue` *new_sale* rows → duplicate `purchases`. Do a find-first:
`AppDataStore.query('activities', { event_id, prospect_id, activity_type: 'EVENT_CLOSING' })`, create only on miss.
Caveat: `activities` SELECT is scoped ([`rls_select_scoping_APPLIED_2026-06-18.sql:29-36`](migrations/rls_select_scoping_APPLIED_2026-06-18.sql:29)),
so a *different* agent may not see an existing child and could mint a second. Two mitigations, pick one:

- set `visibility: 'open'` on the child so the find always succeeds (simplest), **or**
- additive DDL `alter table event_attendees add column closing_activity_id bigint;` and stamp it.

---

## 3. Why `EVENT_CLOSING` and not `CPS` / `FTF`

Every activity-row counter in reporting is a **positive-list** test, so an unknown type is counted by none of them:

| KPI | Gate | Sentinel? |
|---|---|---|
| CPS count | `a.activity_type !== 'CPS'` [`:1483`](chunks/script-reporting.js:1483) | ✅ escapes |
| Total Meetings | `AGENT_MEETING_TYPES.includes` [`:1888`](chunks/script-reporting.js:1888) | ✅ |
| Client Meetings / CS(N) | `CLIENT_MEETING_TYPES.includes` [`:1909`](chunks/script-reporting.js:1909) | ✅ |
| People Met | `=== FTF \|\| === GR` [`:1950`](chunks/script-reporting.js:1950) | ✅ |
| CF Headcount | `!== 'CPS'` [`:2113`](chunks/script-reporting.js:2113) | ✅ |
| Activity Attendance | starts from `event_attendees` [`:2129`](chunks/script-reporting.js:2129) | ✅ — **do not create attendee rows for the child** |
| Server RPCs | `WHERE activity_type = 'CPS'` / `IN (…)` | ✅ |

Typing the child `CPS` would inflate **three** CPS surfaces (`getCPSCount`, the server RPC, and `cpsByAgent` at
[`:1742`](chunks/script-reporting.js:1742)) *and* silently satisfy the pipeline's CPS hard gate at
[`chunks/script-pipeline.js:442`](chunks/script-pipeline.js:442), admitting prospects that were deliberately gated out.
Typing it `FTF` would inflate Client Meetings, People Met, and — per the **ledger-proven** RPC body
([`report_rpc_scope_clamp_2026-06-19.sql:75`](migrations/report_rpc_scope_clamp_2026-06-19.sql:75) counts
`IN ('EVENT','AGENT_MEETING','FTF','FSA')`) — Total Meetings too.

### Two type-agnostic consumers the sentinel does **not** escape

Both need a one-line exclusion in the same PR:

1. **Agent Operating Hours.** `_activityDurationHours` returns **1 hour** whenever the duration isn't positive
   ([`chunks/script-reporting.js:1709-1719`](chunks/script-reporting.js:1709)) — equal start/end still yields 1h, so
   there is no "zero-length" escape. The closer already receives the parent event's hours, so N attendee closings
   add a phantom `N × 1h` against the 45 h/20 h target.
   → **Fix:** skip the sentinel in the `actMap` loop at [`chunks/script-reporting.js:1737-1745`](chunks/script-reporting.js:1737).
2. **Active Agents.** Branch (1) at [`chunks/script-reporting.js:1665-1669`](chunks/script-reporting.js:1665) is fully
   type-agnostic (`if (!a.lead_agent_id || date < cutoff) continue;`) — a dormant agent flips to "active" off one
   closing. Set-based, so no double count, but it is a semantics change.
   → **Fix or accept**, owner's call; one-line skip at the same place.

Also note `chunks/script-pipeline.js:480` weights lead score by `activity_weights?.[activity_type] || 0` — the
sentinel scores 0 **as long as nobody adds a config row for it**. That's data, not code; worth a comment.

---

## 4. Blast radius on credit (owner decision, not a bug)

The leaderboard credits the **record owner**, never the closer:
`ownerAgent = custAgentMap(customer_id) ?? prospAgentMap(prospect_id) ?? lead_agent_id`
([`chunks/script-performance.js:132-135`](chunks/script-performance.js:132)) — and the child *always* carries a
`prospect_id`, so the `lead_agent_id` fallback is never reached. Likewise `purchases` has **no agent column, by
design** ("do NOT add one (prior bug)", [`chunks/script-customers.js:2147-2149`](chunks/script-customers.js:2147)).

**So: agent A closes agent B's attendee at an event → the sale, the LTV and the closing-rate all credit B.**
That is existing CRM behaviour, and this feature makes it visible far more often. If the owner wants event-closer
credit, that is a separate piece of work (new column + a leaderboard decision), not part of this change.

---

## 5. Exact edit list

All in **`chunks/script-calendar.js`** unless stated. Mobile reuses this code verbatim
([`chunks/script-mobile.js:3026-3027`](chunks/script-mobile.js:3026) loads the calendar chunk and calls
`window.app.viewActivityDetails`), so one edit ships to desktop + mobile web + PWA.

1. **`renderProspectRow` [`:5137`](chunks/script-calendar.js:5137)** — add a second button beside *Post Event*:
   ```html
   <button class="btn btn-sm secondary" style="color:#065f46;border-color:#065f46;"
     onclick="(async()=>{ await app.openAttendeeClosingModal(${att.id}, ${activityId}); })()">
     <i class="fas fa-clipboard-check"></i> Closing</button>
   ```
   Pass **only** `att.id` + `activityId` — the handler re-reads the attendee row and branches on
   `attendee_type` itself. (Do **not** copy the `Post Event` signature: it passes `entityId` as a "prospectId"
   and `saveAttendeePostEventNotes` then calls `showProspectDetail(prospectId)`
   ([`:6960-6961`](chunks/script-calendar.js:6960)) — for a customer attendee that navigates to a wrong/nonexistent
   prospect. **Pre-existing bug; worth fixing in the same PR.**)
   Both the row and the inner strip are inline `flex-wrap: wrap`, so a 5th control wraps rather than overflows;
   `styles-mobile.css` has no `.info-row` rule, only `.btn-sm { min-height:36px !important }` at `:897`. No CSS change needed.

2. **New `openAttendeeClosingModal(attendeeId, activityId)`** near [`:6819`](chunks/script-calendar.js:6819):
   `await _ensureActivitiesChunk()` (mandatory — the form body lives in the activities chunk and is not loaded on
   mobile; this is exactly the empty-modal bug documented at [`:6043-6046`](chunks/script-calendar.js:6043)) →
   resolve attendee → resolve prospect → find-or-create child → delegate to `openMeetingOutcomeModal(childId)`.
   **No new save function.** `saveMeetingOutcome` is reused untouched.

3. **Register the handler** in the chunk's return object near [`:7506`](chunks/script-calendar.js:7506).
   `ci/onclick-check.js` **exits 1** on any `app.X(` in an inline handler with no registration.

4. **`chunks/script-reporting.js:1737-1745`** — skip `EVENT_CLOSING` in the `actMap`/`weekActIds` loop (§3.1),
   and optionally at [`:1666-1669`](chunks/script-reporting.js:1666) (§3.2).

5. **Optional parity** — the prospect profile's *Events* tab shows attendee-derived rows
   ([`chunks/script-prospects.js:2627-2667`](chunks/script-prospects.js:2627), synthesized by
   `getProspectAttendeeNotes` [`:6985-7052`](chunks/script-calendar.js:6985)) with *Post Event Notes* + *Photos*
   but no Closing. Adding the same button at [`:2662-2665`](chunks/script-prospects.js:2662) is the natural
   follow-through. Note `getProspectAttendeeNotes` hard-filters `attendee_type === 'prospect'`
   ([`:6989`](chunks/script-calendar.js:6989)) — customer attendees are currently unreachable from any profile.

---

## 6. Pre-flight live probes — ✅ RUN 2026-07-27, all answered

| Probe | Result |
|---|---|
| `event_attendees` RLS | **`auth_full_access` FOR ALL `using(true) with check(true)`** — one permissive policy, RLS on. No band restriction; the L11/L12 concern is refuted. Safe to use as the dedup anchor. |
| `approval_queue` | `approval_queue_agent_insert` **is applied** (INSERT, `submitted_by = current_user_row_id() or level<=2`) — but `admin_select` was still `level<=2`, so `.insert().select().single()` got an empty RETURNING and PostgREST **rolled the insert back** for every agent. 🔴 Live revenue bug. **Fixed** — see `migrations/approval_queue_agent_select_2026-07-27.sql`, applied + verified. |
| `kpi_activity_summary` | Live body is the **wide** one: `cps_count = 'CPS'`, `total_meetings IN ('EVENT','AGENT_MEETING','FTF','FSA')`, `client_meetings IN ('FTF','FSA')`. All positive lists → the `EVENT_CLOSING` sentinel escapes every one. Confirms the design and rules out `CPS`/`FTF`. |
| `purchases` RLS | `auth_full_access` `using(true)` — agent inserts are permitted. |
| `activities` constraints | No CHECK on `activity_type`, so a new value is accepted. NOT NULL = `id`, `closing_amount` (default `0`), `country` (default `'MY'`). |

<details><summary>Original probe SQL (kept for re-verification)</summary>

The adversarial pass flagged these as **unproven at rest**. Two were load-bearing.

```sql
-- 1. BLOCKING — event_attendees RLS. Two incompatible candidate shapes exist in-repo and neither is
--    evidenced for this table. If UPDATE is the mgr_update (level<=10) shape, the L11/L12 band cannot
--    write attendee rows at all — which would mean the EXISTING Paid/Ticket/Attended toggles are
--    already failing silently for those users today.
select polname, polcmd, pg_get_expr(polqual, polrelid), pg_get_expr(polwithcheck, polrelid)
from pg_policy where polrelid = 'public.event_attendees'::regclass;

-- 2. BLOCKING — can a normal agent actually file the approval_queue row? The "✅ APPLIED 2026-07-17"
--    header on migrations/approval_queue_agent_insert_2026-07-14.sql is an UNCOMMITTED working-tree
--    edit, absent from the migration ledger. Even with the INSERT policy, admin_select (level<=2)
--    was not widened, and AppDataStore.add() uses .insert().select().single() (data.js:2293-2300) —
--    an RLS-filtered RETURNING of 0 rows gives PGRST116 and rolls back.
select polname, polcmd, pg_get_expr(polwithcheck, polrelid)
from pg_policy where polrelid = 'public.approval_queue'::regclass;

-- 3. Which KPI body is live? Decides how much the sentinel actually buys us.
select prosrc from pg_proc where proname = 'kpi_activity_summary';

-- 4. purchases RLS — no CREATE POLICY for this table exists anywhere in migrations/, yet
--    DATA_AUDIT_2026-07-17.md:95 says RLS is on for every table.
select polname, polcmd from pg_policy where polrelid = 'public.purchases'::regclass;
```

Ledger reality check: `node ci/test-migration-ledger.js` → **65 recorded, 110 on disk** (38 unrecorded), and the
CI guard only *warns*. Everything after 2026-06-19 — including `set_closing_record_field_2026-07-04`,
`prospects_approval_guard_2026-07-13`, `approval_queue_agent_insert_2026-07-14` — has unknown apply status.

</details>

---

## 7. Risks

1. 🔴 **Pre-existing double-book, made more likely.** A pending *new_sale* + someone dragging the prospect to
   Closed-Won mints **two** `purchases` rows: `closeDealWon` creates row #1 and sets `status='converted'`
   ([`chunks/script-pipeline.js:3094`](chunks/script-pipeline.js:3094), [`:3113`](chunks/script-pipeline.js:3113)),
   then `approveQueueEntry`'s `status === 'converted'` gate ([`chunks/script-approvals.js:316`](chunks/script-approvals.js:316))
   passes and creates row #2 ([`:364`](chunks/script-approvals.js:364)). The only guard, `_convInFlight`
   ([`:333-335`](chunks/script-approvals.js:333)), is an in-session `Set` — it does not survive a reload, another
   user, or another day. Per-attendee closings multiply pending entries per event. **Recommend an invoice +
   customer_id existence check before the create at `approvals:364`** — small, separable, and worth doing first.
2. 🟠 **Prospects UPDATE wall.** `current_user_visible_ids()` returns **self only** for level ≥ 11
   ([`migrations/rls_helpers.sql:58-60`](migrations/rls_helpers.sql:58)), and prospects UPDATE is gated on it
   ([`sec_2026-06-19_writes.sql:21-40`](migrations/sec_2026-06-19_writes.sql:21)) — both ledger-proven. An L11/L12
   agent closing **another agent's** attendee cannot write `prospects.closing_record`; `set_closing_record_field`
   is SECURITY **INVOKER** so it does not bypass this. The activity row saves, the money mirror fails.
   Surface a clear error rather than the current `console.warn` at [`chunks/script-calendar.js:6481`](chunks/script-calendar.js:6481).
3. 🟠 **Modal prefix collision.** `buildMeetingOutcomeBlock` keys every field on `${prefix}-…`
   ([`chunks/script-activities.js:1318`](chunks/script-activities.js:1318), [`:1651`](chunks/script-activities.js:1651)) and
   `hasOrderFormPhoto`/`loadOrderFormThumbnails` resolve `${prefix}-order-form-thumbs` by `getElementById`.
   Reusing prefix `'mo'` while the event modal is still open risks a stale-DOM read — confirm `UI.showModal`
   fully replaces the body, or use a distinct prefix.
4. 🟡 **Silent column stripping.** `AppDataStore` retries inserts up to 15× dropping unknown columns
   ([`data.js:2282+`](data.js:2282)) — a non-existent column looks saved and is absent server-side. This is exactly
   the `life_chart_type` failure. Probe `information_schema.columns` before relying on any new column.

---

## 8. Build & deploy

1. Edit `chunks/script-calendar.js` (+ `chunks/script-reporting.js`, optionally `chunks/script-prospects.js`).
2. `node build.mjs` — regenerates `.min.js`, `.br`, hashed copies, `dist-manifest.json`, and rewrites the
   inline `__ASSET_MANIFEST` in `index.html:185`.
3. `node ci/onclick-check.js` must exit 0.
4. Commit the un-minified sources + `chunks/script-*.min.js` + `index.html`.
5. **No** `src/react/**` change → **do not** rebuild `react-dist/react-island.js` and **do not** bump
   `react-island.js?v=` at `index.html:720`. Confirmed: `grep -ri attendee src/react/` returns **0 hits**;
   `UI.showModal` is plain `innerHTML` on a body-appended overlay, a sibling of `#react-island-root`.
6. **Do not** bump `sw.js` `CACHE_VERSION` — content hashing already busts the chunk, and a bump forces a
   fleet-wide reload that can 521 the NANO Supabase.
7. Verify live by grepping the deployed hashed chunk for the marker `openAttendeeClosingModal`, not by hash.

> 📝 `.claude/CLAUDE.md` says "Vercel's build runs `build.mjs` only, NOT vite". That is **stale** —
> `vercel.json:150` is `node build.mjs && (npx vite build || echo 'vite build skipped …')`. The `|| echo`
> fallback means a vite failure silently uses the committed bundle, so "always commit `react-dist/react-island.js`"
> is still the right posture, but the stated reason is wrong. Worth correcting separately.

---

## 9. Open questions for the owner

1. **Closer credit** — a sale closed by agent A on agent B's attendee currently credits **B** entirely (§4).
   Accept, or scope a separate credit-attribution change?
2. **Active Agents** — should a per-attendee closing mark an otherwise-dormant agent "active" (§3.2)?
3. **Customer attendees with no `converted_from_prospect_id`** — accept the un-approved direct-purchase path,
   or block Closing for them until an approval path exists?
4. Ship the `approvals:364` duplicate-purchase guard (§7.1) **first**, as its own small PR?
