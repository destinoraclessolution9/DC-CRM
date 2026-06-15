// React-island migration — Agents screen (after Customers/Prospects).
//
// Renders the Agents (Consultants) table. The agent LIST (identity-filtered +
// visibility-scoped) is computed in chunks/script-prospects.js — which owns
// isAgent + getVisibleUserIds — and passed in as `agents`. This view applies the
// 4 toolbar filters (search/team/role/status), joins the per-agent count + stats
// maps (useAgentStats / React Query), and reproduces the EXACT row markup the
// legacy renderAgentsTable produces. Row actions call window.app.* (already
// exported for the legacy inline-onclick template). Mounted by the chunk behind
// the opt-in flag __REACT_AGENTS with the legacy table as fallback — so normal
// users are untouched until this path is promoted to default.
//
// Counts note: the per-agent prospect/customer/stats maps are computed in the
// chunk (renderAgentsTable) from the SAME warm AppDataStore.getAll the legacy
// table uses, and passed in as `counts`. We deliberately do NOT wrap that in
// React Query here — it's a derived aggregate, and a mount-time RQ query paused
// as "offline" (never ran) leaving counts at 0. Reading warm data via props is
// simpler and guarantees parity with the legacy table.

const app = () => window.app || {};
const stop = (e) => e.stopPropagation();

function rateClassFor(rate) {
    return rate >= 90 ? 'rate-good' : (rate >= 70 ? 'rate-warning' : 'rate-critical');
}

function Row({ agent, prospectCount, customerCount, stats, canAssignUpline }) {
    const status = agent.status || 'active';
    const rate = stats && stats.followup_rate != null ? stats.followup_rate : 0;
    const id = String(agent.id);
    return (
        <tr data-agent-id={agent.id} className="agent-row">
            <td data-label="Name">
                <div style={{ fontWeight: 600 }}>{agent.full_name}</div>
                <div style={{ fontSize: '12px', color: 'var(--gray-500)' }}>{agent.agent_code || 'N/A'}</div>
            </td>
            <td data-label="Team">{agent.team || 'Unassigned'}</td>
            <td data-label="Status"><span className={`status-badge status-${status}`}>{String(status).toUpperCase()}</span></td>
            <td data-label="License Expiry">{agent.license_expiry || 'N/A'}</td>
            <td data-label="Prospects">{prospectCount} prospects</td>
            <td data-label="Customers">{customerCount} customers</td>
            <td data-label="Follow-up">
                <div className="followup-rate">
                    <span className={`rate-indicator ${rateClassFor(rate)}`}></span>
                    <span>{rate}%</span>
                </div>
            </td>
            <td onClick={stop}>
                <button className="btn-icon view-detail-btn" title="View Detail" onClick={(e) => { stop(e); app().showAgentProfile && app().showAgentProfile(id); }}><i className="fas fa-eye"></i></button>
                <button className="btn-icon edit-agent-btn" title="Edit Agent" onClick={(e) => { stop(e); app().openEditAgentModal && app().openEditAgentModal(id); }}><i className="fas fa-edit"></i></button>
                {canAssignUpline ? <button className="btn-icon" title="Assign Upline" onClick={(e) => { stop(e); app().openAssignUplineModal && app().openAssignUplineModal(id); }}><i className="fas fa-sitemap"></i></button> : null}
                {canAssignUpline ? <button className="btn-icon" title="Reset Password" onClick={(e) => { stop(e); app().openResetPasswordModal && app().openResetPasswordModal(id); }}><i className="fas fa-key"></i></button> : null}
                {canAssignUpline ? <button className="btn-icon" title="Delete Agent" style={{ color: 'var(--error)' }} onClick={(e) => { stop(e); app().deleteAgent && app().deleteAgent(id); }}><i className="fas fa-trash"></i></button> : null}
            </td>
        </tr>
    );
}

export function AgentsTable({ agents = [], counts = {}, filters = {}, meta = {} }) {
    const prospectCountMap = counts.prospectCountMap || {};
    const customerCountMap = counts.customerCountMap || {};
    const statsByAgentId = counts.statsByAgentId || {};

    const search = (filters.search || '').toLowerCase();
    const team = filters.team || '';
    const role = filters.role || '';
    const status = filters.status || '';
    const canAssignUpline = !!meta.canAssignUpline;

    // Mirror renderAgentsTable's per-row filter loop exactly.
    const visible = agents.filter((agent) => {
        if (search
            && !(agent.full_name && agent.full_name.toLowerCase().includes(search))
            && !(agent.agent_code && agent.agent_code.toLowerCase().includes(search))
            && !(agent.phone && agent.phone.toLowerCase().includes(search))) return false;
        if (team && agent.team !== team) return false;
        if (role && agent.role !== role) return false;
        if (status && agent.status !== status) return false;
        return true;
    });

    // Live-verification markers (mirror the Customers island convention).
    window.__REACT_AGENTS_STATE = 'ready';
    window.__REACT_AGENTS_ROWS = visible.length;

    let body;
    if (visible.length === 0) {
        body = <tr><td colSpan="8" style={{ textAlign: 'center', padding: '20px' }}>No agents found</td></tr>;
    } else {
        body = visible.map((agent) => (
            <Row
                key={agent.id}
                agent={agent}
                prospectCount={prospectCountMap[String(agent.id)] || 0}
                customerCount={customerCountMap[String(agent.id)] || 0}
                stats={statsByAgentId[String(agent.id)]}
                canAssignUpline={canAssignUpline}
            />
        ));
    }

    return (
        <div className="agents-table-container" data-react-agents="1">
            <table className="agents-table">
                <thead>
                    <tr>
                        <th scope="col">Name / Agent ID</th>
                        <th scope="col">Team</th>
                        <th scope="col">Status</th>
                        <th scope="col">License Expiry</th>
                        <th scope="col">Assigned Prospects</th>
                        <th scope="col">Customers</th>
                        <th scope="col">Follow-up Rate</th>
                        <th scope="col">Actions</th>
                    </tr>
                </thead>
                <tbody>{body}</tbody>
            </table>
        </div>
    );
}
