// Phase 4.3 (#13) — React Query data hook over the Prospects BFF.
//
// Mirrors useCustomers. Wraps GET /api/prospects (server-verified JWT +
// server-side visibility scope → prospects_page RPC: dormancy + filter + sort +
// page) with TanStack Query caching/dedup/background refetch. This is the data
// layer the Prospects React island will use; React Query owns the cache, which
// is what lets Phase 3 retire the bespoke sync for the prospects view once it
// migrates. The session token comes from the existing window.supabase client.
import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { bffError, bffRetry } from './bffError.js';

async function fetchProspects({ q = '', gua = '', agent = '', sort = 'score', dir = 'desc', dormant = false, limit = 50, offset = 0 } = {}) {
    const sb = window.supabase;
    const { data } = sb && sb.auth ? await sb.auth.getSession() : { data: null };
    const token = data && data.session && data.session.access_token;
    // No token yet = TRANSIENT auth-bootstrap state, not a hard failure. Throw a
    // classified retryable error (409, like the BFF's caller_unresolved race) so
    // bffRetry retries it and the views treat it as recoverable rather than fatal.
    if (!token) throw bffError(409, 'prospects');
    const p = new URLSearchParams();
    p.set('limit', String(limit));
    p.set('offset', String(offset));
    p.set('sort', sort);
    p.set('dir', dir);
    if (q) p.set('q', q);
    if (gua) p.set('gua', gua);
    if (agent) p.set('agent', String(agent));
    if (dormant) p.set('dormant', '1');
    const res = await fetch('/api/prospects?' + p.toString(), { headers: { Authorization: 'Bearer ' + token } });
    if (!res.ok) throw bffError(res.status, 'prospects');
    return res.json(); // { rows, count }
}

export function useProspects(params = {}) {
    return useQuery({
        queryKey: ['prospects', params],
        queryFn: () => fetchProspects(params),
        staleTime: 30_000,
        retry: bffRetry,
        placeholderData: keepPreviousData,
    });
}
