// Phase 3 — the centerpiece: a virtualized, server-paged data table that makes
// 300k rows feel instant. Resident DOM stays at ~(viewport + overscan) rows;
// the scroll height is faked with pad spacer rows; pages load on scroll via the
// server (never a client filter of the whole table). Server-side role scoping
// rides the fetcher's endpoint (e.g. /api/prospects → prospects_page RPC).
//
// Generic by design: the consumer supplies `columns` + a `fetchPage` fetcher.
// Phase 4 wires the prospects/customers fetchers to it.
import { useRef, useEffect } from 'react';
import { useInfiniteRows } from './useInfiniteRows.js';
import { useWindowedRows } from './useWindowedRows.js';
import { EmptyState } from './EmptyState.jsx';
import { ErrorState } from './ErrorState.jsx';

export function VirtualizedDataTable({
    columns = [],
    queryKey,
    fetchPage,
    pageSize = 50,
    mode = 'offset',
    rowHeight = 48,
    overscan = 8,
    height = 600,
    getRowId = (r) => r.id,
    onRowClick,
    sort,
    onSortChange,
    empty,
    ariaLabel = 'Data table',
}) {
    const scrollRef = useRef(null);
    const {
        rows, count, isLoading, isError, error,
        fetchNextPage, hasNextPage, isFetchingNextPage, refetch,
    } = useInfiniteRows({ queryKey, fetchPage, pageSize, mode });

    const { start, end, padTop, padBottom } = useWindowedRows({ scrollRef, rowCount: rows.length, rowHeight, overscan });

    // Infinite trigger: when the window nears the loaded tail, fetch the next page.
    useEffect(() => {
        if (hasNextPage && !isFetchingNextPage && rows.length > 0 && end >= rows.length - overscan) {
            fetchNextPage();
        }
    }, [end, rows.length, hasNextPage, isFetchingNextPage, fetchNextPage, overscan]);

    // Live-verification markers (mirror the existing island convention).
    if (isLoading) window.__REACT_VDT_STATE = 'loading';
    else if (isError) window.__REACT_VDT_STATE = 'error';
    else { window.__REACT_VDT_STATE = 'ready'; window.__REACT_VDT_COUNT = count; window.__REACT_VDT_LOADED = rows.length; }

    const colCount = columns.length;
    const visible = rows.slice(start, end);

    let body;
    if (isLoading && rows.length === 0) {
        body = Array.from({ length: Math.min(14, Math.ceil(height / rowHeight)) }).map((_, i) => (
            <tr key={'sk' + i} style={{ height: rowHeight }}>
                <td colSpan={colCount} style={{ padding: '0 12px' }}>
                    <div className="skeleton-block" style={{ height: 14, width: (50 + (i * 7) % 40) + '%' }} aria-hidden="true"></div>
                </td>
            </tr>
        ));
    } else if (isError) {
        body = (
            <tr><td colSpan={colCount} style={{ padding: 0 }}>
                <ErrorState
                    title="Couldn't load data"
                    description={(error && error.message) || 'Please try again.'}
                    retryable={!error || error.retryable}
                    onRetry={() => refetch()}
                />
            </td></tr>
        );
    } else if (rows.length === 0) {
        body = (
            <tr><td colSpan={colCount} style={{ padding: 0 }}>
                {empty || <EmptyState title="No results" description="Nothing matches the current filters." />}
            </td></tr>
        );
    } else {
        body = (
            <>
                {padTop > 0 ? (
                    <tr aria-hidden="true" style={{ height: padTop }}><td colSpan={colCount} style={{ padding: 0, border: 'none' }}></td></tr>
                ) : null}
                {visible.map((row, i) => {
                    const idx = start + i;
                    return (
                        <tr
                            key={getRowId(row)}
                            aria-rowindex={idx + 1}
                            onClick={onRowClick ? () => onRowClick(row) : undefined}
                            style={{ height: rowHeight, cursor: onRowClick ? 'pointer' : 'default' }}
                        >
                            {columns.map((c) => (
                                <td key={c.key} data-label={typeof c.header === 'string' ? c.header : c.key} style={{ textAlign: c.align || 'left' }}>
                                    {c.render ? c.render(row) : row[c.key]}
                                </td>
                            ))}
                        </tr>
                    );
                })}
                {padBottom > 0 ? (
                    <tr aria-hidden="true" style={{ height: padBottom }}><td colSpan={colCount} style={{ padding: 0, border: 'none' }}></td></tr>
                ) : null}
            </>
        );
    }

    return (
        <div className="prospects-table-container" data-react-vdt="1">
            <div
                ref={scrollRef}
                role="region"
                aria-label={ariaLabel}
                tabIndex={0}
                style={{ overflow: 'auto', height: typeof height === 'number' ? height + 'px' : height, position: 'relative' }}
            >
                <table className="prospects-table" style={{ width: '100%' }} aria-rowcount={count}>
                    <thead style={{ position: 'sticky', top: 0, zIndex: 1, background: 'var(--bg-surface)' }}>
                        <tr>
                            {columns.map((c) => {
                                const isSorted = sort && sort.key === c.key;
                                const ariaSort = c.sortable ? (isSorted ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none') : undefined;
                                const clickable = c.sortable && onSortChange;
                                return (
                                    <th
                                        key={c.key}
                                        scope="col"
                                        aria-sort={ariaSort}
                                        onClick={clickable ? () => onSortChange(c.key, isSorted && sort.dir === 'asc' ? 'desc' : 'asc') : undefined}
                                        style={{ textAlign: c.align || 'left', width: c.width, whiteSpace: 'nowrap', cursor: clickable ? 'pointer' : 'default' }}
                                    >
                                        {c.header}
                                        {c.sortable && isSorted ? (
                                            <i className={`fas fa-caret-${sort.dir === 'asc' ? 'up' : 'down'}`} aria-hidden="true" style={{ marginLeft: 4 }}></i>
                                        ) : null}
                                    </th>
                                );
                            })}
                        </tr>
                    </thead>
                    <tbody>{body}</tbody>
                </table>
                {isFetchingNextPage ? (
                    <div style={{ textAlign: 'center', padding: 12, color: 'var(--text-muted)', fontSize: 13 }}>
                        <i className="fas fa-spinner fa-spin" aria-hidden="true"></i> Loading more…
                    </div>
                ) : null}
            </div>
            <div style={{ padding: '8px 4px', color: 'var(--text-secondary)', fontSize: 13 }} aria-live="polite">
                {count > 0 ? `${rows.length.toLocaleString()} of ${count.toLocaleString()} loaded` : ''}
            </div>
        </div>
    );
}
