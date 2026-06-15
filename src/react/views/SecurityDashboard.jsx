// React-island migration — Security dashboard (screen 2).
//
// Read-only Super-Admin view: a static security-score card + a list of recent
// security incidents. The chunk (showSecurityDashboard in chunks/script-admin.js)
// fetches `security_incidents` via AppDataStore.getAll and passes them in as the
// `incidents` prop — no React Query here (derived/aggregate data via props is the
// robust pattern; avoids the mount-time "offline pause" we hit on the Agents
// counts query). Reproduces the EXACT legacy markup. Legacy render is the
// fallback on any mount error.

export function SecurityDashboard({ incidents = [] }) {
    // Live-verification markers (mirror the other islands' convention).
    window.__REACT_SECURITY_STATE = 'ready';
    window.__REACT_SECURITY_ROWS = incidents.length;
    return (
        <div className="security-dashboard">
            <div className="security-score-card">
                <div className="score-value">92/100</div>
                <div className="score-label">Overall Security Score - Excellent</div>
            </div>

            <h3>Recent Security Incidents</h3>
            <div className="incident-list">
                {incidents.length ? incidents.map((inc, i) => (
                    <div className={`incident-item ${inc.severity || 'medium'}`} key={inc.id ?? i}>
                        <div className="incident-icon"><i className="fas fa-exclamation-circle"></i></div>
                        <div className="incident-content">
                            <div className="incident-title">{inc.title || 'Security Alert'}</div>
                            <div className="incident-meta">
                                <span>{new Date(inc.timestamp).toLocaleString()}</span>
                            </div>
                        </div>
                    </div>
                )) : <p>No recent incidents.</p>}
            </div>
        </div>
    );
}
