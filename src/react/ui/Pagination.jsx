import { useCallback } from 'react';

/**
 * Pagination — page navigation for tables/lists.
 *
 * Two modes share one <nav aria-label="Pagination"> envelope:
 *
 *  - mode='offset' (default): classic indexed paging. Mirrors the legacy
 *    CustomersTable markup exactly — "Showing X–Y of N" then
 *    First / Prev / "Page n of m" / Next / Last, all `.btn.secondary.btn-sm`,
 *    disabled at the bounds. `page` is 0-based; `onNavigate` receives the
 *    target 0-based page index.
 *
 *  - mode='keyset': cursor paging where the total count is unknown/expensive.
 *    Renders only Prev / "Page k" / Next; `onNavigate('prev'|'next')`.
 *    Optional hasPrev/hasNext drive the disabled state (defaults inferred from
 *    the page index — page 1 has no Prev).
 *
 * Foreground text uses tokenized colors only; bounds are enforced so we never
 * fire an out-of-range navigation.
 */
export function Pagination({
  mode = 'offset',
  page = 0,
  pageSize = 0,
  count = 0,
  onNavigate,
  // keyset-only:
  hasPrev,
  hasNext,
}) {
  // --- offset mode -------------------------------------------------------
  // Clamp so a stale `page` (e.g. after the count shrinks) can't render a
  // negative range or enable a button that would navigate past the end.
  const totalPages = mode === 'offset' && pageSize > 0
    ? Math.max(1, Math.ceil(count / pageSize))
    : 1;
  const clampedPage = Math.min(Math.max(0, page), totalPages - 1);

  // Human-facing 1-based range; empty result set shows "0–0 of 0".
  // When pageSize <= 0 (the default — caller omitted it in offset mode), there's
  // effectively a single page covering every row, so the range is 1–count.
  // Without this guard `to` collapsed to Math.min(count, 0) = 0, rendering the
  // nonsensical "Showing 1–0 of N".
  const usablePageSize = mode === 'offset' && pageSize > 0;
  const from = count === 0 ? 0 : usablePageSize ? clampedPage * pageSize + 1 : 1;
  const to = count === 0
    ? 0
    : usablePageSize
    ? Math.min(count, (clampedPage + 1) * pageSize)
    : count;
  const currentPage = clampedPage + 1; // 1-based for display

  const atFirst = clampedPage <= 0;
  const atLast = clampedPage >= totalPages - 1;

  // Guard every nav: never emit an index outside [0, totalPages-1].
  const goOffset = useCallback(
    (target) => {
      const next = Math.min(Math.max(0, target), totalPages - 1);
      if (next === clampedPage) return;
      onNavigate?.(next);
    },
    [clampedPage, totalPages, onNavigate]
  );

  // --- keyset mode -------------------------------------------------------
  // page is 0-based here too; "Page k" is 1-based for the reader.
  const keysetPage = Math.max(0, page) + 1;
  // If the caller doesn't tell us, infer Prev from the index; Next stays open.
  const canPrev = hasPrev !== undefined ? hasPrev : page > 0;
  const canNext = hasNext !== undefined ? hasNext : true;

  const goKeyset = useCallback(
    (dir) => onNavigate?.(dir),
    [onNavigate]
  );

  const secondaryText = { color: 'var(--text-secondary)', fontSize: '13px' };
  const pageLabel = { fontWeight: 600, fontSize: '14px', color: 'var(--text-primary)' };
  const navStyle = {
    display: 'flex',
    alignItems: 'center',
    gap: '0.5rem',
    flexWrap: 'wrap',
  };

  if (mode === 'keyset') {
    return (
      <nav aria-label="Pagination" style={navStyle}>
        <button
          type="button"
          className="btn secondary btn-sm"
          disabled={!canPrev || undefined}
          onClick={() => goKeyset('prev')}
        >
          <i className="fas fa-angle-left" aria-hidden="true" /> Prev
        </button>
        <span style={pageLabel}>Page {keysetPage}</span>
        <button
          type="button"
          className="btn secondary btn-sm"
          disabled={!canNext || undefined}
          onClick={() => goKeyset('next')}
        >
          Next <i className="fas fa-angle-right" aria-hidden="true" />
        </button>
      </nav>
    );
  }

  // offset (default)
  return (
    <nav aria-label="Pagination" style={navStyle}>
      <span style={secondaryText}>
        Showing {from}–{to} of {count}
      </span>
      <button
        type="button"
        className="btn secondary btn-sm"
        disabled={atFirst || undefined}
        onClick={() => goOffset(0)}
        title="First page"
        aria-label="First page"
      >
        <i className="fas fa-angle-double-left" aria-hidden="true" />
      </button>
      <button
        type="button"
        className="btn secondary btn-sm"
        disabled={atFirst || undefined}
        onClick={() => goOffset(clampedPage - 1)}
      >
        <i className="fas fa-angle-left" aria-hidden="true" /> Prev
      </button>
      <span style={pageLabel}>
        Page {currentPage} of {totalPages}
      </span>
      <button
        type="button"
        className="btn secondary btn-sm"
        disabled={atLast || undefined}
        onClick={() => goOffset(clampedPage + 1)}
      >
        Next <i className="fas fa-angle-right" aria-hidden="true" />
      </button>
      <button
        type="button"
        className="btn secondary btn-sm"
        disabled={atLast || undefined}
        onClick={() => goOffset(totalPages - 1)}
        title="Last page"
        aria-label="Last page"
      >
        <i className="fas fa-angle-double-right" aria-hidden="true" />
      </button>
    </nav>
  );
}
