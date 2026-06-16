// Phase 4.3 (#13) — second real view: the Prospects table as a React island.
//
// Renders the Prospects table from the prospects BFF (useProspects / React
// Query), reproducing the legacy `renderProspectsTable` row template. Mounted by
// chunks/script-prospects.js into #prospects-react-root when the opt-in island
// bundle is loaded AND the flag is on AND the view is server-eligible (table
// view, no derived score/status filter, sort ∈ name/score/activity). The legacy
// DOM table is hidden then; for unsupported cases (derived filters, protection
// sort, card view) it stays the fallback. Normal users never load the bundle.
//
// Cross-boundary contract (all already exported on window.app for the legacy
// inline-onclick template): row helpers getScoreGrade / calculateProtectionDays
// / getProtectionStatus / timeAgo; row actions showProspectDetail / quickReassign
// / openProspectModal / openActivityModal / convertToCustomer /
// showConversionApprovalModal / deleteProspect; selection toggleProspectSelect;
// sort sortProspects. Selection is React-local (seeded per-mount via `key`) and
// synced to the chunk's _selectedProspects through toggleProspectSelect so the
// bulk bar + bulk actions keep working.
import { useState } from 'react';
import { useProspects } from '../data/useProspects.js';

const app = () => window.app || {};
const SORT_TO_BFF = { name: 'full_name', score: 'score', activity: 'last_activity_date' };

function SortHeader({ label, field, sortField, sortDir }) {
    const active = sortField === field;
    const icon = active ? `fas fa-sort-${sortDir === 'asc' ? 'up' : 'down'} sort-icon active` : 'fas fa-sort sort-icon';
    return (
        <th scope="col" data-sort-field={field} onClick={() => app().sortProspects && app().sortProspects(field)} style={{ cursor: 'pointer' }}>
            {label} <i className={icon}></i>
        </th>
    );
}

function AgentCell({ p, meta }) {
    const aid = p.responsible_agent_id;
    const cid = aid ? String(aid) : '';
    const selStyle = { padding: '2px 6px', fontSize: '12px', minWidth: '120px', border: '1px solid var(--border)', borderRadius: '4px', background: 'var(--surface)', cursor: 'pointer' };
    if (!meta.canReassign) {
        const name = cid ? (meta.agentNames[cid] || '') : '';
        return <td data-label="Agent" onClick={(e) => e.stopPropagation()}>{name}</td>;
    }
    const inScope = meta.agents.some((a) => String(a.id) === cid);
    const cidName = meta.agentNames[cid];
    let prefix = null, selectVal = cid;
    if (!cid)          { prefix = { value: '', label: '' }; selectVal = ''; }
    else if (inScope)  { prefix = null;                     selectVal = cid; }
    else if (!cidName) { prefix = { value: '', label: '' }; selectVal = ''; }
    else               { prefix = { value: cid, label: cidName }; selectVal = cid; }
    return (
        <td data-label="Agent" onClick={(e) => e.stopPropagation()}>
            <select className="form-control" style={selStyle} value={selectVal} title="Reassign agent"
                onChange={(e) => app().quickReassign && app().quickReassign(p.id, e.target.value, 'prospect')}>
                {prefix ? <option value={prefix.value}>{prefix.label}</option> : null}
                {meta.agents.map((a) => <option key={a.id} value={a.id}>{a.full_name || 'Agent'}</option>)}
            </select>
        </td>
    );
}

function ActionsCell({ p, meta }) {
    return (
        <td onClick={(e) => e.stopPropagation()}>
            <button className="btn-icon" title="Edit" onClick={() => app().openProspectModal && app().openProspectModal(p.id)}><i className="fas fa-edit"></i></button>
            <button className="btn-icon" title="Add Activity" onClick={() => app().openActivityModal && app().openActivityModal('', p.id)}><i className="fas fa-calendar-plus"></i></button>
            {p.conversion_status === 'pending_approval' ? (
                <>
                    <span title="Conversion pending manager approval" style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 28, height: 28, background: '#fef3c7', borderRadius: 6, cursor: 'default' }}>
                        <i className="fas fa-user-clock" style={{ color: '#d97706', fontSize: 12 }}></i>
                    </span>
                    {(meta.isAdmin || meta.isMktMgr) ? (
                        <button className="btn-icon" title="Review & Approve Conversion" style={{ color: '#d97706' }} onClick={(e) => { e.stopPropagation(); app().showConversionApprovalModal && app().showConversionApprovalModal(p.id); }}><i className="fas fa-check-circle"></i></button>
                    ) : null}
                </>
            ) : (p.status !== 'converted' ? (
                <button className="btn-icon" title="Convert to Customer" onClick={() => app().convertToCustomer && app().convertToCustomer(p.id)}><i className="fas fa-user-check"></i></button>
            ) : null)}
            {meta.canDelete ? (
                <button className="btn-icon" title="Delete" style={{ color: 'var(--red-500)' }} onClick={() => app().deleteProspect && app().deleteProspect(p.id)}><i className="fas fa-trash"></i></button>
            ) : null}
        </td>
    );
}

function Row({ p, meta, selected, onToggle }) {
    const A = app();
    const grade = (A.getScoreGrade || (() => 'D'))(p.score);
    const daysLeft = (A.calculateProtectionDays || (() => 0))(p);
    const protStatus = (A.getProtectionStatus || (() => 'normal'))(daysLeft);
    const protFillClass = daysLeft <= 0 ? 'expired' : protStatus;
    const daysClass = daysLeft <= 0 ? 'days-expired' : (daysLeft <= 7 ? 'days-critical' : (daysLeft <= 14 ? 'days-warning' : 'days-normal'));
    const daysLabel = daysLeft <= 0 ? 'Expired' : `${daysLeft}d left`;
    const fillWidth = Math.min(100, daysLeft <= 0 ? 100 : (daysLeft / 30) * 100);
    const relTime = (A.timeAgo || (() => ''))(p.last_activity_date);

    return (
        <tr onClick={() => A.showProspectDetail && A.showProspectDetail(p.id)} className={p.unable_to_serve ? 'row-unable' : ''} style={{ cursor: 'pointer' }}>
            <td className="prospect-select-cell" onClick={(e) => e.stopPropagation()}>
                <input type="checkbox" data-pid={p.id} checked={selected} onChange={() => onToggle(p.id)} />
            </td>
            <td data-label="Name">
                <strong className={p.unable_to_serve ? 'name-unable' : ''}>{p.full_name || '(No Name)'}</strong>
                {p.phone ? <><br /><span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{p.phone}</span></> : null}
                {p.unable_to_serve ? <><br /><span className="badge-unable">Unable to Serve</span></> : null}
            </td>
            <AgentCell p={p} meta={meta} />
            <td data-label="Score"><span className={`score-badge score-${grade.replace('+', '-plus')}`}>{p.score || 0} ({grade})</span></td>
            <td data-label="Ming Gua">{p.ming_gua || 'MG4'}</td>
            <td data-label="Occupation">{(p.occupation || '') + (p.company_name ? ' · ' + p.company_name : '')}</td>
            <td data-label="Last Activity">
                {p.last_activity_date
                    ? <><span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{relTime}</span><br /><span className="la-date" style={{ fontSize: 11, color: 'var(--text-secondary)' }}>{p.last_activity_date}</span></>
                    : <span style={{ color: 'var(--text-secondary)', fontStyle: 'italic' }}>No activity</span>}
            </td>
            <td data-label="Protection">
                <div className={daysClass}>{daysLabel}</div>
                <div className="protection-bar"><div className={`protection-fill ${protFillClass}`} style={{ width: `${fillWidth}%` }}></div></div>
            </td>
            <ActionsCell p={p} meta={meta} />
        </tr>
    );
}

function Pagination({ page, pageSize, count, onNavigate }) {
    const totalPages = Math.ceil(count / pageSize);
    const wrap = { display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', padding: '16px 0', flexWrap: 'wrap' };
    if (totalPages <= 1) {
        return <div id="prospects-react-pagination" style={wrap}><span style={{ color: 'var(--text-secondary)', fontSize: 13 }}>{count} prospect{count !== 1 ? 's' : ''}</span></div>;
    }
    const currentPage = page + 1;
    const pageStart = page * pageSize;
    const from = pageStart + 1;
    const to = Math.min(pageStart + pageSize, count);
    const lastPage = Math.max(0, totalPages - 1);
    return (
        <div id="prospects-react-pagination" style={wrap}>
            <span style={{ color: 'var(--text-secondary)', fontSize: 13 }}>Showing {from}–{to} of {count}</span>
            <button className="btn secondary btn-sm" disabled={page === 0} onClick={() => onNavigate(0)} title="First page"><i className="fas fa-angle-double-left"></i></button>
            <button className="btn secondary btn-sm" disabled={page === 0} onClick={() => onNavigate(Math.max(0, page - 1))}><i className="fas fa-angle-left"></i> Prev</button>
            <span style={{ fontWeight: 600, fontSize: 14 }}>Page {currentPage} of {totalPages}</span>
            <button className="btn secondary btn-sm" disabled={currentPage >= totalPages} onClick={() => onNavigate(Math.min(lastPage, page + 1))}>Next <i className="fas fa-angle-right"></i></button>
            <button className="btn secondary btn-sm" disabled={currentPage >= totalPages} onClick={() => onNavigate(lastPage)} title="Last page"><i className="fas fa-angle-double-right"></i></button>
        </div>
    );
}

// Write the vanilla #prospect-stats-row (lives outside the React root). Total =
// the BFF count (correct); the other three are page-based (same degrade the
// __SERVER_TABLES server path already has — opt-in only, never normal users).
function writeStats(rows, count) {
    const el = document.getElementById('prospect-stats-row');
    if (!el) return;
    const highScore = rows.filter((p) => (p.score || 0) >= 70).length;
    const now = Date.now();
    const active30 = rows.filter((p) => p.last_activity_date && (now - new Date(p.last_activity_date).getTime()) <= 30 * 86400000).length;
    const avgScore = rows.length ? Math.round(rows.reduce((s, p) => s + (p.score || 0), 0) / rows.length) : 0;
    const card = (icon, cls, val, label) => `<div class="prospect-stat-card"><div class="prospect-stat-icon ${cls}"><i class="fas ${icon}"></i></div><div><div class="prospect-stat-value">${val}</div><div class="prospect-stat-label">${label}</div></div></div>`;
    el.innerHTML =
        card('fa-users', 'pink', count, 'Total Prospects') +
        card('fa-star', 'star', highScore, 'High Score (70+)*') +
        card('fa-bolt', 'green', active30, 'Active (30d)*') +
        card('fa-chart-line', 'blue', avgScore, 'Avg. Score*') +
        card('fa-filter', 'rose', count, 'Filtered Results');
}

export function ProspectsTable({ params, meta, pageSize = 50, onNavigate }) {
    const page = Math.max(0, params.page | 0);
    const sortField = params.sortField || 'score';
    const sortDir = params.sortDir || 'desc';
    const { data, isLoading, isError, error } = useProspects({
        q: params.q || '', gua: params.gua || '', agent: params.agent || '',
        sort: SORT_TO_BFF[sortField] || 'score', dir: sortDir, dormant: !!params.dormant,
        limit: pageSize, offset: page * pageSize,
    });

    const rows = (data && data.rows) || [];
    const count = (data && data.count) || 0;

    // React-local selection, seeded from the chunk's _selectedProspects (passed in
    // via meta.selectedIds). Re-seeds on remount because the chunk passes a fresh
    // `key` whenever params change. Toggling syncs the chunk Set + bulk bar via
    // window.app.toggleProspectSelect so bulk reassign/delete keep working.
    const [sel, setSel] = useState(() => new Set((meta.selectedIds || []).map(Number)));
    const toggle = (id) => {
        if (app().toggleProspectSelect) app().toggleProspectSelect(id);
        setSel((prev) => { const n = new Set(prev); n.has(Number(id)) ? n.delete(Number(id)) : n.add(Number(id)); return n; });
    };
    const pageIds = rows.map((p) => Number(p.id));
    const allSelected = pageIds.length > 0 && pageIds.every((id) => sel.has(id));
    const toggleAll = () => {
        const target = !allSelected;
        pageIds.forEach((id) => {
            const has = sel.has(id);
            if (target !== has && app().toggleProspectSelect) app().toggleProspectSelect(id);
        });
        setSel(() => { const n = new Set(sel); pageIds.forEach((id) => target ? n.add(id) : n.delete(id)); return n; });
    };

    // Live-verification markers (mirror the customers island convention).
    if (isLoading)    window.__REACT_PROSPECTS_STATE = 'loading';
    else if (isError) window.__REACT_PROSPECTS_STATE = 'error';
    else {
        window.__REACT_PROSPECTS_STATE = 'ready';
        window.__REACT_PROSPECTS_COUNT = count;
        window.__REACT_PROSPECTS_ROWS = rows.length;
        writeStats(rows, count);
    }

    let body;
    if (isLoading && rows.length === 0) {
        body = <tr><td colSpan="9" style={{ textAlign: 'center', padding: 40, color: 'var(--text-secondary)' }}>Loading prospects…</td></tr>;
    } else if (isError) {
        // error.message is now a classified, human message (bffError); a transient
        // outage shows neutral, a genuine session expiry shows danger red.
        const retryable = !error || error.retryable;
        const msg = (error && error.message) || 'Failed to load prospects.';
        body = <tr><td colSpan="9" style={{ textAlign: 'center', padding: 40, color: retryable ? 'var(--text-secondary)' : 'var(--danger, #dc2626)' }}>{msg}</td></tr>;
    } else if (rows.length === 0) {
        body = <tr><td colSpan="9" style={{ textAlign: 'center', padding: 40 }}>No active prospects. Check "Include dormant" or type a name/phone to search older records.</td></tr>;
    } else {
        body = rows.map((p) => <Row key={p.id} p={p} meta={meta} selected={sel.has(Number(p.id))} onToggle={toggle} />);
    }

    return (
        <div className="prospects-table-container" data-react-prospects="1">
            <table className="prospects-table">
                <thead>
                    <tr>
                        <th scope="col" className="prospect-select-cell"><input type="checkbox" checked={allSelected} onChange={toggleAll} title="Select all" /></th>
                        <SortHeader label="PROSPECT" field="name" sortField={sortField} sortDir={sortDir} />
                        <th scope="col">AGENT</th>
                        <SortHeader label="SCORE" field="score" sortField={sortField} sortDir={sortDir} />
                        <th scope="col">MING GUA</th>
                        <th scope="col">OCCUPATION/COMPANY</th>
                        <SortHeader label="LAST ACTIVITY" field="activity" sortField={sortField} sortDir={sortDir} />
                        <SortHeader label="PROTECTION" field="protection" sortField={sortField} sortDir={sortDir} />
                        <th scope="col">ACTIONS</th>
                    </tr>
                </thead>
                <tbody>{body}</tbody>
            </table>
            <Pagination page={page} pageSize={pageSize} count={count} onNavigate={onNavigate} />
        </div>
    );
}
