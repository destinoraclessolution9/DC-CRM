// Phase 3 — virtualized infinite list (non-table sibling of VirtualizedDataTable).
// Same windowing engine + server pager; the consumer supplies renderItem.
// Use for card/feed layouts (mobile prospect cards, activity feeds) that must
// scale to 300k items without rendering them all.
import { useRef, useEffect } from 'react';
import { useInfiniteRows } from './useInfiniteRows.js';
import { useWindowedRows } from './useWindowedRows.js';
import { EmptyState } from './EmptyState.jsx';
import { ErrorState } from './ErrorState.jsx';

export function InfiniteList({
    queryKey,
    fetchPage,
    renderItem,
    renderSkeleton,
    pageSize = 50,
    mode = 'offset',
    itemHeight = 64,
    overscan = 8,
    height = 600,
    getItemId = (r) => r.id,
    empty,
    ariaLabel = 'List',
}) {
    const scrollRef = useRef(null);
    const {
        rows, count, isLoading, isError, error,
        fetchNextPage, hasNextPage, isFetchingNextPage, refetch,
    } = useInfiniteRows({ queryKey, fetchPage, pageSize, mode });

    const { start, end, padTop, padBottom } = useWindowedRows({ scrollRef, rowCount: rows.length, rowHeight: itemHeight, overscan });

    useEffect(() => {
        if (hasNextPage && !isFetchingNextPage && rows.length > 0 && end >= rows.length - overscan) {
            fetchNextPage();
        }
    }, [end, rows.length, hasNextPage, isFetchingNextPage, fetchNextPage, overscan]);

    if (isLoading && rows.length === 0) {
        return (
            <div style={{ overflow: 'auto', height: typeof height === 'number' ? height + 'px' : height }}>
                {Array.from({ length: Math.ceil((typeof height === 'number' ? height : 600) / itemHeight) }).map((_, i) =>
                    renderSkeleton ? renderSkeleton(i) : (
                        <div key={i} className="skeleton-block" style={{ height: itemHeight - 8, margin: 4, borderRadius: 'var(--radius-md)' }} aria-hidden="true"></div>
                    )
                )}
            </div>
        );
    }
    if (isError) {
        return (
            <ErrorState
                title="Couldn't load"
                description={(error && error.message) || 'Please try again.'}
                retryable={!error || error.retryable}
                onRetry={() => refetch()}
            />
        );
    }
    if (rows.length === 0) return empty || <EmptyState title="Nothing here yet" />;

    const visible = rows.slice(start, end);
    return (
        <div
            ref={scrollRef}
            role="list"
            aria-label={ariaLabel}
            tabIndex={0}
            style={{ overflow: 'auto', height: typeof height === 'number' ? height + 'px' : height, position: 'relative' }}
        >
            <div style={{ height: padTop }} aria-hidden="true"></div>
            {visible.map((row, i) => (
                <div role="listitem" key={getItemId(row)} style={{ minHeight: itemHeight }}>
                    {renderItem(row, start + i)}
                </div>
            ))}
            <div style={{ height: padBottom }} aria-hidden="true"></div>
            {isFetchingNextPage ? (
                <div style={{ textAlign: 'center', padding: 12, color: 'var(--text-muted)', fontSize: 13 }}>
                    <i className="fas fa-spinner fa-spin" aria-hidden="true"></i> Loading more…
                </div>
            ) : null}
        </div>
    );
}
