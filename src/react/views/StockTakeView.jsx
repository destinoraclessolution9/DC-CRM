// Stock Take — scaffold-shell island (view id 'stock_take') + NEW full-JSX path.
//
// TWO render paths live in this file:
//
// 1. SCAFFOLD-SHELL (default / flag-off): React owns ONLY the static shell
//    (header + #st-session-chip + tab bar + empty #st-tab-body). ALL logic stays
//    in the chunk (chunks/script-stock-take.js): admin gate + session bootstrap
//    run before mount; after mount the island's useEffect calls onReady → the
//    chunk's stSwitchTab(tab), which fills #st-session-chip + #st-tab-body via the
//    _stRender* fns and applies active-tab styling to .st-tab-btn. So all 9 tabs,
//    QR scanning, reconciliation, realtime sync and counts are byte-identical to
//    legacy. Tab buttons call window.app.stSwitchTab. This branch is UNCHANGED.
//
// 2. FULL-JSX (opt-in, gated behind chunk flag _reactStJsxOn → ?react_st_jsx=1 /
//    crm_react_st_jsx='1', DEFAULT OFF): when the chunk passes a `data` payload
//    (build via buildStockTakeIslandData), this component renders EVERY tab as
//    real JSX from that serializable data. Tab switching is React state. Primary
//    actions call the EXISTING window.app.* handlers; data-mutating actions then
//    call window.app.stJsxRefresh() to rebuild the payload + re-render. React
//    auto-escapes text children — no innerHTML into React-owned nodes.
import React, { useEffect, useState } from 'react';

const app = () => window.app || {};
const call = (name, ...args) => { const f = app()[name]; if (typeof f === 'function') return f(...args); };
// Run a (possibly async) app.* handler, then refresh the JSX island so the
// view reflects the mutation. The handlers themselves call stSwitchTab() which
// is a no-op on the JSX path (its by-id nodes don't exist), so the refresh is
// what actually re-renders here.
const act = (name, ...args) => {
    try {
        const f = app()[name];
        if (typeof f !== 'function') return;
        const r = f(...args);
        if (r && typeof r.then === 'function') r.then(() => call('stJsxRefresh')).catch(() => call('stJsxRefresh'));
        else call('stJsxRefresh');
    } catch (_) { call('stJsxRefresh'); }
};

const tabBtnStyle = { padding: '10px 16px', border: 'none', background: 'none', cursor: 'pointer', fontWeight: 600, whiteSpace: 'nowrap', borderBottom: '3px solid transparent', color: 'var(--gray-600)' };
const cardStyle = { background: 'white', padding: '16px', borderRadius: '8px', boxShadow: '0 1px 3px rgba(0,0,0,0.05)' };
const inputStyle = { width: '100%', padding: '8px', border: '1px solid var(--gray-300)', borderRadius: '6px' };

const fmtCreated = (s) => String(s || '').slice(0, 16).replace('T', ' ');
const methodColorFor = (m) => m === 'none' ? '#94a3b8' : m === 'mixed' ? '#7c3aed' : m === 'excel_import' ? '#0891b2' : '#0ea5e9';

// ─────────────────────────────────────────────────────────────────────────────
// FULL-JSX render — mirrors the chunk's _stRender* HTML 1:1 (same classNames /
// inline styles) but as real JSX from props.data, with React-state tab switching.
// ─────────────────────────────────────────────────────────────────────────────
function FullJsx({ tabs, data }) {
    const keys = tabs.map((t) => t.key);
    const initial = keys.indexOf(data.isAdmin ? 'sessions' : 'count') >= 0 ? (data.isAdmin ? 'sessions' : 'count') : (keys[0] || 'count');
    const [activeTab, setActiveTab] = useState(initial);
    const tab = keys.indexOf(activeTab) >= 0 ? activeTab : initial;

    return (
        <div className="stock-take-view" style={{ padding: '24px', maxWidth: '1400px', margin: '0 auto' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px', flexWrap: 'wrap', gap: '12px' }}>
                <div>
                    <h1 style={{ margin: 0, fontSize: '24px' }}><i className="fas fa-boxes"></i> Stock Take</h1>
                    <div style={{ color: 'var(--gray-600)', fontSize: '13px', marginTop: '4px' }}>Shelf-by-shelf physical count reconciliation</div>
                </div>
                <div id="st-session-chip">
                    {data.chip ? (
                        <span style={{ padding: '6px 12px', background: data.chip.status === 'open' ? '#dcfce7' : '#f1f5f9', color: data.chip.status === 'open' ? '#166534' : '#475569', borderRadius: '20px', fontSize: '12px', fontWeight: 600 }}>
                            {data.chip.status === 'open' ? '● ' : ''}{data.chip.id} ({data.chip.status})
                        </span>
                    ) : (
                        <span style={{ color: 'var(--gray-500)', fontSize: '12px' }}>No active session</span>
                    )}
                </div>
            </div>
            <div className="st-tabs" style={{ display: 'flex', gap: '4px', borderBottom: '2px solid var(--gray-200)', marginBottom: '16px', overflowX: 'auto' }}>
                {tabs.map((t) => {
                    const active = t.key === tab;
                    return (
                        <button key={t.key} className="st-tab-btn" data-tab={t.key} onClick={() => setActiveTab(t.key)}
                            style={{ ...tabBtnStyle, color: active ? 'var(--primary)' : 'var(--gray-600)', borderBottomColor: active ? 'var(--primary)' : 'transparent' }}>
                            {t.label}
                        </button>
                    );
                })}
            </div>
            <div>
                {tab === 'sessions' && <SessionsTab data={data} />}
                {tab === 'shelves' && <ShelvesTab data={data} />}
                {tab === 'import' && <ImportTab data={data} />}
                {tab === 'exclusions' && <ExclusionsTab data={data} />}
                {tab === 'count' && <CountTab data={data} />}
                {tab === 'bulk' && <BulkTab data={data} />}
                {tab === 'reconcile' && <ReconcileTab data={data} />}
                {tab === 'recount' && <RecountTab data={data} />}
                {tab === 'summary' && <SummaryTab data={data} />}
            </div>
        </div>
    );
}

// ── Sessions ────────────────────────────────────────────────────────────────
function SessionsTab({ data }) {
    const list = data.sessions || [];
    return (
        <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                <h2 style={{ margin: 0, fontSize: '18px' }}>Stock Take Sessions</h2>
                <button className="btn primary" onClick={() => call('stNewSession')}><i className="fas fa-plus"></i> New Session</button>
            </div>
            {list.length === 0 ? (
                <div style={{ padding: '40px', textAlign: 'center', color: 'var(--gray-500)', background: 'var(--gray-50)', borderRadius: '8px' }}>
                    No sessions yet. Click <strong>New Session</strong> to start.
                </div>
            ) : (
                <table style={{ width: '100%', borderCollapse: 'collapse', background: 'white', borderRadius: '8px', overflow: 'hidden', boxShadow: '0 1px 3px rgba(0,0,0,0.05)' }}>
                    <thead style={{ background: 'var(--gray-50)' }}><tr>
                        <th scope="col" style={{ padding: '10px', textAlign: 'left', fontSize: '12px' }}>Session ID</th>
                        <th scope="col" style={{ padding: '10px', textAlign: 'left', fontSize: '12px' }}>Created</th>
                        <th scope="col" style={{ padding: '10px', textAlign: 'left', fontSize: '12px' }}>Locations</th>
                        <th scope="col" style={{ padding: '10px', textAlign: 'center', fontSize: '12px' }}>QR Counts</th>
                        <th scope="col" style={{ padding: '10px', textAlign: 'center', fontSize: '12px' }}>System SKUs</th>
                        <th scope="col" style={{ padding: '10px', textAlign: 'center', fontSize: '12px' }}>Bulk Rows</th>
                        <th scope="col" style={{ padding: '10px', textAlign: 'center', fontSize: '12px' }}>Method</th>
                        <th scope="col" style={{ padding: '10px', textAlign: 'center', fontSize: '12px' }}>Status</th>
                        <th scope="col" style={{ padding: '10px', textAlign: 'right', fontSize: '12px' }}>Actions</th>
                    </tr></thead>
                    <tbody>
                        {list.map((s) => (
                            <tr key={s.id} style={{ borderTop: '1px solid var(--gray-100)' }}>
                                <td style={{ padding: '10px', fontFamily: 'monospace', fontSize: '13px' }}>{s.id}</td>
                                <td style={{ padding: '10px', fontSize: '13px' }}>{fmtCreated(s.createdAt)}</td>
                                <td style={{ padding: '10px', fontSize: '13px' }}>{(s.locations || []).join(', ') || '—'}</td>
                                <td style={{ padding: '10px', textAlign: 'center', fontSize: '13px' }}>{s.qrCounts}</td>
                                <td style={{ padding: '10px', textAlign: 'center', fontSize: '13px' }}>{s.systemSkus}</td>
                                <td style={{ padding: '10px', textAlign: 'center', fontSize: '13px' }}>{s.bulkRows}</td>
                                <td style={{ padding: '10px', textAlign: 'center', fontSize: '11px' }}>
                                    <span style={{ color: methodColorFor(s.method), fontWeight: 600 }}>{s.methodLabel}</span>
                                    {s.partial && s.method !== 'none' ? (
                                        <div style={{ background: '#fef3c7', color: '#92400e', padding: '1px 6px', borderRadius: '8px', fontSize: '10px', marginTop: '2px', display: 'inline-block' }}>PARTIAL</div>
                                    ) : null}
                                </td>
                                <td style={{ padding: '10px', textAlign: 'center' }}>
                                    <span style={{ padding: '3px 10px', borderRadius: '10px', fontSize: '11px', fontWeight: 600, background: s.status === 'open' ? '#dcfce7' : '#f1f5f9', color: s.status === 'open' ? '#166534' : '#475569' }}>{s.status}</span>
                                </td>
                                <td style={{ padding: '10px', textAlign: 'right', whiteSpace: 'nowrap' }}>
                                    <button className="btn secondary small" onClick={() => act('stActivateSession', s.id)}>Activate</button>
                                    {s.status === 'open' ? <button className="btn small" onClick={() => act('stCloseSession', s.id)}>Close</button> : null}
                                    <button className="btn small" style={{ color: '#dc2626' }} onClick={() => act('stDeleteSession', s.id)}>Delete</button>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            )}
        </div>
    );
}

// ── Import (System Stock) ─────────────────────────────────────────────────────
function ImportTab({ data }) {
    if (!data.sessionId) return <NoSession />;
    const stock = data.systemStock || [];
    return (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
            <div style={cardStyle}>
                <h3 style={{ marginTop: 0, fontSize: '16px' }}>Import System Stock</h3>
                <p style={{ color: 'var(--gray-600)', fontSize: '13px' }}>Excel (.xlsx) or CSV with columns: <code>Location, SKU, System_Qty</code></p>
                <input type="file" id="st-file" accept=".xlsx,.xls,.csv" style={{ marginBottom: '8px' }} />
                <button className="btn primary" onClick={() => act('stImportFile')}><i className="fas fa-upload"></i> Import File</button>
                <hr style={{ margin: '16px 0', border: 'none', borderTop: '1px solid var(--gray-200)' }} />
                <h4 style={{ fontSize: '14px' }}>Or paste CSV</h4>
                <textarea id="st-paste" rows="6" placeholder={'Location,SKU,System_Qty\nPuchong warehouse,ABC-001,120\n001 Retail Puchong,ABC-001,15'} style={{ ...inputStyle, fontFamily: 'monospace', fontSize: '12px' }}></textarea>
                <button className="btn secondary" onClick={() => act('stImportPaste')} style={{ marginTop: '8px' }}><i className="fas fa-paste"></i> Import Pasted</button>
            </div>
            <div style={cardStyle}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <h3 style={{ margin: 0, fontSize: '16px' }}>Current Balance ({stock.length})</h3>
                    {stock.length ? <button className="btn small" style={{ color: '#dc2626' }} onClick={() => act('stClearSystemStock')}>Clear</button> : null}
                </div>
                <div style={{ maxHeight: '400px', overflow: 'auto', marginTop: '12px' }}>
                    {stock.length === 0 ? (
                        <div style={{ color: 'var(--gray-500)', padding: '20px', textAlign: 'center' }}>No system stock imported yet.</div>
                    ) : (
                        <>
                            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
                                <thead style={{ position: 'sticky', top: 0, background: 'var(--gray-50)' }}><tr>
                                    <th scope="col" style={{ padding: '6px', textAlign: 'left' }}>Location</th>
                                    <th scope="col" style={{ padding: '6px', textAlign: 'left' }}>SKU</th>
                                    <th scope="col" style={{ padding: '6px', textAlign: 'right' }}>Qty</th>
                                </tr></thead>
                                <tbody>{stock.slice(0, 500).map((r, i) => (
                                    <tr key={i} style={{ borderTop: '1px solid var(--gray-100)' }}>
                                        <td style={{ padding: '6px' }}>{r.Location}</td>
                                        <td style={{ padding: '6px', fontFamily: 'monospace' }}>{r.SKU}</td>
                                        <td style={{ padding: '6px', textAlign: 'right' }}>{r.System_Qty}</td>
                                    </tr>
                                ))}</tbody>
                            </table>
                            {stock.length > 500 ? <div style={{ padding: '8px', textAlign: 'center', color: 'var(--gray-500)', fontSize: '11px' }}>Showing first 500 of {stock.length}</div> : null}
                        </>
                    )}
                </div>
            </div>
        </div>
    );
}

// ── Count (Per-shelf Count) — CAUTION: stAddCount mutates inventory data ───────
function CountTab({ data }) {
    if (!data.sessionId) return <NoSession />;
    const c = data.count || {};
    const recent = c.recent || [];
    return (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.3fr', gap: '16px' }}>
            <div style={cardStyle}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                    <h3 style={{ margin: 0, fontSize: '16px' }}>Record Physical Count</h3>
                    <button type="button" className="btn small" style={{ background: '#7c3aed', color: 'white' }} onClick={() => call('stScanShelfAndCount')} title="Scan a shelf QR — system shows expected SKUs for that shelf"><i className="fas fa-qrcode"></i> Scan Shelf</button>
                </div>
                <div className="form-group" style={{ marginBottom: '10px' }}>
                    <label>Counter Name</label>
                    <input id="st-counter" type="text" defaultValue={c.defaultCounter || ''} style={inputStyle} />
                </div>
                <div className="form-group" style={{ marginBottom: '10px' }}>
                    <label>Location</label>
                    <select id="st-loc" style={inputStyle}>
                        {(c.locations || []).map((l, i) => <option key={i}>{l}</option>)}
                    </select>
                </div>
                <div className="form-group" style={{ marginBottom: '10px' }}>
                    <label>Shelf / Zone <span style={{ color: 'var(--gray-500)', fontWeight: 400 }}>(optional)</span></label>
                    <input id="st-shelf" type="text" placeholder="e.g. A3-top" style={inputStyle} />
                </div>
                <div className="form-group" style={{ marginBottom: '10px' }}>
                    <label>SKU</label>
                    <div style={{ display: 'flex', gap: '6px' }}>
                        <input id="st-sku" type="text" placeholder="scan or type"
                            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); const q = document.getElementById('st-qty'); if (q) q.focus(); } }}
                            style={{ ...inputStyle, flex: 1, fontFamily: 'monospace' }} />
                        <button type="button" className="btn small secondary" onClick={() => call('stOpenScanner', 'st-sku', { title: 'Scan SKU' })} title="Open camera scanner"><i className="fas fa-camera"></i></button>
                    </div>
                </div>
                <div className="form-group" style={{ marginBottom: '12px' }}>
                    <label>Counted Qty</label>
                    <input id="st-qty" type="number" min="0" step="1"
                        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); act('stAddCount'); } }}
                        style={{ ...inputStyle, fontSize: '18px' }} />
                </div>
                <button className="btn primary" style={{ width: '100%', padding: '12px' }} onClick={() => act('stAddCount')}><i className="fas fa-plus"></i> Add Count</button>
            </div>
            <div id="st-counts-panel" style={cardStyle}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <h3 style={{ margin: 0, fontSize: '16px' }}>Recent Counts ({c.totalCounts} total)</h3>
                </div>
                <div style={{ maxHeight: '500px', overflow: 'auto', marginTop: '12px' }}>
                    {recent.length === 0 ? (
                        <div style={{ padding: '30px', textAlign: 'center', color: 'var(--gray-500)' }}>No counts yet.</div>
                    ) : (
                        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
                            <thead style={{ position: 'sticky', top: 0, background: 'var(--gray-50)' }}><tr>
                                <th scope="col" style={{ padding: '6px', textAlign: 'left' }}>When</th>
                                <th scope="col" style={{ padding: '6px', textAlign: 'left' }}>Who</th>
                                <th scope="col" style={{ padding: '6px', textAlign: 'left' }}>Location</th>
                                <th scope="col" style={{ padding: '6px', textAlign: 'left' }}>Shelf</th>
                                <th scope="col" style={{ padding: '6px', textAlign: 'left' }}>SKU</th>
                                <th scope="col" style={{ padding: '6px', textAlign: 'right' }}>Qty</th>
                                <th scope="col"></th>
                            </tr></thead>
                            <tbody>{recent.map((row) => (
                                <tr key={row.id} style={{ borderTop: '1px solid var(--gray-100)' }}>
                                    <td style={{ padding: '6px' }}>{row.timeShort}</td>
                                    <td style={{ padding: '6px' }}>{row.counter}</td>
                                    <td style={{ padding: '6px' }}>{row.location}</td>
                                    <td style={{ padding: '6px', color: 'var(--gray-500)' }}>{row.shelf || '—'}</td>
                                    <td style={{ padding: '6px', fontFamily: 'monospace' }}>
                                        {row.sku}
                                        {row.recount ? <span style={{ background: '#fef3c7', color: '#92400e', padding: '1px 4px', borderRadius: '3px', fontSize: '10px', marginLeft: '4px' }}>RC</span> : null}
                                    </td>
                                    <td style={{ padding: '6px', textAlign: 'right' }}>{row.qty}</td>
                                    <td style={{ padding: '6px', textAlign: 'right' }}>
                                        <button className="btn-link" style={{ color: '#dc2626', border: 'none', background: 'none', cursor: 'pointer' }} onClick={() => act('stDeleteCount', row.id)}><i className="fas fa-times"></i></button>
                                    </td>
                                </tr>
                            ))}</tbody>
                        </table>
                    )}
                </div>
            </div>
        </div>
    );
}

// ── Exclusions ────────────────────────────────────────────────────────────────
function ExclusionsTab({ data }) {
    const list = data.exclusions || [];
    return (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
            <div style={cardStyle}>
                <h3 style={{ marginTop: 0, fontSize: '16px' }}><i className="fas fa-ban"></i> Exclusion List (Delisted SKUs)</h3>
                <p style={{ color: 'var(--gray-600)', fontSize: '13px' }}>Excluded SKUs are ignored everywhere — System Stock, QR counts, Bulk uploads, Reconciliation, Summary.</p>
                <div className="form-group" style={{ marginBottom: '8px' }}>
                    <label>SKU</label>
                    <input id="st-ex-sku" type="text" placeholder="e.g. ABC-001"
                        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); act('stAddExclusion'); } }}
                        style={{ ...inputStyle, fontFamily: 'monospace', textTransform: 'uppercase' }} />
                </div>
                <div className="form-group" style={{ marginBottom: '8px' }}>
                    <label>Reason <span style={{ color: 'var(--gray-500)', fontWeight: 400 }}>(optional)</span></label>
                    <input id="st-ex-reason" type="text" placeholder="e.g. Delisted 2026-04-01" style={inputStyle} />
                </div>
                <button className="btn primary" onClick={() => act('stAddExclusion')} style={{ marginBottom: '12px' }}><i className="fas fa-plus"></i> Add</button>
                <hr style={{ margin: '16px 0', border: 'none', borderTop: '1px solid var(--gray-200)' }} />
                <h4 style={{ fontSize: '14px', marginBottom: '6px' }}>Bulk import (CSV / XLSX)</h4>
                <p style={{ color: 'var(--gray-600)', fontSize: '12px' }}>Single column <code>Product Code</code> or <code>SKU</code>. Optional <code>Reason</code> column.</p>
                <input type="file" id="st-ex-file" accept=".xlsx,.xls,.csv" style={{ marginBottom: '8px' }} />
                <button className="btn secondary" onClick={() => act('stImportExclusions')}><i className="fas fa-upload"></i> Import</button>
            </div>
            <div style={cardStyle}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <h3 style={{ margin: 0, fontSize: '16px' }}>Excluded SKUs ({list.length})</h3>
                    {list.length ? (
                        <div style={{ display: 'flex', gap: '6px' }}>
                            <button className="btn small" onClick={() => call('stExportExclusions')}><i className="fas fa-download"></i> Export</button>
                            <button className="btn small" style={{ color: '#dc2626' }} onClick={() => act('stClearExclusions')}>Clear All</button>
                        </div>
                    ) : null}
                </div>
                <div style={{ maxHeight: '480px', overflow: 'auto', marginTop: '12px' }}>
                    {list.length === 0 ? (
                        <div style={{ color: 'var(--gray-500)', padding: '24px', textAlign: 'center' }}>No exclusions yet.</div>
                    ) : (
                        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
                            <thead style={{ position: 'sticky', top: 0, background: 'var(--gray-50)' }}><tr>
                                <th scope="col" style={{ padding: '6px', textAlign: 'left' }}>SKU</th>
                                <th scope="col" style={{ padding: '6px', textAlign: 'left' }}>Reason</th>
                                <th scope="col" style={{ padding: '6px', textAlign: 'left' }}>Added</th>
                                <th scope="col" style={{ padding: '6px' }}></th>
                            </tr></thead>
                            <tbody>{list.map((e, i) => (
                                <tr key={e.sku + '-' + i} style={{ borderTop: '1px solid var(--gray-100)' }}>
                                    <td style={{ padding: '6px', fontFamily: 'monospace' }}>{e.sku}</td>
                                    <td style={{ padding: '6px', color: 'var(--gray-600)' }}>{e.reason || ''}</td>
                                    <td style={{ padding: '6px', color: 'var(--gray-500)', fontSize: '11px' }}>{(e.addedAt || '').slice(0, 10)} · {e.addedBy || ''}</td>
                                    <td style={{ padding: '6px', textAlign: 'right' }}>
                                        <button className="btn-link" style={{ border: 'none', background: 'none', cursor: 'pointer', color: '#dc2626' }} onClick={() => act('stRemoveExclusion', e.sku)}><i className="fas fa-times"></i></button>
                                    </td>
                                </tr>
                            ))}</tbody>
                        </table>
                    )}
                </div>
            </div>
        </div>
    );
}

// ── Bulk Physical ─────────────────────────────────────────────────────────────
function BulkTab({ data }) {
    if (!data.sessionId) return <NoSession />;
    const b = data.bulk || { rows: [] };
    const rows = b.rows || [];
    const excludedCount = rows.filter((r) => r.excluded).length;
    return (
        <div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                <div style={cardStyle}>
                    <h3 style={{ marginTop: 0, fontSize: '16px' }}><i className="fas fa-file-excel"></i> Upload Physical Count Excel</h3>
                    <p style={{ color: 'var(--gray-600)', fontSize: '13px' }}>
                        Excel/CSV with columns: <code>Product Code</code> (or <code>SKU</code>), <code>Physical Stock</code> (or <code>Qty</code>), <code>Location</code> (optional). Up to 10,000 rows.
                    </p>
                    <input type="file" id="st-bulk-file" accept=".xlsx,.xls,.csv" style={{ marginBottom: '8px' }} />
                    <button className="btn primary" onClick={() => act('stBulkUploadFile')}><i className="fas fa-upload"></i> Upload</button>
                    <hr style={{ margin: '16px 0', border: 'none', borderTop: '1px solid var(--gray-200)' }} />
                    <h4 style={{ fontSize: '14px' }}>Or paste CSV</h4>
                    <textarea id="st-bulk-paste" rows="6" placeholder={'Product Code,Physical Stock\nFMLTS006,0\nQVABOX0037,7'} style={{ ...inputStyle, fontFamily: 'monospace', fontSize: '12px' }}></textarea>
                    <button className="btn secondary" onClick={() => act('stBulkUploadPaste')} style={{ marginTop: '8px' }}><i className="fas fa-paste"></i> Import Pasted</button>
                </div>
                <div style={cardStyle}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <h3 style={{ margin: 0, fontSize: '16px' }}>Uploaded Physical Counts ({rows.length})</h3>
                        {rows.length ? <button className="btn small" style={{ color: '#dc2626' }} onClick={() => act('stClearBulk')}>Clear</button> : null}
                    </div>
                    {b.file ? <div style={{ fontSize: '11px', color: 'var(--gray-500)', marginTop: '4px' }}>From: {b.file} · {fmtCreated(b.uploadedAt)} · {b.uploadedBy || ''}</div> : null}
                    {excludedCount > 0 ? <div style={{ marginTop: '8px', background: '#fef3c7', color: '#92400e', padding: '6px 10px', borderRadius: '6px', fontSize: '12px' }}><i className="fas fa-info-circle"></i> {excludedCount} row(s) match excluded SKUs and will be ignored.</div> : null}
                    <div style={{ maxHeight: '420px', overflow: 'auto', marginTop: '12px' }}>
                        {rows.length === 0 ? (
                            <div style={{ color: 'var(--gray-500)', padding: '20px', textAlign: 'center' }}>No bulk physical counts uploaded yet.</div>
                        ) : (
                            <>
                                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
                                    <thead style={{ position: 'sticky', top: 0, background: 'var(--gray-50)' }}><tr>
                                        <th scope="col" style={{ padding: '6px', textAlign: 'left' }}>SKU</th>
                                        <th scope="col" style={{ padding: '6px', textAlign: 'left' }}>Location</th>
                                        <th scope="col" style={{ padding: '6px', textAlign: 'right' }}>Physical</th>
                                    </tr></thead>
                                    <tbody>{rows.slice(0, 500).map((r, i) => (
                                        <tr key={i} style={{ borderTop: '1px solid var(--gray-100)', ...(r.excluded ? { background: '#fef2f2', color: '#991b1b' } : {}) }}>
                                            <td style={{ padding: '6px', fontFamily: 'monospace' }}>{r.SKU}{r.excluded ? <span style={{ background: '#fee2e2', color: '#991b1b', padding: '1px 4px', borderRadius: '3px', fontSize: '10px', marginLeft: '4px' }}>EXCLUDED</span> : null}</td>
                                            <td style={{ padding: '6px' }}>{r.Location || '—'}</td>
                                            <td style={{ padding: '6px', textAlign: 'right' }}>{r.Physical_Qty}</td>
                                        </tr>
                                    ))}</tbody>
                                </table>
                                {rows.length > 500 ? <div style={{ padding: '8px', textAlign: 'center', color: 'var(--gray-500)', fontSize: '11px' }}>Showing first 500 of {rows.length}</div> : null}
                            </>
                        )}
                    </div>
                </div>
            </div>
            {rows.length > 0 ? (
                <div style={{ background: '#dbeafe', color: '#1e40af', padding: '12px 16px', borderRadius: '8px', marginTop: '12px', fontSize: '13px' }}>
                    <i className="fas fa-info-circle"></i> Bulk numbers are compared against the <strong>sum</strong> of System Stock across every shelf for each SKU. Open <strong>Final Summary</strong> to see SKU-level variances. QR scans for the same SKU automatically override the bulk number.
                </div>
            ) : null}
        </div>
    );
}

// ── Reconciliation ────────────────────────────────────────────────────────────
function ReconcileTab({ data }) {
    if (!data.sessionId) return <NoSession />;
    const rows = data.reconcile || [];
    const threshold = data.threshold;
    const matched = rows.filter((r) => r.Status === 'Match').length;
    const needRc = rows.length - matched;
    const accuracy = rows.length ? (matched / rows.length * 100) : 0;
    const accColor = rows.length === 0 ? '#64748b' : accuracy >= 98 ? '#166534' : accuracy >= 95 ? '#92400e' : '#991b1b';
    const accBg = rows.length === 0 ? '#f1f5f9' : accuracy >= 98 ? '#dcfce7' : accuracy >= 95 ? '#fef3c7' : '#fee2e2';
    return (
        <div>
            <div style={{ display: 'flex', gap: '12px', marginBottom: '12px', flexWrap: 'wrap' }}>
                <div style={{ flex: 1, minWidth: '140px', ...cardStyle, padding: '14px' }}>
                    <div style={{ color: 'var(--gray-600)', fontSize: '12px' }}>Total SKUs</div>
                    <div style={{ fontSize: '24px', fontWeight: 700 }}>{rows.length}</div>
                </div>
                <div style={{ flex: 1, minWidth: '140px', background: '#dcfce7', padding: '14px', borderRadius: '8px' }}>
                    <div style={{ color: '#166534', fontSize: '12px' }}>Matched</div>
                    <div style={{ fontSize: '24px', fontWeight: 700, color: '#166534' }}>{matched}</div>
                </div>
                <div style={{ flex: 1, minWidth: '140px', background: '#fef2f2', padding: '14px', borderRadius: '8px' }}>
                    <div style={{ color: '#991b1b', fontSize: '12px' }}>Recount Required</div>
                    <div style={{ fontSize: '24px', fontWeight: 700, color: '#991b1b' }}>{needRc}</div>
                </div>
                <div style={{ flex: 1, minWidth: '140px', background: accBg, padding: '14px', borderRadius: '8px' }} title="Industry target: ≥98% for A-items">
                    <div style={{ color: accColor, fontSize: '12px' }}>Inventory Accuracy</div>
                    <div style={{ fontSize: '24px', fontWeight: 700, color: accColor }}>{rows.length ? accuracy.toFixed(1) + '%' : '—'}</div>
                </div>
            </div>
            <div style={{ display: 'flex', gap: '12px', alignItems: 'center', marginBottom: '12px', flexWrap: 'wrap', ...cardStyle, padding: '10px 14px' }}>
                <label style={{ fontSize: '13px', color: 'var(--gray-700)', fontWeight: 600 }}><i className="fas fa-sliders-h"></i> Tolerance (± units):</label>
                <input id="st-threshold" type="number" min="0" step="1" defaultValue={threshold}
                    onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); act('stSetThreshold'); } }}
                    style={{ width: '80px', padding: '6px 8px', border: '1px solid var(--gray-300)', borderRadius: '6px' }} />
                <button className="btn small primary" onClick={() => act('stSetThreshold')}>Apply</button>
                <span style={{ color: 'var(--gray-500)', fontSize: '12px' }}>{threshold === 0 ? 'Strict — any variance requires recount.' : `SKUs within ±${threshold} of system qty count as Match.`}</span>
                <div style={{ marginLeft: 'auto', display: 'flex', gap: '8px' }}>
                    <button className="btn secondary" onClick={() => call('stExportReconcile', 'csv')}><i className="fas fa-file-csv"></i> CSV</button>
                    <button className="btn secondary" onClick={() => call('stExportReconcile', 'xlsx')}><i className="fas fa-file-excel"></i> XLSX</button>
                    <button className="btn primary" onClick={() => call('stExportAdjustment')}><i className="fas fa-download"></i> Adjustment File</button>
                    <button className="btn primary" style={{ background: '#7c3aed' }} onClick={() => act('stAcceptVariances')} title="Rewrite System Stock for this session so counted qty becomes the new baseline. Adjustment File is still exported for ERP sync."><i className="fas fa-check-double"></i> Accept Variances</button>
                </div>
            </div>
            <div style={{ ...cardStyle, padding: 0, overflow: 'auto', maxHeight: '600px' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
                    <thead style={{ position: 'sticky', top: 0, background: 'var(--gray-50)', zIndex: 1 }}><tr>
                        <th scope="col" style={{ padding: '10px', textAlign: 'left' }}>Location</th>
                        <th scope="col" style={{ padding: '10px', textAlign: 'left' }}>SKU</th>
                        <th scope="col" style={{ padding: '10px', textAlign: 'right' }}>Physical</th>
                        <th scope="col" style={{ padding: '10px', textAlign: 'right' }}>System</th>
                        <th scope="col" style={{ padding: '10px', textAlign: 'right' }}>Variance</th>
                        <th scope="col" style={{ padding: '10px', textAlign: 'center' }}>Status</th>
                    </tr></thead>
                    <tbody>
                        {rows.length === 0 ? (
                            <tr><td colSpan="6" style={{ padding: '30px', textAlign: 'center', color: 'var(--gray-500)' }}>No data — import system stock and record counts first.</td></tr>
                        ) : rows.map((r, i) => (
                            <tr key={i} style={{ borderTop: '1px solid var(--gray-100)' }}>
                                <td style={{ padding: '8px 10px' }}>{r.Location}</td>
                                <td style={{ padding: '8px 10px', fontFamily: 'monospace' }}>{r.SKU}</td>
                                <td style={{ padding: '8px 10px', textAlign: 'right' }}>{r.Physical_Total}</td>
                                <td style={{ padding: '8px 10px', textAlign: 'right' }}>{r.System_Qty}</td>
                                <td style={{ padding: '8px 10px', textAlign: 'right', color: r.Variance === 0 ? 'inherit' : (r.Variance > 0 ? '#059669' : '#dc2626'), fontWeight: r.Variance === 0 ? 400 : 600 }}>{r.Variance > 0 ? '+' : ''}{r.Variance}</td>
                                <td style={{ padding: '8px 10px', textAlign: 'center' }}>
                                    <span style={{ padding: '3px 10px', borderRadius: '10px', fontSize: '11px', fontWeight: 600, background: r.Status === 'Match' ? '#dcfce7' : '#fee2e2', color: r.Status === 'Match' ? '#166534' : '#991b1b' }}>{r.Status}</span>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
}

// ── Recount ───────────────────────────────────────────────────────────────────
function RecountTab({ data }) {
    if (!data.sessionId) return <NoSession />;
    const rows = data.recount || [];
    const byLoc = {};
    rows.forEach((r) => { (byLoc[r.Location] = byLoc[r.Location] || []).push(r); });
    const groups = Object.entries(byLoc);
    return (
        <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                <h3 style={{ margin: 0, fontSize: '16px' }}>Recount List — {rows.length} SKU(s) across {groups.length} location(s)</h3>
                <div style={{ display: 'flex', gap: '8px' }}>
                    <button className="btn secondary" onClick={() => call('stExportRecount', 'csv')}><i className="fas fa-file-csv"></i> CSV</button>
                    <button className="btn secondary" onClick={() => call('stExportRecount', 'xlsx')}><i className="fas fa-file-excel"></i> XLSX</button>
                </div>
            </div>
            {rows.length === 0 ? (
                <div style={{ padding: '40px', textAlign: 'center', color: 'var(--gray-500)', background: '#dcfce7', borderRadius: '8px' }}>
                    <i className="fas fa-check-circle" style={{ fontSize: '24px', color: '#166534' }}></i><br /><br />All SKUs matched. No recount needed.
                </div>
            ) : groups.map(([loc, items]) => (
                <div key={loc} style={{ ...cardStyle, padding: 0, marginBottom: '12px', overflow: 'hidden' }}>
                    <div style={{ padding: '10px 14px', background: 'var(--gray-50)', fontWeight: 600, borderBottom: '1px solid var(--gray-200)' }}>
                        <i className="fas fa-map-marker-alt"></i> {loc} <span style={{ color: 'var(--gray-500)', fontWeight: 400, fontSize: '12px' }}>({items.length})</span>
                    </div>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
                        <thead style={{ background: 'var(--gray-50)' }}><tr>
                            <th scope="col" style={{ padding: '8px 10px', textAlign: 'left' }}>SKU</th>
                            <th scope="col" style={{ padding: '8px 10px', textAlign: 'right' }}>Physical</th>
                            <th scope="col" style={{ padding: '8px 10px', textAlign: 'right' }}>System</th>
                            <th scope="col" style={{ padding: '8px 10px', textAlign: 'right' }}>Variance</th>
                            <th scope="col" style={{ padding: '8px 10px', textAlign: 'center' }}>Recount action</th>
                        </tr></thead>
                        <tbody>{items.map((r, i) => (
                            <tr key={i} style={{ borderTop: '1px solid var(--gray-100)' }}>
                                <td style={{ padding: '8px 10px', fontFamily: 'monospace' }}>{r.SKU}</td>
                                <td style={{ padding: '8px 10px', textAlign: 'right' }}>{r.Physical_Total}</td>
                                <td style={{ padding: '8px 10px', textAlign: 'right' }}>{r.System_Qty}</td>
                                <td style={{ padding: '8px 10px', textAlign: 'right', color: r.Variance > 0 ? '#059669' : '#dc2626', fontWeight: 600 }}>{r.Variance > 0 ? '+' : ''}{r.Variance}</td>
                                <td style={{ padding: '8px 10px', textAlign: 'center' }}>
                                    <button className="btn small primary" onClick={() => call('stOpenRecount', r.Location, r.SKU)}>Recount</button>
                                </td>
                            </tr>
                        ))}</tbody>
                    </table>
                </div>
            ))}
        </div>
    );
}

// ── Final Summary ─────────────────────────────────────────────────────────────
function SummaryTab({ data }) {
    if (!data.sessionId) return <NoSession />;
    const s = data.summary || {};
    const bySku = s.bySku || [];
    const partial = s.partial || { partial: false, uncovered: 0, uncountedLocations: [], countedLocations: [] };
    const threshold = data.threshold;
    const reasons = s.reasons || {};
    const matched = bySku.filter((r) => r.Status === 'Match').length;
    const recountReq = bySku.filter((r) => r.Status === 'Recount Required').length;
    const notCounted = bySku.filter((r) => r.Status === 'Not Counted').length;
    const unregistered = bySku.filter((r) => r.Status === 'Unregistered').length;
    const methodLabel = ({ qr_only: 'QR scans only', excel_import: 'Excel bulk import only', mixed: 'Mixed (QR + Excel)', none: 'No counts yet' })[s.method];
    const methodColor = s.method === 'none' ? '#94a3b8' : s.method === 'mixed' ? '#7c3aed' : '#0ea5e9';
    const statusBg = (st) => st === 'Match' ? '#dcfce7' : st === 'Unregistered' ? '#fef3c7' : st === 'Not Counted' ? '#f1f5f9' : '#fee2e2';
    const statusColor = (st) => st === 'Match' ? '#166534' : st === 'Unregistered' ? '#92400e' : st === 'Not Counted' ? '#475569' : '#991b1b';
    const metric = (label, value, opts = {}) => (
        <div style={opts.span ? { gridColumn: '1 / -1' } : undefined}>
            <div style={{ color: opts.warn ? '#92400e' : 'var(--gray-500)', fontSize: '11px', textTransform: 'uppercase' }}>{label}</div>
            <div style={{ fontWeight: 600, ...(opts.style || {}) }}>{value}</div>
        </div>
    );
    return (
        <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px', flexWrap: 'wrap', gap: '8px' }}>
                <h2 style={{ margin: 0, fontSize: '18px' }}><i className="fas fa-clipboard-check"></i> Final Stock Take Summary</h2>
                <div style={{ display: 'flex', gap: '8px' }}>
                    <button className="btn secondary" onClick={() => call('stExportSummary', 'csv')}><i className="fas fa-file-csv"></i> CSV</button>
                    <button className="btn secondary" onClick={() => call('stExportSummary', 'xlsx')}><i className="fas fa-file-excel"></i> XLSX</button>
                    <button className="btn primary" onClick={() => window.print()}><i className="fas fa-print"></i> Print</button>
                </div>
            </div>

            <div style={{ ...cardStyle, marginBottom: '12px' }}>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(190px,1fr))', gap: '12px' }}>
                    {metric('Session', data.sessionId, { style: { fontFamily: 'monospace' } })}
                    {metric('Counter', s.createdBy || '—')}
                    {metric('Created', fmtCreated(s.createdAt))}
                    {metric('Status', <span style={{ padding: '2px 8px', borderRadius: '10px', fontSize: '11px', fontWeight: 600, background: s.status === 'open' ? '#dcfce7' : '#f1f5f9', color: s.status === 'open' ? '#166534' : '#475569' }}>{s.status || '—'}</span>)}
                    {metric('Method', methodLabel, { style: { color: methodColor } })}
                    {metric('Coverage', partial.partial ? <><i className="fas fa-exclamation-triangle"></i> Partial — {partial.uncovered} SKU(s) uncovered</> : <><i className="fas fa-check-circle"></i> Full — all SKUs covered</>, { style: { color: partial.partial ? '#92400e' : '#166534' } })}
                    {metric('Tolerance', threshold === 0 ? 'Strict (any variance)' : `±${threshold} units`)}
                    {metric('Exclusions applied', `${s.exclusionCount || 0} SKU(s)`)}
                    {s.bulkFile ? metric('Bulk file', s.bulkFile, { style: { fontSize: '12px' } }) : null}
                    {partial.countedLocations && partial.countedLocations.length ? metric('Locations counted by QR', partial.countedLocations.join(', '), { span: true, style: { fontSize: '12px' } }) : null}
                    {partial.uncountedLocations && partial.uncountedLocations.length ? metric('Locations NOT counted by QR', partial.uncountedLocations.join(', '), { span: true, warn: true, style: { fontSize: '12px', color: '#92400e' } }) : null}
                </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(140px,1fr))', gap: '12px', marginBottom: '12px' }}>
                <div style={{ ...cardStyle, padding: '14px' }}>
                    <div style={{ color: 'var(--gray-600)', fontSize: '12px' }}>Total SKUs</div>
                    <div style={{ fontSize: '24px', fontWeight: 700 }}>{bySku.length}</div>
                </div>
                <div style={{ background: '#dcfce7', padding: '14px', borderRadius: '8px' }}>
                    <div style={{ color: '#166534', fontSize: '12px' }}>Matched</div>
                    <div style={{ fontSize: '24px', fontWeight: 700, color: '#166534' }}>{matched}</div>
                </div>
                <div style={{ background: '#fee2e2', padding: '14px', borderRadius: '8px' }}>
                    <div style={{ color: '#991b1b', fontSize: '12px' }}>Variance</div>
                    <div style={{ fontSize: '24px', fontWeight: 700, color: '#991b1b' }}>{recountReq}</div>
                </div>
                <div style={{ background: '#fef3c7', padding: '14px', borderRadius: '8px' }}>
                    <div style={{ color: '#92400e', fontSize: '12px' }}>Unregistered</div>
                    <div style={{ fontSize: '24px', fontWeight: 700, color: '#92400e' }}>{unregistered}</div>
                </div>
                <div style={{ background: '#f1f5f9', padding: '14px', borderRadius: '8px' }}>
                    <div style={{ color: '#475569', fontSize: '12px' }}>Not Counted</div>
                    <div style={{ fontSize: '24px', fontWeight: 700, color: '#475569' }}>{notCounted}</div>
                </div>
            </div>

            {partial.partial ? (
                <div style={{ background: '#fef3c7', color: '#92400e', padding: '12px 16px', borderRadius: '8px', marginBottom: '12px', fontSize: '13px' }}>
                    <strong><i className="fas fa-exclamation-triangle"></i> Partial Stock Take</strong> — {partial.uncovered} SKU(s) had no QR scan and no bulk-upload entry. Uncounted SKUs keep their previous expected quantities.
                </div>
            ) : null}

            <div style={{ ...cardStyle, padding: 0, overflow: 'auto', maxHeight: '520px' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
                    <thead style={{ position: 'sticky', top: 0, background: 'var(--gray-50)', zIndex: 1 }}><tr>
                        <th scope="col" style={{ padding: '10px', textAlign: 'left' }}>SKU</th>
                        <th scope="col" style={{ padding: '10px', textAlign: 'right' }} title="Sum across all shelves">System Total</th>
                        <th scope="col" style={{ padding: '10px', textAlign: 'right' }} title="Sum of QR scans">QR</th>
                        <th scope="col" style={{ padding: '10px', textAlign: 'right' }} title="From bulk Excel upload">Bulk</th>
                        <th scope="col" style={{ padding: '10px', textAlign: 'right' }} title="QR overrides Bulk if any QR scan exists for that SKU">Physical Used</th>
                        <th scope="col" style={{ padding: '10px', textAlign: 'right' }}>Variance</th>
                        <th scope="col" style={{ padding: '10px', textAlign: 'right' }} title="QR minus Bulk — flags when the two physical sources disagree, even if either agrees with System">QR vs Bulk</th>
                        <th scope="col" style={{ padding: '10px', textAlign: 'center' }}>Source</th>
                        <th scope="col" style={{ padding: '10px', textAlign: 'center' }}>Status</th>
                        <th scope="col" style={{ padding: '10px', textAlign: 'left' }}>Reason</th>
                    </tr></thead>
                    <tbody>
                        {bySku.length === 0 ? (
                            <tr><td colSpan="10" style={{ padding: '30px', textAlign: 'center', color: 'var(--gray-500)' }}>No data — import System Stock or upload Bulk Physical first.</td></tr>
                        ) : bySku.map((r, i) => (
                            <tr key={r.SKU + '-' + i} style={{ borderTop: '1px solid var(--gray-100)', ...(r.QR_vs_Bulk_Disagree ? { background: '#fff7ed' } : {}) }}>
                                <td style={{ padding: '8px 10px', fontFamily: 'monospace' }}>
                                    {r.SKU}
                                    {r.ShelfCount > 1 ? <span style={{ background: '#dbeafe', color: '#1e40af', padding: '1px 5px', borderRadius: '3px', fontSize: '10px', cursor: 'help', marginLeft: '4px' }} title={`On ${r.ShelfCount} shelves: ${(r.Shelves || []).map((sh) => sh.Location + '=' + sh.Qty).join(', ')}`}>×{r.ShelfCount}</span> : null}
                                </td>
                                <td style={{ padding: '8px 10px', textAlign: 'right' }}>{r.System_Qty}</td>
                                <td style={{ padding: '8px 10px', textAlign: 'right', color: r.QR_Qty ? '#0ea5e9' : '#94a3b8' }}>{r.QR_Qty || '—'}</td>
                                <td style={{ padding: '8px 10px', textAlign: 'right', color: r.Bulk_Qty ? '#0ea5e9' : '#94a3b8' }}>{r.Bulk_Qty || '—'}</td>
                                <td style={{ padding: '8px 10px', textAlign: 'right', fontWeight: 600 }}>{r.Physical_Used}</td>
                                <td style={{ padding: '8px 10px', textAlign: 'right', color: r.Variance === 0 ? 'inherit' : (r.Variance > 0 ? '#059669' : '#dc2626'), fontWeight: r.Variance === 0 ? 400 : 600 }}>{r.Variance > 0 ? '+' : ''}{r.Variance}</td>
                                <td style={{ padding: '8px 10px', textAlign: 'right', color: r.QR_vs_Bulk_Disagree ? '#b45309' : (r.QR_vs_Bulk === null ? '#94a3b8' : 'inherit'), fontWeight: r.QR_vs_Bulk_Disagree ? 700 : 400 }}>
                                    {r.QR_vs_Bulk === null ? '—' : (r.QR_vs_Bulk > 0 ? '+' : '') + r.QR_vs_Bulk}
                                    {r.QR_vs_Bulk_Disagree ? <i className="fas fa-exclamation-triangle" title="QR and Bulk disagree beyond tolerance" style={{ marginLeft: '4px' }}></i> : null}
                                </td>
                                <td style={{ padding: '8px 10px', textAlign: 'center', fontSize: '11px', color: 'var(--gray-600)' }}>{r.Source}</td>
                                <td style={{ padding: '8px 10px', textAlign: 'center' }}>
                                    <span style={{ padding: '3px 8px', borderRadius: '10px', fontSize: '11px', fontWeight: 600, background: statusBg(r.Status), color: statusColor(r.Status) }}>{r.Status}</span>
                                </td>
                                <td style={{ padding: '6px 10px' }}>
                                    {(r.Status === 'Recount Required' || r.Status === 'Unregistered' || r.QR_vs_Bulk_Disagree) ? (
                                        <input type="text" defaultValue={reasons[r.SKU] || ''} placeholder="reason..."
                                            onBlur={(e) => call('stSetReason', r.SKU, e.target.value)}
                                            style={{ width: '100%', padding: '4px 6px', border: '1px solid var(--gray-300)', borderRadius: '4px', fontSize: '12px' }} />
                                    ) : null}
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
}

// ── Shelves (v2 Supabase master) ──────────────────────────────────────────────
function ShelvesTab({ data }) {
    const sh = data.shelves || { v2Available: false, loaded: false, stores: [], shelves: [] };
    if (!sh.v2Available) {
        return <div style={{ padding: '40px', textAlign: 'center', color: 'var(--gray-500)' }}>Supabase client not available. Sign in and reload.</div>;
    }
    if (!sh.loaded) {
        // Payload was built before the Supabase shelf master finished loading. Offer
        // a re-fetch that re-renders the island once data is warm (the legacy chunk
        // loads on first scaffold render; here we trigger + refresh explicitly).
        return (
            <div style={{ padding: '40px', textAlign: 'center', color: 'var(--gray-500)' }}>
                <i className="fas fa-spinner"></i> Shelves master not loaded in this payload.{' '}
                <button className="btn small secondary" onClick={() => act('stSwitchTab', 'shelves')}>Load shelves</button>
            </div>
        );
    }
    const stores = sh.stores || [];
    const shelves = sh.shelves || [];
    const storeByCode = (id) => (stores.find((s) => s.id === id) || {});
    return (
        <div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginBottom: '16px' }}>
                <div style={{ ...cardStyle, padding: '14px' }}>
                    <h3 style={{ margin: '0 0 10px', fontSize: '15px' }}><i className="fas fa-store"></i> Add Store</h3>
                    <div style={{ display: 'flex', gap: '6px' }}>
                        <input id="st-v2-store-code" placeholder="store code (e.g. PUCHONG)" style={{ flex: 1, padding: '6px', border: '1px solid var(--gray-300)', borderRadius: '4px', fontFamily: 'monospace', textTransform: 'uppercase' }} />
                        <input id="st-v2-store-name" placeholder="name" style={{ flex: 2, padding: '6px', border: '1px solid var(--gray-300)', borderRadius: '4px' }} />
                        <button className="btn small primary" onClick={() => act('stV2AddStore')}><i className="fas fa-plus"></i></button>
                    </div>
                </div>
                <div style={{ ...cardStyle, padding: '14px' }}>
                    <h3 style={{ margin: '0 0 10px', fontSize: '15px' }}><i className="fas fa-th"></i> Add Shelf</h3>
                    <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                        <select id="st-v2-shelf-store" style={{ flex: 1, padding: '6px', border: '1px solid var(--gray-300)', borderRadius: '4px', minWidth: '120px' }}>
                            <option value="">store…</option>
                            {stores.map((s) => <option key={s.id} value={s.id}>{s.store_code} — {s.name}</option>)}
                        </select>
                        <input id="st-v2-shelf-code" placeholder="shelf code (A1-01)" style={{ flex: 1, padding: '6px', border: '1px solid var(--gray-300)', borderRadius: '4px', fontFamily: 'monospace', textTransform: 'uppercase', minWidth: '100px' }} />
                        <input id="st-v2-shelf-qr" placeholder="QR payload (e.g. PUCHONG-A1-01)" style={{ flex: 2, padding: '6px', border: '1px solid var(--gray-300)', borderRadius: '4px', fontFamily: 'monospace', minWidth: '200px' }} />
                        <button className="btn small primary" onClick={() => act('stV2AddShelf')}><i className="fas fa-plus"></i></button>
                    </div>
                </div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: '16px' }}>
                <div style={{ ...cardStyle, padding: '14px' }}>
                    <h3 style={{ margin: '0 0 10px', fontSize: '15px' }}>Stores ({stores.length})</h3>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
                        <thead style={{ background: 'var(--gray-50)' }}><tr><th scope="col" style={{ padding: '8px 10px', textAlign: 'left' }}>Code</th><th scope="col" style={{ padding: '8px 10px', textAlign: 'left' }}>Name</th><th scope="col" style={{ padding: '8px 10px', textAlign: 'right' }}>Shelves</th><th></th></tr></thead>
                        <tbody>
                            {stores.length === 0 ? (
                                <tr><td colSpan="4" style={{ padding: '20px', color: 'var(--gray-500)', textAlign: 'center' }}>No stores yet. Add one to get started.</td></tr>
                            ) : stores.map((s) => (
                                <tr key={s.id} style={{ borderTop: '1px solid var(--gray-100)' }}>
                                    <td style={{ padding: '8px 10px', fontFamily: 'monospace' }}>{s.store_code}</td>
                                    <td style={{ padding: '8px 10px' }}>{s.name}</td>
                                    <td style={{ padding: '8px 10px', textAlign: 'right' }}>{shelves.filter((x) => x.store_id === s.id).length}</td>
                                    <td style={{ padding: '8px 10px', textAlign: 'right' }}><button className="btn small" style={{ color: '#dc2626' }} onClick={() => act('stV2DeleteStore', s.id)}><i className="fas fa-trash"></i></button></td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
                <div style={{ ...cardStyle, padding: '14px' }}>
                    <h3 style={{ margin: '0 0 10px', fontSize: '15px' }}>Shelves ({shelves.length})</h3>
                    <div style={{ maxHeight: '480px', overflow: 'auto' }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
                            <thead style={{ background: 'var(--gray-50)', position: 'sticky', top: 0 }}><tr><th scope="col" style={{ padding: '8px 10px', textAlign: 'left' }}>Store</th><th scope="col" style={{ padding: '8px 10px', textAlign: 'left' }}>Shelf</th><th scope="col" style={{ padding: '8px 10px', textAlign: 'left' }}>QR payload</th><th scope="col" style={{ padding: '8px 10px', textAlign: 'left' }}>Description</th><th></th></tr></thead>
                            <tbody>
                                {shelves.length === 0 ? (
                                    <tr><td colSpan="5" style={{ padding: '20px', color: 'var(--gray-500)', textAlign: 'center' }}>No shelves yet.</td></tr>
                                ) : shelves.map((x) => (
                                    <tr key={x.id} style={{ borderTop: '1px solid var(--gray-100)' }}>
                                        <td style={{ padding: '8px 10px', fontFamily: 'monospace' }}>{storeByCode(x.store_id).store_code || '?'}</td>
                                        <td style={{ padding: '8px 10px', fontFamily: 'monospace' }}>{x.shelf_code}</td>
                                        <td style={{ padding: '8px 10px', fontFamily: 'monospace', fontSize: '11px' }}>{x.qr_payload}</td>
                                        <td style={{ padding: '8px 10px', color: 'var(--gray-600)', fontSize: '12px' }}>{x.description || ''}</td>
                                        <td style={{ padding: '8px 10px', textAlign: 'right', whiteSpace: 'nowrap' }}>
                                            <button className="btn small secondary" onClick={() => call('stV2EditExpected', x.id)}><i className="fas fa-list"></i> Expected</button>
                                            <button className="btn small" style={{ color: '#dc2626' }} onClick={() => act('stV2DeleteShelf', x.id)}><i className="fas fa-trash"></i></button>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>
            <div style={{ marginTop: '12px', background: '#dbeafe', color: '#1e40af', padding: '10px 14px', borderRadius: '6px', fontSize: '12px' }}>
                <i className="fas fa-info-circle"></i> Print the QR payload as a code label and stick it on the physical shelf. Scan it on the Count tab to bring up the expected SKU list.
            </div>
        </div>
    );
}

function NoSession() {
    return <div style={{ padding: '40px', textAlign: 'center', color: 'var(--gray-500)' }}>Activate a session first.</div>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Component entry — NEW full-JSX path first (props.data), else UNCHANGED scaffold.
// ─────────────────────────────────────────────────────────────────────────────
export function StockTakeView({ tabs = [], onReady, data }) {
    try { window.__REACT_ST_STATE = 'ready'; } catch (_) { /* noop */ }

    useEffect(() => {
        // Only the scaffold path uses onReady (the chunk's by-id fill). On the
        // full-JSX path the chunk passes a no-op onReady, so this stays inert.
        if (typeof onReady === 'function') {
            try { onReady(); } catch (e) { try { console.warn('[stock-take] onReady failed:', e && e.message); } catch (_) {} }
        }
    }, [onReady]);

    // NEW third render path — full real-JSX render from the serializable payload.
    if (data) {
        return <FullJsx tabs={tabs} data={data} />;
    }

    // EXISTING scaffold branch — UNCHANGED (empty stable-id containers; chunk's
    // onReady → stSwitchTab fills #st-session-chip + #st-tab-body by id).
    return (
        <div className="stock-take-view" style={{ padding: '24px', maxWidth: '1400px', margin: '0 auto' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px', flexWrap: 'wrap', gap: '12px' }}>
                <div>
                    <h1 style={{ margin: 0, fontSize: '24px' }}><i className="fas fa-boxes"></i> Stock Take</h1>
                    <div style={{ color: 'var(--gray-600)', fontSize: '13px', marginTop: '4px' }}>Shelf-by-shelf physical count reconciliation</div>
                </div>
                <div id="st-session-chip"></div>
            </div>
            <div className="st-tabs" style={{ display: 'flex', gap: '4px', borderBottom: '2px solid var(--gray-200)', marginBottom: '16px', overflowX: 'auto' }}>
                {tabs.map((t) => (
                    <button key={t.key} className="st-tab-btn" data-tab={t.key} onClick={() => call('stSwitchTab', t.key)} style={tabBtnStyle}>
                        {t.label}
                    </button>
                ))}
            </div>
            <div id="st-tab-body"></div>
        </div>
    );
}
