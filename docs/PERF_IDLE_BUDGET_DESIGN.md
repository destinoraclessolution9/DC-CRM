# requestIdleCallback budget tracking — design (not yet implemented)

**Status:** designed, not implemented. Small but real refactor in script.js boot path.
**Date:** 2026-06-01
**Source:** Tier A #6

## Problem

`requestIdleCallback` (and the `scheduler.postTask` fallback added in Phase G) is already used to defer non-critical boot work — mobile enhancements block, Chart.js polling, etc. (commit 25293e5). But the existing callbacks don't *check* the available idle budget; they just run their whole block and return.

If a callback exceeds the deadline, the main thread frame is missed → INP regression.

## Goal

Wrap existing idle work in a yield-aware loop that consumes its budget:

```js
// Before
requestIdleCallback(() => {
  for (const item of heavyList) {
    processItem(item);
  }
});

// After
async function processInIdleChunks(items, processFn) {
  let i = 0;
  while (i < items.length) {
    await new Promise(resolve =>
      requestIdleCallback(async (deadline) => {
        while (i < items.length && deadline.timeRemaining() > 0) {
          processFn(items[i++]);
        }
        resolve();
      })
    );
  }
}
```

This splits a 200ms loop into ~10 frames of 20ms each, none of which block input.

## Target call sites

The existing `requestIdleCallback` usage from Phase F (commit 25293e5):
- Mobile enhancements block (table→card transforms, tree fullscreen, drawer augmentation)
- Chart.js defaults polling (every 1.5s after deferred startup)

Plus Phase G's `_yieldToMain()` helper which already exists at the `scheduler.yield()` level.

The actual *missing* implementation is wrapping these in deadline-aware loops. Today they run blob-style and trust they finish fast enough.

## Recommended approach

Don't rewrite every callback. Instead:

1. **Add a single utility** `_idleChunked(items, processFn, opts)` to script.js right where `_yieldToMain` is defined.
2. **Wrap only the longest** callback first (likely the mobile-enhancements block).
3. **Measure** with `PerformanceObserver` watching `longtask` entries.
4. **Iterate** wrapping more callbacks if longtasks persist.

## Cost

~50 lines of new code; should be a 30-minute change once the relevant callbacks are identified by line number.

## When to do this

Trigger this when:
- Lighthouse TBT > 200ms on cold load OR
- Long Animation Frames (LoAF) API shows >50ms frames during boot

Today's TBT budget in Lighthouse is set to 400ms (warn). The codebase is comfortably under, so this is a future optimization.

## Verification post-implementation

```js
new PerformanceObserver(list => {
  for (const entry of list.getEntries()) {
    if (entry.duration > 50) console.warn('Long task:', entry);
  }
}).observe({ entryTypes: ['longtask'] });
```

Page load with no console warnings = success.
