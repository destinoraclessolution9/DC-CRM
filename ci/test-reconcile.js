// Phase 11.1 verification: prove DataStore._reconcile (the new synchronous
// read-path merge) is byte-identical to _autoSync's NON-network merge for the
// common case (empty queue) and behaves correctly for pending/tombstoned/ghost
// queue items. Loads the REAL data.js in Node with mocked browser globals.
const fs = require('fs');
const path = require('path');

// ── Browser-global mocks ────────────────────────────────────────────────────
const _store = new Map();
global.localStorage = {
  getItem: (k) => (_store.has(k) ? _store.get(k) : null),
  setItem: (k, v) => _store.set(k, String(v)),
  removeItem: (k) => _store.delete(k),
  clear: () => _store.clear(),
};
global.window = {};
global.navigator = { onLine: true };
global.document = { addEventListener() {}, readyState: 'complete' };
global.setInterval = () => 0;
global.addEventListener = () => {};
// AbortController is native in Node 16+.

// ── Load the real data.js (defines DataStore, sets window.AppDataStore) ───────
const src = fs.readFileSync(path.join(__dirname, '..', 'data.js'), 'utf8');
// eslint-disable-next-line no-eval
eval(src);
const ds = global.window.AppDataStore;
if (!ds || typeof ds._reconcile !== 'function') {
  console.error('FAIL: could not load DataStore / _reconcile not found');
  process.exit(1);
}

// ── Test harness ──────────────────────────────────────────────────────────────
let pass = 0, fail = 0;
const setQueue = (items) => localStorage.setItem('fs_crm_sync_queue', JSON.stringify(items));
const setTomb = (obj) => localStorage.setItem('fs_crm_tombstones', JSON.stringify(obj));
const setLocal = (t, rows) => localStorage.setItem('fs_crm_' + t, JSON.stringify(rows));
const reset = () => _store.clear();
const sortById = (arr) => [...arr].sort((a, b) => String(a.id).localeCompare(String(b.id)));
function eq(name, got, exp) {
  const ok = JSON.stringify(sortById(got)) === JSON.stringify(sortById(exp));
  if (ok) { pass++; }
  else { fail++; console.error(`FAIL ${name}\n  got: ${JSON.stringify(got)}\n  exp: ${JSON.stringify(exp)}`); }
}

// 1. EMPTY QUEUE (common case) → returns serverData unchanged (byte-identical to
//    _autoSync's empty-queue output: merged=[...serverData], no Step-2, no local).
reset();
const sd1 = [{ id: 1, full_name: 'Alice' }, { id: 2, full_name: 'Bob' }];
eq('empty-queue=serverData', ds._reconcile('prospects', sd1), sd1);

// 2. EMPTY QUEUE + local-only extra field → re-merged (mirrors _autoSync Step 3).
reset();
setLocal('prospects', [{ id: 1, full_name: 'Alice', potential_level: 'hot' }]);
eq('empty-queue+localExtra', ds._reconcile('prospects', [{ id: 1, full_name: 'Alice' }]),
  [{ id: 1, full_name: 'Alice', potential_level: 'hot' }]);

// 3. PENDING item (not on server, not pushed) → optimistically included.
reset();
setQueue([{ tableName: 'prospects', record: { id: 99, full_name: 'Pending' } }]);
eq('pending-included', ds._reconcile('prospects', [{ id: 1, full_name: 'Alice' }]),
  [{ id: 1, full_name: 'Alice' }, { id: 99, full_name: 'Pending' }]);

// 4. Pending item that IS already on server → not duplicated.
reset();
setQueue([{ tableName: 'prospects', record: { id: 1, full_name: 'Alice' } }]);
eq('confirmed-not-duplicated', ds._reconcile('prospects', [{ id: 1, full_name: 'Alice' }]),
  [{ id: 1, full_name: 'Alice' }]);

// 5. Tombstoned pending item → excluded.
reset();
setQueue([{ tableName: 'prospects', record: { id: 50, full_name: 'Deleted' } }]);
setTomb({ prospects: ['50'] });
eq('tombstoned-excluded', ds._reconcile('prospects', [{ id: 1, full_name: 'Alice' }]),
  [{ id: 1, full_name: 'Alice' }]);

// 6. GHOST (pushed before, now missing from server) → excluded (the incident class).
reset();
setQueue([{ tableName: 'prospects', record: { id: 77, full_name: 'Ghost' }, pushed: true }]);
eq('ghost-excluded', ds._reconcile('prospects', [{ id: 1, full_name: 'Alice' }]),
  [{ id: 1, full_name: 'Alice' }]);

// 7. Queue item for a DIFFERENT table → ignored.
reset();
setQueue([{ tableName: 'customers', record: { id: 5, full_name: 'OtherTable' } }]);
eq('other-table-ignored', ds._reconcile('prospects', [{ id: 1, full_name: 'Alice' }]),
  [{ id: 1, full_name: 'Alice' }]);

// 8. Corrupt queue JSON → falls back to serverData (never throws).
reset();
localStorage.setItem('fs_crm_sync_queue', '{not valid json');
eq('corrupt-queue-safe', ds._reconcile('prospects', sd1), sd1);

console.log(`\nreconcile-test: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
