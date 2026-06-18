/**
 * Feng Shui CRM — Data-layer pure helpers (Phase 11.3 partial: separation of concerns).
 *
 * These are the STATELESS classifier/parser functions the DataStore used to carry
 * as instance methods even though they touch no `this` state. Extracting them into
 * a dedicated, independently-testable module decouples the data layer's pure logic
 * from its stateful orchestration (network/cache/sync/queue), per the clean-arch
 * brief. DataStore keeps thin delegator methods (so every existing call site —
 * this._classifyQueueError(e), etc. — is unchanged), but the implementation lives
 * here and is unit-tested directly (ci/test-data-helpers.js).
 *
 * Loaded as a classic script BEFORE data.js (see index.html). No imports, no state.
 */
(function () {
    'use strict';

    // Classify a Supabase/PostgREST write error so the sync queue can decide:
    // duplicate (drop), fk (bounded retry), permanent (park), transient (retry).
    function classifyQueueError(error) {
        const code = String((error && error.code) || '');
        const msg = [error && error.message, error && error.details, error && error.hint]
            .filter(Boolean).join(' ');
        if (code === '23505' || /duplicate key value/i.test(msg)) return 'duplicate';
        // FK violation (23503): the referenced parent row may simply not have
        // synced YET — e.g. an activity created offline replays before its
        // prospect. Dead-lettering it loses the record even though a later pass
        // (once the parent lands) would succeed. Classify as bounded-retry 'fk';
        // the caller retries a few times before parking.
        if (code === '23503' || /violates foreign key constraint/i.test(msg)) return 'fk';
        if (/^22/.test(code) || /^23/.test(code) || code === '42501' || code === '42703' || code === 'PGRST204'
            || /invalid input syntax|violates (not-null|check) constraint|row-level security|schema cache/i.test(msg)) {
            return 'permanent';
        }
        return 'transient';
    }

    // Extract the offending column name from a schema-mismatch error, if any.
    function extractUnknownCol(e) {
        const sources = [e && e.message, e && e.details, e && e.hint, e && e.error].filter(Boolean).join(' ');
        if (!sources) return null;
        // PostgREST/Supabase: "Could not find the 'col' column of 'table' in the schema cache"
        return (sources.match(/find the '(\w+)' column/) || [])[1]
            || (sources.match(/find the "(\w+)" column/) || [])[1]
            // PostgreSQL: column "col" of relation / column "col" does not exist
            || (sources.match(/column "?(\w+)"? of relation/) || [])[1]
            || (sources.match(/column "?(\w+)"? does not exist/) || [])[1]
            || null;
    }

    // True when the error is a schema-cache / unknown-column mismatch (→ retry with '*').
    function isSchemaError(e) {
        const s = [e && e.code, e && e.message, e && e.details].filter(Boolean).join(' ');
        return /PGRST204|42703|schema cache|does not exist|could not find/i.test(s);
    }

    // True when a read was aborted by abortInflight() (view-change) — not a real error.
    function isAbortError(err) {
        if (!err) return false;
        if (err.name === 'AbortError') return true;
        const msg = String(err.message || err.toString() || '').toLowerCase();
        return msg.includes('abort') || msg.includes('cancel') || err.code === '20';
    }

    // Cheap structural diff of two row snapshots (id + modified-stamp fingerprint)
    // used by SWR to decide whether a background refresh changed anything.
    function snapshotsDiffer(a, b) {
        if (!Array.isArray(a) || !Array.isArray(b)) return true;
        if (a.length !== b.length) return true;
        const fingerprint = (arr) =>
            arr.map(r => `${r.id}:${r.updated_at || r.created_at || r.modified_at || ''}`)
               .sort().join('|');
        return fingerprint(a) !== fingerprint(b);
    }

    const api = { classifyQueueError, extractUnknownCol, isSchemaError, isAbortError, snapshotsDiffer };
    // Browser global (loaded before data.js). Also export for Node tests.
    if (typeof window !== 'undefined') window._dataHelpers = api;
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
