// Reporting & KPI Dashboard — scaffold-shell island (view id 'reports').
//
// React owns ONLY the static shell (header + role-gated actions + time/role/
// agent/date filters + every empty container incl. the Chart.js canvas
// #revenue-trend-chart). ALL data + chart rendering stays in the chunk
// (chunks/script-reporting.js): the island useEffect calls onReady → the chunk's
// _kpiPopulate() (cached-snapshot inject + async agent-dropdown fill +
// refreshKPIDashboard, which draws Chart.js into the canvas + fills the tables).
// Filter buttons / selects / date pickers call window.app.* exactly as legacy.
import React, { useEffect, useState } from 'react';

const app = () => window.app || {};
const call = (name, ...args) => { const f = app()[name]; if (typeof f === 'function') f(...args); };
const byId = (id) => { const el = document.getElementById(id); return el ? el.value : ''; };

export function ReportsView({ isTeamLeader = false, currentTimeFilter = 'monthly', roles = [], currentRoleFilter = 'All', customDateFrom = '', customDateTo = '', agents = [], currentAgentFilter = 'all', loadAgents, onReady }) {
    try { window.__REACT_REPORTS_STATE = 'ready'; } catch (_) { /* noop */ }

    // Agent-filter options are owned by React state (rendered options, not an
    // imperative innerHTML fill — which lost a race vs React's <select> sync and
    // depended on users being warm at mount). loadAgents() resolves the list
    // whenever the data is ready (cold-load safe).
    const [agentList, setAgentList] = useState(agents);
    try { window.__DBG_RPT_RENDER = (window.__DBG_RPT_RENDER || 0) + 1; window.__DBG_RPT_RENDER_AGENTS = agentList.length; } catch (_) {}
    useEffect(() => {
        try { window.__DBG_RPT_LA = (typeof loadAgents === 'function') ? 'called' : ('no-fn:' + typeof loadAgents); } catch (_) {}
        if (typeof loadAgents !== 'function') return undefined;
        let alive = true;
        Promise.resolve(loadAgents()).then((a) => {
            try { window.__DBG_RPT_LA_RESOLVED = Array.isArray(a) ? a.length : ('non-array:' + typeof a); } catch (_) {}
            if (alive && Array.isArray(a)) { setAgentList(a); try { window.__DBG_RPT_SETSTATE = a.length; } catch (_) {} }
        }).catch((e) => { try { window.__DBG_RPT_LA_ERR = String(e && e.message); } catch (_) {} });
        return () => { alive = false; try { window.__DBG_RPT_CLEANUP = (window.__DBG_RPT_CLEANUP || 0) + 1; } catch (_) {} };
    }, [loadAgents]);

    useEffect(() => {
        if (typeof onReady === 'function') {
            try { onReady(); } catch (e) { try { console.warn('[reports] onReady failed:', e && e.message); } catch (_) {} }
        }
    }, [onReady]);

    const TIMES = ['weekly', 'monthly', 'quarterly', 'yearly'];

    return (
        <div className="kpi-dashboard">
            <div className="dashboard-header">
                <div>
                    <h1>Reporting &amp; KPI Dashboard</h1>
                    <p>Real-time performance tracking and hierarchical targets</p>
                </div>
                <div className="header-actions">
                    {isTeamLeader ? (
                        <>
                            <button className="btn primary" onClick={() => call('openKPITargetsModal')}><i className="fas fa-bullseye"></i> Set Yearly Targets</button>
                            <button className="btn primary" onClick={() => call('openQuarterlyTargetsModal')}><i className="fas fa-calendar-alt"></i> Set Quarterly Targets</button>
                            <button className="btn secondary" onClick={() => call('openTargetManagementModal')}><i className="fas fa-user-cog"></i> Agent Targets</button>
                        </>
                    ) : null}
                    <button className="btn secondary" onClick={() => call('exportKPIReport', 'csv')}><i className="fas fa-file-csv"></i> Export CSV</button>
                    <button className="btn secondary" onClick={() => call('printDashboard')}><i className="fas fa-print"></i> Print</button>
                </div>
            </div>

            <div className="time-filter-bar">
                <div className="time-toggle-group">
                    {TIMES.map((t) => (
                        <button key={t} className={`time-toggle-btn${currentTimeFilter === t ? ' active' : ''}`} onClick={() => call('setTimeFilter', t)}>
                            {t.charAt(0).toUpperCase() + t.slice(1)}
                        </button>
                    ))}
                </div>
                <div className="role-filter-group" style={{ marginLeft: '20px' }}>
                    <select id="kpi-role-filter" className="form-control" defaultValue={currentRoleFilter} onChange={(e) => call('setRoleFilter', e.target.value)} style={{ width: '200px' }}>
                        <option value="All">All Roles</option>
                        {roles.map((r) => <option key={r} value={r}>{r}</option>)}
                    </select>
                </div>
                <div className="role-filter-group" style={{ marginLeft: '12px' }}>
                    <select id="kpi-agent-filter" className="form-control" defaultValue={String(currentAgentFilter)} onChange={(e) => call('setAgentFilter', e.target.value)} style={{ width: '200px' }}>
                        <option value="all">All Agents</option>
                        {agentList.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                    </select>
                </div>
                <div className="date-range-picker" style={{ marginLeft: 'auto' }}>
                    <label htmlFor="kpi-date-from" className="sr-only">From date</label>
                    <input type="date" id="kpi-date-from" aria-label="From date" defaultValue={customDateFrom} onChange={(e) => call('setCustomDateRange', e.target.value, byId('kpi-date-to'))} />
                    <span aria-hidden="true">to</span>
                    <label htmlFor="kpi-date-to" className="sr-only">To date</label>
                    <input type="date" id="kpi-date-to" aria-label="To date" defaultValue={customDateTo} onChange={(e) => call('setCustomDateRange', byId('kpi-date-from'), e.target.value)} />
                </div>
            </div>

            <div id="kpi-stats-grid" className="stats-grid">
                <div style={{ gridColumn: '1/-1', textAlign: 'center', padding: '32px', color: 'var(--gray-400)' }}><i className="fas fa-spinner fa-spin"></i> Loading KPI data...</div>
            </div>

            <div className="dashboard-charts-row">
                <div className="chart-container">
                    <div className="chart-header">
                        <h3>Revenue Trend (Actual vs Target)</h3>
                        <div className="chart-legend">
                            <span style={{ display: 'inline-block', width: '12px', height: '12px', background: '#0D9488', marginRight: '4px' }}></span> Actual
                            <span style={{ display: 'inline-block', width: '12px', height: '12px', background: '#94a3b8', marginRight: '4px', marginLeft: '12px' }}></span> Target
                        </div>
                    </div>
                    <canvas id="revenue-trend-chart"></canvas>
                </div>
                <div id="target-overview-container"></div>
            </div>

            <div className="kpi-bottom-grid">
                <div className="performance-card card">
                    <div className="card-header"><h3>Current Quarter Performance Breakdown</h3></div>
                    <div id="quarterly-performance-table"></div>
                </div>
                <div className="leaderboard-card">
                    <div className="leaderboard-header"><h3>Agent Performance Leaderboard</h3></div>
                    <div id="agent-leaderboard-table"></div>
                </div>
            </div>

            <div id="kpi-target-comparison-section" style={{ marginTop: '24px' }}></div>

            <div className="kpi-card" style={{ marginTop: '24px' }}>
                <h3 className="kpi-card-title">Cases by Product Category</h3>
                <div id="cases-count-table"></div>
            </div>

            <div className="kpi-card" style={{ marginTop: '16px' }}>
                <h3 className="kpi-card-title">Headcount by Event Type</h3>
                <div id="headcount-table"></div>
            </div>

            <div className="kpi-card" style={{ marginTop: '16px' }}>
                <h3 className="kpi-card-title">Activity Attendance Breakdown</h3>
                <div id="activity-attendance-details"></div>
            </div>
        </div>
    );
}
