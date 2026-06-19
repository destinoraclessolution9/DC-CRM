// Phase 4.2 (#13) — first REAL view migrated to a React island.
//
// Renders the Customers table from the BFF (via useCustomers / React Query),
// reproducing the EXACT markup the already-live `renderCustomersTable` BFF path
// produces (same `.prospects-table` shell, same row template, same pagination).
// The legacy filter bar + tab shell stay vanilla; this island only owns the
// table body + pagination. Mounted by chunks/script-prospects.js behind a flag
// (opt-in bundle), with the legacy table as the fallback — so normal users are
// untouched until this path is promoted to default.
//
// Cross-boundary contract: all row actions call window.app.* (already exported
// for the legacy inline-onclick template); the health badge is produced by
// window.app.renderQuickHealthBadge (HTML string → dangerouslySetInnerHTML, same
// as legacy). Pagination/reassign metadata (scope, agent list) is passed in by
// the chunk via props so the island never re-derives the visibility scope.
import { useCustomers } from '../data/useCustomers.js';
import { EmptyState } from '../ui/EmptyState.jsx';
import { ErrorState } from '../ui/ErrorState.jsx';

const app = () => window.app || {};

// Status → badge-class map. Previously every row hard-coded `score-A+` regardless
// of c.status, so an inactive/churned customer looked identical to an active one.
// (Aside: `score-A+` matches NO css rule — the real green class is `score-A-plus`,
// `+` being illegal in a selector — so even active rows only ever got the base
// .score-badge styling.) Derive the colour from the actual status using VALID
// classes so the badge finally carries signal: active→green, inactive/churned→red,
// anything else→orange. styles-fixed.css:1388-1411 defines these.
function statusBadgeClass(status) {
    const s = String(status || 'active').toLowerCase();
    if (s === 'active') return 'score-A-plus';
    if (s === 'inactive' || s === 'churned' || s === 'lost') return 'score-D';
    return 'score-C';
}

// Edit-permission gate — mirrors the customer detail view, which only shows the
// Edit button for Super Admin / Marketing Manager (script-customers.js:643:
// `isSystemAdmin(_state.cu) || isMarketingManager(_state.cu)`). Prefer the
// chunk-provided meta.canEdit flag; fall back to deriving it from the shared
// _crmUtils helpers against the current user so the island is correct even if the
// chunk hasn't supplied the flag yet.
function canEditCustomers(meta) {
    if (meta && typeof meta.canEdit === 'boolean') return meta.canEdit;
    const u = window._crmUtils;
    const cu = (window._appState && window._appState.cu) || null;
    if (u && (typeof u.isSystemAdmin === 'function' || typeof u.isMarketingManager === 'function')) {
        return !!((u.isSystemAdmin && u.isSystemAdmin(cu)) || (u.isMarketingManager && u.isMarketingManager(cu)));
    }
    return false;
}

// Reassign dropdown — faithful reproduction of the legacy <select> logic
// (chunks/script-prospects.js renderCustomersTable agent cell).
function AgentCell({ c, meta }) {
    const aid = c.responsible_agent_id || c.agent_id;
    const cid = aid ? String(aid) : '';
    const selStyle = {
        padding: '2px 6px', fontSize: '12px', minWidth: '120px',
        border: '1px solid var(--border)', borderRadius: '4px',
        background: 'var(--surface)', cursor: 'pointer',
    };

    if (!meta.canReassign) {
        const name = cid ? (meta.agentNames[cid] || '') : '';
        return <td data-label="Agent" onClick={(e) => e.stopPropagation()}>{name}</td>;
    }

    const inScope = meta.agents.some((a) => String(a.id) === cid);
    const cidName = meta.agentNames[cid];
    // Mirror legacy: prefix option + selected value.
    let prefix = null;            // {value,label} | null
    let selectVal = cid;
    if (!cid)            { prefix = { value: '', label: '' }; selectVal = ''; }
    else if (inScope)    { prefix = null;                     selectVal = cid; }
    else if (!cidName)   { prefix = { value: '', label: '' }; selectVal = ''; }
    else                 { prefix = { value: cid, label: cidName }; selectVal = cid; }

    return (
        <td data-label="Agent" onClick={(e) => e.stopPropagation()}>
            <select
                className="form-control"
                style={selStyle}
                value={selectVal}
                title="Reassign agent"
                onChange={(e) => app().quickReassign && app().quickReassign(c.id, e.target.value, 'customer')}
            >
                {prefix ? <option value={prefix.value}>{prefix.label}</option> : null}
                {meta.agents.map((a) => (
                    <option key={a.id} value={a.id}>{a.full_name || 'Agent'}</option>
                ))}
            </select>
        </td>
    );
}

function Row({ c, meta }) {
    const badgeHtml = (app().renderQuickHealthBadge || (() => ''))(c);
    const canEdit = canEditCustomers(meta);
    return (
        <tr onClick={() => app().showCustomerDetail && app().showCustomerDetail(c.id)} style={{ cursor: 'pointer' }}>
            <td data-label="Name"><strong>{c.full_name || ''}</strong></td>
            <td data-label="Lifetime Value">
                RM {(c.lifetime_value || 0).toLocaleString()}{' '}
                <span style={{ color: 'var(--success)', fontSize: '12px' }}><i className="fas fa-caret-up"></i></span>
            </td>
            <td data-label="Customer Since">{c.customer_since || '—'}</td>
            <td data-label="Ming Gua">{c.ming_gua || '—'}</td>
            <AgentCell c={c} meta={meta} />
            <td data-label="Health" dangerouslySetInnerHTML={{ __html: badgeHtml }}></td>
            <td data-label="Status"><span className={`score-badge ${statusBadgeClass(c.status)}`}>{(c.status || 'active').toUpperCase()}</span></td>
            <td onClick={(e) => e.stopPropagation()}>
                {canEdit ? <button className="btn-icon" title="Edit" onClick={(e) => { e.stopPropagation(); app().openProspectModal && app().openProspectModal(c.id); }}><i className="fas fa-edit"></i></button> : null}
                <button className="btn-icon" title="Add Purchase" onClick={() => app().openAddPurchaseModal && app().openAddPurchaseModal(c.id)}><i className="fas fa-shopping-cart"></i></button>
                <button className="btn-icon" title="Referral" onClick={(e) => { e.stopPropagation(); app().openCustomerReferralModal && app().openCustomerReferralModal(c.id); }}><i className="fas fa-user-plus"></i></button>
                <button className="btn-icon" title="Recruit" onClick={() => app().openRecruitModal && app().openRecruitModal(c.id)}><i className="fas fa-user-tie"></i></button>
            </td>
        </tr>
    );
}

function Pagination({ page, pageSize, count, onNavigate }) {
    const totalPages = Math.ceil(count / pageSize);
    const wrap = { display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', padding: '16px 0', flexWrap: 'wrap' };
    if (totalPages <= 1) {
        return (
            <div id="customers-react-pagination" style={wrap}>
                <span style={{ color: 'var(--text-secondary)', fontSize: '13px' }}>
                    {count} customer{count !== 1 ? 's' : ''}
                </span>
            </div>
        );
    }
    const currentPage = page + 1;
    const pageStart = page * pageSize;
    const from = pageStart + 1;
    const to = Math.min(pageStart + pageSize, count);
    const lastPage = Math.max(0, totalPages - 1);
    return (
        <div id="customers-react-pagination" style={wrap}>
            <span style={{ color: 'var(--text-secondary)', fontSize: '13px' }}>Showing {from}–{to} of {count}</span>
            <button className="btn secondary btn-sm" disabled={page === 0} onClick={() => onNavigate(0)} title="First page"><i className="fas fa-angle-double-left"></i></button>
            <button className="btn secondary btn-sm" disabled={page === 0} onClick={() => onNavigate(Math.max(0, page - 1))}><i className="fas fa-angle-left"></i> Prev</button>
            <span style={{ fontWeight: 600, fontSize: '14px' }}>Page {currentPage} of {totalPages}</span>
            <button className="btn secondary btn-sm" disabled={currentPage >= totalPages} onClick={() => onNavigate(Math.min(lastPage, page + 1))}>Next <i className="fas fa-angle-right"></i></button>
            <button className="btn secondary btn-sm" disabled={currentPage >= totalPages} onClick={() => onNavigate(lastPage)} title="Last page"><i className="fas fa-angle-double-right"></i></button>
        </div>
    );
}

export function CustomersTable({ params, meta, pageSize = 50, onNavigate }) {
    const page = Math.max(0, params.page | 0);
    const { data, isLoading, isError, error } = useCustomers({
        q: params.q || '', gua: params.gua || '', type: params.type || '',
        limit: pageSize, offset: page * pageSize,
    });

    const rows = (data && data.rows) || [];
    const count = (data && data.count) || 0;

    // Live-verification markers (mirror the 4.1 probe convention).
    if (isLoading)      window.__REACT_CUSTOMERS_STATE = 'loading';
    else if (isError)   window.__REACT_CUSTOMERS_STATE = 'error';
    else {
        window.__REACT_CUSTOMERS_STATE = 'ready';
        window.__REACT_CUSTOMERS_COUNT = count;
        window.__REACT_CUSTOMERS_ROWS = rows.length;
    }

    let body;
    if (isLoading && rows.length === 0) {
        body = <tr><td colSpan="8" style={{ textAlign: 'center', padding: '20px', color: 'var(--text-secondary)' }}>Loading customers…</td></tr>;
    } else if (isError) {
        // Classified, human message (bffError) via the shared <ErrorState>.
        body = <tr><td colSpan="8" style={{ padding: 0 }}><ErrorState title="Couldn't load customers" description={(error && error.message) || 'Failed to load customers.'} retryable={!error || error.retryable} /></td></tr>;
    } else if (rows.length === 0) {
        body = <tr><td colSpan="8" style={{ padding: 0 }}><EmptyState icon="fa-user-group" title="No customers found" description="Try adjusting your search or filters." /></td></tr>;
    } else {
        body = rows.map((c) => <Row key={c.id} c={c} meta={meta} />);
    }

    return (
        <div className="prospects-table-container" data-react-customers="1">
            <table className="prospects-table">
                <thead>
                    <tr>
                        <th scope="col">Name</th>
                        <th scope="col">Lifetime Value</th>
                        <th scope="col">Customer Since</th>
                        <th scope="col">Ming Gua</th>
                        <th scope="col">Agent</th>
                        <th scope="col">Health</th>
                        <th scope="col">Status</th>
                        <th scope="col">Actions</th>
                    </tr>
                </thead>
                <tbody>{body}</tbody>
            </table>
            <Pagination page={page} pageSize={pageSize} count={count} onNavigate={onNavigate} />
        </div>
    );
}
