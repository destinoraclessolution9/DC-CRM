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
        // DOMException.ABORT_ERR === 20. A native DOMException exposes `code` as
        // the NUMBER 20, so the string compare alone never matches a real abort —
        // accept both the numeric and string forms.
        if (err.code === 20 || err.code === '20') return true;
        // A real server-side failure carries a Postgres/PostgREST error code (e.g.
        // statement timeout 57014 → "canceling statement due to statement timeout",
        // failed transaction 25P02 → "current transaction is aborted"). Those
        // messages contain 'cancel'/'abort' but must NOT be treated as harmless
        // client aborts, or _getInRange would return a partial page as a complete
        // result. Only fall back to substring matching when there is no such code.
        const code = String((err && err.code) || '');
        if (code && /^\d/.test(code)) return false;
        const msg = String(err.message || err.toString() || '').toLowerCase();
        return msg.includes('abort') || msg.includes('cancel');
    }

    // Stable content hash of a row's scalar fields — used as the fingerprint
    // fallback when a row carries NO modified-stamp. Some tables (data.js
    // _NO_DELTA_TABLES: special_program_participants, cps_intake_requests,
    // pipeline_config, pipeline_config_history) lack updated_at/created_at/
    // modified_at entirely, so an `id:` stamp degrades to a constant and an
    // in-place field edit (same id, same length, no bumped timestamp) would be
    // invisible — suppressing the SWR view refresh. Serializing the row's
    // sorted scalar columns makes such edits detectable. Objects/arrays are
    // skipped (cheap, deterministic, avoids deep-walk cost on hot SWR path).
    function rowContentHash(r) {
        if (!r || typeof r !== 'object') return String(r);
        return Object.keys(r).sort().map(k => {
            const v = r[k];
            if (v === null || v === undefined) return `${k}=`;
            const t = typeof v;
            if (t === 'object') return `${k}=~`; // skip nested objects/arrays
            return `${k}=${v}`;
        }).join(',');
    }

    // Cheap structural diff of two row snapshots used by SWR to decide whether a
    // background refresh changed anything. Fingerprints each row by id + its
    // last-modified stamp; for rows that expose NO modified-stamp it falls back
    // to a content hash of the row's scalar fields so a server-side field edit
    // on a timestamp-less table (same id, same length, no bumped timestamp) is
    // still detected instead of silently compared equal.
    function snapshotsDiffer(a, b) {
        if (!Array.isArray(a) || !Array.isArray(b)) return true;
        if (a.length !== b.length) return true;
        const fingerprint = (arr) =>
            arr.map(r => {
                const stamp = r && (r.updated_at || r.created_at || r.modified_at);
                // No modified-stamp → fall back to a content-aware hash so
                // in-place edits on timestamp-less tables aren't missed.
                return stamp ? `${r.id}:${stamp}` : `${r && r.id}:#${rowContentHash(r)}`;
            }).sort().join('|');
        return fingerprint(a) !== fingerprint(b);
    }

    const api = { classifyQueueError, extractUnknownCol, isSchemaError, isAbortError, snapshotsDiffer };
    // Browser global (loaded before data.js). Also export for Node tests.
    if (typeof window !== 'undefined') window._dataHelpers = api;
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
