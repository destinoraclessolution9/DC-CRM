// Protection Period & Follow-up Monitoring — standalone view (Screen 35 / protection).
//
// Render-only island. The chunk (chunks/script-import.js, showProtectionMonitoringView)
// owns ALL data + derivation: it fetches prospects/users/activities + visibleIds,
// builds monitorData, and computes four plain model arrays (team summary cards,
// agent-performance rows, inactive-prospect rows, reassignment-history rows) via
// the _prot* builders — mirroring the legacy renderTeamSummaryCards /
// renderAgentPerformanceRows / renderInactiveProspectsRows / renderReassignmentHistory
// (kept as the legacy fallback). Every mutation stays in the chunk via window.app.*
// (refreshFollowupStats, exportFollowupReport, configureAlerts, viewAgentDetails,
// bulkReassign, openReassignModal, contactProspect, navigateTo). React auto-escapes
// names/reasons the legacy path interpolated raw.
import React from 'react';

const app = () => window.app || {};
const call = (name, ...args) => { const f = app()[name]; if (typeof f === 'function') f(...args); };

export function ProtectionMonitoringView({ teamCards = [], agentRows = [], inactiveRows = [], reassignRows = [], reassignEmpty = 'No reassignment history yet.' }) {
    try {
        window.__REACT_PROTECTION_STATE = 'ready';
        window.__REACT_PROTECTION_ROWS = { teams: teamCards.length, agents: agentRows.length, inactive: inactiveRows.length, reassign: reassignRows.length };
    } catch (_) { /* noop */ }

    return (
        <div className="protection-view">
            <div className="protection-header">
                <div><h1>Protection Period &amp; Follow-up Monitoring</h1><p>Track prospect protection periods and agent follow-up performance</p></div>
                <div className="protection-header-actions">
                    <button className="btn secondary" onClick={() => call('refreshFollowupStats')}><i className="fas fa-sync-alt"></i> Refresh Stats</button>
                    <button className="btn secondary" onClick={() => call('exportFollowupReport')}><i className="fas fa-download"></i> Export Report</button>
                    <button className="btn secondary" onClick={() => call('configureAlerts')}><i className="fas fa-bell"></i> Configure Alerts</button>
                    <button className="btn primary" onClick={() => call('navigateTo', 'import')}><i className="fas fa-upload"></i> Bulk Import</button>
                </div>
            </div>

            <div className="team-summary-cards">
                {teamCards.map((t, i) => (
                    <div className={`summary-card ${t.colorClass}`} key={i}>
                        <h4>{t.name}</h4>
                        <div className="summary-stats">
                            <div><span className="stat-label">Active:</span><span className="stat-value">{t.active}</span></div>
                            <div><span className="stat-label">Attention:</span><span className="stat-value warning">{t.attention}</span></div>
                            <div><span className="stat-label">Inactive:</span><span className="stat-value danger">{t.inactive}</span></div>
                            <div><span className="stat-label">Critical:</span><span className="stat-value danger">{t.critical}</span></div>
                        </div>
                    </div>
                ))}
            </div>

            <div className="agent-performance">
                <h3>Agent Performance</h3>
                <div className="agent-table-container">
                    <table className="agent-performance-table">
                        <thead><tr>
                            <th scope="col">Agent</th><th scope="col">Team</th><th scope="col">Assigned</th>
                            <th scope="col">Followed up (7d)</th><th scope="col">Rate</th>
                            <th scope="col">Inactive (3-7d)</th><th scope="col">Inactive (8-14d)</th><th scope="col">Inactive (15d+)</th>
                            <th scope="col">Actions</th>
                        </tr></thead>
                        <tbody>
                            {agentRows.map((r) => (
                                <tr key={r.id}>
                                    <td><strong>{r.full_name}</strong></td>
                                    <td>{r.team}</td>
                                    <td>{r.assigned}</td>
                                    <td>{r.followedUp7d}</td>
                                    <td><span className={`rate-badge ${r.rateCls}`}>{r.rate}%</span></td>
                                    <td>{r.i37}</td>
                                    <td>{r.i814}</td>
                                    <td>{r.i15}</td>
                                    <td>
                                        <button className="btn-icon" onClick={() => call('viewAgentDetails', r.id)} title="View"><i className="fas fa-eye"></i></button>
                                        <button className="btn-icon" onClick={() => call('bulkReassign', r.id)} title="Reassign"><i className="fas fa-exchange-alt"></i></button>
                                        <button className="btn-icon" onClick={() => call('bulkReassign', r.id)} title="Bulk Reassign"><i className="fas fa-users"></i></button>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>

            <div className="inactive-prospects">
                <h3>Inactive Prospects (&gt;7 days)</h3>
                <div className="inactive-table-container">
                    <table className="inactive-table">
                        <thead><tr>
                            <th scope="col">Prospect</th><th scope="col">Agent</th><th scope="col">Days Inactive</th>
                            <th scope="col">Score</th><th scope="col">Protection Deadline</th><th scope="col">Status</th><th scope="col">Actions</th>
                        </tr></thead>
                        <tbody>
                            {inactiveRows.length === 0
                                ? <tr><td colSpan="7" style={{ textAlign: 'center', padding: '24px', color: 'var(--gray-500)' }}>No inactive prospects found</td></tr>
                                : inactiveRows.map((r) => (
                                    <tr key={r.id}>
                                        <td><strong>{r.full_name}</strong></td>
                                        <td>{r.agentName}</td>
                                        <td className={r.daysCls}>{r.daysText}</td>
                                        <td>{r.score}</td>
                                        <td>{r.deadline}</td>
                                        <td><span className={`status-badge status-${r.status}`}>{r.statusLabel}</span></td>
                                        <td>
                                            <button className="btn-icon" onClick={() => call('openReassignModal', r.id)} title="Reassign"><i className="fas fa-exchange-alt"></i></button>
                                            <button className="btn-icon" onClick={() => call('contactProspect', r.id)} title="Contact"><i className="fas fa-phone"></i></button>
                                        </td>
                                    </tr>
                                ))}
                        </tbody>
                    </table>
                </div>
            </div>

            <div className="agent-performance" style={{ marginTop: '24px' }}>
                <h3>Reassignment History</h3>
                <div className="agent-table-container">
                    {reassignRows.length === 0
                        ? <p style={{ padding: '16px', color: 'var(--gray-500)' }}>{reassignEmpty}</p>
                        : (
                            <table className="agent-performance-table">
                                <thead><tr>
                                    <th scope="col">Date</th><th scope="col">Prospect ID</th><th scope="col">From Agent</th>
                                    <th scope="col">To Agent</th><th scope="col">Reason</th><th scope="col">By</th>
                                </tr></thead>
                                <tbody>
                                    {reassignRows.map((r, i) => (
                                        <tr key={i}>
                                            <td>{r.date}</td>
                                            <td>#{r.prospect_id}</td>
                                            <td>{r.fromName}</td>
                                            <td>{r.toName}</td>
                                            <td>{r.reason}</td>
                                            <td>{r.byName}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        )}
                </div>
            </div>
        </div>
    );
}
