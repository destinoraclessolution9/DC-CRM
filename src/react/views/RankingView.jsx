// React-island migration — Ranking Performance Overview (read-only).
//
// The chunk (showRankingPerformanceView in chunks/script-performance.js) fetches
// users/activities/purchases/prospects, buckets them, and computes the sorted
// per-agent `agentStats` + the month label — then passes them in as props. This
// island only renders (top-3 cards + full rankings table), reproducing the exact
// legacy markup. No React Query (computed data via props = robust). The single
// Refresh button calls window.app.refreshCurrentView().

const rankBadge = (i) => (i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `#${i + 1}`);
const rateBadgeClass = (r, hi, mid) => (r >= hi ? 'success' : r >= mid ? 'warning' : 'danger');

function TopCard({ a, i }) {
    const border = i === 0 ? '#FFD700' : i === 1 ? '#C0C0C0' : '#CD7F32';
    return (
        <div style={{ background: 'var(--white)', borderRadius: '12px', padding: '20px', textAlign: 'center', boxShadow: '0 2px 8px rgba(0,0,0,0.06)', borderTop: `4px solid ${border}` }}>
            <div style={{ fontSize: '32px', marginBottom: '8px' }}>{rankBadge(i)}</div>
            <div style={{ fontSize: '16px', fontWeight: 600 }}>{a.name}</div>
            <div style={{ color: 'var(--gray-500)', fontSize: '12px', marginBottom: '12px' }}>{a.team}</div>
            <div style={{ fontSize: '24px', fontWeight: 700, color: 'var(--primary)' }}>{a.performanceScore} pts</div>
            <div style={{ fontSize: '12px', color: 'var(--gray-500)', marginTop: '8px' }}>Sales: RM {a.sales.toLocaleString()} · CPS: {a.cps} · Rate: {a.closingRate}%</div>
        </div>
    );
}

export function RankingView({ agentStats = [], monthLabel = '' }) {
    window.__REACT_RANKING_STATE = 'ready';
    window.__REACT_RANKING_ROWS = agentStats.length;
    const right = { textAlign: 'right' };
    return (
        <div className="ranking-view">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
                <div>
                    <h1>Ranking Performance Overview</h1>
                    <p style={{ color: 'var(--gray-500)' }}>Agent rankings for {monthLabel}</p>
                </div>
                <div>
                    <button className="btn secondary" onClick={() => window.app && window.app.refreshCurrentView && window.app.refreshCurrentView()}><i className="fas fa-sync-alt"></i> Refresh</button>
                </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '16px', marginBottom: '24px' }}>
                {agentStats.slice(0, 3).map((a, i) => <TopCard key={a.id ?? i} a={a} i={i} />)}
            </div>

            <div className="profile-section">
                <h2><i className="fas fa-list-ol"></i> Full Rankings</h2>
                <table className="data-table" style={{ width: '100%' }}>
                    <thead>
                        <tr>
                            <th scope="col">Rank</th>
                            <th scope="col">Agent</th>
                            <th scope="col">Team</th>
                            <th scope="col" style={right}>Score</th>
                            <th scope="col" style={right}>CPS</th>
                            <th scope="col" style={right}>Sales (RM)</th>
                            <th scope="col" style={right}>Meetings</th>
                            <th scope="col" style={right}>Prospects</th>
                            <th scope="col" style={right}>Follow-up %</th>
                            <th scope="col" style={right}>Closing %</th>
                        </tr>
                    </thead>
                    <tbody>
                        {agentStats.map((a, i) => (
                            <tr key={a.id ?? i} style={i < 3 ? { background: 'var(--primary-50)' } : undefined}>
                                <td style={{ fontWeight: 600 }}>{rankBadge(i)}</td>
                                <td>{a.name}</td>
                                <td>{a.team}</td>
                                <td style={{ textAlign: 'right', fontWeight: 600 }}>{a.performanceScore}</td>
                                <td style={right}>{a.cps}</td>
                                <td style={right}>{a.sales.toLocaleString()}</td>
                                <td style={right}>{a.meetings}</td>
                                <td style={right}>{a.prospects}</td>
                                <td style={right}><span className={`badge ${rateBadgeClass(a.followupRate, 80, 50)}`}>{a.followupRate}%</span></td>
                                <td style={right}><span className={`badge ${rateBadgeClass(a.closingRate, 30, 15)}`}>{a.closingRate}%</span></td>
                            </tr>
                        ))}
                        {agentStats.length === 0 && (
                            <tr><td colSpan="10" style={{ textAlign: 'center', padding: '20px' }}>No agent data available</td></tr>
                        )}
                    </tbody>
                </table>
            </div>
        </div>
    );
}
