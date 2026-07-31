# Pipeline v7 — Evidence + Fit + Calibration (PROPOSAL)

**Status: @suggest — design only. Nothing in this document has been executed. No DDL applied, no code changed.**
Date: 2026-07-31 · Author: Claude (with external critique as input) · Engine today: v6 activity-scored model in `chunks/script-pipeline.js`

---

## 1. Verdict on the critique

| Critique point | Verdict | Reason (grounded in this codebase/business) |
|---|---|---|
| No negative signals | **AGREE — build it** | Activities already carry `note_outcome`, `status`, `unable_to_serve` in the light select, but scoring only ever adds. An explicit `outcome` field + negative weights is cheap and honest. |
| No fit/firmographics | **ADAPT — right idea, wrong inputs** | Industry/employee-count/tech-stack is B2B SaaS thinking. Our fit = affordability + authority + urgency, and the inputs already exist since the 2026-07-29 potential-columns migration (`income_range`, `budget_range`, `decision_maker`, `decision_timeline`, `is_own_business`, `company_size`). The critique's "$10k budget vs $100k product" doesn't map to RM1.2k–8.5k products, but Bujishu RM8,500 vs Formula RM1,200 affordability fit is real. |
| Arbitrary multipliers (K=2.5, boosters) | **AGREE in principle — but calibration table, not ML** | With our deal volume, per-category regression overfits. The right first step is an empirical reliability report: predicted band vs actual close rate, then a suggested K. `monthly_focus_archive` already snapshots `probability` per prospect per month — a free (if biased) backtest seed. Full ML is premature; revisit at ≥100 closed deals per category. |
| Manual override reintroduces bias | **PARTIALLY AGREE — constrain it, don't kill it** | The critique misread the code: `_applyPotentialBoost` fires only when `!entry.qualified` — a declared High-70 **never overrides an earned score**. The real bug is in *ranking*: declared-70 outranks earned-40 on one axis. Fix: cap declared-only rows below HOT, sort evidence first on ties, and score each agent's declared-potential accuracy so judgment earns trust. Removing the human door is wrong for this org — field agents know things the CRM doesn't. |
| Everyone hits 100% with enough engagement | **AGREE — the biggest real flaw** | CPS (15) + two boosted events (12 each) = 39 raw → 98%, with no proposal ever sent. Decay bounds the window but not the ceiling. Fix with **stage caps derived from facts we already store** — see below. |
| Proposed formula `0.6×behavior + 0.4×fit` | **REJECT the arithmetic, keep the intent** | Additive fit lets a perfect-fit stranger with zero engagement outrank an engaged buyer, and replaces one arbitrary constant (2.5) with two (0.6/0.4). Use fit as a *multiplicative dampener* (can shrink or mildly amplify, never fabricate), with weights that P3 calibration later tunes. |
| Stage caps (Discovery 10% / Demo 25% / …) | **ADAPT — derive, don't ask** | We don't have Demo/Legal stages, and the legacy Kanban `pipeline_stage` column is stale (only the old drag view writes it — don't trust it). But stage is *derivable with zero new data entry*: `proposed_solutions` rows are already prefetched by the engine, and `prospects.closing_record` is already in the light select. |

**Net verdict: keep the v6 philosophy (behavior over opinion, recency decay, hard CPS gate, full transparency), add four missing organs: caps, negatives, fit, feedback.**

---

## 2. The v7 formula

```
per activity, per category:
  contribution = base_weight × decay(age) × booster(text) × outcome_sign   ← P1 adds outcome_sign

behavior_raw  = Σ contributions (best category wins → Target to Sign)
              with per-type repeat dampener: top N of each activity type count
              fully, the rest × repeat_factor                              ← P0

stage_cap     = derived: CPS-only 45 · proposal-sent 75 · closing-started 95  ← P0
behavior_pct  = min(stage_cap, behavior_raw × K)

fit_mult      = 0.7 + 0.5 × (fit_score / 100)     ∈ [0.7, 1.2]             ← P2
              unknown fit inputs score neutral 50 — never zero

probability   = min(stage_cap, round(behavior_pct × fit_mult) + referral_bonus)

declared-only door (no qualifying behavior):
  probability = min(potential_prob_cap = 65, declared value)               ← P0
  → can reach WARM, never HOT; evidence-qualified sorts first on ties
```

Every new constant lives in `pipeline_config` (versioned, rollback exists), editable in the Super Admin rules modal, and every new term renders as a line in the Score Breakdown (Explain) modal. Nothing becomes a black box.

---

## 3. Phases

### P0 — Stage caps + repeat dampener + declared-door cap (no DDL, ~1 session)

The highest-value fix: kills forecast inflation using only data already on hand.

- **Stage detection** in `calcPipelineEntry`: `solutionsByProspect` (already in `_plPrefetched`) → proposal sent; `prospect.closing_record` / `closing_records_history` (already in the prospects light select) → closing started; purchases → already handled as Won. Ignore the stale legacy `pipeline_stage` column.
- **Config**: `constants.stage_caps = { cps_only: 45, proposal: 75, closing: 95 }`, `constants.repeat_dampener = { top_n: 3, factor: 0.3 }`, `constants.potential_prob_cap = 65`.
- **Ranking**: in `buildPipelineIslandData` sort, evidence-qualified beats `fromPotential` at equal probability.
- **Explain modal**: add cap line ("Capped at 75% — proposal sent, closing not started"), dampened rows marked, declared rows badged.
- Touch points: `calcPipelineEntry`, `_applyPotentialBoost`, `showPipelineExplain`, `buildPipelineIslandData`, `_buildSystemRowData` / `_buildFocusRowData` (JSX payload) **and** legacy `renderFocusRow` / `renderSystemRow` (flag-off path), config modal trio (`_renderPipelineConfigModal`, `_readPipelineDraftFromDom`, `savePipelineRules`).

### P1 — Negative signals (additive DDL + UI, ~1–2 sessions)

- **DDL (additive — NOT executed, listed for the future migration file)**: `ALTER TABLE activities ADD COLUMN IF NOT EXISTS outcome TEXT;` values `positive | neutral | negative | not_interested`. **Deliberately no CHECK constraint** — the 2026-07-29 lesson: strip-and-retry only catches 42703 (unknown column); a 23514 CHECK violation fails the whole update.
- **⚠ Append `outcome` to `_lightSelects.activities` in `data.js`** — the exact trap that silently ate the potential columns for years. Any column the scorer reads must be in the light select.
- **UI**: Outcome select on activity create/edit forms (activities chunk + any React modal shell). Echo-verify the write (reuse `savePotential`'s missing-key detector).
- **Scoring**: `outcome_multipliers = { positive: 1.1, neutral: 1.0, negative: -0.5, not_interested: -1.0 }` — negative contributions ride the same decay curve, so bad news fades exactly like good news. A `not_interested` outcome within 60 days additionally suppresses the prospect from the auto table with an explicit reason (mirrors the CPS-gate messaging).
- **Backfill hint**: one-off offline script pattern-matching existing `note_outcome` text ("not interested", "no budget", "postpone", "拒绝") → propose outcomes for human review before writing anything.
- **Event no-shows** (VERIFY FIRST): probe live `event_attendees` for a registration-vs-attended status column before designing the `no_show_penalty` knob. Do not assume.
  - **VERIFIED + BUILT 2026-07-31.** Live probe: `attendance_status` TEXT (`'Registered'`/`'Attended'`/`'No Show'`) and an `attended` boolean both exist; the marking UI writes the literal `'No Show'`. Distribution: 21 of 24 past-event prospect registrations still sat at `'Registered'` (organizers rarely re-mark), so the penalty counts **only explicit `'No Show'` marks** — an implicit past+unattended rule would punish organizer data hygiene, not prospect behavior. Shipped: `constants.no_show_penalty` (flat pts, default 3, 0 = off, rules modal §7), subtracted per skipped event with decay driven by the event's date (fallback: registration `created_at`), flat across categories so ranking never moves; rows ride a 60s-TTL module-cached bulk `event_attendees` map (no N+1, no DDL — and no light-select append needed: the table has no `_lightSelects` entry, reads are `select=*`). Explain modal shows per-event 🚷 rows + a total-deduction line.

### P2 — Fit score (no DDL — the 2026-07-29 columns finally pay rent, ~1–2 sessions)

- **Components** (config-weighted, each 0–100, unknown → 50 neutral):
  - *Affordability*: `budget_range` / `income_range` parsed against the target category's `default_amount`.
  - *Authority*: `decision_maker` yes=100 / unknown=50 / no=20.
  - *Urgency*: `decision_timeline` bucketed ("within 1 month" high, "next year" low).
  - *Owner bonus*: `is_own_business` / occupation contains business/owner — extra weight when target is `agent_package` or `fengshui` (office audit).
- **Blend**: multiplicative dampener `fit_mult ∈ [0.7, 1.2]` (see formula) — NOT the critique's additive 60/40.
- **Side effect worth stating in rollout comms**: filling the "Edit Potential & Opportunities" modal now visibly moves the score — agents finally have a reason to complete it.
- Fit renders as a chip on rows + a component table in Explain.

### P3 — Calibration loop (additive DDL, ~2–3 sessions)

- **DDL (additive — NOT executed)**: `pipeline_snapshots` table: `snapped_at date, user_id, prospect_id, probability int, raw_score numeric, category text, stage text, fit int, amount numeric`. RLS from day one: agent INSERT/SELECT own, L1 SELECT all (approval_queue lesson — never ship the table first and scope it later).
- **Write path**: on pipeline view open, throttled to once per user per day, bulk-insert the visible qualified rows (single PostgREST array insert, not N `create()` calls — NANO-friendly).
- **Report** (admin-only tab in the rules modal): join snapshots (+ `monthly_focus_archive` as biased seed — note its `probability` is stored as a String) to purchases within 90 days → reliability table: predicted band vs actual close rate, per category only where n ≥ 30. Output: suggested K and suggested stage caps, with a one-click "apply" that writes through `savePipelineConfigJson` (already versioned with rollback).
- **Agent judgment report**: declared High/Medium/Low at snapshot time vs 90-day outcome, per agent — surfaces whose gut deserves trust; candidate for the QBR chunk.

### P4 — Later / optional

- `prospects.potential_set_at` (DDL + light select) so *declared* potential decays with age like earned scores.
- Velocity term (rising vs fading touch cadence).
- Per-category calibrated K once sample sizes clear n≥100.

---

## 4. What we deliberately do NOT adopt

- **Firmographic ICP / intent data** (6sense-style) — wrong market, no data source.
- **ML regression service** — premature at current volume; the calibration table is the honest version.
- **Removing the manual door** — it encodes field knowledge; we constrain (cap 65) and audit it (P3 accuracy report) instead.
- **Additive 0.6/0.4 formula** — see verdict table.
- **Trusting `pipeline_stage`** — stale legacy Kanban column; stage is derived from facts.

## 5. Standing traps for whoever executes this

1. Any new **prospects** or **activities** column the engine reads → append to `_lightSelects` in `data.js` in the same commit as the DDL. This exact omission caused the 2026-07-29 bug.
2. Ship **both render paths**: JSX payload builders (`_build*RowData`) and legacy fallback (`renderFocusRow`/`renderSystemRow`). If `src/react/*` changes, bump `react-island.js ?v=` in `index.html`; do NOT bump `sw.js` `CACHE_VERSION` for this (521 herd risk) — batch it with the next forced deploy.
3. New writes → **echo-verify** (missing key in returned row = silently stripped column), pattern already in `savePotential`.
4. No CHECK constraints on enum-ish TEXT columns (23514 vs 42703 strip-and-retry asymmetry).
5. No new N+1: stage/fit inputs ride the existing `_plPrefetched` maps; snapshots are one bulk insert, throttled.
6. All DDL here is additive (pre-authorized class per standing instruction), but **@suggest means none of it runs now**.
7. Mobile web + PWA get everything automatically only if changes stay in the chunks; verify the pipeline React island payload shape stays serializable (no Dates in rows — `lastActivity` is already stringified).

## 6. How we'll know it worked

Before/after on the same trailing quarter, using P3 data: mean absolute calibration error per band (|predicted − actual close rate|). Success = v7 error < v6 error and the HOT band's actual close rate ≥ 2× the WARM band's. Secondary: forecast Σ(amount × probability) vs actual booked revenue drifts closer to 1.0.

## 7. Effort summary

| Phase | Effort | DDL | Risk |
|---|---|---|---|
| P0 caps + dampener | ~1 session | none | low — pure chunk logic, both paths |
| P1 negatives | ~1–2 sessions | 1 additive column | medium — form UI in two stacks |
| P2 fit | ~1–2 sessions | none | low-medium — parsing messy budget/income text |
| P3 calibration | ~2–3 sessions | 1 additive table + RLS | medium — bulk insert path, NANO load |
| P4 extras | as needed | 1 additive column | low |

Recommended order: P0 → P1 → P2 → P3 (P0 alone already fixes the inflated-forecast red flag).
