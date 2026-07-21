// Monthly Promotion — poster-forward promo cards (view id 'promotions').
//
// Pure render island, zero mutations. The chunk (chunks/script-marketing.js,
// showMonthlyPromotionView) fetches promotions + products, filters to active
// & non-expired + visible-to-viewer, and builds one plain card model per promo
// (name, poster url, product names, requirement, time frame, slots, payment
// types, agent-only bonus note, price, discount) — then mounts this component.
// The agent bonus (agentNote) is only present in the payload for admin/agent
// viewers; there is no customer-facing share path, so it never leaves the app.
// React auto-escapes every interpolated field (package_name, requirement,
// agentNote, payment types, product names) — an XSS-hardening win.
//
// Poster: each card leads with the uploaded promotion poster (16:9 hero) and
// degrades gracefully to a clean placeholder when none is set. A page-level
// banner marks these posters INTERNAL USE ONLY; the customer-share action was
// removed 2026-07-07 (owner: posters must not be forwarded out). The only
// per-card action is "View full poster", which enlarges it locally.
import React from 'react';

const BRAND = '#8B1A1A';

const cardOuter = { background: '#fff', border: '1px solid var(--gray-200)', borderRadius: '12px', overflow: 'hidden', display: 'flex', flexDirection: 'column', boxShadow: 'var(--shadow-sm)' };
const chip = { fontSize: '12px', color: 'var(--gray-600)', background: 'var(--gray-50, #f9fafb)', border: '1px solid var(--gray-200)', borderRadius: '6px', padding: '3px 8px', display: 'inline-flex', alignItems: 'center', gap: '4px' };

function openPoster(m) {
    try {
        // Prefer the ORIGINAL stored URL (posterPath) — app.viewProductImage
        // re-signs it fresh at click time, so the enlarge works even if the
        // inline hero's signed URL has since expired. Falls back to posterUrl.
        const src = m.posterPath || m.posterUrl;
        if (src && window.app && typeof window.app.viewProductImage === 'function') {
            window.app.viewProductImage(src, m.name || 'Poster');
        }
    } catch (_) { /* noop */ }
}

function PromoHero({ m, onImgError }) {
    if (m.posterUrl) {
        return (
            <div style={{ position: 'relative', aspectRatio: '16 / 9', background: '#f3f4f6', borderBottom: '1px solid var(--gray-200)', cursor: 'zoom-in' }} onClick={() => openPoster(m)} title="Tap to view full poster">
                <img src={m.posterUrl} alt={m.name} loading="lazy" decoding="async" onError={onImgError} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
                {m.hasDiscount && (
                    <span style={{ position: 'absolute', top: '10px', right: '10px', background: '#A32D2D', color: '#fff', fontSize: '12px', fontWeight: 700, padding: '3px 9px', borderRadius: '6px' }}>
                        <i className="fas fa-tag" style={{ marginRight: '4px' }}></i>Save {m.savePct}%
                    </span>
                )}
            </div>
        );
    }
    return (
        <div style={{ position: 'relative', aspectRatio: '16 / 9', background: 'var(--gray-50, #f9fafb)', borderBottom: '1px solid var(--gray-200)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: 'var(--gray-300)' }}>
            <i className="fas fa-image" style={{ fontSize: '30px' }}></i>
            <span style={{ fontSize: '12px', marginTop: '6px' }}>No poster</span>
            {m.hasDiscount && (
                <span style={{ position: 'absolute', top: '10px', right: '10px', background: '#A32D2D', color: '#fff', fontSize: '12px', fontWeight: 700, padding: '3px 9px', borderRadius: '6px' }}>
                    <i className="fas fa-tag" style={{ marginRight: '4px' }}></i>Save {m.savePct}%
                </span>
            )}
        </div>
    );
}

function PromoCard({ m }) {
    // If the poster fails to load (deleted object, expired signature, offline),
    // fall back to the clean "No poster" placeholder instead of the browser's
    // broken-image icon, and hide the now-useless "View full poster" action.
    const [posterBroken, setPosterBroken] = React.useState(false);
    const view = posterBroken ? { ...m, posterUrl: null } : m;
    return (
        <div style={cardOuter}>
            <PromoHero m={view} onImgError={() => setPosterBroken(true)} />
            <div style={{ padding: '14px 16px', display: 'flex', flexDirection: 'column', flex: 1 }}>
                <div style={{ fontSize: '16px', fontWeight: 700, color: BRAND, marginBottom: '2px' }}>{m.name}</div>
                {m.productNames.length > 0 && (
                    <div style={{ fontSize: '12px', color: 'var(--gray-500)', marginBottom: '8px' }}>
                        <i className="fas fa-box" style={{ marginRight: '4px' }}></i>{m.productNames.join(', ')}
                    </div>
                )}
                {m.price && (
                    <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px', marginBottom: '10px' }}>
                        <span style={{ fontSize: '22px', fontWeight: 800, color: BRAND }}>RM {m.price}</span>
                        {m.hasDiscount && <span style={{ fontSize: '13px', color: '#999', textDecoration: 'line-through' }}>RM {m.originalStr}</span>}
                    </div>
                )}
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginBottom: '10px' }}>
                    {m.hasTimeFrame && <span style={chip}><i className="fas fa-calendar-alt"></i>{m.startStr} – {m.endStr}</span>}
                    {m.slots && <span style={chip}><i className="fas fa-layer-group"></i>Limited {m.slots} sets</span>}
                    {m.paymentTypes.map((pt, i) => <span key={i} style={chip}>{pt}</span>)}
                </div>
                {m.requirement && (
                    <div style={{ fontSize: '12px', color: 'var(--gray-600)', marginBottom: '6px' }}>
                        <i className="fas fa-check-circle" style={{ color: BRAND, marginRight: '4px' }}></i>{m.requirement}
                    </div>
                )}
                {m.agentNote && (
                    <div style={{ marginBottom: '8px', padding: '8px 10px', background: '#fbf3f3', border: '1px solid #edd9d9', borderLeft: '3px solid ' + BRAND, borderRadius: '6px' }}>
                        <div style={{ fontSize: '9px', fontWeight: 800, letterSpacing: '0.6px', color: BRAND, textTransform: 'uppercase', display: 'flex', alignItems: 'center', gap: '4px', marginBottom: '2px' }}>
                            <i className="fas fa-lock" style={{ fontSize: '9px' }}></i>Agent only · 代理专属
                        </div>
                        <div style={{ fontSize: '12px', color: 'var(--gray-700)', lineHeight: 1.4 }}>{m.agentNote}</div>
                    </div>
                )}
                {view.posterUrl && (
                    <div style={{ display: 'flex', gap: '8px', marginTop: 'auto', paddingTop: '10px' }}>
                        <button onClick={() => openPoster(m)} title="View full poster" aria-label="View full poster" style={{ flex: 1, background: '#fff', color: 'var(--gray-700)', border: '1px solid var(--gray-300)', borderRadius: '6px', padding: '9px 12px', fontSize: '13px', fontWeight: 600, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: '6px' }}>
                            <i className="fas fa-expand"></i>View full poster
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
}

export function MonthlyPromotionView({ promos = [], totalPromos = 0 }) {
    try {
        window.__REACT_PROMO_STATE = 'ready';
        window.__REACT_PROMO_ROWS = promos.length;
    } catch (_) { /* noop */ }

    return (
        <div style={{ padding: '20px', maxWidth: '1040px', margin: '0 auto' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
                <div>
                    <h2 style={{ fontSize: '22px', fontWeight: 700, margin: 0 }}>Monthly Promotion</h2>
                    <p style={{ color: 'var(--gray-500)', fontSize: '13px', margin: '4px 0 0' }}>Current active promotions — tap a poster to enlarge.</p>
                </div>
            </div>
            {promos.length > 0 && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', margin: '0 0 18px', padding: '11px 14px', background: '#fbf3f3', border: '1px solid #edd9d9', borderLeft: '3px solid ' + BRAND, borderRadius: '8px' }}>
                    <i className="fas fa-lock" style={{ color: BRAND, fontSize: '15px', flexShrink: 0 }}></i>
                    <span style={{ fontSize: '13px', color: 'var(--gray-700)', lineHeight: 1.45 }}>
                        <strong style={{ color: BRAND }}>This promotion poster is for internal use only.</strong> Please do not share it out.
                    </span>
                </div>
            )}
            {promos.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '60px 20px', color: 'var(--gray-400)' }}>
                    <i className="fas fa-tags" style={{ fontSize: '40px', marginBottom: '12px', display: 'block' }}></i>
                    <p>No active promotions at the moment.</p>
                    {totalPromos > 0
                        ? <p style={{ fontSize: '12px', color: 'var(--gray-400)', marginTop: '8px' }}>({totalPromos} package(s) found but hidden — check Active status, End Date, or Visible To settings)</p>
                        : <p style={{ fontSize: '12px', color: 'var(--gray-400)', marginTop: '8px' }}>No packages have been created yet. Go to Marketing Lists → Promotion Packages to create one.</p>}
                </div>
            ) : (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 300px), 1fr))', gap: '18px' }}>
                    {promos.map((m) => <PromoCard m={m} key={m.id} />)}
                </div>
            )}
        </div>
    );
}
