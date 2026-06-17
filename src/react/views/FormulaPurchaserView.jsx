// Formula Purchaser — scaffold-shell island (view id 'formula_purchaser', Super-Admin).
//
// TWO render paths live here:
//
// 1) FULL-JSX (props.data present — new default-OFF flag _reactFpJsxOn in the
//    chunk → ?react_fp_jsx=1 / localStorage crm_react_fp_jsx='1'): React owns the
//    WHOLE view and renders all 6 tabs as REAL JSX from props.data. Tab switching
//    is React state (useState) — the legacy by-id fpSwitchTab is NEVER called on
//    this path. Primary actions call the existing window.app.* handlers
//    (fpRunReplenishmentCheck, fpProposePoFromLowStock, fpReceivePo, fpExportPoExcel,
//    fpExecuteTransfer, fpOpenVendorModal, fpDeleteVendor, fpSaveActualMin, etc.).
//    Text is rendered as JSX children (React auto-escapes) — never innerHTML.
//
// 2) SCAFFOLD-SHELL (props.data absent — flag-off / build failed / kill-switch):
//    React owns ONLY the static shell (header + Import dropdown + Refresh + 6-tab
//    bar + empty #fp-tab-content). ALL logic stays in the chunk; the useEffect
//    calls onReady → fpLoadData() then fpSwitchTab(tab), which fills
//    #fp-tab-content via fpRender* + active-tab styling. This branch is UNCHANGED.
import React, { useEffect, useState } from 'react';

const app = () => window.app || {};
const call = (name, ...args) => { const f = app()[name]; if (typeof f === 'function') return f(...args); };

const hov = (on) => (e) => { e.currentTarget.style.background = on ? '#f3f4f6' : ''; };
const menuItem = { padding: '8px 14px', cursor: 'pointer' };

const FP_TABS = [
    { key: 'dashboard', label: 'Dashboard', icon: 'fa-chart-line' },
    { key: 'pos', label: 'Purchase Orders', icon: 'fa-file-invoice' },
    { key: 'transfers', label: 'Transfers', icon: 'fa-exchange-alt' },
    { key: 'stock', label: 'Stock Inquiry', icon: 'fa-warehouse' },
    { key: 'vendors', label: 'Vendors', icon: 'fa-truck' },
    { key: 'exclusions', label: 'Exclusions & Deals', icon: 'fa-ban' },
];

// ── Shared header (Import dropdown + Refresh) ───────────────────────────────
function FpHeader() {
    return (
        <div className="fp-header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '20px', flexWrap: 'wrap', gap: '12px' }}>
            <div>
                <h1 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <i className="fas fa-flask" style={{ color: '#0ea5e9' }}></i> Formula Purchaser
                </h1>
                <div style={{ color: 'var(--gray-500)', fontSize: '13px', marginTop: '4px' }}>Stock replenishment, multi-outlet distribution &amp; PO generation. Super Admin only.</div>
            </div>
            <div style={{ display: 'flex', gap: '8px' }}>
                <div style={{ position: 'relative' }}>
                    <button className="btn secondary" onClick={() => call('fpToggleImportMenu')}><i className="fas fa-file-import"></i> Import ▾</button>
                    <div id="fp-import-menu" style={{ display: 'none', position: 'absolute', right: 0, top: '100%', marginTop: '4px', background: '#fff', border: '1px solid var(--gray-200)', borderRadius: '8px', boxShadow: '0 4px 12px rgba(0,0,0,0.1)', minWidth: '220px', zIndex: 100 }}>
                        <div style={{ ...menuItem, borderBottom: '1px solid var(--gray-100)' }} onMouseOver={hov(true)} onMouseOut={hov(false)} onClick={() => call('fpImportStock')}>
                            <i className="fas fa-boxes" style={{ width: '18px', color: '#0ea5e9' }}></i> Stock Snapshot
                        </div>
                        <div style={{ ...menuItem, borderBottom: '1px solid var(--gray-100)' }} onMouseOver={hov(true)} onMouseOut={hov(false)} onClick={() => call('fpImportPos')}>
                            <i className="fas fa-cash-register" style={{ width: '18px', color: '#10b981' }}></i> POS Sales History
                        </div>
                        <div style={menuItem} onMouseOver={hov(true)} onMouseOut={hov(false)} onClick={() => call('fpImportDelisted')}>
                            <i className="fas fa-ban" style={{ width: '18px', color: '#dc2626' }}></i> Delisted SKUs
                        </div>
                    </div>
                </div>
                <button className="btn secondary" onClick={() => call('fpRefresh')}><i className="fas fa-sync-alt"></i> Refresh</button>
            </div>
        </div>
    );
}

// ── Tab bar (React-state controlled on the full-JSX path) ───────────────────
function FpTabBar({ activeTab, onSelect }) {
    return (
        <div className="fp-tabs" style={{ display: 'flex', gap: '4px', borderBottom: '2px solid var(--gray-200)', marginBottom: '20px', flexWrap: 'wrap' }}>
            {FP_TABS.map((t) => {
                const isActive = t.key === activeTab;
                return (
                    <button key={t.key} className={`fp-tab-btn${isActive ? ' active' : ''}`} data-tab={t.key} onClick={() => onSelect(t.key)}
                        style={{ padding: '12px 20px', background: 'none', border: 'none', borderBottom: `3px solid ${isActive ? '#0ea5e9' : 'transparent'}`, fontWeight: 600, cursor: 'pointer', color: isActive ? '#0ea5e9' : 'var(--gray-600)' }}>
                        <i className={`fas ${t.icon}`}></i> {t.label}
                    </button>
                );
            })}
        </div>
    );
}

// ── Dashboard tab (mirrors fpRenderDashboard) ───────────────────────────────
function DashboardTab({ d }) {
    const card = (label, value, color, icon) => (
        <div style={{ flex: 1, minWidth: '180px', background: '#fff', padding: '18px', borderRadius: '10px', border: '1px solid var(--gray-200)', boxShadow: '0 1px 3px rgba(0,0,0,0.04)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', color, fontSize: '14px', fontWeight: 600, marginBottom: '8px' }}>
                <i className={`fas ${icon}`}></i> {label}
            </div>
            <div style={{ fontSize: '28px', fontWeight: 700, color: 'var(--gray-800)' }}>{value}</div>
        </div>
    );
    return (
        <>
            <div style={{ display: 'flex', gap: '12px', marginBottom: '20px', flexWrap: 'wrap' }}>
                {card('Total SKUs', d.totalSkus, '#0ea5e9', 'fa-boxes')}
                {card('Low Stock', d.lowStockCount, '#ef4444', 'fa-exclamation-triangle')}
                {card('Pending POs', d.pendingPos, '#f59e0b', 'fa-file-invoice')}
                {card('Pending Transfers', d.pendingTransfers, '#8b5cf6', 'fa-exchange-alt')}
            </div>

            {d.negStockCount ? (
                <div style={{ background: '#fef2f2', border: '1px solid #fecaca', color: '#991b1b', padding: '12px 16px', borderRadius: '8px', marginBottom: '16px' }}>
                    <i className="fas fa-exclamation-circle"></i> <strong>{d.negStockCount}</strong> stock row(s) have negative quantities. Review under Stock Inquiry.
                </div>
            ) : null}

            <div style={{ display: 'flex', gap: '8px', marginBottom: '16px', flexWrap: 'wrap' }}>
                <button className="btn primary" onClick={() => call('fpRunReplenishmentCheck')}><i className="fas fa-search-plus"></i> Run Replenishment Check</button>
                <button className="btn secondary" onClick={() => call('fpRunTransferCheck')}><i className="fas fa-search-plus"></i> Run Transfer Check</button>
            </div>

            <div style={{ background: '#fff', border: '1px solid var(--gray-200)', borderRadius: '10px', overflow: 'hidden' }}>
                <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--gray-200)', fontWeight: 600, fontSize: '15px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span><i className="fas fa-list" style={{ color: '#ef4444' }}></i> Low Stock SKUs ({d.lowStockCount})</span>
                    {d.lowStockCount ? (
                        <button className="btn primary" style={{ padding: '6px 14px', fontSize: '13px' }} onClick={() => call('fpProposePoFromLowStock')}><i className="fas fa-plus"></i> Propose PO from list</button>
                    ) : null}
                </div>
                <div style={{ overflowX: 'auto', maxHeight: '520px', overflowY: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
                        <thead style={{ background: 'var(--gray-50)', position: 'sticky', top: 0 }}>
                            <tr>
                                <th scope="col" style={{ padding: '10px', textAlign: 'left' }}>Code</th>
                                <th scope="col" style={{ padding: '10px', textAlign: 'left' }}>Name</th>
                                <th scope="col" style={{ padding: '10px', textAlign: 'right' }}>Total</th>
                                <th scope="col" style={{ padding: '10px', textAlign: 'right' }}>Min</th>
                                <th scope="col" style={{ padding: '10px', textAlign: 'right' }}>Short</th>
                                <th scope="col" style={{ padding: '10px', textAlign: 'right' }}>Recommended</th>
                                <th scope="col" style={{ padding: '10px', textAlign: 'left' }}>Deal / Refund</th>
                            </tr>
                        </thead>
                        <tbody>
                            {d.lowStock.length ? d.lowStock.map((r, i) => (
                                <tr key={i} style={{ contentVisibility: 'auto', containIntrinsicSize: 'auto 36px', borderTop: '1px solid var(--gray-100)' }}>
                                    <td style={{ padding: '8px 10px', fontFamily: 'monospace', fontSize: '12px' }}>{r.code}</td>
                                    <td style={{ padding: '8px 10px' }}>{r.name}</td>
                                    <td style={{ padding: '8px 10px', textAlign: 'right', ...(r.totalStock < 0 ? { color: '#dc2626', fontWeight: 700 } : {}) }}>{r.totalStock}</td>
                                    <td style={{ padding: '8px 10px', textAlign: 'right' }}>{r.minStock}</td>
                                    <td style={{ padding: '8px 10px', textAlign: 'right', color: '#dc2626', fontWeight: 600 }}>{r.shortage}</td>
                                    <td style={{ padding: '8px 10px', textAlign: 'right', fontWeight: 700, color: '#0ea5e9' }}>{r.recommendedQty}{r.freeQty ? <span style={{ color: '#10b981' }}> +{r.freeQty} free</span> : null}</td>
                                    <td style={{ padding: '8px 10px', fontSize: '11px', color: 'var(--gray-600)' }}>
                                        {r.deal ? <span style={{ background: '#fef3c7', color: '#92400e', padding: '2px 6px', borderRadius: '4px' }}>Buy {r.deal.x} get {r.deal.y}</span> : null}
                                        {r.refundRate > 0.05 ? <span style={{ background: '#fee2e2', color: '#991b1b', padding: '2px 6px', borderRadius: '4px', marginLeft: '4px' }}>Refund {(r.refundRate * 100).toFixed(0)}%</span> : null}
                                    </td>
                                </tr>
                            )) : (
                                <tr><td colSpan={7} style={{ padding: '40px', textAlign: 'center', color: 'var(--gray-500)' }}>All SKUs are above minimum stock. {d.totalSkus === 0 ? 'Import stock data to begin.' : ''}</td></tr>
                            )}
                        </tbody>
                    </table>
                </div>
            </div>
        </>
    );
}

// ── Purchase Orders tab (mirrors fpRenderPurchaseOrders) ────────────────────
function StatusBadge({ status, map }) {
    const [bg, fg] = map[status] || Object.values(map)[0];
    return <span style={{ background: bg, color: fg, padding: '3px 10px', borderRadius: '12px', fontSize: '11px', fontWeight: 600, textTransform: 'uppercase' }}>{String(status).replace('_', ' ')}</span>;
}

function PosTab({ d }) {
    const poColors = { draft: ['#f3f4f6', '#374151'], submitted: ['#dbeafe', '#1e40af'], received: ['#d1fae5', '#065f46'], cancelled: ['#fee2e2', '#991b1b'] };
    return (
        <>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                <h2 style={{ margin: 0, fontSize: '18px' }}>Purchase Orders</h2>
                <button className="btn primary" onClick={() => call('fpProposePoFromLowStock')}><i className="fas fa-plus"></i> New PO from Low Stock</button>
            </div>
            <div style={{ background: '#fff', border: '1px solid var(--gray-200)', borderRadius: '10px', overflow: 'hidden' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
                    <thead style={{ background: 'var(--gray-50)' }}>
                        <tr>
                            <th scope="col" style={{ padding: '10px', textAlign: 'left' }}>PO #</th>
                            <th scope="col" style={{ padding: '10px', textAlign: 'left' }}>Vendor</th>
                            <th scope="col" style={{ padding: '10px', textAlign: 'left' }}>Branch</th>
                            <th scope="col" style={{ padding: '10px', textAlign: 'left' }}>Date</th>
                            <th scope="col" style={{ padding: '10px', textAlign: 'right' }}>Items</th>
                            <th scope="col" style={{ padding: '10px', textAlign: 'center' }}>Status</th>
                            <th scope="col" style={{ padding: '10px', textAlign: 'right' }}>Actions</th>
                        </tr>
                    </thead>
                    <tbody>
                        {d.orders.length ? d.orders.map((p) => (
                            <tr key={p.id} style={{ borderTop: '1px solid var(--gray-100)' }}>
                                <td style={{ padding: '8px 10px', fontFamily: 'monospace', fontWeight: 600 }}>{p.poNumber}</td>
                                <td style={{ padding: '8px 10px' }}>{p.vendor}</td>
                                <td style={{ padding: '8px 10px' }}>{p.branch}</td>
                                <td style={{ padding: '8px 10px' }}>{p.orderDate}</td>
                                <td style={{ padding: '8px 10px', textAlign: 'right' }}>{p.items}</td>
                                <td style={{ padding: '8px 10px', textAlign: 'center' }}><StatusBadge status={p.status} map={poColors} /></td>
                                <td style={{ padding: '8px 10px', textAlign: 'right', whiteSpace: 'nowrap' }}>
                                    <button className="btn secondary" style={{ padding: '4px 10px', fontSize: '12px' }} onClick={() => call('fpExportPoExcel', p.id)}><i className="fas fa-file-excel"></i> Excel</button>
                                    {p.status !== 'received' && p.status !== 'cancelled' ? (
                                        <button className="btn primary" style={{ padding: '4px 10px', fontSize: '12px' }} onClick={async () => { await call('fpReceivePo', p.id); call('fpRefresh'); }}><i className="fas fa-check"></i> Receive</button>
                                    ) : null}
                                </td>
                            </tr>
                        )) : (
                            <tr><td colSpan={7} style={{ padding: '40px', textAlign: 'center', color: 'var(--gray-500)' }}>No purchase orders yet. Click "New PO from Low Stock" to create one.</td></tr>
                        )}
                    </tbody>
                </table>
            </div>
        </>
    );
}

// ── Transfers tab (mirrors fpRenderTransfers) ───────────────────────────────
function TransfersTab({ d }) {
    const trColors = { pending: ['#fef3c7', '#92400e'], in_transit: ['#dbeafe', '#1e40af'], completed: ['#d1fae5', '#065f46'], cancelled: ['#fee2e2', '#991b1b'] };
    return (
        <>
            <h2 style={{ margin: '0 0 14px', fontSize: '18px' }}>Recommended Transfers ({d.recs.length})</h2>
            <div style={{ background: '#fff', border: '1px solid var(--gray-200)', borderRadius: '10px', overflow: 'hidden', marginBottom: '24px' }}>
                <div style={{ overflowX: 'auto', maxHeight: '400px', overflowY: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
                        <thead style={{ background: 'var(--gray-50)', position: 'sticky', top: 0 }}>
                            <tr>
                                <th scope="col" style={{ padding: '10px', textAlign: 'left' }}>Outlet</th>
                                <th scope="col" style={{ padding: '10px', textAlign: 'left' }}>SKU</th>
                                <th scope="col" style={{ padding: '10px', textAlign: 'right' }}>Outlet Stock</th>
                                <th scope="col" style={{ padding: '10px', textAlign: 'right' }}>Outlet Min</th>
                                <th scope="col" style={{ padding: '10px', textAlign: 'right' }}>Hub Stock</th>
                                <th scope="col" style={{ padding: '10px', textAlign: 'right' }}>Transfer Qty</th>
                                <th scope="col" style={{ padding: '10px', textAlign: 'right' }}>Action</th>
                            </tr>
                        </thead>
                        <tbody>
                            {d.recs.length ? d.recs.map((r) => (
                                <tr key={r.idx} style={{ contentVisibility: 'auto', containIntrinsicSize: 'auto 36px', borderTop: '1px solid var(--gray-100)' }}>
                                    <td style={{ padding: '8px 10px' }}>{r.outlet}</td>
                                    <td style={{ padding: '8px 10px', fontFamily: 'monospace', fontSize: '12px' }}>{r.code} <span style={{ color: 'var(--gray-500)', fontFamily: 'initial' }}>— {r.name}</span></td>
                                    <td style={{ padding: '8px 10px', textAlign: 'right' }}>{r.currentStock}</td>
                                    <td style={{ padding: '8px 10px', textAlign: 'right' }}>{r.outletMin}</td>
                                    <td style={{ padding: '8px 10px', textAlign: 'right' }}>{r.hubStock}</td>
                                    <td style={{ padding: '8px 10px', textAlign: 'right', fontWeight: 700, color: '#0ea5e9' }}>{r.transferQty}</td>
                                    <td style={{ padding: '8px 10px', textAlign: 'right' }}>
                                        <button className="btn primary" style={{ padding: '4px 10px', fontSize: '12px' }} onClick={async () => { await call('fpExecuteTransfer', r.idx); call('fpRefresh'); }}><i className="fas fa-paper-plane"></i> Execute</button>
                                    </td>
                                </tr>
                            )) : (
                                <tr><td colSpan={7} style={{ padding: '40px', textAlign: 'center', color: 'var(--gray-500)' }}>No transfers recommended.</td></tr>
                            )}
                        </tbody>
                    </table>
                </div>
            </div>

            <h2 style={{ margin: '0 0 14px', fontSize: '18px' }}>Transfer History</h2>
            <div style={{ background: '#fff', border: '1px solid var(--gray-200)', borderRadius: '10px', overflow: 'hidden' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
                    <thead style={{ background: 'var(--gray-50)' }}>
                        <tr>
                            <th scope="col" style={{ padding: '10px', textAlign: 'left' }}>Date</th>
                            <th scope="col" style={{ padding: '10px', textAlign: 'left' }}>From</th>
                            <th scope="col" style={{ padding: '10px', textAlign: 'left' }}>To</th>
                            <th scope="col" style={{ padding: '10px', textAlign: 'right' }}>Items</th>
                            <th scope="col" style={{ padding: '10px', textAlign: 'center' }}>Status</th>
                        </tr>
                    </thead>
                    <tbody>
                        {d.history.length ? d.history.map((t, i) => (
                            <tr key={i} style={{ borderTop: '1px solid var(--gray-100)' }}>
                                <td style={{ padding: '8px 10px' }}>{t.transferDate}</td>
                                <td style={{ padding: '8px 10px' }}>{t.from}</td>
                                <td style={{ padding: '8px 10px' }}>{t.to}</td>
                                <td style={{ padding: '8px 10px', textAlign: 'right' }}>{t.items}</td>
                                <td style={{ padding: '8px 10px', textAlign: 'center' }}><StatusBadge status={t.status} map={trColors} /></td>
                            </tr>
                        )) : (
                            <tr><td colSpan={5} style={{ padding: '30px', textAlign: 'center', color: 'var(--gray-500)' }}>No transfers yet.</td></tr>
                        )}
                    </tbody>
                </table>
            </div>
        </>
    );
}

// ── Stock Inquiry tab (mirrors fpRenderStockInquiry) ────────────────────────
function StockTab({ d }) {
    // Local search state — filter the (already-capped) payload rows client-side.
    const [search, setSearch] = useState(d.search || '');
    const q = (search || '').toLowerCase();
    const filtered = q ? d.skus.filter((s) => (s.code || '').toLowerCase().includes(q) || (s.name || '').toLowerCase().includes(q)) : d.skus;
    return (
        <>
            <div style={{ display: 'flex', gap: '8px', marginBottom: '14px', alignItems: 'center' }}>
                <input placeholder="Search by code or name..." value={search} onChange={(e) => setSearch(e.target.value)}
                    style={{ flex: 1, padding: '10px', border: '1px solid #d1d5db', borderRadius: '6px' }} />
                <span style={{ color: 'var(--gray-500)', fontSize: '13px' }}>{filtered.length} of {d.totalSkus}</span>
            </div>
            <div style={{ background: '#fff', border: '1px solid var(--gray-200)', borderRadius: '10px', overflow: 'hidden' }}>
                <div style={{ overflowX: 'auto', maxHeight: '600px', overflowY: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
                        <thead style={{ background: 'var(--gray-50)', position: 'sticky', top: 0 }}>
                            <tr>
                                <th scope="col" style={{ padding: '10px', textAlign: 'left' }}>Code</th>
                                <th scope="col" style={{ padding: '10px', textAlign: 'left' }}>Name</th>
                                {d.locs.map((l) => <th key={l.id} scope="col" style={{ padding: '10px', textAlign: 'right' }}>{l.short}</th>)}
                                <th scope="col" style={{ padding: '10px', textAlign: 'right' }}>Total</th>
                                <th scope="col" style={{ padding: '10px', textAlign: 'right' }}>Auto Min</th>
                                <th scope="col" style={{ padding: '10px', textAlign: 'right' }}>Actual Min</th>
                                <th scope="col" style={{ padding: '10px', textAlign: 'right' }}>Cost</th>
                            </tr>
                        </thead>
                        <tbody>
                            {filtered.length ? filtered.map((s) => (
                                <tr key={s.id} style={{ borderTop: '1px solid var(--gray-100)' }}>
                                    <td style={{ padding: '6px 10px', fontFamily: 'monospace' }}>{s.code}</td>
                                    <td style={{ padding: '6px 10px' }}>{s.name}</td>
                                    {s.perLoc.map((v, li) => (
                                        <td key={li} style={{ padding: '6px 10px', textAlign: 'right', ...(v < 0 ? { color: '#dc2626', fontWeight: 700 } : {}) }}>{v}</td>
                                    ))}
                                    <td style={{ padding: '6px 10px', textAlign: 'right', fontWeight: 600, ...(s.total < 0 ? { color: '#dc2626' } : {}) }}>{s.total}</td>
                                    <td style={{ padding: '6px 10px', textAlign: 'right', color: 'var(--gray-500)' }}>{s.autoMin}</td>
                                    <td style={{ padding: '6px 10px', textAlign: 'right' }}>
                                        <input type="number" min="0" defaultValue={s.actualMin} placeholder="auto"
                                            onChange={(e) => call('fpSaveActualMin', s.id, e.target.value)}
                                            style={{ width: '60px', padding: '3px', border: '1px solid #d1d5db', borderRadius: '4px', textAlign: 'right' }} />
                                    </td>
                                    <td style={{ padding: '6px 10px', textAlign: 'right' }}>
                                        <input type="number" min="0" step="0.01" defaultValue={s.unitCost} placeholder="—"
                                            onChange={(e) => call('fpSaveUnitCost', s.id, e.target.value)}
                                            style={{ width: '70px', padding: '3px', border: '1px solid #d1d5db', borderRadius: '4px', textAlign: 'right' }} />
                                    </td>
                                </tr>
                            )) : (
                                <tr><td colSpan={d.locs.length + 6} style={{ padding: '40px', textAlign: 'center', color: 'var(--gray-500)' }}>No SKUs found. Import stock to begin.</td></tr>
                            )}
                        </tbody>
                    </table>
                </div>
            </div>
        </>
    );
}

// ── Vendors tab (mirrors fpRenderVendors) ───────────────────────────────────
function VendorsTab({ d }) {
    return (
        <>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
                <h2 style={{ margin: 0, fontSize: '18px' }}>Vendors</h2>
                <button className="btn primary" onClick={() => call('fpOpenVendorModal')}><i className="fas fa-plus"></i> Add Vendor</button>
            </div>
            <div style={{ background: '#fff', border: '1px solid var(--gray-200)', borderRadius: '10px', overflow: 'hidden' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
                    <thead style={{ background: 'var(--gray-50)' }}>
                        <tr>
                            <th scope="col" style={{ padding: '10px', textAlign: 'left' }}>Name</th>
                            <th scope="col" style={{ padding: '10px', textAlign: 'left' }}>Address</th>
                            <th scope="col" style={{ padding: '10px', textAlign: 'left' }}>Phone</th>
                            <th scope="col" style={{ padding: '10px', textAlign: 'left' }}>Email</th>
                            <th scope="col" style={{ padding: '10px', textAlign: 'center' }}>Active</th>
                            <th scope="col" style={{ padding: '10px', textAlign: 'right' }}>Actions</th>
                        </tr>
                    </thead>
                    <tbody>
                        {d.rows.length ? d.rows.map((v) => (
                            <tr key={v.id} style={{ borderTop: '1px solid var(--gray-100)' }}>
                                <td style={{ padding: '8px 10px', fontWeight: 600 }}>{v.name}</td>
                                <td style={{ padding: '8px 10px', fontSize: '12px' }}>{v.address}</td>
                                <td style={{ padding: '8px 10px' }}>{v.phone}</td>
                                <td style={{ padding: '8px 10px', fontSize: '12px' }}>{v.email}</td>
                                <td style={{ padding: '8px 10px', textAlign: 'center' }}>{v.isActive ? <i className="fas fa-check" style={{ color: '#10b981' }}></i> : '—'}</td>
                                <td style={{ padding: '8px 10px', textAlign: 'right', whiteSpace: 'nowrap' }}>
                                    <button className="btn secondary" style={{ padding: '4px 10px', fontSize: '12px' }} onClick={() => call('fpOpenVendorModal', v.id)}><i className="fas fa-edit"></i></button>
                                    <button className="btn secondary" style={{ padding: '4px 10px', fontSize: '12px', color: '#dc2626' }} onClick={async () => { await call('fpDeleteVendor', v.id); call('fpRefresh'); }}><i className="fas fa-trash"></i></button>
                                </td>
                            </tr>
                        )) : (
                            <tr><td colSpan={6} style={{ padding: '40px', textAlign: 'center', color: 'var(--gray-500)' }}>No vendors. Add your first supplier.</td></tr>
                        )}
                    </tbody>
                </table>
            </div>
        </>
    );
}

// ── Exclusions & Deals tab (mirrors fpRenderExclusionsDeals) ────────────────
function ExclusionsTab({ d }) {
    return (
        <>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
                <h2 style={{ margin: 0, fontSize: '18px' }}>Product Exclusions</h2>
                <div style={{ display: 'flex', gap: '8px' }}>
                    <button className="btn secondary" onClick={() => call('fpExclusionBulkUpload')}><i className="fas fa-upload"></i> Bulk CSV</button>
                    <button className="btn primary" onClick={() => call('fpOpenExclusionModal')}><i className="fas fa-plus"></i> Add Exclusion</button>
                </div>
            </div>
            <div style={{ background: '#fff', border: '1px solid var(--gray-200)', borderRadius: '10px', overflow: 'hidden', marginBottom: '24px' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
                    <thead style={{ background: 'var(--gray-50)' }}>
                        <tr>
                            <th scope="col" style={{ padding: '10px', textAlign: 'left' }}>Code/Pattern</th>
                            <th scope="col" style={{ padding: '10px', textAlign: 'left' }}>Match</th>
                            <th scope="col" style={{ padding: '10px', textAlign: 'left' }}>Reason</th>
                            <th scope="col" style={{ padding: '10px', textAlign: 'center' }}>Active</th>
                            <th scope="col" style={{ padding: '10px', textAlign: 'right' }}>Actions</th>
                        </tr>
                    </thead>
                    <tbody>
                        {d.exclusions.length ? d.exclusions.map((e) => (
                            <tr key={e.id} style={{ borderTop: '1px solid var(--gray-100)' }}>
                                <td style={{ padding: '8px 10px', fontFamily: 'monospace' }}>{e.productCode}</td>
                                <td style={{ padding: '8px 10px', fontSize: '11px', background: 'none' }}><span style={{ background: '#e0f2fe', color: '#075985', padding: '2px 6px', borderRadius: '4px' }}>{e.matchType}</span></td>
                                <td style={{ padding: '8px 10px', fontSize: '12px' }}>{e.reason}</td>
                                <td style={{ padding: '8px 10px', textAlign: 'center' }}>
                                    <input type="checkbox" defaultChecked={e.isActive} onChange={(ev) => call('fpToggleExclusion', e.id, ev.target.checked)} />
                                </td>
                                <td style={{ padding: '8px 10px', textAlign: 'right' }}>
                                    <button className="btn secondary" style={{ padding: '4px 10px', fontSize: '12px', color: '#dc2626' }} onClick={async () => { await call('fpDeleteExclusion', e.id); call('fpRefresh'); }}><i className="fas fa-trash"></i></button>
                                </td>
                            </tr>
                        )) : (
                            <tr><td colSpan={5} style={{ padding: '30px', textAlign: 'center', color: 'var(--gray-500)' }}>No exclusions.</td></tr>
                        )}
                    </tbody>
                </table>
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
                <h2 style={{ margin: 0, fontSize: '18px' }}>Order Requirements (Deals)</h2>
                <button className="btn primary" onClick={() => call('fpOpenDealModal')}><i className="fas fa-plus"></i> Add Deal</button>
            </div>
            <div style={{ background: '#fff', border: '1px solid var(--gray-200)', borderRadius: '10px', overflow: 'hidden' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
                    <thead style={{ background: 'var(--gray-50)' }}>
                        <tr>
                            <th scope="col" style={{ padding: '10px', textAlign: 'left' }}>SKU</th>
                            <th scope="col" style={{ padding: '10px', textAlign: 'left' }}>Type</th>
                            <th scope="col" style={{ padding: '10px', textAlign: 'right' }}>Buy</th>
                            <th scope="col" style={{ padding: '10px', textAlign: 'right' }}>Free</th>
                            <th scope="col" style={{ padding: '10px', textAlign: 'left' }}>Effective</th>
                            <th scope="col" style={{ padding: '10px', textAlign: 'right' }}>Actions</th>
                        </tr>
                    </thead>
                    <tbody>
                        {d.deals.length ? d.deals.map((dl) => (
                            <tr key={dl.id} style={{ borderTop: '1px solid var(--gray-100)' }}>
                                <td style={{ padding: '8px 10px', fontFamily: 'monospace', fontSize: '12px' }}>{dl.code}</td>
                                <td style={{ padding: '8px 10px', fontSize: '11px' }}><span style={{ background: '#fef3c7', color: '#92400e', padding: '2px 6px', borderRadius: '4px' }}>{dl.requirementType}</span></td>
                                <td style={{ padding: '8px 10px', textAlign: 'right' }}>{dl.buy}</td>
                                <td style={{ padding: '8px 10px', textAlign: 'right', color: '#10b981', fontWeight: 600 }}>{dl.free}</td>
                                <td style={{ padding: '8px 10px', fontSize: '11px' }}>{dl.effectiveFrom} → {dl.effectiveTo || '∞'}</td>
                                <td style={{ padding: '8px 10px', textAlign: 'right' }}>
                                    <button className="btn secondary" style={{ padding: '4px 10px', fontSize: '12px', color: '#dc2626' }} onClick={async () => { await call('fpDeleteDeal', dl.id); call('fpRefresh'); }}><i className="fas fa-trash"></i></button>
                                </td>
                            </tr>
                        )) : (
                            <tr><td colSpan={6} style={{ padding: '30px', textAlign: 'center', color: 'var(--gray-500)' }}>No deals.</td></tr>
                        )}
                    </tbody>
                </table>
            </div>
        </>
    );
}

// ── Full-JSX view (React owns the whole view; React-state tab switching) ─────
function FullJsxView({ data, activeTab = 'dashboard' }) {
    try { window.__REACT_FP_STATE = 'ready'; } catch (_) { /* noop */ }
    const [tab, setTab] = useState(activeTab);
    let body;
    switch (tab) {
        case 'pos':        body = <PosTab d={data.pos} />; break;
        case 'transfers':  body = <TransfersTab d={data.transfers} />; break;
        case 'stock':      body = <StockTab key={data.stock.search} d={data.stock} />; break;
        case 'vendors':    body = <VendorsTab d={data.vendors} />; break;
        case 'exclusions': body = <ExclusionsTab d={data.exclusions} />; break;
        case 'dashboard':
        default:           body = <DashboardTab d={data.dashboard} />; break;
    }
    return (
        <div className="fp-view" style={{ padding: '24px' }}>
            <FpHeader />
            <FpTabBar activeTab={tab} onSelect={setTab} />
            <div id="fp-tab-content">{body}</div>
        </div>
    );
}

export function FormulaPurchaserView({ tabs = [], activeTab = 'dashboard', onReady, data }) {
    // Full-JSX path: when the chunk hands us a payload (new default-OFF flag),
    // React owns the whole view. The legacy scaffold branch below is NEVER run.
    if (data) {
        return <FullJsxView data={data} activeTab={activeTab} />;
    }

    // ── Legacy scaffold-shell branch (flag-off / build-failed) — UNCHANGED ──
    try { window.__REACT_FP_STATE = 'ready'; } catch (_) { /* noop */ }

    useEffect(() => {
        if (typeof onReady === 'function') {
            try { onReady(); } catch (e) { try { console.warn('[fp] onReady failed:', e && e.message); } catch (_) {} }
        }
    }, [onReady]);

    return (
        <div className="fp-view" style={{ padding: '24px' }}>
            <div className="fp-header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '20px', flexWrap: 'wrap', gap: '12px' }}>
                <div>
                    <h1 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: '10px' }}>
                        <i className="fas fa-flask" style={{ color: '#0ea5e9' }}></i> Formula Purchaser
                    </h1>
                    <div style={{ color: 'var(--gray-500)', fontSize: '13px', marginTop: '4px' }}>Stock replenishment, multi-outlet distribution &amp; PO generation. Super Admin only.</div>
                </div>
                <div style={{ display: 'flex', gap: '8px' }}>
                    <div style={{ position: 'relative' }}>
                        <button className="btn secondary" onClick={() => call('fpToggleImportMenu')}><i className="fas fa-file-import"></i> Import ▾</button>
                        <div id="fp-import-menu" style={{ display: 'none', position: 'absolute', right: 0, top: '100%', marginTop: '4px', background: '#fff', border: '1px solid var(--gray-200)', borderRadius: '8px', boxShadow: '0 4px 12px rgba(0,0,0,0.1)', minWidth: '220px', zIndex: 100 }}>
                            <div style={{ ...menuItem, borderBottom: '1px solid var(--gray-100)' }} onMouseOver={hov(true)} onMouseOut={hov(false)} onClick={() => call('fpImportStock')}>
                                <i className="fas fa-boxes" style={{ width: '18px', color: '#0ea5e9' }}></i> Stock Snapshot
                            </div>
                            <div style={{ ...menuItem, borderBottom: '1px solid var(--gray-100)' }} onMouseOver={hov(true)} onMouseOut={hov(false)} onClick={() => call('fpImportPos')}>
                                <i className="fas fa-cash-register" style={{ width: '18px', color: '#10b981' }}></i> POS Sales History
                            </div>
                            <div style={menuItem} onMouseOver={hov(true)} onMouseOut={hov(false)} onClick={() => call('fpImportDelisted')}>
                                <i className="fas fa-ban" style={{ width: '18px', color: '#dc2626' }}></i> Delisted SKUs
                            </div>
                        </div>
                    </div>
                    <button className="btn secondary" onClick={() => call('fpRefresh')}><i className="fas fa-sync-alt"></i> Refresh</button>
                </div>
            </div>

            <div className="fp-tabs" style={{ display: 'flex', gap: '4px', borderBottom: '2px solid var(--gray-200)', marginBottom: '20px', flexWrap: 'wrap' }}>
                {tabs.map((t) => {
                    const isActive = t.key === activeTab;
                    return (
                        <button key={t.key} className={`fp-tab-btn${isActive ? ' active' : ''}`} data-tab={t.key} onClick={() => call('fpSwitchTab', t.key)}
                            style={{ padding: '12px 20px', background: 'none', border: 'none', borderBottom: `3px solid ${isActive ? '#0ea5e9' : 'transparent'}`, fontWeight: 600, cursor: 'pointer', color: isActive ? '#0ea5e9' : 'var(--gray-600)' }}>
                            <i className={`fas ${t.icon}`}></i> {t.label}
                        </button>
                    );
                })}
            </div>

            <div id="fp-tab-content"><div style={{ padding: '40px', textAlign: 'center', color: 'var(--gray-500)' }}><i className="fas fa-spinner fa-spin"></i> Loading...</div></div>
        </div>
    );
}
