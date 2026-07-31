# Pipeline v7.2 — Per-Product Probability (DEEP DESIGN, PROPOSAL)

**Status: @suggest — design only. Nothing executed.**
Date: 2026-07-31 · Prompted by: "the percentage for those who can buy Power Ring with high %" · Companion to `PIPELINE_FILTERS_PLAN.md` (v7.1 ships the simple filter; this doc is the theory upgrade behind it)

---

## 1. The question behind the question

"Who can buy Power Ring with high %" sounds like a filter. It is actually a request for a number the engine does not compute: **P(this prospect buys product X)**. The engine computes ONE probability per prospect — the close-probability of their single best category ("Target to Sign"). Filtering on that gives systematically wrong answers, verified against the live engine below.

## 2. Three verified flaws (probed against the shipped v7 engine, 2026-07-31)

Probe: stubbed-harness calls to the real `calcPipelineEntry` (same rig as the 22-test suite).

**A. Evidence floods all categories.** CPS (10d) + 画作分享会 (5d):
```
{powerring:21, fengshui:21, calligraphy:27, agent_package:21, bujishu:21, formula:21}
```
Calligraphy wins correctly — but the other five categories score 21 from evidence (CPS 15 + event base 6) that says nothing about those products. A naive "per-category %" would claim she's `21×2.5 = 53%` likely to buy a mattress she has never shown interest in. Type-neutral evidence measures *engagement*, not *preference*.

**B. Ties are hidden by iteration order.** CPS + 汇集 (booster ×2.5 on BOTH fengshui and calligraphy):
```
{fengshui:30, calligraphy:30, …} → best: fengshui
```
The engine reports Target = fengshui only because `fengshui` precedes `calligraphy` in config order (`s > bestScore` keeps the first). Calligraphy demand is IDENTICAL and invisible. A Target filter for calligraphy misses this prospect entirely.

**C. 🔴 The CPS-only artifact — every fresh prospect "targets Power Ring".** CPS only:
```
{all six: 15} → best: powerring 36%
```
All six tie; the engine picks `powerring` purely because it is first in the config array. **Every CPS-only prospect in the entire CRM currently shows Power Ring as their Target to Sign.** The user's exact query — "who targets Power Ring at high %" — would be polluted by every engaged-but-undifferentiated prospect. This borders on a v7 bug worth fixing regardless of v7.2 (see §8).

## 3. Evidence anatomy

Split every prospect's category scores into two parts:
- **Common floor** = `min(categoryScores)` — evidence that lifted all categories equally (CPS, calls, un-boosted event base). This is engagement.
- **Specificity** = `score_c − floor` — evidence that singled this product out (boosted events, FSA→calligraphy, hands-on FTF→Bujishu, museum→Power Ring). This is preference.

Rerunning the three cases:
- A: specificity = {calligraphy: 6, rest: 0} → she is 100% a calligraphy prospect.
- B: {fengshui: 9, calligraphy: 9} → genuinely torn 50/50 — the honest answer.
- C: all 0 → **no product signal yet** — the honest answer is "engaged, undecided", never "Power Ring".

## 4. The model

```
P(close)      = the existing v7 probability (behavior × fit × referral, stage-capped) — UNCHANGED
share_c       = specificity_c / Σ specificity        (linear, explainable)
                if Σ specificity == 0 → share = "no product signal" (uniform for math, labeled honestly in UI)
P(buy c)      = P(close) × share_c
afford_c      = affordability recomputed vs PRODUCT c's price (not the winner's price)
                lenient (default): unknown budget passes · strict: parsed budget ≥ 50% of price required
```

- **Linear share, not softmax**: a temperature parameter would be a fourth arbitrary constant; linear specificity share is explainable in one Explain-modal sentence ("her only product-specific evidence points at 画作"), which is the system's standing ethos. Softmax noted as a future calibrated option only.
- **Affordability re-targeted**: v7 fit already parses `budget_range`/`income_range`, but against the *winner's* price. "CAN buy Power Ring" must check against Power Ring's RM 2,500 specifically. Reuse `_parseMoneyMax`; this is a per-product re-evaluation of one component, not a new fit.
- P(buy c) sums to ≤ P(close) across products by construction — no overcounting, coherent expected revenue: `E[revenue_c] = Σ_prospects P(buy c) × amount_c`.

## 5. Worked example — answering the user's actual question

"Power Ring, high %": for each qualified prospect compute `P(buy powerring)`. A museum-visit prospect (CPS 15 + museum 6×1.5=9 PR): floor 21 → wait, museum contributes 6×1.5=9 to PR and 6×1.2=7.2 fengshui, 7.2 calligraphy, 6 rest → specificity PR = 3-ish → share ≈ dominant → P(buy PR) ≈ P(close) × ~0.5+. Meanwhile Case-C prospects (CPS only) contribute 0% to the PR line instead of polluting it. The PR product line then reads:

> Power Ring: 9 real contenders · expected RM 14,100 · 2 blocked by budget (strict mode)

## 6. UI (restraint deliberately)

1. **"By product" pivot** (one new section or modal off the pipeline header): six rows — product, contender count (share ≥ 30% and P(close) ≥ 50 by default, both config), Σ expected revenue, top-3 names. This IS the answer to the user's question.
2. **Explain modal**: one added "Product mix" bar under the category-scores table showing share_c — reuses `fitComponents` table pattern.
3. **Do NOT** put a second percentage on every table row — two %s per row destroys the one-number clarity of the main view.
4. v7.1's Target filter upgrades from "winner == X" to "share_X ≥ threshold" (contender semantics) once v7.2 lands.

## 7. Closing the loop (calibration extension)

Snapshots today store only the winner `category`. v7.2 adds `top2_category` + `top_share` (two cheap columns, additive DDL). Validation query once matured: among snapshots where PR share ≥ 50%, what fraction actually bought a Power Ring within 90d — vs the base rate? **VERIFY FIRST**: how a purchase maps to a category (`purchases` product field vs `activities.solution_sold` vs `proposed_solutions` text) — probe live schema before designing the join; do not assume.

## 8. Independent quick fix worth pulling forward (v7 patch, not v7.2)

Case C is arguably a live mislabel today: ties (and the all-equal case) should not resolve by config order. Minimal patch: when `bestScore − min(scores) === 0` (no specificity), set Target display to "General — no product signal yet" with action "Invite to a product event to discover preference"; on genuine ties, show both names. Small, chunk-only, honest. Flagged separately so it can ship before the full v7.2.

## 9. What we deliberately do NOT do

- No softmax/temperature (arbitrary constant; calibrate first, complicate later).
- No per-product machine-learned propensity — same small-n verdict as v7 P3.
- No second probability column on the main table.
- No new mandatory data entry — everything derives from existing activities + the potential form.

## 10. Phasing, effort, coordination

| Item | Effort | Depends on |
|---|---|---|
| §8 no-signal/tie patch | ~½ session, chunk-only | nothing — can ship first |
| v7.1 filters (existing plan) | ~1 session | after task_3a159494 (no-show session, same file) lands |
| v7.2 product probability + pivot + Explain mix | ~1–2 sessions | v7.1 |
| Calibration columns + validation query | ~½ session | v7.2 + purchases-mapping VERIFY |

Same standing traps as always (§5 of PIPELINE_V7_PLAN.md): both render paths, `?v=` bump if `src/react` changes, light-select rule for the two snapshot columns, no CHECK constraints.
