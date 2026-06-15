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
import React, { useEffect } from 'react';

const app = () => window.app || {};
const call = (name, ...args) => { const f = app()[name]; if (typeof f === 'function') f(...args); };

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

export function ReferralsView({ onReady }) {
    try { window.__REACT_REFERRALS_STATE = 'ready'; } catch (_) { /* noop */ }

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
