// Shared BFF error classifier for the /api/* React-Query hooks.
//
// Turns an HTTP status from the prospects/customers BFF into a single Error with
// a human-readable .message + a numeric .status and a .retryable flag the views
// can branch on. The point: distinguish a REAL auth failure (401/403 → the
// session is genuinely expired, refresh to re-auth) from a TEMPORARY backend
// outage (502/503/504/408/429 → Supabase is overloaded/down, keep cached data
// and retry). Before this, every non-2xx surfaced as a raw "BFF /api/x 401",
// which made the 2026-06-16 Supabase compute outage look like an auth bug.
export function bffError(status, what) {
    const msg =
        (status === 401 || status === 403)
            ? 'Your session expired — refresh the page to sign in again.'
        : (status === 502 || status === 503 || status === 504 || status === 408 || status === 429)
            ? 'Server temporarily unavailable — retrying. Showing cached data where available.'
        : status === 409
            ? 'Finishing sign-in — retrying…'
            : `Couldn't load ${what} (error ${status}).`;
    const e = new Error(msg);
    e.status = status;
    // Anything that isn't a genuine token rejection is worth retrying.
    e.retryable = status !== 401 && status !== 403;
    return e;
}

// React Query retry predicate: never retry a genuine auth failure (pointless,
// just hammers a dead token). Give deliberately-transient/race statuses a larger
// retry budget: 409 ('caller_unresolved' SW-activation/uid-resolution race) and
// 408/429/5xx (backend overload/outage) can span a couple seconds / several
// fetches during a cold-boot reload — a single retry can exhaust before the uid
// resolves and park the view on the 'Finishing sign-in — retrying…' error state.
// Everything else (unknown/4xx) keeps the original single-retry behaviour.
export function bffRetry(failureCount, err) {
    if (err && (err.status === 401 || err.status === 403)) return false;
    const s = err && err.status;
    const isTransient = s === 409 || s === 408 || s === 429 || (s >= 500 && s <= 599);
    if (isTransient) return failureCount < 3;
    return failureCount < 1;
}
