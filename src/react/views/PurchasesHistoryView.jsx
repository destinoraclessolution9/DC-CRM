// React-island migration — Purchases History (editable table).
//
// The chunk (_renderPurchasesHistory in chunks/script-prospects.js) passes the
// full prepared `rows` + `agentMap` (from _purchasesHistoryCache). This island
// owns the filter + page state (so the search box keeps focus while typing —
// the legacy innerHTML re-render dropped it every keystroke), applies the EXACT
// legacy filter logic, paginates (50/page), and reproduces the legacy table.
//
// Inline-edit cells keep the SAME element ids (ph-ds-/ph-rem-/ph-cc-${rk}) that
// the existing window.app.savePurchasesHistoryRow reads via getElementById, so
// the save path is unchanged. Row link / Save / Refresh call window.app.*.
import { useState } from 'react';
import { EmptyState } from '../ui/EmptyState.jsx';

const PAGE_SIZE = 50;
const app = () => window.app || {};

export function PurchasesHistoryView({ rows = [], agentMap = {} }) {
    const [search, setSearch] = useState('');
    const [agent, setAgent] = useState('all');
    const [delivery, setDelivery] = useState('all');
    const [from, setFrom] = useState('');
    const [to, setTo] = useState('');
    const [page, setPage] = useState(0);

    const reset = () => setPage(0);

    const filtered = rows.filter((r) => {
        if (search) {
            const q = search.toLowerCase();
            if (!r.customerName.toLowerCase().includes(q) && !r.invoiceNo.toLowerCase().includes(q) && !r.product.toLowerCase().includes(q)) return false;
        }
        if (agent !== 'all' && String(r.agentId) !== agent) return false;
        if (delivery !== 'all' && r.deliveryStatus !== delivery) return false;
        if (from && r.date && r.date < from) return false;
        if (to && r.date && r.date > to) return false;
        return true;
    });

    const totalCount = filtered.length;
    const totalAmt = filtered.reduce((s, r) => s + r.amount, 0);
    const totalPages = Math.ceil(totalCount / PAGE_SIZE);
    const safePage = Math.min(page, Math.max(0, totalPages - 1));
    const start = safePage * PAGE_SIZE;
    const pageRows = filtered.slice(start, start + PAGE_SIZE);
    const uniqueAgentIds = [...new Set(rows.map((r) => r.agentId).filter(Boolean))];

    window.__REACT_PURCHASES_STATE = 'ready';
    window.__REACT_PURCHASES_ROWS = totalCount;

    const th = (extra) => ({ padding: '8px 10px', fontSize: '11px', fontWeight: 700, color: 'var(--gray-500)', whiteSpace: 'nowrap', ...extra });
    const td = (extra) => ({ padding: '8px 10px', fontSize: '12px', ...extra });

    return (
        <div>
            <div style={{ padding: '16px 20px 10px', background: '#fff', borderBottom: '1px solid #e5e7eb', position: 'sticky', top: 0, zIndex: 10 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '10px', flexWrap: 'wrap', gap: '8px' }}>
                    <div>
                        <div style={{ fontSize: '18px', fontWeight: 700, color: 'var(--gray-800)' }}>🧾 Purchases History</div>
                        <div style={{ fontSize: '12px', color: 'var(--gray-400)', marginTop: '2px' }}>{totalCount} record{totalCount !== 1 ? 's' : ''} · Total: <strong style={{ color: 'var(--gray-700)' }}>RM {totalAmt.toLocaleString()}</strong></div>
                    </div>
                    <button className="btn secondary btn-sm" onClick={() => app().refreshPurchasesHistory && app().refreshPurchasesHistory()}><i className="fas fa-sync-alt"></i> Refresh</button>
                </div>
                <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
                    <input className="form-control" placeholder="🔍 Customer / invoice / product" value={search} style={{ flex: 1, minWidth: '180px', height: '32px', fontSize: '12px' }} onInput={(e) => { setSearch(e.target.value); reset(); }} onChange={(e) => { setSearch(e.target.value); reset(); }} />
                    <select className="form-control" style={{ height: '32px', fontSize: '12px', minWidth: '130px' }} value={agent} onChange={(e) => { setAgent(e.target.value); reset(); }}>
                        <option value="all">All Consultants</option>
                        {uniqueAgentIds.map((id) => <option key={id} value={String(id)}>{agentMap[String(id)] || String(id)}</option>)}
                    </select>
                    <select className="form-control" style={{ height: '32px', fontSize: '12px', minWidth: '120px' }} value={delivery} onChange={(e) => { setDelivery(e.target.value); reset(); }}>
                        <option value="all">All Status</option>
                        <option value="pending">Pending</option>
                        <option value="delivered">Delivered</option>
                        <option value="completed">Completed</option>
                    </select>
                    <input type="date" className="form-control" value={from} style={{ height: '32px', fontSize: '12px', width: '130px' }} onChange={(e) => { setFrom(e.target.value); reset(); }} />
                    <span style={{ fontSize: '12px', color: 'var(--gray-400)' }}>–</span>
                    <input type="date" className="form-control" value={to} style={{ height: '32px', fontSize: '12px', width: '130px' }} onChange={(e) => { setTo(e.target.value); reset(); }} />
                </div>
            </div>
            <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: '1000px' }}>
                    <thead>
                        <tr style={{ background: '#f9fafb', borderBottom: '2px solid #e5e7eb' }}>
                            <th scope="col" style={th({ textAlign: 'center' })}>SN</th>
                            <th scope="col" style={th()}>Date</th>
                            <th scope="col" style={th()}>Consultant</th>
                            <th scope="col" style={th()}>Invoice No</th>
                            <th scope="col" style={th()}>Customer Name</th>
                            <th scope="col" style={th()}>Product / Service</th>
                            <th scope="col" style={th({ textAlign: 'right' })}>Amount (RM)</th>
                            <th scope="col" style={th()}>Delivery Tracking</th>
                            <th scope="col" style={th()}>Remarks</th>
                            <th scope="col" style={th({ textAlign: 'center' })}>Case Completed</th>
                            <th scope="col" style={th({ textAlign: 'center' })}>Save</th>
                        </tr>
                    </thead>
                    <tbody>
                        {pageRows.length === 0 ? (
                            <tr><td colSpan="11"><EmptyState icon="fa-receipt" title="No purchase records found" description="No purchases match the current filters." /></td></tr>
                        ) : pageRows.map((r, i) => {
                            const sn = start + i + 1;
                            const rk = `${r.prospectId}-${r.historyIndex}`;
                            return (
                                <tr key={rk} style={{ borderBottom: '1px solid #f3f4f6', ...(r.caseCompleted ? { background: '#f0fdf4' } : {}) }}>
                                    <td style={td({ color: 'var(--gray-400)', textAlign: 'center' })}>{sn}</td>
                                    <td style={td({ whiteSpace: 'nowrap' })}>{r.date || '-'}</td>
                                    <td style={td({ whiteSpace: 'nowrap' })}>{r.agentName}</td>
                                    <td style={td({ whiteSpace: 'nowrap' })}>{r.invoiceNo}</td>
                                    <td style={td()}>
                                        <span style={{ color: 'var(--primary)', cursor: 'pointer', textDecoration: 'underline', fontWeight: 500 }} onClick={(e) => { e.stopPropagation(); app().showProspectDetail && app().showProspectDetail(r.prospectId); }}>{r.customerName}</span>
                                    </td>
                                    <td style={td()}>{r.product}</td>
                                    <td style={td({ textAlign: 'right', fontWeight: 600, whiteSpace: 'nowrap' })}>RM {r.amount.toLocaleString()}</td>
                                    <td style={{ padding: '8px 10px' }}>
                                        <select id={`ph-ds-${rk}`} className="form-control" style={{ fontSize: '11px', minWidth: '130px' }} defaultValue={r.deliveryStatus}>
                                            <option value="pending">Pending Delivery</option>
                                            <option value="delivered">Delivered</option>
                                            <option value="completed">Completed</option>
                                        </select>
                                    </td>
                                    <td style={{ padding: '8px 10px' }}>
                                        <input id={`ph-rem-${rk}`} className="form-control" defaultValue={r.remarks} placeholder="Remarks..." style={{ height: '28px', fontSize: '11px', minWidth: '150px' }} />
                                    </td>
                                    <td style={{ padding: '8px 10px', textAlign: 'center' }}>
                                        <input type="checkbox" id={`ph-cc-${rk}`} defaultChecked={!!r.caseCompleted} style={{ width: '16px', height: '16px', cursor: 'pointer' }} />
                                    </td>
                                    <td style={{ padding: '8px 10px', textAlign: 'center' }}>
                                        <button className="btn primary btn-sm" style={{ height: '28px', padding: '0 12px', fontSize: '11px' }} onClick={(e) => { e.stopPropagation(); app().savePurchasesHistoryRow && app().savePurchasesHistoryRow(r.prospectId, r.historyIndex, r.isHistory); }}><i className="fas fa-save"></i></button>
                                    </td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            </div>
            {totalPages > 1 && (
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '12px', padding: '16px', borderTop: '1px solid #e5e7eb' }}>
                    <button className="btn secondary btn-sm" disabled={safePage === 0} onClick={() => setPage(safePage - 1)}><i className="fas fa-chevron-left"></i> Prev</button>
                    <span style={{ fontSize: '13px', color: 'var(--gray-600)' }}>Page {safePage + 1} of {totalPages}</span>
                    <button className="btn secondary btn-sm" disabled={safePage >= totalPages - 1} onClick={() => setPage(safePage + 1)}>Next <i className="fas fa-chevron-right"></i></button>
                </div>
            )}
        </div>
    );
}
