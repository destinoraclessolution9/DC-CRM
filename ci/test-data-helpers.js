// Phase 11.3 (partial): unit tests for the extracted pure data-layer helpers.
// data-helpers.js exports via module.exports in Node — no browser globals needed.
const h = require('../data-helpers.js');

let pass = 0, fail = 0;
function eq(name, got, exp) {
  if (got === exp) { pass++; }
  else { fail++; console.error(`FAIL ${name}: got ${JSON.stringify(got)} expected ${JSON.stringify(exp)}`); }
}

// classifyQueueError — the sync-queue routing decision.
eq('dup-code', h.classifyQueueError({ code: '23505' }), 'duplicate');
eq('dup-msg', h.classifyQueueError({ message: 'duplicate key value violates unique' }), 'duplicate');
eq('fk-code', h.classifyQueueError({ code: '23503' }), 'fk');
eq('fk-msg', h.classifyQueueError({ message: 'violates foreign key constraint' }), 'fk');
eq('perm-rls', h.classifyQueueError({ message: 'new row violates row-level security policy' }), 'permanent');
eq('perm-42501', h.classifyQueueError({ code: '42501' }), 'permanent');
eq('perm-42703', h.classifyQueueError({ code: '42703' }), 'permanent');
eq('perm-pgrst204', h.classifyQueueError({ code: 'PGRST204' }), 'permanent');
eq('perm-notnull', h.classifyQueueError({ message: 'violates not-null constraint' }), 'permanent');
eq('transient', h.classifyQueueError({ code: '503', message: 'service unavailable' }), 'transient');
eq('transient-empty', h.classifyQueueError({}), 'transient');
eq('transient-null', h.classifyQueueError(null), 'transient');

// extractUnknownCol
eq('col-find-single', h.extractUnknownCol({ message: "Could not find the 'foo_bar' column of 'x' in the schema cache" }), 'foo_bar');
eq('col-relation', h.extractUnknownCol({ message: 'column "baz" of relation "tbl" does not exist' }), 'baz');
eq('col-does-not-exist', h.extractUnknownCol({ message: 'column "qux" does not exist' }), 'qux');
eq('col-none', h.extractUnknownCol({ message: 'unrelated error' }), null);
eq('col-empty', h.extractUnknownCol({}), null);

// isSchemaError
eq('schema-pgrst204', h.isSchemaError({ code: 'PGRST204' }), true);
eq('schema-42703', h.isSchemaError({ code: '42703' }), true);
eq('schema-cache', h.isSchemaError({ message: 'schema cache reload' }), true);
eq('schema-no', h.isSchemaError({ message: 'connection refused' }), false);

// isAbortError
eq('abort-name', h.isAbortError({ name: 'AbortError' }), true);
eq('abort-msg-abort', h.isAbortError({ message: 'The operation was aborted' }), true);
eq('abort-msg-cancel', h.isAbortError({ message: 'request cancelled' }), true);
eq('abort-code20', h.isAbortError({ code: '20' }), true);
eq('abort-no', h.isAbortError({ message: 'genuine failure' }), false);
eq('abort-null', h.isAbortError(null), false);

// snapshotsDiffer
eq('snap-same', h.snapshotsDiffer([{ id: 1, updated_at: 'a' }], [{ id: 1, updated_at: 'a' }]), false);
eq('snap-same-order', h.snapshotsDiffer([{ id: 1 }, { id: 2 }], [{ id: 2 }, { id: 1 }]), false);
eq('snap-len', h.snapshotsDiffer([{ id: 1 }], [{ id: 1 }, { id: 2 }]), true);
eq('snap-stamp', h.snapshotsDiffer([{ id: 1, updated_at: 'a' }], [{ id: 1, updated_at: 'b' }]), true);
eq('snap-nonarray', h.snapshotsDiffer(null, []), true);

console.log(`\ndata-helpers-test: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
