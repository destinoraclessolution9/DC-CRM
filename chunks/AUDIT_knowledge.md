# Knowledge HQ chunk — extraction runbook

**Status:** Audit complete; extraction itself **deferred** to a dedicated session per project precedent.
**Source location:** `script-features.js` lines ~7693–8328 (~635 lines)
**Target file:** `chunks/script-knowledge.min.js`
**Created:** 2026-06-01

## Why this audit instead of doing the extraction

The prior commit (`b9c3083 perf(phase-f)`) explicitly scoped per-view chunk extraction as needing a dedicated session, citing "IIFE closure deps audit required." This document is that audit, executable in the next session.

## Surface

Public entrypoint (called from `navigateTo`):
- `window._fv.showKnowledgeView(container)`

App-callable functions (HTML inline `onclick="app.X(...)"`):
- `app.showKnowledgeDetail(id)`
- `app.kbBackToList()`
- `app.kbEditCurrent()` / `app.kbSaveEdit()` / `app.kbCancelEdit()`
- `app.kbAddLink(toId)` / `app.kbRemoveLink(linkId)`
- `app.addKnowledgeLink(fromId, toId)`
- `app.kbSetSegment(seg)`
- `app.kbSetDailyDate(iso)`
- `app.searchKnowledgeEntries(q)`
- Plus any others discovered by grepping HTML strings for `app.kb*` or `app.showKnowledge*`

**Action for next session:** run `grep -nE "app\.(showKnowledge|kb[A-Z])" script.js script-features.js` to enumerate the full app-surface — every name must end up in the chunk's `Object.assign(window.app, { ... })` call.

## Internal (chunk-local) helpers

These move WITH the public entrypoint and stay local to the chunk:
- `_kbTypeIcon`, `_kbTypeLabel` — pure helpers
- `_kbReloadDashboard`, `_kbReloadAll` — re-render helpers
- `showKnowledgeDashboard`, `showKnowledgeCapture`, `showKnowledgeAllEntries`, `showKnowledgeDailyNotes`, `showKnowledgeDetail` — sub-views

No conflict; these are only called from within the knowledge view code itself.

## External dependencies (must be available as stable globals)

Verified in current `script-features.js`:

| Dependency | Source | Already global? |
|---|---|---|
| `window.AppDataStore` | data.js | ✅ |
| `window.UI.toast` / `window.UI.showModal` / `window.UI.hideModal` | ui.js | ✅ |
| `window._currentUser` | script.js (login flow) | ✅ |
| `window._appState.kbSegment` / `kbCurrentEntryId` / `kbDailyDate` | script.js (state bag) | ✅ |
| `escapeHtml` | exposed at script.js:960 — "Expose escapeHtml globally so script-features.js can use it" | ✅ |
| `window._crmUtils.*` (role helpers) | script.js:517 | ✅ (knowledge doesn't appear to use these) |

**Action for next session:** confirm `escapeHtml` is on `window` (not just hoisted in the IIFE that script-features.js executes inside) — if it's only IIFE-local in script.js, it must be promoted to `window.escapeHtml` first.

## Build pipeline changes needed

1. `build.mjs` already iterates `chunks/*.js`. Verify it does (read the build script first).
2. If it doesn't, add: glob `chunks/*.js`, minify each, emit `chunks/*.min.js` + brotli + hashed copy.
3. Add to `dist-manifest.json` so `_loadChunkOnce` can resolve the hashed name.

## Wiring change

Replace the commented-out registry entry in `script.js:11543`:

```js
const _CHUNK_VIEWS = {
    'knowledge': 'chunks/script-knowledge.min.js',
    // 'stock_take': ...
};
```

Then **remove** the knowledge code block from `script-features.js` (lines ~7693–8328) so it isn't double-loaded.

## Smoke test plan

1. Confirm dev server serves `chunks/script-knowledge.min.js` (HTTP 200).
2. Navigate to Knowledge HQ from sidebar — verify chunk is fetched (Network tab) and view renders.
3. Navigate away and back — chunk is fetched ONCE (cached after first load).
4. Open a knowledge detail, edit, save — full CRUD path works.
5. Search — `app.searchKnowledgeEntries` callable.
6. Verify `window._appFeaturesLoaded` is still being set correctly even with knowledge removed from features bundle.

## Rollback

If anything breaks, revert the wiring change (one-line removal from `_CHUNK_VIEWS`) and rebuild — knowledge code is still in `script-features.js` since the removal hasn't been committed.

## Size estimate

| Stage | Approx size |
|---|---|
| `chunks/script-knowledge.js` (source) | ~30 KB |
| `chunks/script-knowledge.min.js` (after esbuild minify) | ~12 KB |
| `chunks/script-knowledge.min.js.br` (brotli-11) | ~3.5 KB |
| `script-features.js` shrinkage | -30 KB source / -12 KB minified |

Worth it: ~9 KB shaved off `script-features.min.js` cold-load for users who never visit Knowledge HQ (most non-L1 staff). Smaller relative win than the original code-split since the features bundle is already lazy-loaded; this is a second-order optimization.

## Sequencing for follow-up chunks

Per `chunks/README.md`, after knowledge:
1. `egg_purchasing` (~600 lines, L1-only feature → biggest cold-load win for non-admin users)
2. `stock_take` (~1428 lines, but heavy IIFE closures — needs deeper audit)
3. `reports` (~1200 lines)
4. `marketing_auto` (~900 lines)
