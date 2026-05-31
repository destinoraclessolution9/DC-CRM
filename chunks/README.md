# CRM Lazy-Load Chunks

This directory holds feature-area JS modules loaded on-demand by `navigateTo()`.

## Pattern (from docs/CODE_SPLIT_DESIGN.md — Option A)

Each chunk is a self-contained IIFE that:
1. Reads shared state through **stable globals** only: `window.AppDataStore`, `window.UI`, `window._currentUser`, `window._crmUtils`
2. Attaches its public functions to `window.app` via `Object.assign(window.app, { ... })`
3. Is fetched once via `_loadChunkOnce(viewId)` in `navigateTo()`, then cached

## Loader in script.js

```js
const _chunkLoaders = {
    'knowledge': () => _loadChunkOnce('knowledge'),
    // 'stock_take': () => _loadChunkOnce('stock_take'),  // next step
    // 'reports':   () => _loadChunkOnce('reports'),
};
```

The loader is wired into `navigateTo()` before `_loadFeatures()`. Once all
chunks are extracted, `script-features.js` can be eliminated entirely.

## Chunks planned

| View              | Source lines | Status     |
|-------------------|-------------|------------|
| stock_take        | ~1,428      | Pending — dependencies audit required (many IIFE closures; see design doc) |
| knowledge         | ~800        | Next candidate — reads only AppDataStore + UI |
| egg_purchasing    | ~600        | After knowledge |
| reports           | ~1,200      | After stock_take pattern is validated |
| marketing_auto    | ~900        | After reports  |

## Status

Infrastructure scaffolded (build pipeline, loader, chunks/ dir). 
First real chunk extraction needs a dedicated session to audit IIFE closure deps.
