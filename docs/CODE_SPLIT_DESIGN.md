# script.js Code-Split Design

**Status:** design only — implementation deferred to dedicated session
**Created:** 2026-05-31
**Owner:** TBD
**Source:** Tier 2 #13 from 20-suggestion perf plan

## Problem

`script.js` is **51,660 lines / ~3.32 MB** (un-minified) loaded on every page.
Production `script.min.js` is **~2.29 MB**. On a slow mobile CPU, parse + compile
of 2.29 MB of JS costs ~2–4 s on cold load — the biggest single mobile-cold-start
latency remaining after this session's work.

## Constraints

The codebase has architectural shape that makes naive code-splitting non-trivial:

1. **Single IIFE.** All app logic lives inside `const appLogic = (() => { ... })()`
   at script.js:~1. Functions share closures over module-level state
   (`_currentUser`, `_cache`, `_currentView`, helpers like `isAgent`, `UI`,
   `AppDataStore`, etc.). Naively moving a function out of the IIFE loses access
   to those closures.

2. **Single `window.app` surface.** The IIFE returns an object that gets exposed
   as `window.app` at script.js:~53800. HTML uses inline `onclick="app.X(id)"`
   — so any function reachable from HTML *must* be on `window.app` at the
   moment the user clicks the button.

3. **Vanilla JS, no bundler.** Loading is via `<script defer src="...">` tags
   in `index.html`. No ESM, no webpack, no Rollup. Files are minified via the
   existing build pipeline (`*.min.js` files committed alongside originals).

4. **Production already optimized.** Service Worker (commit 4cc6a1d), minified
   bundles (e6829ad), async non-critical CSS (b5a5711), `fetchpriority="low"`
   on the main script (1665f3a), cache headers, brotli. Code split is the
   remaining win.

## Approach options

### Option A — Lazy-load feature modules (recommended)

Extract self-contained feature areas (Knowledge HQ, Marketing Automation,
Stock Take, Egg Purchasing, Reports) into separate `.js` files. Each file:

- Is a standalone IIFE that does NOT access main-IIFE closures directly
- Instead reads shared state through stable globals: `window.AppDataStore`,
  `window.UI`, `window._currentUser`, `window._crmUtils` (already populated by
  main IIFE at script.js:517)
- Attaches its public functions to `window.app` after loading
- Is loaded via dynamic `<script>` injection on first navigation to that view

```js
// In main script.js (NEW)
const _chunkLoaders = {
  'knowledge-hq': () => _loadScriptOnce('chunks/knowledge-hq.min.js'),
  'marketing-automation': () => _loadScriptOnce('chunks/marketing-automation.min.js'),
  'stock-take': () => _loadScriptOnce('chunks/stock-take.min.js'),
  // ...
};

const showView = async (viewId) => {
  const loader = _chunkLoaders[viewId];
  if (loader) await loader();  // already deduplicated by _loadScriptOnce
  // ...existing render logic...
};
```

```js
// In chunks/knowledge-hq.js (NEW)
(() => {
  // All Knowledge HQ functions go here. Read shared state via window.X.
  const showKnowledgeHQ = async () => {
    const u = window._currentUser;
    const data = await window.AppDataStore.getAll('knowledge_entries');
    // ...
  };
  // Attach to app surface
  Object.assign(window.app, {
    showKnowledgeHQ,
    saveKnowledgeEntry,
    // ...everything HTML calls via app.X
  });
})();
```

**Pros:**
- No bundler needed
- Existing `_loadScriptOnce` helper already does dedup + caching
- Each chunk is small enough to verify independently
- Originals can stay in script.js as commented-out backup during transition

**Cons:**
- Each extracted chunk must be carefully audited for hidden closure access
- Initial nav to extracted feature has +1 network round-trip (mitigated by
  prefetch on hover)

### Option B — Convert to ESM with dynamic import (heavier)

Refactor to `<script type="module">` + native `import()`. Cleaner long-term
but a much bigger refactor. Defer until after Option A is proven.

### Option C — Server-side route splitting (out of scope)

Would require switching from static SPA to a framework. Not on the roadmap.

## Recommended chunk plan (size estimates from script.js audit)

Best candidates ordered by ROI (largest, most isolated, least-used first):

| Chunk | Approx LOC | Used by | Notes |
|---|---|---|---|
| `chunks/knowledge-hq.js` | ~5,600 | All roles, but rarely | Largest single chunk; users navigate to it deliberately |
| `chunks/marketing-automation.js` | ~4,500 | L1 + L2 only | Behind permission gate; majority of users never load |
| `chunks/reports-kpi.js` | ~4,000 | L1-L5 | Dashboard analytics — not on critical path |
| `chunks/pipeline.js` | ~3,500 | L3+ | Vertical feature; clear nav boundary |
| `chunks/activities-modal.js` | ~3,900 | All | Modal-on-demand; could defer until first activity open |
| `chunks/stock-take.js` | ~1,700 | L1 + L15 | Already mostly self-contained |
| `chunks/agents-admin.js` | ~2,100 | L1-L4 | Admin feature |
| `chunks/referrals.js` | ~2,300 | All | Conditional |

Realistic phase plan (1 chunk per dedicated session):

1. **Phase 1 (pick the easiest):** Extract `stock-take` first (1,700 LOC,
   self-contained, already has clear `_st*` helper prefix). Use this to
   validate the extraction pattern + build pipeline changes.
2. **Phase 2:** Extract `knowledge-hq` (biggest single win).
3. **Phase 3:** Extract `marketing-automation` (biggest privilege gate).
4. **Phase 4+:** Reports, Pipeline, Agents.

After all phases: initial `script.min.js` shrinks from ~2.29 MB to roughly
**1 MB** core + on-demand chunks. Mobile cold-start parse drops ~50%.

## Build pipeline changes needed

The existing minifier (whatever produces `script.min.js`) needs to learn:

- New `chunks/*.js` sources alongside `script.js`
- Emit `chunks/*.min.js` for each
- `index.html` needs no changes (chunks are loaded dynamically by `showView`)

## Validation plan per phase

For each extracted chunk:

1. **Pre-extract**: grep every `app.X()` call in HTML for the chunk's feature.
   Confirm all `X` are present in the chunk's `Object.assign(window.app, ...)`
   block.
2. **Pre-extract**: grep every closure-captured variable referenced by chunk
   functions. Confirm each is exposed on `window.X` or move it explicitly.
3. **Post-extract**: full smoke test of every feature still in the main IIFE
   PLUS every feature in the extracted chunk.
4. **Post-extract**: Lighthouse score before/after on a slow-mobile profile.
   Target: ≥20% faster Time-to-Interactive.

## Open questions

- **Build pipeline**: where is `script.min.js` actually generated? Need to find
  the script (Vercel build step? local npm script?) before defining the chunk
  build step.
- **Service worker**: cached chunks need cache-key rotation when the version
  string in `index.html` bumps. Verify the SW cache strategy handles
  dynamically-loaded chunks.
- **Sentry/error reporting**: stack traces from dynamically-loaded chunks need
  source-map registration to be useful. Verify.

## Not in this design

- HTTP/2 push of chunks (browser-level optimization, separate concern)
- Tree-shaking of dead code within chunks (separate optimization)
- Removing duplicate helpers (would solve some closure issues but invasive)
