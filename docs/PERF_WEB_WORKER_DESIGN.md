# Web Worker offload — design (not yet implemented)

**Status:** designed, not implemented. Significant refactor — needs dedicated session.
**Date:** 2026-06-01
**Source:** Tier A #7 of remaining-optimization plan

## Problem

On big tenants (30K+ prospects), client-side search/filter that iterates the full prospects list runs on the main thread. With typing-debounce already in place, the user perception is OK for short queries — but on slower mobile CPUs the filter loop can still cause a frame drop while typing fast.

## Target call sites

The patterns that scan ≥5K rows synchronously:

1. `filterProspects()` and the prospect list re-render path
2. `searchProspectReferrers()` autocomplete on big tenants
3. `_mpRenderList()` partial filter / pagination on the mobile-home grid
4. Aggregate computation in `generateSalesForecast` (when transactions table grows)

`searchProspects` and `searchCustomers` already push the query to Supabase trigram indexes, so they're NOT in scope. This design only addresses CLIENT-SIDE filtering of already-loaded data.

## Approach: dedicated Worker for list-filter operations

### `workers/filter-worker.js` (new file)

```js
// Self-contained Worker; reads no app state — receives the dataset and
// filter spec as a message, returns the matched subset.
self.onmessage = (e) => {
  const { reqId, rows, query, fields } = e.data;
  const q = (query || '').toLowerCase();
  const matched = q
    ? rows.filter(r => fields.some(f => (r[f] || '').toLowerCase().includes(q)))
    : rows;
  self.postMessage({ reqId, matched });
};
```

### Worker manager in main thread (additions to script.js)

```js
const _filterWorker = new Worker('workers/filter-worker.js');
const _filterCallbacks = new Map();
let _filterReqId = 0;

_filterWorker.onmessage = (e) => {
  const { reqId, matched } = e.data;
  const cb = _filterCallbacks.get(reqId);
  if (cb) { _filterCallbacks.delete(reqId); cb(matched); }
};

const filterOnWorker = (rows, query, fields) => new Promise((resolve) => {
  const reqId = ++_filterReqId;
  _filterCallbacks.set(reqId, resolve);
  _filterWorker.postMessage({ reqId, rows, query, fields });
});
```

### Call site swap (illustrative)

Before:
```js
const matched = allProspects.filter(p =>
  p.full_name?.toLowerCase().includes(q) || p.phone?.includes(q));
```

After:
```js
const matched = await filterOnWorker(allProspects, q, ['full_name','phone']);
```

## Important gotchas

1. **Postmessage cost.** Serializing 30K row objects across the worker boundary is itself ~5-15 ms on phones. The Worker filter only wins if the filter loop is *longer* than that overhead. For tenants under ~5K rows, the Worker would be SLOWER than main-thread filter. Decision logic must threshold by row count.

2. **Transferable objects.** For very large datasets, transfer via `ArrayBuffer` (zero-copy) instead of structured clone. Requires re-encoding rows to a binary format on each filter — significant complexity. Skip unless `>50K row` case shows up.

3. **Worker startup cost.** ~10-50ms on first message. Pre-warm the Worker by sending an empty filter on app boot so the JS bundle is parsed before the user's first search.

4. **Cache locality.** Pre-process the dataset ONCE into a normalized search index (lowercase concatenation) instead of doing `.toLowerCase()` on every filter call. Stored in the Worker after first message.

5. **Cancellation.** If the user types fast, multiple `filterOnWorker` calls queue up. Only the latest should resolve. Add `reqId` tracking and stale-response dropping (already in the design above).

6. **AbortController integration.** The existing `AppDataStore.abortInflight()` only cancels Supabase fetches. Worker work should also be cancellable on view-change — add a "cancel" message type.

## Sequencing

This is a 4–8 hour piece of work. Suggested phasing:

1. **Phase 1 — infrastructure (1 hr)**: Worker file, manager, threshold logic, smoke test on one call site with synthetic data. Don't replace any real call sites yet.

2. **Phase 2 — swap `filterProspects` (2 hr)**: Replace the synchronous filter with the worker call. Add feature flag for instant rollback.

3. **Phase 3 — swap remaining sites (1 hr each)**: `searchProspectReferrers`, `_mpRenderList`, etc.

4. **Phase 4 — pre-warm + cancellation (1 hr)**: boot pre-warm, view-change cancellation.

5. **Phase 5 — measurement (1 hr)**: add `performance.mark` / `performance.measure` around filter calls; verify INP improvement in real-user data.

## When to do this

**Trigger:** real-user complaints about typing lag in search, OR Lighthouse INP score consistently >200ms on the prospects list page, OR a tenant crosses 30K rows.

Today: probably not warranted given the typing debounce + already-indexed Supabase searches. Filed for the day when a tenant scales up.

## Rollback

Each call-site swap is reversible. Behind the proposed feature flag, set to `false` and the code falls back to the synchronous path. No data migration needed.
