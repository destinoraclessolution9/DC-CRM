# Pipeline v7.1 — Target & Band Filters + Share Summary (PROPOSAL)

**Status: @suggest — design only. Nothing executed.**
Date: 2026-07-31 · Prompted by: "I want to know the percentage for those who can buy Power Ring with high %"

---

## 1. What exists today (verified)

The Potential Pipeline has exactly **two** filters, both in the header of the Auto-Generated table:

| Filter | State var | Filters on |
|---|---|---|
| Agent | `_pipelineAgentFilter` | `prospect.responsible_agent_id` |
| Status | `_pipelineStatusFilter` | `prospect.status` |

Both flow through `setPipelineFilter(type, value)` → re-render. There is **no filter by Target-to-Sign product, no filter by probability band, and no aggregate anywhere** that answers "what share of my pipeline is X". Today the user would have to eyeball the table and count rows by hand.

## 2. What the question actually asks for

Two capabilities:
1. **Filter**: show only prospects whose Target to Sign = Power Ring (or any category) AND probability band = HOT (or any band).
2. **Share summary**: with any filter active, show *N shown / M qualified (X%)* plus the money view — raw Σ amount and weighted Σ (amount × probability) — so "13% of my qualified pipeline is HOT Power Ring, worth RM 57,500 raw / RM 48,900 weighted" is one glance.

Note on "Power Ring 6": categories are **config rows**, not code. The filter must read its options from `pipeline_config.categories` dynamically — so if PR6 becomes a real product tier, the admin adds a category row in the rules modal and the filter picks it up with zero code changes.

## 3. Design

### Filters (client-side, zero new queries)
- Two new module state vars beside the existing pair: `_pipelineTargetFilter = 'all'` (values: category id | `'potential'` for declared-only rows), `_pipelineBandFilter = 'all'` (values: `hot` ≥80 / `warm` 50–79 / `cold` <50).
- Applied **after scoring, on `enriched`** in `buildPipelineIslandData` (and the legacy STEP 6 mirror) — the engine already computed `entry.category.id`, `entry.fromPotential`, `entry.probability` for every row, so filtering is a `.filter()` over in-memory rows. No queries, no schema.
- Band thresholds reuse the existing 80/50 cutoffs (same as `_plProbMeta` and the badge renderers) — do NOT invent a fourth copy of the thresholds; read them from one shared helper or at minimum the same literals with a cross-reference comment.
- Scope decision: filters apply to the **Auto-Generated table only**. The MONTH FOCUS list stays unfiltered — it is a hand-picked priority list; hiding rows from it would look like data loss. Team sections likewise untouched.

### Share summary strip
A chip row above the Auto-Generated table, always visible (not only when filtering):
```
Showing 23 of 180 qualified (13%) · Σ RM 57,500 · weighted RM 48,900
```
- Denominator = qualified prospects **within the current Agent/Status scope** (so an agent sees their own share, a leader sees the team's). State this in the tooltip — percentage ambiguity is how dashboards lose trust.
- Weighted Σ uses `amount × probability/100` with the same amount waterfall the row displays (`getPipelineAmount` result already computed per row in `_buildSystemRowData` — reuse, don't refetch). Rows with `amount == null` (agent package "Varies") are excluded from both sums and footnoted: "+3 with no fixed amount".
- With v7 stage caps live, the weighted number is now a defensible forecast — this strip is where that pays off visibly.

### Touch points (both render paths — the standing rule)
1. `chunks/script-pipeline.js`:
   - state vars + extend `setPipelineFilter` (add `target`, `band` types)
   - `buildPipelineIslandData`: filter `enriched`, compute summary, add `targetFilter`, `bandFilter`, `categories` (id+name from config), and `summary` to the payload
   - `buildPipelineHeaderControlsHtml`: two more `<select>`s (legacy fill path)
   - legacy `showPipelineView` STEP 6: same filter + a small summary line above the table
2. `src/react/views/PipelineView.jsx`: two selects beside the existing Agent/Status pair (same `call('setPipelineFilter', …)` idiom at lines ~234-240) + the summary chip row → **vite rebuild + `?v=` bump in index.html** (do NOT touch `sw.js` CACHE_VERSION).
3. No DDL. No new tables. Mobile web + PWA inherit via the chunk + island automatically.

### Optional (defer unless asked)
- Tapping the summary chip exports the filtered list (names + phones) for a WhatsApp blast — pairs with the existing share patterns. Out of scope here.
- Persisting filter choices per user (localStorage) — existing Agent/Status filters reset on reload; keep the new ones consistent with that behavior for now.

## 4. Coordination warning

Session `task_3a159494` (event no-show penalty) is **live-editing `chunks/script-pipeline.js` right now** in this shared workdir. Execute this plan only after that session lands; `@work`'s pull-first rule handles the rebase. The two changes touch different functions but the same file and the same rules-modal region — merge order matters, simultaneous editing does not work.

## 5. Effort

~1 session. Risk low: pure client-side over already-computed rows; the only real trap is forgetting one of the two render paths or the `?v=` bump — both are §3 checklist items.
