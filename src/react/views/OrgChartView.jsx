// React-island migration — Org Chart Consultant list (read-only table).
//
// The chunk (showOrgChartView in chunks/script-org.js) fetches org_consultations,
// sorts desc by created_at, and passes `rows` as a prop. New Consultation + Open
// go through window.app.* modals (vanilla). React auto-escapes the client fields
// (the legacy ran them through _orgEscapeHtml).

const app = () => window.app || {};

const STATUS = { draft: ['#94a3b8', 'Draft'], collecting: ['#3b82f6', 'Collecting'], analyzing: ['#8b5cf6', 'Analysing'], completed: ['#16a34a', 'Completed'], delivered: ['#0891b2', 'Delivered'] };
const PAY = { paid: ['#16a34a', 'Paid'], unpaid: ['#dc2626', 'Unpaid'], waived: ['#94a3b8', 'Waived'] };

function Badge({ map, k }) {
    const [bg, label] = map[k] || ['#94a3b8', '—'];
    return <span style={{ background: bg, color: '#fff', fontSize: '11px', padding: '2px 8px', borderRadius: '10px' }}>{label}</span>;
}
const fmtDate = (iso) => { try { return new Date(iso).toLocaleDateString(); } catch (_) { return iso || ''; } };

export function OrgChartView({ rows = [] }) {
    window.__REACT_ORG_STATE = 'ready';
    window.__REACT_ORG_ROWS = rows.length;
    const th = { padding: '12px' };
    return (
        <div style={{ padding: '24px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px', gap: '16px', flexWrap: 'wrap' }}>
                <div>
                    <h1 style={{ margin: 0, fontSize: '24px' }}>Org Chart Consultant</h1>
                    <div style={{ color: 'var(--gray-500)', fontSize: '13px', marginTop: '4px' }}>Corporate team restructure analysis — RM 99 to RM 3,999 per engagement</div>
                </div>
                <button className="btn primary" onClick={() => app().openNewOrgConsultation()}><i className="fas fa-plus"></i> New Consultation</button>
            </div>
            <div style={{ background: '#fff', border: '1px solid var(--gray-200)', borderRadius: '8px', overflow: 'hidden' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '14px' }}>
                    <thead style={{ background: 'var(--gray-100)', textAlign: 'left' }}>
                        <tr>
                            <th style={th}>Client Company</th>
                            <th style={th}>Team Size</th>
                            <th style={th}>Price</th>
                            <th style={th}>Payment</th>
                            <th style={th}>Status</th>
                            <th style={th}>Created</th>
                            <th style={{ padding: '12px', textAlign: 'right' }}>Actions</th>
                        </tr>
                    </thead>
                    <tbody>
                        {rows.length ? rows.map((r) => (
                            <tr key={r.id} style={{ borderTop: '1px solid var(--gray-200)' }}>
                                <td style={{ padding: '12px' }}><strong>{r.client_company}</strong>{r.client_contact_name ? <div style={{ fontSize: '11px', color: 'var(--gray-500)' }}>{r.client_contact_name}</div> : null}</td>
                                <td style={{ padding: '12px' }}>{r.team_size}</td>
                                <td style={{ padding: '12px' }}>RM {Number(r.price_myr).toLocaleString()}</td>
                                <td style={{ padding: '12px' }}><Badge map={PAY} k={r.payment_status} /></td>
                                <td style={{ padding: '12px' }}><Badge map={STATUS} k={r.status} /></td>
                                <td style={{ padding: '12px', fontSize: '12px', color: 'var(--gray-500)' }}>{fmtDate(r.created_at)}</td>
                                <td style={{ padding: '12px', textAlign: 'right' }}>
                                    <button className="btn btn-sm" onClick={() => app().openOrgConsultationDetail(r.id)}>Open</button>
                                </td>
                            </tr>
                        )) : (
                            <tr><td colSpan="7" style={{ padding: '32px', textAlign: 'center', color: 'var(--gray-500)' }}>No consultations yet. Click "New Consultation" to start.</td></tr>
                        )}
                    </tbody>
                </table>
            </div>
        </div>
    );
}
