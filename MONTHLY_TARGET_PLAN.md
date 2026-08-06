# Monthly Targets — Plan

**Status:** BUILT — all JS phases implemented, 75 tests green, built and committed
locally. **One step outstanding: the migration must be run by a human** (see below).
Not pushed.
**Date:** 2026-08-06
**Ask:** the Reporting & KPI dashboard header has *Set Yearly Targets* and *Set Quarterly
Targets*. It should also have a **monthly** target.

---

## 0. Execution status

| phase | status |
|---|---|
| 0 — migration | **file written, NOT APPLIED** — `migrations/monthly_targets_full_metrics_2026-08-06.sql` |
| 1 — writer fix (`is_manual` guard, exact split, batched writes) | done |
| 2 — Set Monthly Targets modal | done |
| 3 — read wiring (chart, breakdown card, target-vs-actual, overview, CSV) | done |
| 4 — both render sites + build | done |
| 5 — tests | done — 75 assertions, 8/8 mutants killed |

**The one thing left:** run
`migrations/monthly_targets_full_metrics_2026-08-06.sql` in the Supabase SQL editor
(project `remuwhxvzkzjtgbzqjaa`), precheck queries first. It could not be applied from
this session — the machine's `SUPABASE_ACCESS_TOKEN` belongs to the DNJ account and
reaches only `sfnrpbsdscikpmbhrzub`, and the Chrome extension (the dashboard-token
route) is not connected.

The JS is written to survive that gap rather than depend on it: the modal probes for
`is_manual` and renders a "migration not applied" banner instead of eating the edits,
`saveMonthlyTargets` refuses to write, and every monthly READ falls back to quarter ÷ 3
— i.e. exactly today's numbers. So the code is safe to ship before the DDL lands; it
simply doesn't do anything new until it does.

**CI:** `node ci/regression.js` fails 2 checks — `script-fude.js lost exports:
changeLeaderboardPeriod` and the line-count size budgets. Both pre-existing:
`script-fude.js` is untouched by this work, and both edited chunks were already over
budget at HEAD (`script-features2.js` 1891 > 1810, `script-reporting.js` 4525 > 3780).

---

## 1. Findings — what already exists

`monthly_targets` is **not** a new table. It already exists, is already written on every
"Save Yearly Targets", and **is read by nothing**. Most of its columns don't exist.

### 1.1 Live column probe

Probed `remuwhxvzkzjtgbzqjaa` via anon PostgREST (`200 []` = column exists, `400 42703` =
missing), 2026-08-06:

| table | metric columns present |
|---|---|
| `yearly_targets` | `id, target_year,` all 10 metrics `, created_at, updated_at` |
| `quarterly_targets` | `id, year, quarter,` all 10 metrics `, created_at, updated_at` |
| **`monthly_targets`** | `id, month, year, quarter, cps_count_target, total_sales_target, created_at, updated_at` — **8 of 10 metrics missing** |
| `weekly_targets` | `id, cps_count_target, total_sales_target, created_at` — unused by any code |

The 10 metrics referenced throughout the target code are:
`cps_count_target, total_sales_target, pop_case_count_target, pop_sales_target,
epp_case_count_target, epp_sales_target, new_agents_target, new_customers_target,
total_meetings_target, activity_headcount_target`.

Reproduce with:

```bash
K="sb_publishable_XVWyiw5j1lnEErQUTV4XWg_lQcCIAjX"; B="https://remuwhxvzkzjtgbzqjaa.supabase.co/rest/v1"; for c in month year quarter cps_count_target total_sales_target pop_case_count_target pop_sales_target epp_case_count_target epp_sales_target new_agents_target new_customers_target total_meetings_target activity_headcount_target; do printf '%-28s %s\n' "$c" "$(curl -s -H "apikey: $K" -H "Authorization: Bearer $K" "$B/monthly_targets?select=$c&limit=1")"; done
```

### 1.2 Where targets are written

| what | where |
|---|---|
| Yearly form + inline quarterly matrix + **12 auto monthly rows** | [`chunks/script-features2.js:680`](chunks/script-features2.js:680) `openKPITargetsModal` → [`:761`](chunks/script-features2.js:761) `saveKPITargets` |
| Monthly auto-generation (quarter ÷ 3) | [`chunks/script-features2.js:822-833`](chunks/script-features2.js:822) |
| Standalone quarterly matrix | [`:842`](chunks/script-features2.js:842) `openQuarterlyTargetsModal` → [`:890`](chunks/script-features2.js:890) `saveQuarterlyTargets` |
| Registration | [`chunks/script-features2.js:1872-1875`](chunks/script-features2.js:1872) |

### 1.3 Where targets are read

| what | where | granularity |
|---|---|---|
| Q1–Q4 Target Overview table | [`chunks/script-reporting.js:3682`](chunks/script-reporting.js:3682) `renderTargetOverview` | quarterly |
| "Current Quarter Performance Breakdown" | [`:3785`](chunks/script-reporting.js:3785) `renderPerformanceTable` | **always current quarter, regardless of filter** |
| Revenue chart target line | [`:3923`](chunks/script-reporting.js:3923) `renderRevenueChart` | yearly ÷ 52 (weekly) · **quarter ÷ 3** (monthly, [`:3993`](chunks/script-reporting.js:3993)) · quarterly |
| Hierarchical Target vs Actual | [`:4427`](chunks/script-reporting.js:4427) `renderKPITargetComparison` | quarter + yearly rollup |
| Quarter Business Review | [`chunks/script-quarter-review.js:953`](chunks/script-quarter-review.js:953) | quarterly |

**`monthly_targets` appears in zero read sites.** Grep across the tree returns only the
three write lines in `script-features2.js` plus the table list at
[`data.js:16`](data.js:16).

---

## 2. Defects this exposes

### D1 — Silent data loss + round-trip storm on every yearly save
`saveKPITargets` writes all 10 metrics to `monthly_targets`. `AppDataStore`'s
unknown-column retry loop ([`data.js:2356`](data.js:2356) insert,
[`data.js:2658`](data.js:2658) update) strips **one** unknown column per failed attempt
and retries. With 8 missing columns that is **9 requests per month row** — ~108 requests
instead of 12 on every "Save Yearly Targets", against the NANO instance. The 8 stripped
metrics land nowhere and no error surfaces.

### D2 — Monthly rows are invisible
Even `cps_count_target` and `total_sales_target`, which *do* persist, are never read back.

### D3 — The Monthly filter shows quarterly targets
Selecting **Monthly** in the time-filter bar changes the KPI cards' date range
([`:1276`](chunks/script-reporting.js:1276) in `getDateRanges`) but every target-bearing
widget keeps showing quarter figures. `refreshKPIDashboard` explicitly computes a *second*
quarterly KPI set to feed the breakdown card
([`:1159-1170`](chunks/script-reporting.js:1159)) — deliberate, and the reason the card is
titled "Current Quarter".

### D4 — Two ghost quarterly columns (adjacent, cheap to fix here)
`renderPerformanceTable` reads `qTarget.meetup_existing_target` and
`qTarget.cf_headcount_target` ([`:3806-3807`](chunks/script-reporting.js:3806)). Neither
column exists on `quarterly_targets` and **no form writes them**, so "Meet Up (Existing
Customers)" and "CF Headcount" have rendered Target 0 / 0.0% since they were added.

### D5 — Dead second yearly-target form (note only, no action)
[`chunks/script-reporting.js:4210-4331`](chunks/script-reporting.js:4210) holds a rival
yearly form with a different seasonal split (0.9/1.0/1.1/1.2) writing `yearly_target_id` /
`seasonal_factor`. Its `openKPITargetsModal` is deliberately **not** registered
([`:4500`](chunks/script-reporting.js:4500)) but `saveYearlyTargets` **is**
([`:4513`](chunks/script-reporting.js:4513)) — unreachable from the UI. Leave it; just
don't add the monthly form here (see §4, Phase 2).

---

## 3. Design decisions

### 3.1 The override rule — the load-bearing decision

`saveKPITargets` currently rewrites all 12 monthly rows **unconditionally**. Ship a monthly
editor without changing that and **every "Save Yearly Targets" silently wipes every
hand-set monthly target.**

**Rule:** each `monthly_targets` row is either

- **Manual** (`is_manual = true`) — typed by a user in the monthly modal. Yearly/quarterly
  saves never touch it.
- **Auto** (`is_manual = false`, the default) — derived from its quarter. Regenerated on
  every yearly save.

The modal shows a Manual/Auto badge per month so it is visible which columns a yearly
re-save will overwrite, plus a per-month "revert to auto" control that flips the flag back
and re-derives.

### 3.2 Derivation & rounding

Current derivation is `Math.round(quarterValue / 3)` per month
([`:826`](chunks/script-features2.js:826)), so the three months don't sum to the quarter
whenever it isn't divisible by 3 (quarter 100 → 33 + 33 + 33 = 99). Fix: months 1 and 2 get
`Math.round(q/3)`, month 3 gets `q − m1 − m2`. The trio then always reconciles.

### 3.3 Month-to-date vs a full-month target

The Monthly filter's range is **1st of month → today**
([`:1276-1280`](chunks/script-reporting.js:1276)). Comparing an MTD actual to a full-month
target reads as perpetually behind — on the 3rd of the month every metric looks like a
90% miss. Show a **pro-rated pace** figure alongside the raw number:

```
pace = target × daysElapsed / daysInMonth
```

and label the achievement badge against pace, with the full-month target still visible as
the denominator. Same treatment the quarterly card *doesn't* have today, but the distortion
is 3× worse at month granularity.

### 3.4 Modal shape

A 12-column × 10-metric matrix (the shape `openQuarterlyTargetsModal` uses for 4 quarters)
needs ~1,200px of horizontal scroll. Reporting KPI **is** reachable in the mobile PWA
([`chunks/script-mobile.js:508`](chunks/script-mobile.js:508), and in the bottom nav as
"Insights" at [`:652`](chunks/script-mobile.js:652)), so that shape is unusable there.

**Chosen shape:** a `Q1 | Q2 | Q3 | Q4` tab strip, each tab showing **3 month columns × 10
metric rows**. Same visual language as the quarterly matrix, one third the width, whole year
reachable in 4 taps. Per tab: an "Auto-split from quarter ÷ 3" button that fills the three
columns from the stored quarterly row.

### 3.5 No agent dimension

`yearly/quarterly/monthly_targets` are **org-wide**. Per-agent targets are a separate table
(`agent_targets`) behind the *Agent Targets* button
([`chunks/script-reporting.js:4499`](chunks/script-reporting.js:4499)
`openTargetManagementModal`). Monthly targets stay org-wide — `(year, month)` is the natural
key. Per-agent monthly is explicitly out of scope (§8).

---

## 4. Phases

### Phase 0 — Migration (additive DDL, pre-authorized)

`migrations/monthly_targets_full_metrics_2026-08-06.sql`

**Precheck first** — confirm the sibling column types and that no `(year, month)` duplicates
exist:

```sql
select column_name, data_type
  from information_schema.columns
 where table_name in ('quarterly_targets','monthly_targets')
 order by table_name, column_name;

select year, month, count(*) from monthly_targets group by 1,2 having count(*) > 1;
```

Then (match the type `quarterly_targets` actually uses — `numeric` below is the assumption,
adjust if the count columns are `integer`):

```sql
alter table monthly_targets
    add column if not exists pop_case_count_target      numeric,
    add column if not exists pop_sales_target           numeric,
    add column if not exists epp_case_count_target      numeric,
    add column if not exists epp_sales_target           numeric,
    add column if not exists new_agents_target          numeric,
    add column if not exists new_customers_target       numeric,
    add column if not exists total_meetings_target      numeric,
    add column if not exists activity_headcount_target  numeric,
    add column if not exists meetup_existing_target     numeric,
    add column if not exists cf_headcount_target        numeric,
    add column if not exists is_manual                  boolean default false;

-- D4: the two columns renderPerformanceTable has always read but never had
alter table quarterly_targets
    add column if not exists meetup_existing_target     numeric,
    add column if not exists cf_headcount_target        numeric;

-- dedupe BEFORE this runs, or it fails
create unique index if not exists monthly_targets_year_month_uidx
    on monthly_targets (year, month);
```

The unique index matters: `saveKPITargets` takes one pre-loop snapshot
([`:806`](chunks/script-features2.js:806)) and does find-then-create, so two concurrent
saves can already produce duplicate month rows.

Also mirror the additions into [`SCHEMA_MIGRATION.sql:197`](SCHEMA_MIGRATION.sql:197), which
currently only carries `monthly_targets.quarter`.

**Verify applied** with the §1.1 probe loop — every column should return `200 []`.

### Phase 1 — Fix the writer (`chunks/script-features2.js`)

In `saveKPITargets` ([`:822-833`](chunks/script-features2.js:822)):

1. Skip regeneration for any existing row with `is_manual === true`.
2. Use the remainder-corrected split from §3.2.
3. Stamp `is_manual: false` on generated rows.
4. Batch the writes instead of 12 sequential awaits inside the quarter loop.

Same three points apply to `saveQuarterlyTargets` ([`:890`](chunks/script-features2.js:890)),
which today doesn't touch monthly rows at all — after this it should re-derive the auto
months of any quarter it changes, or the monthly numbers silently drift from the quarter
they claim to sum to.

After Phase 0 the round-trip storm (D1) disappears on its own: no unknown columns, no
strip-retry.

### Phase 2 — `openMonthlyTargetsModal` + `saveMonthlyTargets`

**Lives in `chunks/script-features2.js`, beside `openQuarterlyTargetsModal`** — *not* in
`script-reporting.js`. That file carries an explicit warning at
[`:4500`](chunks/script-reporting.js:4500) that duplicate target-modal registrations caused a
load-order-dependent overwrite (Set Yearly Targets opened the Agent Targets modal instead).
Register in the `app.register('features2', …)` block at
[`:1872`](chunks/script-features2.js:1872), next to the existing four.

- Same `isTeamLeaderOrAbove(_state.cu)` gate as the other two buttons.
- Quarter tab strip → 3 month columns × 10 metric rows (§3.4), Manual/Auto badge per column.
- Blank input = auto (derive), typed value = manual.
- Save writes only the tabs the user touched, then
  `if (typeof window.app.refreshKPIDashboard === 'function') await window.app.refreshKPIDashboard();`
  matching the existing two save functions.

### Phase 3 — Read wiring (`chunks/script-reporting.js`), highest value first

1. **Revenue chart** — [`:3993-4000`](chunks/script-reporting.js:3993). Replace the
   quarter ÷ 3 distribution with the real `monthly_targets` rows; fall back to quarter ÷ 3
   per month that has no row. Biggest visible win — the chart's target line becomes real.
2. **Performance breakdown** — [`:3785`](chunks/script-reporting.js:3785). When
   `_currentTimeFilter === 'monthly'`, read the current month's row and retitle the card to
   "Current Month". `refreshKPIDashboard` already has
   `perfKpis = isQuarterlyView ? kpis : quarterlyKpis`
   ([`:1170`](chunks/script-reporting.js:1170)); add a monthly arm that passes the
   already-computed `kpis` through instead of forcing the extra quarterly
   `calculateKPIs` call. Apply the §3.3 pace treatment here.
3. **Target vs Actual** — [`:4427`](chunks/script-reporting.js:4427). Add an
   "*Month* YYYY — Target vs Actual" block above the quarter block when the filter is
   monthly. Same `row()` helper.
4. **Target Overview** — [`:3682`](chunks/script-reporting.js:3682). Expand each quarter row
   into its three months (or render a Monthly variant when the filter is monthly).
5. **CSV export** — `exportKPIReport` gains the monthly target column when the filter is
   monthly.

Items 3–5 are independently droppable if scope needs trimming.

### Phase 4 — Both render sites + build

The dashboard header exists **twice** and the React island is default-on:

- [`chunks/script-reporting.js:132-140`](chunks/script-reporting.js:132) — `_buildKpiDashboardShell`
- [`src/react/views/ReportsView.jsx:82-84`](src/react/views/ReportsView.jsx:82)

Add the third button in both, in the same order, with the same role gate. The `header-actions`
row will then hold 5 buttons — check the wrap on mobile web and in the PWA.

The breakdown heading is duplicated too
([`reporting:201`](chunks/script-reporting.js:201) /
[`ReportsView:170`](src/react/views/ReportsView.jsx:170)) — make it a renderer-set
`<span id="perf-breakdown-title">` rather than editing the literal string in two places,
since Phase 3.2 changes it dynamically.

**Build:** rebuild `react-dist/react-island.js` and bump its `?v=` in `index.html` — the
bundle is *not* hashed, `?v=` is the only cache-buster, and Vercel runs `build.mjs` only, not
vite. **Do not bump `sw.js` `CACHE_VERSION`** — this isn't a change that must reach every open
client simultaneously, and the fleet-reload herd can 521 the NANO instance.

---

## 5. Test plan

Follow the eval-the-real-chunk harness pattern already used for the boss-report catalog
(69 tests) and the CPS referrer split (55 tests).

Derivation / override (pure, no DOM):
- quarter 100 → months 33/33/34, sums to 100 exactly.
- quarter 0 → 0/0/0.
- `is_manual = true` month survives a yearly re-save; its two auto siblings are regenerated.
- `is_manual = true` month survives a quarterly re-save.
- "revert to auto" flips the flag and re-derives from the current quarter value.
- A quarter with no stored row derives 0/0/0, not `NaN`.

Read wiring:
- Monthly filter + a stored monthly row → breakdown card shows that row's target, not the
  quarter's.
- Monthly filter + **no** stored row → falls back to quarter ÷ 3 (no regression vs today).
- Quarterly filter → identical output to pre-change (regression lock on
  `renderPerformanceTable` and `renderRevenueChart`).
- Pace: on day 15 of a 30-day month with target 300, pace = 150.
- Month boundary: Jan/Dec, and a 28-day February.

**Mutation-test the tests** before trusting them — a prior session shipped tests that passed
against a deliberately broken implementation.

---

## 6. Deploy / verify checklist

- [ ] Precheck queries run; duplicates resolved.
- [ ] Migration applied via the Supabase dashboard SQL editor (project `remuwhxvzkzjtgbzqjaa`).
      The machine's env `SUPABASE_ACCESS_TOKEN` is the **DNJ** account and cannot apply CRM DDL.
- [ ] §1.1 probe loop returns `200 []` for all 10 metrics + `is_manual` on `monthly_targets`,
      and for the two new `quarterly_targets` columns.
- [ ] `npm run ci` — note there are 2 pre-existing failures unrelated to this work.
- [ ] `react-island.js` rebuilt, `?v=` bumped in `index.html`.
- [ ] Stage explicitly — the build leaves ~45 `.min` files as pure CRLF churn. **Never
      `git add -A`.**
- [ ] `index.html` conflicts on concurrent pushes: `git checkout origin/main -- index.html`
      then rebuild.
- [ ] `sw.js` `CACHE_VERSION` **not** bumped.
- [ ] Verify the deploy **by content**, not by chunk hash — Vercel's hash won't match local.
- [ ] Check the header button row wraps cleanly: desktop, mobile web, iOS PWA.

---

## 7. Risks

| risk | mitigation |
|---|---|
| Yearly save wipes manual monthly targets | `is_manual` flag, Phase 1 — this is why Phase 1 can't be skipped |
| Unique index creation fails on existing dupes | precheck query in Phase 0 |
| MTD vs full-month target looks like a permanent miss | pro-rated pace, §3.3 |
| Non-atomic multi-row writes (existing problem, noted at [`:4304`](chunks/script-reporting.js:4304)) leave months half-updated | out of scope; a transactional RPC is the real fix |
| Column type mismatch vs `quarterly_targets` | precheck `information_schema` before applying |
| SWR-cached reads serve stale targets | `AppDataStore.create/update` already invalidate; confirm the monthly modal's post-save `refreshKPIDashboard` picks up fresh rows |

---

## 8. Out of scope

- Per-agent monthly targets (`agent_targets` is a separate system).
- `weekly_targets` — the table exists with 2 columns and **no code references it at all**.
  Either wire it or drop it; not here.
- The dead second yearly form (D5).
- Making the 4-quarter write loop transactional.

---

## 9. Sizing

Phases 0 + 1 are the load-bearing part — roughly half a day including verifying the
migration landed. Phases 2–4 are mechanical, mirroring `openQuarterlyTargetsModal` almost
line for line. Phase 3 items 3–5 drop cleanly if scope needs trimming.

---

## 10. Open questions

1. **Should manual monthly targets survive a yearly re-save?** Assumed **yes** — it's the only
   reason to have a monthly editor at all. If no, Phase 1 collapses to just the rounding fix
   and the modal becomes a preview rather than an editor.
2. **Pace marker, or raw month-to-date?** Recommending pace (§3.3).
3. **Fold D4 (the two ghost quarterly columns) into this work?** It's two lines of DDL and two
   rows in the quarterly modal, and it's the same screen — recommending yes.
