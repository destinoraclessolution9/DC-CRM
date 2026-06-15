// Monthly Promotion — read-only promo-card display (view id 'promotions').
//
// Pure render island, zero mutations. The chunk (chunks/script-marketing.js,
// showMonthlyPromotionView) fetches promotions + products, filters to active
// & non-expired, and builds one plain card model per promo (name, product
// names, requirement, time frame, slots, payment types, remarks, price,
// discount) — then mounts this component. React auto-escapes every field the
// legacy markup interpolated raw (package_name, requirement, remarks, payment
// types, product names) — an XSS-hardening win on top of the migration.
import React from 'react';

const cardOuter = { background: '#fff', border: '1px solid var(--gray-200)', borderRadius: '10px', padding: '18px 22px', boxShadow: 'var(--shadow-sm)' };
const payPill = { fontSize: '11px', background: '#f3f4f6', border: '1px solid #e5e7eb', borderRadius: '4px', padding: '1px 7px', color: '#555' };
const metaSpan = { fontSize: '11px', color: 'var(--gray-500)' };

function PromoCard({ m }) {
    return (
        <div style={cardOuter}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '16px' }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: '17px', fontWeight: 700, color: '#8B1A1A', marginBottom: '4px' }}>{m.name}</div>
                    {m.productNames.length > 0 && (
                        <div style={{ fontSize: '12px', color: 'var(--gray-500)', marginBottom: '6px' }}>
                            <i className="fas fa-box" style={{ marginRight: '4px' }}></i>{m.productNames.join(', ')}
                        </div>
                    )}
                    {m.requirement && (
                        <div style={{ fontSize: '12px', color: 'var(--gray-600)', marginBottom: '4px' }}>
                            <i className="fas fa-check-circle" style={{ color: '#8B1A1A', marginRight: '4px' }}></i>{m.requirement}
                        </div>
                    )}
                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap', marginTop: '6px' }}>
                        {m.hasTimeFrame && (
                            <span style={metaSpan}><i className="fas fa-calendar-alt" style={{ marginRight: '4px' }}></i>{m.startStr} – {m.endStr}</span>
                        )}
                        {m.slots && (
                            <span style={metaSpan}><i className="fas fa-layer-group" style={{ marginRight: '4px' }}></i>Limited: {m.slots} sets</span>
                        )}
                    </div>
                    {m.paymentTypes.length > 0 && (
                        <div style={{ marginTop: '6px', display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                            {m.paymentTypes.map((pt, i) => <span key={i} style={payPill}>{pt}</span>)}
                        </div>
                    )}
                    {m.remarks && (
                        <div style={{ fontSize: '11px', color: 'var(--gray-400)', marginTop: '6px' }}>
                            <i className="fas fa-info-circle" style={{ marginRight: '4px' }}></i>{m.remarks}
                        </div>
                    )}
                </div>
                <div style={{ textAlign: 'right', flexShrink: 0, minWidth: '90px' }}>
                    {m.price && <div style={{ fontSize: '20px', fontWeight: 800, color: '#8B1A1A' }}>RM {m.price}</div>}
                    {m.hasDiscount && (
                        <>
                            <div style={{ fontSize: '12px', color: '#888', textDecoration: 'line-through' }}>RM {m.originalStr}</div>
                            <div style={{ fontSize: '11px', color: '#c53030', fontWeight: 700 }}>Save {m.savePct}%</div>
                        </>
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
        <div style={{ padding: '20px', maxWidth: '960px', margin: '0 auto' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
                <div>
                    <h2 style={{ fontSize: '22px', fontWeight: 700, margin: 0 }}>Monthly Promotion</h2>
                    <p style={{ color: 'var(--gray-500)', fontSize: '13px', margin: '4px 0 0' }}>Current active promotions</p>
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
                <div style={{ display: 'grid', gap: '16px' }}>
                    {promos.map((m) => <PromoCard m={m} key={m.id} />)}
                </div>
            )}
        </div>
    );
}
