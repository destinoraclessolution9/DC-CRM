// Product & Event Manager — tabbed master-data view (view id 'marketing_lists').
//
// Island renders the shell (header + role/tab-gated action button + 7-tab bar)
// and React tables for the FIVE master-data tabs (products/events/venues/
// bujishu/formula) from chunk-computed data. The two complex tabs —
// promotions (renderPackagesTab) and special_programs (cross-chunk
// renderSpecialProgramsTable) — are left to the chunk: for those, the island
// renders an empty <div id="marketing-list-content"> that the chunk fills via
// the existing legacy renderer (unchanged). Tab clicks + every mutation stay in
// the chunk via app.* (switchMarketingListTab, openMarketingListAddModal/
// EditModal, deleteMarketingListItem, viewProductImage, showProductPriceHistory,
// updateVenueSequence, openSpecialProgramModal). React auto-escapes every field
// the legacy tables interpolated raw — XSS hardening across all 5 tables.
import React from 'react';

const app = () => window.app || {};
const call = (name, ...args) => { const f = app()[name]; if (typeof f === 'function') f(...args); };

const MASTER_TABS = ['products', 'events', 'venues', 'bujishu', 'formula'];
const TABS = [
    { key: 'products', label: 'Products' },
    { key: 'events', label: 'Events' },
    { key: 'promotions', label: 'Promotions' },
    { key: 'venues', label: 'Venues' },
    { key: 'bujishu', label: 'Bujishu' },
    { key: 'formula', label: 'Formula' },
    { key: 'special_programs', label: '🏆 Special Programs' },
];
const NEW_LABEL = { products: 'Product', events: 'Event', venues: 'Venue' };

function StatusBadge({ active }) {
    return <span className={`status-badge ${active ? 'status-active' : 'status-inactive'}`}>{active ? 'Active' : 'Inactive'}</span>;
}

function RowActions({ id }) {
    return (
        <td>
            <button className="btn-icon" onClick={() => call('openMarketingListEditModal', String(id))} title="Edit"><i className="fas fa-pencil-alt"></i></button>
            <button className="btn-icon text-danger" onClick={() => call('deleteMarketingListItem', String(id))} title="Delete"><i className="fas fa-trash-alt"></i></button>
        </td>
    );
}

const imgStyle = { width: '40px', height: '40px', objectFit: 'cover', borderRadius: '4px', cursor: 'pointer' };

function ImageCell({ url, label, emoji, emptyTitle }) {
    return (
        <td style={{ textAlign: 'center' }}>
            {url
                ? <img loading="lazy" decoding="async" src={url} crossOrigin="anonymous" style={imgStyle} onClick={() => call('viewProductImage', url, label)} title={`View ${label.toLowerCase()}`} />
                : <span style={{ color: 'var(--gray-300)', fontSize: '18px' }} title={emptyTitle}>{emoji}</span>}
        </td>
    );
}

function ProductsTable({ rows }) {
    return (
        <table className="data-table">
            <thead><tr>
                <th scope="col" style={{ width: '54px' }}>Photo</th>
                <th scope="col" style={{ width: '54px' }}>Poster</th>
                <th scope="col">Name</th><th scope="col">Category</th>
                <th scope="col">Functions Description</th><th scope="col">Product Description</th>
                <th scope="col">Price (RM)</th><th scope="col">Lead Time</th>
                <th scope="col">Dimension</th><th scope="col">Weight</th>
                <th scope="col">Status</th><th scope="col">Actions</th>
            </tr></thead>
            <tbody>
                {rows.map((item) => (
                    <tr key={item.id} style={!item.is_active ? { opacity: 0.6, background: '#f9fafb' } : undefined}>
                        <ImageCell url={item.photo_url} label="Photo" emoji="📷" emptyTitle="No photo" />
                        <ImageCell url={item.poster_url} label="Poster" emoji="🖼️" emptyTitle="No poster" />
                        <td><strong>{item.name}</strong><br /><small className="text-muted">{item.remarks || ''}</small></td>
                        <td>{item.category || '-'}</td>
                        <td>{item.functions_description || '-'}</td>
                        <td>{item.description || '-'}</td>
                        <td>
                            <span style={{ fontWeight: 600 }}>RM {item.price || 0}</span>
                            <button className="btn-icon" style={{ marginLeft: '4px', opacity: 0.6 }} onClick={() => call('showProductPriceHistory', item.id)} title="Price history"><i className="fas fa-history"></i></button>
                        </td>
                        <td>{item.delivery_lead_time || '-'}</td>
                        <td>{item.product_dimension || '-'}</td>
                        <td>{item.product_weight || '-'}</td>
                        <td><StatusBadge active={!!item.is_active} /></td>
                        <RowActions id={item.id} />
                    </tr>
                ))}
            </tbody>
        </table>
    );
}

const catPill = { display: 'inline-block', background: 'var(--primary-50,#fef3c7)', color: 'var(--primary-700,#92400e)', border: '1px solid var(--primary-200,#fde68a)', borderRadius: '10px', padding: '2px 8px', margin: '2px 2px 2px 0', fontSize: '11px', whiteSpace: 'nowrap' };

function EventsTable({ rows }) {
    return (
        <table className="data-table">
            <thead><tr>
                <th scope="col" style={{ minWidth: '160px' }}>Categories</th>
                <th scope="col" style={{ width: '54px' }}>Poster</th>
                <th scope="col">Title</th><th scope="col">Price (RM)</th>
                <th scope="col">Early Bird (RM)</th><th scope="col">Group Price (RM)</th>
                <th scope="col">Duration</th><th scope="col">Target Group</th>
                <th scope="col">Location</th><th scope="col">Speaker</th>
                <th scope="col">Remarks</th><th scope="col">Status</th><th scope="col">Actions</th>
            </tr></thead>
            <tbody>
                {rows.map((item) => {
                    const isActive = item.is_active || item.status === 'active' || item.status === 'Active';
                    const cats = item._cats || [];
                    return (
                        <tr key={item.id} style={!isActive ? { opacity: 0.6, background: '#f9fafb' } : undefined}>
                            <td>{cats.length ? cats.map((c, i) => <span key={i} style={catPill}>{c}</span>) : <span className="text-muted">-</span>}</td>
                            <ImageCell url={item.poster_url} label="Poster" emoji="🖼️" emptyTitle="No poster" />
                            <td><strong>{item.event_title || item.title || ''}</strong><br /><small className="text-muted">{item.description || ''}</small></td>
                            <td>{item.ticket_price || '-'}</td>
                            <td>{item.early_bird_price || '-'}</td>
                            <td>{item.group_purchase_price || '-'}</td>
                            <td>{item.duration || '-'}</td>
                            <td>{item.target_group || '-'}</td>
                            <td>{item.location || '-'}</td>
                            <td>{item.speaker || '-'}</td>
                            <td>{item.remarks || '-'}</td>
                            <td><StatusBadge active={!!isActive} /></td>
                            <RowActions id={item.id} />
                        </tr>
                    );
                })}
            </tbody>
        </table>
    );
}

function VenuesTable({ rows }) {
    const seqOptions = Array.from({ length: rows.length }, (_, i) => i + 1);
    return (
        <table className="data-table">
            <thead><tr>
                <th scope="col" style={{ width: '60px' }}>#</th>
                <th scope="col">Venue Name</th><th scope="col">Location</th>
                <th scope="col">Address</th><th scope="col">Waze</th><th scope="col">Actions</th>
            </tr></thead>
            <tbody>
                {rows.length === 0
                    ? <tr><td colSpan="6" style={{ textAlign: 'center', color: 'var(--gray-400)', padding: '32px' }}>No venues added yet.</td></tr>
                    : rows.map((item, idx) => (
                        <tr key={item.id}>
                            <td>
                                <select className="form-control" style={{ width: '55px', padding: '2px 4px', fontSize: '13px', textAlign: 'center' }}
                                    defaultValue={item.sequence || idx + 1} onChange={(e) => call('updateVenueSequence', String(item.id), e.target.value)} title="Drag to reorder">
                                    {seqOptions.map((n) => <option key={n} value={n}>{n}</option>)}
                                </select>
                            </td>
                            <td><strong>{item.name}</strong></td>
                            <td>{item.location || '-'}</td>
                            <td>{item.address || '-'}</td>
                            <td>{item.waze_link ? <a href={item.waze_link} target="_blank" rel="noopener" style={{ color: 'var(--primary)', textDecoration: 'none' }} title="Open in Waze"><i className="fas fa-map-marker-alt"></i> Waze</a> : '-'}</td>
                            <RowActions id={item.id} />
                        </tr>
                    ))}
            </tbody>
        </table>
    );
}

function BujishuTable({ rows }) {
    return (
        <table className="data-table">
            <thead><tr>
                <th scope="col">Name</th><th scope="col">Category</th><th scope="col">Function</th>
                <th scope="col">Price (RM)</th><th scope="col">Lead Time</th><th scope="col">Dimension</th>
                <th scope="col">Weight</th><th scope="col">Status</th><th scope="col">Actions</th>
            </tr></thead>
            <tbody>
                {rows.length === 0
                    ? <tr><td colSpan="9" style={{ textAlign: 'center', color: 'var(--gray-400)', padding: '32px' }}>No Bujishu items added yet.</td></tr>
                    : rows.map((item) => (
                        <tr key={item.id} style={!item.is_active ? { opacity: 0.6, background: '#f9fafb' } : undefined}>
                            <td><strong>{item.name}</strong></td>
                            <td>{item.category || '-'}</td>
                            <td>{item.function_desc || '-'}</td>
                            <td>{item.price || 0}</td>
                            <td>{item.delivery_lead_time || '-'}</td>
                            <td>{item.product_dimension || '-'}</td>
                            <td>{item.product_weight || '-'}</td>
                            <td><StatusBadge active={!!item.is_active} /></td>
                            <RowActions id={item.id} />
                        </tr>
                    ))}
            </tbody>
        </table>
    );
}

function FormulaTable({ rows }) {
    return (
        <table className="data-table">
            <thead><tr>
                <th scope="col">Name</th><th scope="col">Category</th><th scope="col">Functions</th>
                <th scope="col">Pills/Bottles</th><th scope="col">Dosage</th><th scope="col">Price (RM)</th>
                <th scope="col">Lead Time</th><th scope="col">Status</th><th scope="col">Actions</th>
            </tr></thead>
            <tbody>
                {rows.length === 0
                    ? <tr><td colSpan="9" style={{ textAlign: 'center', color: 'var(--gray-400)', padding: '32px' }}>No Formula items added yet.</td></tr>
                    : rows.map((item) => {
                        const hasDosage = item.capsules_per_bottle && item.daily_dosage;
                        return (
                            <tr key={item.id} style={!item.is_active ? { opacity: 0.6, background: '#f9fafb' } : undefined}>
                                <td><strong>{item.name}</strong></td>
                                <td>{item.category || '-'}</td>
                                <td>{item.functions || '-'}</td>
                                <td>{item.pills_bottles || '-'}</td>
                                <td>
                                    {hasDosage
                                        ? <span title="Capsules per bottle · daily dosage · reminder lead"><strong>{item.capsules_per_bottle}</strong> caps · <strong>{item.daily_dosage}</strong>/day<br /><small className="text-muted">{item.reminder_lead_days ?? 3}d lead · {((item.reminder_buffer_percent ?? 0.10) * 100).toFixed(0)}% buffer</small></span>
                                        : <span className="text-muted" style={{ fontSize: '11px' }}>Not configured</span>}
                                </td>
                                <td>{item.price || 0}</td>
                                <td>{item.delivery_lead_time || '-'}</td>
                                <td><StatusBadge active={!!item.is_active} /></td>
                                <RowActions id={item.id} />
                            </tr>
                        );
                    })}
            </tbody>
        </table>
    );
}

function MasterTable({ tab, rows }) {
    if (tab === 'products') return <ProductsTable rows={rows} />;
    if (tab === 'events') return <EventsTable rows={rows} />;
    if (tab === 'venues') return <VenuesTable rows={rows} />;
    if (tab === 'bujishu') return <BujishuTable rows={rows} />;
    if (tab === 'formula') return <FormulaTable rows={rows} />;
    return null;
}

export function MarketingListsView({ tab = 'products', rows = [], isTeamLeader = false, legacyHtml = '' }) {
    try {
        window.__REACT_MKTLISTS_STATE = 'ready';
        window.__REACT_MKTLISTS_TAB = tab;
        window.__REACT_MKTLISTS_ROWS = MASTER_TABS.includes(tab) ? rows.length : null;
    } catch (_) { /* noop */ }

    const isMaster = MASTER_TABS.includes(tab);

    let actionBtn = null;
    if (tab === 'special_programs') {
        if (isTeamLeader) actionBtn = <button className="btn primary" onClick={() => call('openSpecialProgramModal')}><i className="fas fa-plus"></i> New Program</button>;
    } else if (tab !== 'promotions') {
        actionBtn = <button className="btn primary" onClick={() => call('openMarketingListAddModal')}><i className="fas fa-plus"></i> New {NEW_LABEL[tab] || tab}</button>;
    }

    return (
        <div className="marketing-lists-view" style={{ padding: '24px' }}>
            <div className="view-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
                <div>
                    <h1>Product &amp; Event Manager</h1>
                    <p className="text-muted">Manage master data for products, events, and monthly promotions.</p>
                </div>
                <div className="header-actions">{actionBtn}</div>
            </div>

            <div className="tabs-container" style={{ marginBottom: '20px', borderBottom: '1px solid var(--gray-200)', display: 'flex', gap: '20px' }}>
                {TABS.map((t) => {
                    const active = tab === t.key;
                    return (
                        <div key={t.key} className={`tab-item ${active ? 'active' : ''}`} onClick={() => call('switchMarketingListTab', t.key)}
                            style={{ padding: '10px 16px', cursor: 'pointer', borderBottom: `2px solid ${active ? 'var(--primary-600)' : 'transparent'}`, color: active ? 'var(--primary-600)' : 'var(--gray-600)', fontWeight: 500 }}>
                            {t.label}
                        </div>
                    );
                })}
            </div>

            {/* Master tabs render React tables; promotions/special_programs use the
                chunk's pre-rendered legacy HTML (inline app.* handlers still resolve). */}
            {isMaster
                ? <div id="marketing-list-content"><MasterTable tab={tab} rows={rows} /></div>
                : <div id="marketing-list-content" dangerouslySetInnerHTML={{ __html: legacyHtml }} />}
        </div>
    );
}
