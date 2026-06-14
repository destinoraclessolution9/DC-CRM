/**
 * Phase 0 (#10) — data-layer contract tests.
 *
 * Locks the offline-queue + sync classification logic in data.js — the exact
 * code behind the 2026-06-11 cache-wipe incident and the FK-retry fix. Runs in
 * a sandboxed VM with minimal browser stubs (no live Supabase needed).
 *
 *   node --test tests/contract/
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

// ── Minimal browser environment sufficient to LOAD data.js ───────────────────
function loadDataStore() {
  const store = new Map();
  const localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
    clear: () => store.clear(),
    key: (i) => [...store.keys()][i] ?? null,
    get length() { return store.size; },
  };
  const noop = () => {};
  const docStub = {
    addEventListener: noop, removeEventListener: noop,
    getElementById: () => null, querySelector: () => null, querySelectorAll: () => [],
    createElement: () => ({ style: {}, setAttribute: noop, appendChild: noop }),
    body: { appendChild: noop }, head: { appendChild: noop },
    documentElement: { style: {} }, visibilityState: 'visible',
  };
  const winTarget = {
    localStorage,
    navigator: { onLine: true, serviceWorker: { addEventListener: noop, ready: Promise.resolve() } },
    document: docStub,
    addEventListener: noop, removeEventListener: noop, dispatchEvent: noop,
    location: { href: 'http://localhost/', origin: 'http://localhost' },
    setTimeout, clearTimeout, setInterval, clearInterval,
    crypto: { randomUUID: () => '00000000-0000-4000-8000-000000000000' },
    fetch: async () => ({ ok: false, json: async () => ({}) }),
    console,
  };
  // Proxy absorbs reads of not-yet-stubbed globals (window.supabase, window.Perf,
  // window.UI, …) as undefined instead of throwing at load time.
  const win = new Proxy(winTarget, {
    get: (t, p) => (p in t ? t[p] : undefined),
    set: (t, p, v) => { t[p] = v; return true; },
    has: () => true,
  });
  const sandbox = {
    window: win, globalThis: win, self: win,
    localStorage, document: docStub, navigator: winTarget.navigator,
    console, setTimeout, clearTimeout, setInterval, clearInterval,
    crypto: winTarget.crypto, fetch: winTarget.fetch,
    structuredClone: (x) => JSON.parse(JSON.stringify(x)),
  };
  const code = readFileSync(fileURLToPath(new URL('../../data.js', import.meta.url)), 'utf8');
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox, { filename: 'data.js' });
  return win.AppDataStore;
}

let ds;
try { ds = loadDataStore(); } catch (e) {
  // Surface load failure as a real signal — data.js should be VM-loadable so it
  // stays testable. If it isn't, that is itself a Phase 4 refactor finding.
  test('data.js loads in a sandbox', () => { throw e; });
}

test('AppDataStore exposes its public surface', () => {
  assert.ok(ds, 'window.AppDataStore is defined after load');
  for (const m of ['getAll', 'queryAdvanced', 'create', 'update', 'delete']) {
    assert.equal(typeof ds[m], 'function', `AppDataStore.${m} exists`);
  }
});

test('_classifyQueueError: 23505 duplicate', () => {
  assert.equal(ds._classifyQueueError({ code: '23505', message: 'duplicate key value' }), 'duplicate');
});

test('_classifyQueueError: 23503 FK is bounded-retry "fk", NOT permanent', () => {
  // The fix: an offline child row queued before its parent must retry, not die.
  assert.equal(ds._classifyQueueError({ code: '23503', message: 'violates foreign key constraint' }), 'fk');
  assert.equal(ds._classifyQueueError({ message: 'insert ... violates foreign key constraint "x"' }), 'fk');
});

test('_classifyQueueError: other constraint/permission errors stay permanent', () => {
  assert.equal(ds._classifyQueueError({ code: '23502', message: 'null value violates not-null constraint' }), 'permanent');
  assert.equal(ds._classifyQueueError({ code: '42501', message: 'row-level security' }), 'permanent');
  assert.equal(ds._classifyQueueError({ code: '42703', message: 'column does not exist' }), 'permanent');
});

test('_classifyQueueError: network/5xx is transient', () => {
  assert.equal(ds._classifyQueueError({ message: 'Failed to fetch' }), 'transient');
  assert.equal(ds._classifyQueueError({ code: '503', message: 'service unavailable' }), 'transient');
});

test('_snapshotsDiffer: detects add/remove/update, ignores reorder', () => {
  const a = [{ id: 1, updated_at: 't1' }, { id: 2, updated_at: 't2' }];
  assert.equal(ds._snapshotsDiffer(a, [{ id: 2, updated_at: 't2' }, { id: 1, updated_at: 't1' }]), false, 'reorder = same');
  assert.equal(ds._snapshotsDiffer(a, [{ id: 1, updated_at: 't1' }]), true, 'removed row differs');
  assert.equal(ds._snapshotsDiffer(a, [{ id: 1, updated_at: 'tX' }, { id: 2, updated_at: 't2' }]), true, 'updated row differs');
});
