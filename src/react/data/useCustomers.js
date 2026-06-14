// Phase 4.1 (#13) — React Query data hook over the Customers BFF.
//
// Wraps the existing /api/customers endpoint (server-verified JWT + server-side
// visibility scope) with TanStack Query's caching / dedup / background refetch.
// This is the layer that REPLACES the bespoke delta-sync/tombstone machinery
// (#8) for migrated views — React Query owns the cache, so Phase 3's teardown
// falls out per-view. The session token comes from the existing window.supabase
// client (strangler-fig: the island lives in the same page, shares auth).
import { useQuery } from '@tanstack/react-query';

async function fetchCustomers({ q = '', gua = '', type = '', limit = 50, offset = 0 } = {}) {
    const sb = window.supabase;
    const { data } = sb && sb.auth ? await sb.auth.getSession() : { data: null };
    const token = data && data.session && data.session.access_token;
    if (!token) throw new Error('not authenticated');
    const p = new URLSearchParams();
    p.set('limit', String(limit));
    p.set('offset', String(offset));
    if (q) p.set('q', q);
    if (gua) p.set('gua', gua);
    if (type) p.set('type', type);
    const res = await fetch('/api/customers?' + p.toString(), { headers: { Authorization: 'Bearer ' + token } });
    if (!res.ok) throw new Error('BFF /api/customers ' + res.status);
    return res.json(); // { rows, count }
}

export function useCustomers(params = {}) {
    return useQuery({
        queryKey: ['customers', params],
        queryFn: () => fetchCustomers(params),
        staleTime: 30_000,
        retry: 1,
    });
}
