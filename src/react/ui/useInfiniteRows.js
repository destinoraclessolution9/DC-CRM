// Phase 3 — generic infinite pager over TanStack Query (already a dependency).
//
// fetchPage({ pageParam, signal, limit }) => { rows, count, nextCursor? }.
//  - mode 'offset' (default): pageParam is the row offset; the next offset is
//    derived from rows-loaded-so-far vs count (works against the existing
//    /api/prospects offset endpoint with ZERO new server work).
//  - mode 'cursor': pageParam is an opaque cursor; getNextPageParam reads
//    page.nextCursor (ready for the future prospects_page_keyset RPC, which
//    makes deep scroll O(1) instead of OFFSET's O(n) — wire it by swapping the
//    fetcher + mode, no component change).
//
// Returns the query plus flattened `rows` and the server `count`.
import { useInfiniteQuery, keepPreviousData } from '@tanstack/react-query';

export function useInfiniteRows({ queryKey, fetchPage, pageSize = 50, mode = 'offset', staleTime = 30_000, enabled = true }) {
    const q = useInfiniteQuery({
        queryKey,
        queryFn: ({ pageParam, signal }) => fetchPage({ pageParam, signal, limit: pageSize }),
        initialPageParam: mode === 'cursor' ? null : 0,
        getNextPageParam: (lastPage, allPages) => {
            if (mode === 'cursor') return lastPage && lastPage.nextCursor != null ? lastPage.nextCursor : undefined;
            // Stop if the last page returned no rows, even when loaded < count.
            // A count/rows mismatch (RLS post-count filtering, a stale over-count,
            // or an empty page) would otherwise pin the offset and keep hasNextPage
            // true forever, producing an unbounded refetch loop that hammers the API.
            if (!lastPage || !lastPage.rows || lastPage.rows.length === 0) return undefined;
            const loaded = allPages.reduce((n, p) => n + (p && p.rows ? p.rows.length : 0), 0);
            const total = (lastPage && lastPage.count) || 0;
            return loaded < total ? loaded : undefined; // next offset
        },
        staleTime,
        placeholderData: keepPreviousData,
        enabled,
    });
    const rows = q.data ? q.data.pages.flatMap((p) => (p && p.rows) || []) : [];
    const count = q.data && q.data.pages[0] ? (q.data.pages[0].count || 0) : 0;
    return Object.assign(q, { rows, count });
}
