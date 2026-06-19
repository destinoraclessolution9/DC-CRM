// Phase 3 — dependency-free row windowing for large lists/tables.
//
// The whole point of the scale spine: a 300k-row table is ~9,000,000 DOM nodes
// and kills the tab. The screen only shows ~15-20 rows, so we keep a resident
// set of ~(viewport + overscan*2) rows and fake the scroll height with pad
// spacers. This hook computes the visible [start,end) window + top/bottom pad
// from the scroll container's scrollTop, recomputed on a rAF-coalesced scroll.
//
// Fixed estimated row height (uniform-height rows, which is what the CRM tables
// are). Returns padTop/padBottom so the caller can render spacer rows that give
// the scrollbar its true length without rendering the off-screen rows.
import { useState, useEffect, useCallback, useRef } from 'react';

export function useWindowedRows({ scrollRef, rowCount, rowHeight = 48, overscan = 8 }) {
    const [range, setRange] = useState({ start: 0, end: Math.min(rowCount, 30) });
    const rangeRef = useRef(range);
    rangeRef.current = range;
    // Read rowCount through a ref inside recompute so a page append (rowCount
    // change) does NOT change recompute's identity — otherwise the subscribe
    // effect below tears down + re-adds the scroll listener / ResizeObserver on
    // every page load, churning during fast scroll and dropping scroll events.
    const rowCountRef = useRef(rowCount);
    rowCountRef.current = rowCount;

    const recompute = useCallback(() => {
        const el = scrollRef.current;
        if (!el) return;
        const count = rowCountRef.current;
        const viewport = el.clientHeight || 600;
        const start = Math.max(0, Math.floor(el.scrollTop / rowHeight) - overscan);
        const visible = Math.ceil(viewport / rowHeight) + overscan * 2;
        const end = Math.min(count, start + visible);
        const prev = rangeRef.current;
        if (prev.start !== start || prev.end !== end) setRange({ start, end });
    }, [scrollRef, rowHeight, overscan]);

    useEffect(() => {
        const el = scrollRef.current;
        if (!el) return;
        let raf = 0;
        const onScroll = () => {
            if (raf) return;
            raf = requestAnimationFrame(() => { raf = 0; recompute(); });
        };
        el.addEventListener('scroll', onScroll, { passive: true });
        recompute();
        const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => recompute()) : null;
        if (ro) ro.observe(el);
        return () => {
            el.removeEventListener('scroll', onScroll);
            if (raf) cancelAnimationFrame(raf);
            if (ro) ro.disconnect();
        };
    }, [recompute, scrollRef]);

    // Re-window when the row count changes (new page loaded, filter applied).
    useEffect(() => { recompute(); }, [rowCount, recompute]);

    const padTop = range.start * rowHeight;
    const padBottom = Math.max(0, (rowCount - range.end) * rowHeight);
    return { start: range.start, end: range.end, padTop, padBottom, recompute };
}
