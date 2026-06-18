// Phase 3 — infinite (windowed) prospects fetch for VirtualizedDataTable.
//
// Same BFF contract as useProspects (GET /api/prospects, server-verified JWT +
// server-side visibility scope → prospects_page RPC), but paged for infinite
// scroll: each page is offset = previous-rows-loaded. Drop-in fetcher for
// VirtualizedDataTable's `fetchPage`. Swapping to keyset later = change the
// fetcher + mode:'cursor' here only; the component stays identical.
import { useInfiniteRows } from '../ui/useInfiniteRows.js';
import { bffError } from './bffError.js';

export async function fetchProspectsPage({ params = {}, pageParam = 0, limit = 50, signal } = {}) {
    const sb = window.supabase;
    const sess = sb && sb.auth ? await sb.auth.getSession() : { data: null };
    const token = sess && sess.data && sess.data.session && sess.data.session.access_token;
    if (!token) throw new Error('not authenticated');
    const p = new URLSearchParams();
    p.set('limit', String(limit));
    p.set('offset', String(pageParam || 0));
    p.set('sort', params.sort || 'score');
    p.set('dir', params.dir || 'desc');
    if (params.q) p.set('q', params.q);
    if (params.gua) p.set('gua', params.gua);
    if (params.agent) p.set('agent', String(params.agent));
    if (params.dormant) p.set('dormant', '1');
    const res = await fetch('/api/prospects?' + p.toString(), {
        headers: { Authorization: 'Bearer ' + token },
        signal,
    });
    if (!res.ok) throw bffError(res.status, 'prospects');
    return res.json(); // { rows, count }
}

export function useProspectsInfinite(params = {}, pageSize = 50) {
    return useInfiniteRows({
        queryKey: ['prospects-infinite', params],
        pageSize,
        mode: 'offset',
        fetchPage: ({ pageParam, signal, limit }) => fetchProspectsPage({ params, pageParam, limit, signal }),
    });
}
