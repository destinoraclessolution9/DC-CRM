// Phase 2 (#11) — thin browser adapter for the BFF (/api/*). Attaches the
// current Supabase access token and returns parsed JSON. Exposed as
// window.ApiClient. The customers list flips to this once the endpoint is
// verified (SUPABASE_SECRET_KEY set in Vercel env). Until then nothing calls it.
(function () {
    async function _authHeader() {
        try {
            const { data } = await window.supabase.auth.getSession();
            const token = data && data.session && data.session.access_token;
            return token ? { Authorization: 'Bearer ' + token } : {};
        } catch (_) {
            return {};
        }
    }

    // GET /api/customers — server-verified, server-scoped, keyset-paginated.
    // opts: { cursor=0 (last id seen), limit=50, q='', gua='' }
    // returns { rows: [...], nextCursor: number|null }  (throws on non-2xx)
    async function getCustomers(opts = {}) {
        const { cursor = 0, limit = 50, q = '', gua = '' } = opts;
        const params = new URLSearchParams();
        if (cursor) params.set('cursor', String(cursor));
        if (limit) params.set('limit', String(limit));
        if (q) params.set('q', q);
        if (gua) params.set('gua', gua);
        const res = await fetch('/api/customers?' + params.toString(), {
            headers: await _authHeader(),
        });
        if (!res.ok) {
            const body = await res.json().catch(() => ({}));
            throw new Error('BFF /api/customers ' + res.status + (body.error ? ' ' + body.error : ''));
        }
        return res.json();
    }

    window.ApiClient = { getCustomers };
})();
