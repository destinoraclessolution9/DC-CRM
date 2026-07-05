// Monthly Promotion — poster-forward promo cards (view id 'promotions').
//
// Pure render island, zero mutations. The chunk (chunks/script-marketing.js,
// showMonthlyPromotionView) fetches promotions + products, filters to active
// & non-expired + visible-to-viewer, and builds one plain card model per promo
// (name, poster url, product names, requirement, time frame, slots, payment
// types, remarks, price, discount) — then mounts this component. React
// auto-escapes every interpolated field (package_name, requirement, remarks,
// payment types, product names) — an XSS-hardening win on top of the migration.
//
// Poster: each card leads with the uploaded promotion poster (16:9 hero) and
// degrades gracefully to a clean placeholder when none is set. "Share to
// customer" uses the Web Share API to push the poster image + summary to
// WhatsApp on mobile, falling back to wa.me on desktop.
import React from 'react';

const BRAND = '#8B1A1A';

const cardOuter = { background: '#fff', border: '1px solid var(--gray-200)', borderRadius: '12px', overflow: 'hidden', display: 'flex', flexDirection: 'column', boxShadow: 'var(--shadow-sm)' };
const chip = { fontSize: '12px', color: 'var(--gray-600)', background: 'var(--gray-50, #f9fafb)', border: '1px solid var(--gray-200)', borderRadius: '6px', padding: '3px 8px', display: 'inline-flex', alignItems: 'center', gap: '4px' };

// Build a WhatsApp-ready summary and share it. On mobile with Web Share +
// file support, the poster image itself is attached; otherwise we fall back to
// wa.me with the text (and poster link). Best-effort — never throws to the UI.
async function sharePromo(m) {
    const parts = [m.name];
    if (m.price) parts.push(m.hasDiscount ? `RM ${m.price} (原价 RM ${m.originalStr}，省 ${m.savePct}%)` : `RM ${m.price}`);
    if (m.requirement) parts.push(m.requirement);
    if (m.hasTimeFrame) parts.push(`${m.startStr} – ${m.endStr}`);
    if (m.slots) parts.push(`限量 ${m.slots} 套 / Limited ${m.slots} sets`);
    const text = parts.filter(Boolean).join('\n');
    try {
        if (m.posterUrl && typeof navigator !== 'undefined' && navigator.canShare) {
            const resp = await fetch(m.posterUrl, { mode: 'cors' });
            const blob = await resp.blob();
            const file = new File([blob], 'promotion.jpg', { type: blob.type || 'image/jpeg' });
            if (navigator.canShare({ files: [file] })) {
                await navigator.share({ files: [file], text });
                return;
            }
        }
        if (typeof navigator !== 'undefined' && navigator.share) {
            await navigator.share({ text, url: m.posterUrl || undefined });
            return;
        }
    } catch (_) { /* user cancelled or unsupported — fall through to wa.me */ }
    const wa = 'https://wa.me/?text=' + encodeURIComponent(text + (m.posterUrl ? '\n' + m.posterUrl : ''));
    try { window.open(wa, '_blank', 'noopener'); } catch (_) { /* noop */ }
}

function openPoster(m) {
    try {
        if (m.posterUrl && window.app && typeof window.app.viewProductImage === 'function') {
            window.app.viewProductImage(m.posterUrl, m.name || 'Poster');
        }
    } catch (_) { /* noop */ }
}

function PromoHero({ m }) {
    if (m.posterUrl) {
        return (
            <div style={{ position: 'relative', aspectRatio: '16 / 9', background: '#f3f4f6', borderBottom: '1px solid var(--gray-200)', cursor: 'zoom-in' }} onClick={() => openPoster(m)} title="Tap to view full poster">
                <img src={m.posterUrl} alt={m.name} loading="lazy" decoding="async" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
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
    return (
        <div style={cardOuter}>
            <PromoHero m={m} />
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
                {m.remarks && (
                    <div style={{ fontSize: '11px', color: 'var(--gray-400)', marginBottom: '6px' }}>
                        <i className="fas fa-info-circle" style={{ marginRight: '4px' }}></i>{m.remarks}
                    </div>
                )}
                <div style={{ display: 'flex', gap: '8px', marginTop: 'auto', paddingTop: '10px' }}>
                    <button onClick={() => sharePromo(m)} style={{ flex: 1, background: '#1a9e75', color: '#fff', border: 'none', borderRadius: '6px', padding: '9px 10px', fontSize: '13px', fontWeight: 600, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: '6px' }}>
                        <i className="fab fa-whatsapp" style={{ fontSize: '15px' }}></i>Share to customer
                    </button>
                    {m.posterUrl && (
                        <button onClick={() => openPoster(m)} title="View full poster" aria-label="View full poster" style={{ background: '#fff', color: 'var(--gray-700)', border: '1px solid var(--gray-300)', borderRadius: '6px', padding: '9px 12px', fontSize: '13px', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                            <i className="fas fa-expand"></i>Poster
                        </button>
                    )}
                </div>
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
                    <p style={{ color: 'var(--gray-500)', fontSize: '13px', margin: '4px 0 0' }}>Current active promotions — tap a poster to enlarge, or share it straight to a customer.</p>
                </div>
            </div>
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
