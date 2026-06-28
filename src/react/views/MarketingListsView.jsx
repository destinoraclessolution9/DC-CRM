// Product & Event Manager — tabbed master-data view (view id 'marketing_lists').
//
// Island renders the shell (header + role/tab-gated action button + 7-tab bar)
// and React tables for the FIVE master-data tabs (products/events/venues/
// bujishu/formula) from chunk-computed data. The two complex passthrough tabs —
// promotions (mirrors chunk renderPackagesTab) and special_programs (mirrors
// cross-chunk renderSpecialProgramsTable) — now ALSO render as real JSX from a
// structured payload the chunk passes through the existing `rows` prop (the
// mount in main.jsx forwards only tab/rows/isTeamLeader/legacyHtml — unchanged).
// FALLBACK: when the chunk's per-view kill-switch is off, or the payload build
// throws, `rows` is the empty array and we render the chunk's pre-rendered
// legacy HTML via dangerouslySetInnerHTML exactly as before. The stable
// <div id="marketing-list-content"> container is kept on every path so the
// legacy by-id fallback still works. Tab clicks + every mutation stay in the
// chunk via app.* (switchMarketingListTab, openMarketingListAddModal/EditModal,
// deleteMarketingListItem, viewProductImage, showProductPriceHistory,
// updateVenueSequence, openSpecialProgramModal, openCreatePackageModal,
// viewPackageCustomers, deletePackage, filterPackages, deleteSpecialProgram).
// React auto-escapes every field these tables interpolated raw — XSS hardening
// across every JSX table.
import React from 'react';
import { EmptyState } from '../ui/EmptyState.jsx';

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

// ── Promotions tab (mirrors chunk renderPackagesTab/renderPackageRow 1:1). ──
const pkgThStyle = { padding: '11px 14px', fontSize: '12px', fontWeight: 700, whiteSpace: 'nowrap', color: '#fff', background: '#8B1A1A', borderRight: '1px solid rgba(255,255,255,0.15)' };
const pkgThLastStyle = { padding: '11px 14px', fontSize: '12px', fontWeight: 700, whiteSpace: 'nowrap', color: '#fff', background: '#8B1A1A' };
const pkgTdStyle = { padding: '11px 14px', borderBottom: '1px solid var(--gray-200)', fontSize: '13px', verticalAlign: 'middle' };

function PackageDiscount({ discount }) {
    if (!discount || discount.kind === 'none') return <span style={{ color: '#aaa' }}>—</span>;
    if (discount.kind === 'save') {
        return (
            <span>
                <span style={{ color: '#888', textDecoration: 'line-through', fontSize: '11px' }}>RM {discount.original}</span><br />
                <span style={{ color: '#c53030', fontWeight: 700, fontSize: '11px' }}>Save {discount.savePct}%</span>
            </span>
        );
    }
    return <span style={{ fontSize: '12px' }}>RM {discount.original}</span>;
}

function PackageRow({ row }) {
    const rowStyle = row.dimmed ? { opacity: 0.62, background: '#fafafa' } : undefined;
    return (
        <tr style={rowStyle}
            onMouseOver={(e) => { const t = e.currentTarget; if (!t.style.opacity || t.style.opacity == 1) t.style.background = '#fdf8f8'; }}
            onMouseOut={(e) => { const t = e.currentTarget; if (!t.style.opacity || t.style.opacity == 1) t.style.background = ''; }}>
            <td style={pkgTdStyle}>
                <a href="javascript:void(0)" onClick={() => call('viewPackageCustomers', row.id)} style={{ fontWeight: 600, color: '#8B1A1A' }}>{row.name}</a>
            </td>
            <td style={{ ...pkgTdStyle, color: '#555' }} title={row.productNames}>{row.shortProducts}</td>
            <td style={{ ...pkgTdStyle, fontWeight: 700 }}>RM {row.priceFmt}</td>
            <td style={pkgTdStyle}><PackageDiscount discount={row.discount} /></td>
            <td style={{ ...pkgTdStyle, fontSize: '12px', color: '#555', maxWidth: '140px' }}>
                {row.requirement ? row.requirement : <span style={{ color: '#aaa' }}>—</span>}
            </td>
            <td style={{ ...pkgTdStyle, textAlign: 'center' }}>
                {row.limitedSlots
                    ? <span><strong>{row.limitedSlots}</strong> <span style={{ color: '#aaa', fontSize: '11px' }}>sets</span></span>
                    : <span style={{ color: '#aaa' }}>—</span>}
            </td>
            <td style={{ ...pkgTdStyle, fontSize: '12px' }}>
                {row.timeFrame
                    ? <span style={{ whiteSpace: 'nowrap' }}>{row.timeFrame}</span>
                    : <span style={{ color: '#aaa' }}>Ongoing</span>}
            </td>
            <td style={pkgTdStyle}>
                <span className={`status-badge ${row.status.cls}`} style={cssTextToObj(row.status.style)}>{row.status.label}</span>
            </td>
            <td style={pkgTdStyle}>
                <div className="table-actions">
                    <button className="btn-icon" onClick={(e) => { e.stopPropagation(); call('openCreatePackageModal', row.id); }} title="Edit"><i className="fas fa-edit"></i></button>
                    <button className="btn-icon" onClick={(e) => { e.stopPropagation(); call('viewPackageCustomers', row.id); }} title="View Customers"><i className="fas fa-users"></i></button>
                    <button className="btn-icon text-danger" onClick={(e) => { e.stopPropagation(); call('deletePackage', row.id); }} title="Delete"><i className="fas fa-trash"></i></button>
                </div>
            </td>
        </tr>
    );
}

// Parse the small inline "background:#x;color:#y;" status styles the chunk emits
// into a React style object so the badges render byte-identically.
function cssTextToObj(cssText) {
    const obj = {};
    if (!cssText) return obj;
    String(cssText).split(';').forEach((decl) => {
        const i = decl.indexOf(':');
        if (i < 0) return;
        const prop = decl.slice(0, i).trim();
        const val = decl.slice(i + 1).trim();
        if (!prop || !val) return;
        const camel = prop.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
        obj[camel] = val;
    });
    return obj;
}

function PromotionsTab({ data }) {
    const showExpiredDivider = data.expired && data.expired.length > 0;
    return (
        <div className="packages-layout" style={{ padding: '24px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '18px' }}>
                <div>
                    <h3 style={{ margin: '0 0 4px' }}>Promotion Packages</h3>
                    <p className="text-muted" style={{ margin: 0 }}>Manage bundled offers and track customer purchases</p>
                </div>
                <button className="btn primary" onClick={() => call('openCreatePackageModal')}><i className="fas fa-plus"></i> New Package</button>
            </div>

            <div style={{ display: 'flex', gap: '12px', marginBottom: '18px', flexWrap: 'wrap' }}>
                <div style={{ position: 'relative', flex: 1, minWidth: '200px' }}>
                    <i className="fas fa-search" style={{ position: 'absolute', left: '11px', top: '50%', transform: 'translateY(-50%)', color: 'var(--gray-400)', fontSize: '13px' }}></i>
                    <input type="text" id="package-search" className="form-control" placeholder="Search by package name or product…" style={{ paddingLeft: '34px' }} onKeyUp={() => call('filterPackages')} />
                </div>
                <select id="package-status-filter" className="form-control" style={{ width: '160px' }} onChange={() => call('filterPackages')}>
                    <option value="all">All Status</option>
                    <option value="active">Active</option>
                    <option value="upcoming">Upcoming</option>
                    <option value="inactive">Inactive</option>
                    <option value="expired">Expired</option>
                </select>
            </div>

            <div style={{ overflowX: 'auto', borderRadius: '6px', boxShadow: '0 1px 4px rgba(0,0,0,0.08)' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: '880px' }}>
                    <thead>
                        <tr>
                            <th scope="col" style={pkgThStyle}>Package Name</th>
                            <th scope="col" style={pkgThStyle}>Product / Service</th>
                            <th scope="col" style={pkgThStyle}>Amount (RM)</th>
                            <th scope="col" style={pkgThStyle}>Discounted Value Worth</th>
                            <th scope="col" style={pkgThStyle}>Requirement</th>
                            <th scope="col" style={{ ...pkgThStyle, textAlign: 'center' }}>Limited To (Sets)</th>
                            <th scope="col" style={pkgThStyle}>Time Frame</th>
                            <th scope="col" style={pkgThStyle}>Status</th>
                            <th scope="col" style={pkgThLastStyle}>Actions</th>
                        </tr>
                    </thead>
                    <tbody id="packages-table-body">
                        {data.empty
                            ? <tr><td colSpan={9}><EmptyState icon="fa-tags" title="No promotion packages" description='Click "+ New Package" to create one.' /></td></tr>
                            : <>
                                {data.active.map((r) => <PackageRow key={r.id} row={r} />)}
                                {showExpiredDivider && (
                                    <tr>
                                        <td colSpan="9" style={{ padding: '7px 14px', background: '#f7f7f7', color: '#999', fontSize: '11px', textAlign: 'center', letterSpacing: '1.5px', fontWeight: 700, borderBottom: '1px solid var(--gray-200)' }}>
                                            ── EXPIRED PROMOTIONS ──
                                        </td>
                                    </tr>
                                )}
                                {data.expired.map((r) => <PackageRow key={r.id} row={r} />)}
                            </>}
                    </tbody>
                </table>
            </div>
        </div>
    );
}

// ── Special Programs tab (mirrors features2 renderSpecialProgramsTable 1:1). ──
function SpecialProgramCell({ t }) {
    if (!t) return <td style={{ padding: '10px', color: 'var(--gray-300)', textAlign: 'center' }}>—</td>;
    return (
        <td style={{ padding: '10px', borderBottom: '1px solid var(--gray-100)', minWidth: '160px' }}>
            <div style={{ fontSize: '12px', fontWeight: 600, marginBottom: '3px' }}>{t.display}</div>
            <div style={{ background: '#eee', borderRadius: '4px', height: '6px', overflow: 'hidden', marginBottom: '3px' }}>
                <div style={{ background: t.color, height: '100%', width: `${t.pct}%`, transition: 'width .3s' }}></div>
            </div>
            <div style={{ fontSize: '11px', color: 'var(--gray-500)' }}>{t.pct}% · {t.remaining > 0 ? `${t.remainingDisplay} to go` : '✓ Hit'}</div>
        </td>
    );
}

function SpecialProgramRow({ r, canManage }) {
    const statusBadge = r.noParticipants
        ? <span style={{ background: '#f3f4f6', color: '#6b7280', padding: '3px 10px', borderRadius: '12px', fontSize: '11px' }}>No Agents</span>
        : (r.qualified
            ? <span style={{ background: '#dcfce7', color: '#166534', padding: '3px 10px', borderRadius: '12px', fontSize: '11px', fontWeight: 600 }}>✓ Qualified</span>
            : <span style={{ background: '#fef3c7', color: '#92400e', padding: '3px 10px', borderRadius: '12px', fontSize: '11px' }}>In Progress</span>);
    const expiredBadge = r.isExpired
        ? <span style={{ background: '#f3f4f6', color: '#6b7280', padding: '2px 6px', borderRadius: '8px', fontSize: '10px', marginLeft: '6px' }}>EXPIRED</span>
        : <span style={{ background: '#fef3c7', color: '#92400e', padding: '2px 6px', borderRadius: '8px', fontSize: '10px', marginLeft: '6px' }}>{r.daysLeft}d left</span>;
    return (
        <tr style={r.isExpired ? { opacity: 0.6, background: '#f9fafb' } : undefined}>
            <td style={{ padding: '10px', borderBottom: '1px solid var(--gray-100)', minWidth: '200px' }}>
                <strong style={{ fontSize: '13px' }}>🏆 {r.programName}</strong>{expiredBadge}
                <div style={{ fontSize: '11px', color: 'var(--gray-500)', marginTop: '3px' }}>🎁 {r.reward}</div>
                <div style={{ fontSize: '10px', color: 'var(--gray-400)', marginTop: '2px' }}>{r.startDate} → {r.endDate}</div>
            </td>
            <td style={{ padding: '10px', borderBottom: '1px solid var(--gray-100)', minWidth: '160px' }}>
                {r.noParticipants
                    ? <span style={{ color: 'var(--gray-400)', fontStyle: 'italic' }}>No participants</span>
                    : <>
                        <strong style={{ fontSize: '13px' }}>{r.agentName}</strong>
                        <div style={{ fontSize: '11px', color: 'var(--gray-500)', marginTop: '2px' }}>{r.agentRole}</div>
                    </>}
            </td>
            <SpecialProgramCell t={r.sales} />
            <SpecialProgramCell t={r.customers} />
            <SpecialProgramCell t={r.cps} />
            <td style={{ padding: '10px', borderBottom: '1px solid var(--gray-100)', textAlign: 'center' }}>{statusBadge}</td>
            <td style={{ padding: '10px', borderBottom: '1px solid var(--gray-100)', whiteSpace: 'nowrap' }}>
                {canManage && <>
                    <button className="btn-icon" onClick={() => call('openSpecialProgramModal', r.programId)} title="Edit"><i className="fas fa-pencil-alt"></i></button>
                    <button className="btn-icon text-danger" onClick={() => call('deleteSpecialProgram', r.programId)} title="Delete"><i className="fas fa-trash-alt"></i></button>
                </>}
            </td>
        </tr>
    );
}

function SpecialProgramsTab({ data }) {
    if (data.empty) {
        return (
            <EmptyState
                icon="fa-trophy"
                title="No Active Special Programs"
                description={data.canManage ? 'Click "New Program" to launch a new challenge for selected agents.' : 'No special programs have been launched yet.'}
            />
        );
    }
    return (
        <>
            <div style={{ marginBottom: '12px', color: 'var(--gray-500)', fontSize: '13px' }}>
                Track each agent's progress toward their special program targets. Bars show how much they have made and how far to go.
            </div>
            <div style={{ overflowX: 'auto' }}>
                <table className="data-table" style={{ width: '100%' }}>
                    <thead>
                        <tr>
                            <th scope="col" style={{ textAlign: 'left' }}>Program</th>
                            <th scope="col" style={{ textAlign: 'left' }}>Agent</th>
                            <th scope="col" style={{ textAlign: 'left' }}>Total Sales</th>
                            <th scope="col" style={{ textAlign: 'left' }}>New Customers</th>
                            <th scope="col" style={{ textAlign: 'left' }}>CPS Count</th>
                            <th scope="col" style={{ textAlign: 'center' }}>Status</th>
                            <th scope="col" style={{ textAlign: 'left' }}>Actions</th>
                        </tr>
                    </thead>
                    <tbody>
                        {data.rows.map((r, i) => <SpecialProgramRow key={r.programId + '|' + (r.agentId ?? i)} r={r} canManage={data.canManage} />)}
                    </tbody>
                </table>
            </div>
        </>
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

// A passthrough tab renders JSX iff `rows` is the structured payload object the
// chunk built (kind matches the tab). Otherwise (flag off / payload-build threw →
// rows is the empty array) we fall back to the chunk's pre-rendered legacy HTML.
function _passthroughPayload(tab, rows) {
    if (Array.isArray(rows) || !rows || typeof rows !== 'object') return null;
    if (tab === 'promotions' && rows.kind === 'promotions') return rows;
    if (tab === 'special_programs' && rows.kind === 'special_programs') return rows;
    return null;
}

export function MarketingListsView({ tab = 'products', rows = [], isTeamLeader = false, isSuperAdmin = false, legacyHtml = '' }) {
    const isMaster = MASTER_TABS.includes(tab);
    const passthrough = isMaster ? null : _passthroughPayload(tab, rows);

    try {
        window.__REACT_MKTLISTS_STATE = 'ready';
        window.__REACT_MKTLISTS_TAB = tab;
        window.__REACT_MKTLISTS_ROWS = isMaster ? (Array.isArray(rows) ? rows.length : 0) : null;
    } catch (_) { /* noop */ }

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
                {/* NPO — Super-Admin only. Lives here (not a sidebar tab); opens the
                    full NPO management view via the chunk's switchMarketingListTab('npo'). */}
                {isSuperAdmin && (
                    <div className="tab-item" onClick={() => call('switchMarketingListTab', 'npo')}
                        style={{ padding: '10px 16px', cursor: 'pointer', borderBottom: '2px solid transparent', color: 'var(--gray-600)', fontWeight: 500 }}>
                        <i className="fas fa-file-invoice-dollar" style={{ marginRight: '6px' }}></i>NPO
                    </div>
                )}
            </div>

            {/* Master tabs render React tables. The promotions + special_programs
                passthrough tabs now ALSO render real JSX when the chunk passes a
                structured payload through `rows` (kill-switch on). When the
                kill-switch is off / the payload build threw, `rows` is the empty
                array and we fall back to the chunk's pre-rendered legacy HTML via
                dangerouslySetInnerHTML — byte-for-byte today's behavior. */}
            {isMaster
                ? <div id="marketing-list-content"><MasterTable tab={tab} rows={rows} /></div>
                : passthrough
                    ? <div id="marketing-list-content">
                        {tab === 'promotions'
                            ? <PromotionsTab data={passthrough} />
                            : <SpecialProgramsTab data={passthrough} />}
                      </div>
                    : <div id="marketing-list-content" dangerouslySetInnerHTML={{ __html: legacyHtml }} />}
        </div>
    );
}
