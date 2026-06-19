// Referral Relationship Management — scaffold-shell island (view id 'referrals').
//
// React owns ONLY the static shell (header + search box + actions + summary/
// leaderboard containers + tree section with filter chips, tools, the D3 <svg>,
// placeholder, and node sidebar). ALL logic stays in the chunk
// (chunks/script-referrals.js): the injected <style> block, renderSummary/
// renderLeaderboard fills, and the D3 zoom/pan tree (showReferralTree into
// #referral-tree-svg) — unchanged. Island signals onReady from useEffect; the
// chunk awaits it then runs its style-inject + summary/leaderboard + tree render
// by id. Search / filter chips / tools / Add-Referral call window.app.*.
//
// THIRD render path (default-OFF, gated in the chunk by _reactRefJsxOn /
// ?react_ref_jsx=1 / crm_react_ref_jsx='1'): when the chunk hands us a `data`
// payload, we render the SURROUNDING parts — header / summary cards / Top
// Referrers strip / leaderboard — as real JSX with React-state for the
// leaderboard period selector + hidden-referrer toggles, calling existing
// window.app.* handlers for interactions. The D3 relationship TREE is NOT
// componentized: we render the SAME stable-id containers (#referral-tree-*,
// #tree-node-sidebar) and the chunk still fills them by id (showReferralTree).
// The scaffold branch below is UNCHANGED and still runs whenever `data` is
// absent (flag off, or payload build threw → chunk does the by-id fill).
import React, { useEffect, useState } from 'react';
import { EmptyState } from '../ui/EmptyState.jsx';

const app = () => window.app || {};
const call = (name, ...args) => { const f = app()[name]; if (typeof f === 'function') return f(...args); };

const FILTERS = [
    { key: 'all', label: 'All', active: true },
    { key: 'new', label: 'CPS Active' },
    { key: 'expected_drop', label: 'Expected to Drop' },
    { key: 'lost', label: 'Inactive / Unable' },
];
const TOOLS = [
    { id: 'tree-back-btn', fn: 'treeNavBack', icon: 'fa-arrow-left', title: 'Go Back', hidden: true },
    { fn: 'treeZoomIn', icon: 'fa-plus', title: 'Zoom In' },
    { fn: 'treeZoomOut', icon: 'fa-minus', title: 'Zoom Out' },
    { fn: 'treeResetZoom', icon: 'fa-compress-arrows-alt', title: 'Reset' },
    { fn: 'showTreeBookmarks', icon: 'fa-heart', title: 'Bookmarks' },
    { fn: 'exportRelationshipTree', icon: 'fa-download', title: 'Export' },
];

// ── Shared shell pieces (used by BOTH the scaffold and full-JSX paths) ──────
// The header (title + search box + actions) is identical markup in both paths;
// extracting it keeps the two branches in sync. The search box keeps the SAME
// element ids (#tree-search-input / #tree-search-results) the chunk writes to.
function RefHeader() {
    return (
        <div className="ref-v2-header">
            <div>
                <h1>Referral Relationship Management</h1>
                <div className="ref-v2-subtitle">Visualize connections and track top referrers</div>
            </div>
            <div className="ref-v2-actions">
                <div className="search-box-v2">
                    <i className="fas fa-search"></i>
                    <input type="text" id="tree-search-input" placeholder="Search person to view tree..." autoComplete="off"
                        onInput={(e) => { const v = e.target.value; call('debounceCall', 'tree-search', () => call('searchTreePerson', v), 260); }} />
                    <div id="tree-search-results" className="search-results-v2"></div>
                </div>
                <button className="btn primary" onClick={() => call('openAddReferralModal')}><i className="fas fa-plus"></i> Add Referral</button>
                <button className="btn secondary" onClick={() => call('refreshCurrentView')}><i className="fas fa-sync-alt"></i> Refresh</button>
            </div>
        </div>
    );
}

// Relationship-tree section. The D3 zoom/pan tree is NOT componentized — these
// are the stable-id containers the chunk fills by id (showReferralTree →
// #referral-tree-svg) on BOTH the scaffold and full-JSX paths. Filter chips keep
// data-filter so the chunk's applyTreeFilters can toggle their .active class.
function RefTreeSection() {
    return (
        <div className="ref-v2-tree-section">
            <div className="tree-header">
                <div style={{ display: 'flex', alignItems: 'center', gap: '16px', flexWrap: 'wrap' }}>
                    <h3><i className="fas fa-network-wired"></i> Relationship Tree</h3>
                    <div className="tree-filter-chips">
                        {FILTERS.map((f) => (
                            <button key={f.key} className={`tree-filter-chip${f.active ? ' active' : ''}`} data-filter={f.key} onClick={() => call('applyTreeFilters', f.key)}>{f.label}</button>
                        ))}
                    </div>
                </div>
                <div className="tree-tools">
                    {TOOLS.map((t, i) => (
                        <button key={i} className="tool-btn" id={t.id} onClick={() => call(t.fn)} title={t.title} style={t.hidden ? { display: 'none' } : undefined}>
                            <i className={`fas ${t.icon}`}></i>
                        </button>
                    ))}
                </div>
            </div>
            <div className="tree-workspace">
                <div id="referral-tree-container" className="tree-visualization">
                    <div id="referral-tree-placeholder" className="tree-empty">
                        <i className="fas fa-search"></i>
                        <p>Search for a person above to view their referral network.</p>
                    </div>
                    <svg id="referral-tree-svg" style={{ width: '100%', height: '100%', display: 'none' }}></svg>
                </div>
                <div id="tree-node-sidebar" className="tree-node-sidebar" style={{ display: 'none' }}></div>
            </div>
        </div>
    );
}

// ── Full-JSX: Summary cards + Top Referrers strip (mirror of renderSummary) ──
function SummarySection({ summary }) {
    const s = summary || {};
    const top3 = s.top3 || [];
    return (
        <div id="referral-summary-container">
            <div className="summary-table-v2">
                <div className="summary-card-v2 blue">
                    <div className="icon"><i className="fas fa-users"></i></div>
                    <div className="info"><h4>Total Referrers</h4><div>{s.totalReferrers || 0}</div></div>
                </div>
                <div className="summary-card-v2 green">
                    <div className="icon"><i className="fas fa-user-plus"></i></div>
                    <div className="info"><h4>Total Referrals</h4><div>{s.totalReferrals || 0}</div></div>
                </div>
                <div className="summary-card-v2 purple">
                    <div className="icon"><i className="fas fa-percentage"></i></div>
                    <div className="info"><h4>Conversion Rate</h4><div>{(s.conversionRate || 0)}%</div></div>
                </div>
            </div>
            <div className="top-referrers-strip">
                <div className="strip-label"><i className="fas fa-fire"></i> Top Referrers:</div>
                <div className="strip-items">
                    {top3.length === 0
                        ? <div className="text-muted" style={{ fontSize: '12px' }}>No referrals yet.</div>
                        : top3.map((t, i) => (
                            <div className="strip-item" key={i}><span className="rank">#{i + 1}</span> {t.name} ({t.count})</div>
                        ))}
                </div>
            </div>
        </div>
    );
}

// ── Full-JSX: Top Referrers leaderboard (mirror of renderLeaderboard) ────────
// React-state owns the collapse toggle, the period selector, and the hidden-
// referrer list. Period changes call app.getReferralLeaderboardData(period)
// (DOM-free — never the legacy by-id renderLeaderboard); hide/reset call the
// DOM-free app.toggleHideReferrerData / app.resetHiddenReferrersData. We do NOT
// reuse id="referral-leaderboard-container" here on purpose, so a stray legacy
// by-id fill can never clobber this React-owned subtree.
function LeaderboardSection({ leaderboard }) {
    const lb = leaderboard || {};
    const PERIOD_LABEL = { all: 'All Time', year: 'This Year', month: 'This Month' };
    const [collapsed, setCollapsed] = useState(false);
    const [period, setPeriod] = useState(lb.period || 'all');
    const [rows, setRows] = useState(lb.rows || []);
    const [hiddenIds, setHiddenIds] = useState((lb.hiddenIds || []).map(String));

    const onPeriod = async (label) => {
        const map = { 'All Time': 'all', 'This Year': 'year', 'This Month': 'month' };
        const p = map[label] || 'all';
        setPeriod(p);
        try {
            const next = await call('getReferralLeaderboardData', p);
            if (Array.isArray(next)) setRows(next);
        } catch (_) { /* keep current rows on error */ }
    };
    const onHide = async (id) => {
        try {
            const next = await call('toggleHideReferrerData', id);
            if (Array.isArray(next)) setHiddenIds(next.map(String));
        } catch (_) { /* noop */ }
    };
    const onReset = async () => {
        try {
            const next = await call('resetHiddenReferrersData');
            if (Array.isArray(next)) setHiddenIds(next.map(String));
        } catch (_) { /* noop */ }
    };

    const visible = rows.filter((r) => !hiddenIds.includes(String(r.id)));

    return (
        <div className="ref-v2-leaderboard-section">
            <div className={`section-header${collapsed ? ' collapsed' : ''}`} onClick={() => setCollapsed((c) => !c)}>
                <h3><i className="fas fa-trophy"></i> Top Referrers Leaderboard</h3>
                <i className="fas fa-chevron-up toggle-icon"></i>
            </div>
            <div className={`collapsible-content${collapsed ? ' collapsed' : ''}`}>
                <div className="leaderboard-controls-v2">
                    <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
                        <select className="form-control" style={{ width: '150px' }} value={PERIOD_LABEL[period] || 'All Time'} onChange={(e) => onPeriod(e.target.value)}>
                            <option>All Time</option>
                            <option>This Year</option>
                            <option>This Month</option>
                        </select>
                        <button className="btn secondary btn-sm" onClick={onReset}>Reset Hidden</button>
                    </div>
                    <div className="text-muted" style={{ fontSize: '12px' }}>Showing top contributors</div>
                </div>
                <table className="leaderboard-table-v2">
                    <thead>
                        <tr>
                            <th scope="col">Rank</th>
                            <th scope="col">Referrer Name</th>
                            <th scope="col">Total Referrals</th>
                            <th scope="col">Converted</th>
                            <th scope="col">Latest Activity</th>
                            <th scope="col" className="text-right">Action</th>
                        </tr>
                    </thead>
                    <tbody>
                        {visible.length === 0 ? (
                            <tr><td colSpan="6"><EmptyState icon="fa-trophy" title="No referrer data found" description="Referrers will appear here once referrals are recorded." /></td></tr>
                        ) : visible.map((item, idx) => (
                            <tr className={`rank-${idx + 1}`} key={`${item.type}:${item.id}`}>
                                <td data-label="Rank" className="rank-cell">{idx + 1}</td>
                                <td data-label="Referrer" className="name-cell" onClick={() => call('showReferralTree', item.id, item.type || 'prospect')}>
                                    {item.name}
                                    {item.type === 'customer' ? <span className="badge" style={{ background: '#dcfce7', color: '#166534' }}>C</span> : null}
                                    {item.type === 'user' ? <span className="badge" style={{ background: '#dbeafe', color: '#1e40af' }}>Agent</span> : null}
                                </td>
                                <td data-label="Referrals">{item.count}</td>
                                <td data-label="Converted"><span style={{ color: '#10b981', fontWeight: 600 }}>{item.converted}</span></td>
                                <td data-label="Latest">{item.latestLabel}</td>
                                <td className="text-right">
                                    <button className="btn-icon" onClick={(e) => { e.stopPropagation(); onHide(item.id); }} title="Hide from leaderboard">
                                        <i className="far fa-eye-slash"></i>
                                    </button>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
}

// ── Full-JSX view (the third render path) ───────────────────────────────────
// Header + summary + leaderboard are real JSX from props.data; the D3 tree is
// left as the stable-id container the chunk still fills by id.
function ReferralsFullJsx({ data, onReady }) {
    // Signal onReady AFTER this commit so the chunk's mount handshake resolves
    // and it injects the style block + renders the D3 tree into the now-present
    // #referral-tree-svg container. Same useEffect-after-commit handshake the
    // scaffold path uses — without it the chunk would stall on its 4s guard.
    useEffect(() => {
        if (typeof onReady === 'function') {
            try { onReady(); } catch (_) { /* noop */ }
        }
    }, [onReady]);
    return (
        <div className="referrals-view-v2">
            <RefHeader />
            <div className="ref-v2-content">
                <SummarySection summary={data.summary} />
                <LeaderboardSection leaderboard={data.leaderboard} />
                <RefTreeSection />
            </div>
        </div>
    );
}

export function ReferralsView({ onReady, data }) {
    try { window.__REACT_REFERRALS_STATE = 'ready'; } catch (_) { /* noop */ }

    // THIRD render path (default-OFF): when the chunk supplies a serializable
    // `data` payload, render the surrounding parts as real JSX (the D3 tree is
    // still a by-id container the chunk fills). The scaffold branch below is
    // UNCHANGED and runs whenever `data` is absent.
    if (data) {
        return <ReferralsFullJsx data={data} onReady={onReady} />;
    }

    useEffect(() => {
        if (typeof onReady === 'function') {
            try { onReady(); } catch (_) { /* noop */ }
        }
    }, [onReady]);

    return (
        <div className="referrals-view-v2">
            <div className="ref-v2-header">
                <div>
                    <h1>Referral Relationship Management</h1>
                    <div className="ref-v2-subtitle">Visualize connections and track top referrers</div>
                </div>
                <div className="ref-v2-actions">
                    <div className="search-box-v2">
                        <i className="fas fa-search"></i>
                        <input type="text" id="tree-search-input" placeholder="Search person to view tree..." autoComplete="off"
                            onInput={(e) => { const v = e.target.value; call('debounceCall', 'tree-search', () => call('searchTreePerson', v), 260); }} />
                        <div id="tree-search-results" className="search-results-v2"></div>
                    </div>
                    <button className="btn primary" onClick={() => call('openAddReferralModal')}><i className="fas fa-plus"></i> Add Referral</button>
                    <button className="btn secondary" onClick={() => call('refreshCurrentView')}><i className="fas fa-sync-alt"></i> Refresh</button>
                </div>
            </div>

            <div className="ref-v2-content">
                <div id="referral-summary-container"></div>

                <div className="ref-v2-leaderboard-section">
                    <div className="section-header" onClick={() => call('toggleLeaderboard')}>
                        <h3><i className="fas fa-trophy"></i> Top Referrers Leaderboard</h3>
                        <i className="fas fa-chevron-up toggle-icon"></i>
                    </div>
                    <div id="referral-leaderboard-container" className="collapsible-content"></div>
                </div>

                <div className="ref-v2-tree-section">
                    <div className="tree-header">
                        <div style={{ display: 'flex', alignItems: 'center', gap: '16px', flexWrap: 'wrap' }}>
                            <h3><i className="fas fa-network-wired"></i> Relationship Tree</h3>
                            <div className="tree-filter-chips">
                                {FILTERS.map((f) => (
                                    <button key={f.key} className={`tree-filter-chip${f.active ? ' active' : ''}`} data-filter={f.key} onClick={() => call('applyTreeFilters', f.key)}>{f.label}</button>
                                ))}
                            </div>
                        </div>
                        <div className="tree-tools">
                            {TOOLS.map((t, i) => (
                                <button key={i} className="tool-btn" id={t.id} onClick={() => call(t.fn)} title={t.title} style={t.hidden ? { display: 'none' } : undefined}>
                                    <i className={`fas ${t.icon}`}></i>
                                </button>
                            ))}
                        </div>
                    </div>
                    <div className="tree-workspace">
                        <div id="referral-tree-container" className="tree-visualization">
                            <div id="referral-tree-placeholder" className="tree-empty">
                                <i className="fas fa-search"></i>
                                <p>Search for a person above to view their referral network.</p>
                            </div>
                            <svg id="referral-tree-svg" style={{ width: '100%', height: '100%', display: 'none' }}></svg>
                        </div>
                        <div id="tree-node-sidebar" className="tree-node-sidebar" style={{ display: 'none' }}></div>
                    </div>
                </div>
            </div>
        </div>
    );
}
