// React-island migration — Noticeboard card grid (read-only).
//
// The chunk (showNoticeboardView in chunks/script-performance.js) renders the
// page shell (self-contained <style>, topbar, hero, admin bar, #noticeboard-grid,
// footer), fetches `events`, applies the exact visibility filter, sorts, and
// pre-signs poster URLs (_posterSigned) — then mounts this island INTO
// #noticeboard-grid with the prepared `events`. This island only renders the
// cards (or the empty state), reproducing the legacy card markup. React
// auto-escapes text (legacy used an inline esc()). No React Query.
import { useState } from 'react';

const dateOf = (e) => e?.date || e?.event_date || null;
const titleOf = (e) => e.event_title || e.title || 'Untitled Event';

function fmtDate(d) {
    const dt = new Date(d);
    if (isNaN(dt.getTime())) return '日期待定 · Date TBD';
    try {
        return dt.toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'short' });
    } catch (_) { return dt.toLocaleDateString(); }
}

function fmtTime(s, e) {
    if (!s && !e) return '';
    const fmt = (t) => {
        if (!t) return '';
        const [h, m] = String(t).split(':');
        const hr = parseInt(h, 10);
        if (isNaN(hr)) return t;
        const ampm = hr >= 12 ? 'PM' : 'AM';
        const h12 = hr % 12 || 12;
        return `${h12}:${(m || '00').padStart(2, '0')} ${ampm}`;
    };
    if (s && e) return `${fmt(s)} – ${fmt(e)}`;
    return fmt(s || e);
}

function Poster({ e }) {
    const [errored, setErrored] = useState(false);
    if (e._posterSigned && !errored) {
        return <img className="nb-poster" loading="lazy" decoding="async" src={e._posterSigned} alt={titleOf(e)} onError={() => setErrored(true)} />;
    }
    return <div className="nb-poster-placeholder">📅</div>;
}

function PriceBadge({ e }) {
    if (e.ticket_price && parseFloat(e.ticket_price) > 0) {
        return <div className="nb-price-badge">RM {parseFloat(e.ticket_price).toFixed(0)}{e.early_bird_price ? ` · 早鸟 RM ${e.early_bird_price}` : ''}</div>;
    }
    if (e.ticket_price === 0 || e.ticket_price === '0') {
        return <div className="nb-price-badge" style={{ background: '#10b981' }}>免费 · Free</div>;
    }
    return null;
}

function Card({ e, idx }) {
    const num = String(idx + 1).padStart(2, '0');
    const time = fmtTime(e.start_time, e.end_time);
    const tagline = e.speaker ? `主讲 · ${e.speaker}` : (e.target_group || '');
    return (
        <article className="nb-card">
            <div className="nb-num">{num}</div>
            <Poster e={e} />
            <div className="nb-body">
                <h3 className="nb-title">{titleOf(e)}</h3>
                {tagline ? <div className="nb-tagline">{tagline}</div> : null}
                <div className="nb-info">
                    <div className="nb-info-row"><i className="fas fa-calendar"></i> {fmtDate(dateOf(e))}</div>
                    {time ? <div className="nb-info-row"><i className="fas fa-clock"></i> {time}</div> : null}
                    {e.location ? <div className="nb-info-row"><i className="fas fa-map-marker-alt"></i> {e.location}</div> : null}
                </div>
                {e.description ? <div className="nb-desc">{e.description}</div> : null}
                <PriceBadge e={e} />
            </div>
        </article>
    );
}

export function NoticeboardGrid({ events = [], isAdmin = false }) {
    window.__REACT_NOTICEBOARD_STATE = 'ready';
    window.__REACT_NOTICEBOARD_ROWS = events.length;
    if (!events.length) {
        return (
            <div className="nb-empty">
                <div className="nb-empty-emoji">📭</div>
                <div style={{ fontSize: '1.15rem', fontWeight: 700, color: '#800020', marginBottom: '6px' }}>暂无活动 · No upcoming events</div>
                <div style={{ fontSize: '0.9rem' }}>{isAdmin ? 'Tap "Post Event" above to publish the first one.' : 'Check back soon — new events will appear here.'}</div>
            </div>
        );
    }
    return <>{events.map((e, idx) => <Card key={e.id ?? idx} e={e} idx={idx} />)}</>;
}
