# CPS Consultations → Total | Agent Referrers | Client Referrers

**Status:** BUILT + TESTED locally. **NOT pushed** — say the word and it goes live.
**Date:** 2026-08-05

---

## 1. What shipped

The CPS Consultations KPI card now reads:

```
CPS Consultations  ⓘ
5
👤 1 agent referrer   🤝 1 client referrer
↓ 44.4% vs last period
```

- **Total** — unchanged, still the headline session count.
- **Agent head count** — distinct consultants who referred at least one of the period's CPS.
- **Referral head count** — distinct prospects/customers who did.

**The three numbers do not sum**, and that is deliberate. `5` counts sessions; the other two
count *people*. In your example 1+1+2+1 = 5 sessions from 2 agents + 2 prospects. If Wong Wai
Yeng had referred 3 people instead of 1 it would read **7 | 2 | 2**. Same person-dedup rule as
the existing NEA/Fengshui Pitching cards. The tooltip and the drill-down both say so in words.

---

## 2. Live data probe (ran 2026-08-05, read-only)

| Metric | Result |
|---|---|
| CPS activities (all time) | **227** |
| …with a prospect linked | **227** (100%) |
| …with a referrer id linked | **227** (100%) |
| …name-only, no id | **0** |
| …no referrer at all | **0** |
| Referrer types present | `Consultant` 150 sessions / 13 heads · `Prospect` 77 sessions / 42 heads |
| Cross-type id collisions | **0** |

**Why it is this clean:** the CPS intake form hard-blocks a save without a referrer
("All appointments must be by recommendation", [script-activities.js:4867](chunks/script-activities.js:4867))
and its picker offers exactly two kinds of people — Prospect and Consultant (a user at level ≥ 3).
So `prospects.referred_by_type` *is* the agent/client split at source.

**Consequence:** no "unattributed" chip is needed. The code still computes that bucket and will
render a third chip if a legacy import ever produces one, but today it is always 0.

**Verification baseline:** Aug 1–5 org-wide = **5 CPS | 1 agent | 1 client**
(LIM MIN QI brought 3, Lai Sow Lian brought 2) — which matches the `5` in your screenshot.

---

## 3. CF Headcount was dead — now FIXED

The probe confirmed the suspicion:

```
CPS activities with a customer_id: 0  (of 227)
```

`getCFHeadcount` counted distinct `a.customer_id` on CPS activities, but the CPS create path
never writes `customer_id` — it writes `prospect_id`. So CF read **0 for its entire history**.

**It is not a KPI card.** There is no card with key `cfHeadcount`. The number actually surfaces in
two boss-facing places, both of which have been reporting zero:

1. the **weekly Monday report**, Section 2 **CF** cell (auto-filled)
2. the **Quarterly Performance Breakdown** row *CF Headcount*, against `cf_headcount_target`

### The definition, chosen from the data

Owner picked **all non-agent referrers** over the narrower "only referrers who are customers":

| | Mar | Apr | May | Jun | Jul | Aug |
|---|---|---|---|---|---|---|
| All non-agent referrers ✅ | 5 | 6 | 1 | 4 | 5 | 2 |
| Only those with a customer record | 3 | 1 | 1 | 4 | **0** | **0** |

All-time there are 42 client referrers but only 15 have a customer record, so the narrow reading
reports 0 in months where referrals plainly happened.

### How it is fixed

`getCFHeadcount` now **delegates to `getCPSReferrerSplit`** and returns its client count. The CPS
card's chip, the weekly-report CF cell and the quarterly row are therefore one number *by
construction*, not two implementations that happen to agree. `calculateKPIs` derives CF from the
split it already computes, so it costs nothing and no longer reads the RPC's `cf_headcount`.

The CF drill-down shared the same bug (grouped by `customer_id`, always empty). It now shares
`_cpsSessionScan` with the CPS drill-down and lists the client referrers, noting how many agent
referrers were excluded and where they are counted instead.

### ⚠️ One step left for you

`migrations/kpi_extended_summary_cf_fix_2026-08-05.sql` — the server RPC carries the identical
`count(distinct customer_id)` bug. **Applying it is optional**: the client no longer reads
`cf_headcount` from the RPC, so every visible number is already correct. It is worth applying so
the server aggregate is not a wrong-answer landmine for the next caller.

Only the `cf` CTE changes — everything else is byte-identical to
`kpi_extended_summary_2026-06-14.sql` (verified by diff). Rollback = re-run that file.
Dry-run against live agrees with an independent formulation of the same definition:

| Window | new CTE | independent check | old (broken) |
|---|---|---|---|
| Aug MTD | 1 | 1 | 0 |
| Jul | 5 | 5 | 0 |
| 2026 | 24 | 24 | 0 |

I could not apply it myself — writing DDL through the browser was blocked by a permission
guard. Paste it into the Supabase SQL editor, or tell me and I'll try another route.

---

## 4. How it works

For each CPS activity in range passing the **existing** scope gates (market, team, role):
`activity.prospect_id → prospect.referred_by_type` → agent bucket or client bucket, deduped by a
**composite** key (`user:5` and `prospect:5` are two people).

Three deliberate choices:

- **Scope is a line-for-line clone of `getCPSCount`.** The split is a separate pass, so if the
  gates ever drift the card would show a split describing a different set of sessions than the
  total right above it — invisibly. A test pins this.
- **No join to the referrer's own row.** The name is read off the consulted prospect, so an
  RLS-scoped agent gets correct counts without needing read access to the referrer's record.
- **No migration.** The getter runs *alongside* the `kpi_*` RPCs rather than inside them, so the
  numbers appear whether or not those server aggregates exist.

Drill-down (tap the card) now shows a **By referrer** table (Referrer · Type · Sessions) plus a
per-session table with Referred By / Referrer Type columns — so the two chips are auditable.
It also stops doing a whole-table `getAll('activities')` scan on every click.

---

## 5. Files changed

| File | Change |
|---|---|
| `chunks/script-reporting.js` | `getCPSReferrerSplit` + `_cpsReferrerOf` + chip builders; wired into both `calculateKPIs` paths; card def; tooltip; CSV descriptions; drill-down rewrite |
| `src/react/views/ReportsView.jsx` | `cps` branch in `renderCardSub` |
| `react-dist/react-island.js` | rebuilt (vite) |
| `index.html` | `react-island.js ?v=` bump + build manifest hash |
| `chunks/script-reporting.min.js` | regenerated (`build.mjs`) |
| `ci/test-cps-referrer-split.js` | **new** — 39 tests |

`sw.js` CACHE_VERSION deliberately **not** bumped (fleet-reload → NANO 521 risk).
Mobile needed no separate work — it routes `reports` to the same island.

---

## 6. Verification

**39/39 tests pass** (`node ci/test-cps-referrer-split.js`), covering the worked example,
non-summing head-counts, composite keys, every type spelling, legacy rows, all three scope
gates, non-CPS exclusion, and drill-down↔card agreement.

**The tests were proven able to fail.** Two deliberate mutations of the production code:

| Mutation | Result |
|---|---|
| composite key → bare id | caught (after I strengthened the test — see below) |
| removed the team-scope gate from the split only | caught: "team scope drops the other agent's session" |

The first mutation initially passed, which exposed a weak test: agent-vs-client cannot detect a
bare-id key because the two buckets are separate Sets. The real collision is *within* the client
bucket (`prospect:5` vs `customer:5`), which is now the test that pins it. Both mutations were
reverted; the chunk is byte-identical to its pre-mutation state.

**Browser-verified on both render paths** — the legacy HTML grid *and* the React island (which
is what production actually uses). Both produce the identical chip row.

| Viewport | Card width | Behaviour |
|---|---|---|
| Desktop 1280px | 399px | chips side by side, one 18px line |
| Mobile 375px | 183px | chips stack, **each chip unbroken**, no horizontal scroll |

The mobile KPI grid is two columns (~182px/card) — narrow enough that a single text run broke
mid-phrase ("👤 1 agent / referrer"). The chip row is therefore flex-wrap with one span per
chip, so a narrow card wraps *between* chips and never inside one.

**Repo regression:** the 2 failing checks (`ci/regression.js`) are pre-existing and unrelated —
stale size budgets across nearly every file (`script-reporting.js` was already 598 lines over at
HEAD, before my change) and a `script-fude.js` export I never touched.

---

## 7. Still open for you

1. **Apply `migrations/kpi_extended_summary_cf_fix_2026-08-05.sql`** (§3) — optional cleanup;
   every visible number is already correct without it.
2. **Labels** — "agent referrer / client referrer", or your own wording?
3. Should the split also land on the **Weekly Monday report** (`wr-cps`) and the **quarterly
   CPS Count** row? Not included.
4. **Two future-dated CPS** (Aug 6 and Aug 15, keyed 2026-08-05). Outside the month-to-date
   window, so they don't affect today's numbers — but a CPS is a completed consultation, so
   check whether those dates are intentional.
