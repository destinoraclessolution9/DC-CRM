// Advanced Search — overlay-drawer scaffold-shell island (view 'search').
//
// React owns ONLY the static drawer shell (overlay + panel chrome, presets,
// entity <select>, date inputs, condition-builder chrome, action buttons) and
// the stable-id containers the chunk fills:
//   #filter-sections        ← updateFilterSections()
//   #extra-filter-sections  ← updateFilterSections()
//   #condition-groups       ← renderConditionGroups()
//   #saved-searches-list    ← renderSavedSearches()
//   #search-history-list / #search-results / #search-pagination ← chunk
// ALL logic stays in chunks/script-search.js (the 9-entity filter renderers,
// condition builder, save/execute/export, pagination). The chunk mounts this
// into a host div, awaits onReady (useEffect), then runs its by-id fills.
// Every button keeps the legacy app.* behaviour. Inputs/selects are uncontrolled
// (defaultValue) so the chunk reads/writes them by id exactly as before.
import React, { useEffect } from 'react';

const app = () => window.app || {};
// Several search handlers (executeSearch, loadPreset, openSaveSearchModal,
// updateFilterSections, exportResults…) are async. The legacy chunk markup wrapped
// each in `(async()=>{try{await app.X();}catch(e){console.error(e);}})()`; calling
// f(...) here discards the returned promise, so a rejection (Supabase offline /
// RLS deny) becomes an unhandled rejection. Catch it to mirror the legacy behaviour.
const callA = (name, ...args) => {
    const f = app()[name];
    if (typeof f !== 'function') return;
    const r = f(...args);
    if (r && typeof r.then === 'function') {
        r.catch((e) => console.error('[search] handler ' + name + ' failed:', e));
    }
};

export function SearchPanelView({ onReady }) {
    try { window.__REACT_SEARCH_STATE = 'ready'; } catch (_) { /* noop */ }

    useEffect(() => {
        if (typeof onReady === 'function') {
            try { onReady(); } catch (_) { /* noop */ }
        }
    }, [onReady]);

    const summaryStyle = { cursor: 'pointer', fontWeight: 600, color: '#8B0000', padding: '10px 0', listStyle: 'none', display: 'flex', alignItems: 'center', gap: '6px', userSelect: 'none' };

    return (
        <>
            <div className="search-panel-overlay" id="search-panel-overlay" onClick={() => callA('hideSearchPanel')}></div>
            <div className="search-panel" id="search-panel">
                <div className="search-panel-header">
                    <h2>Search</h2>
                    <button className="close-btn" onClick={() => callA('hideSearchPanel')}>&times;</button>
                </div>

                <div className="filter-sections" id="filter-sections"></div>

                <details id="search-advanced-options" style={{ marginTop: '4px' }}>
                    <summary style={summaryStyle}>
                        <i className="fas fa-sliders-h"></i> Advanced Options
                    </summary>

                    <div className="search-presets">
                        <h3>Quick Presets</h3>
                        <div className="preset-buttons">
                            <button className="preset-btn" onClick={() => callA('loadPreset', 'agent-monthly')}>Agent Monthly Report</button>
                            <button className="preset-btn" onClick={() => callA('loadPreset', 'high-score')}>High Score Prospects</button>
                            <button className="preset-btn" onClick={() => callA('loadPreset', 'recent-activities')}>Recent Activities</button>
                            <button className="preset-btn" onClick={() => callA('loadPreset', 'cai-ku-not-purchased')}>CAI KU Painting Not Purchased</button>
                        </div>
                    </div>

                    <div className="search-entity-selector">
                        <label>Search in:</label>
                        <select id="search-entity" defaultValue="prospects" onChange={() => callA('updateFilterSections')}>
                            <option value="agents">Agents</option>
                            <option value="prospects">Prospects</option>
                            <option value="customers">Customers</option>
                            <option value="activities">Activities</option>
                            <option value="transactions">Transactions</option>
                            <option value="events">Events</option>
                            <option value="products">Products</option>
                            <option value="bujishu">Bujishu</option>
                            <option value="formula">Formula</option>
                        </select>
                    </div>

                    <div className="date-range-filter">
                        <h3>Date Range</h3>
                        <div className="date-range-group">
                            <input type="date" id="search-date-from" className="form-control" placeholder="From" />
                            <span>to</span>
                            <input type="date" id="search-date-to" className="form-control" placeholder="To" />
                        </div>
                    </div>

                    <div id="extra-filter-sections"></div>

                    <div className="condition-builder" id="condition-builder">
                        <h3>Advanced Conditions</h3>
                        <div id="condition-groups"></div>
                        <button className="btn secondary btn-sm" onClick={() => callA('addConditionGroup')}>
                            <i className="fas fa-plus"></i> Add Condition Group
                        </button>
                        <div className="condition-logic-toggle">
                            <label>Group Logic:</label>
                            <select id="group-logic" onChange={(e) => callA('updateGroupLogic', 0, e.target.value)} defaultValue="AND">
                                <option value="AND">AND</option>
                                <option value="OR">OR</option>
                            </select>
                        </div>
                    </div>

                    <div style={{ display: 'flex', gap: '8px', margin: '8px 0', flexWrap: 'wrap' }}>
                        <button className="btn secondary" onClick={() => callA('openSaveSearchModal')}>
                            <i className="fas fa-save"></i> Save Search
                        </button>
                        <button className="btn secondary" onClick={() => callA('exportResults', 'csv')}>
                            <i className="fas fa-download"></i> Export
                        </button>
                    </div>

                    <div className="saved-searches">
                        <h3>Saved Searches</h3>
                        <div id="saved-searches-list"></div>
                    </div>

                    <div className="search-history">
                        <h3>Recent Searches</h3>
                        <div id="search-history-list"></div>
                    </div>
                </details>

                <div className="search-actions">
                    <button className="btn primary" onClick={() => callA('executeSearch')}>
                        <i className="fas fa-search"></i> Apply Filters
                    </button>
                    <button className="btn secondary" onClick={() => callA('clearAllFilters')}>
                        <i className="fas fa-times"></i> Clear All
                    </button>
                </div>

                <div className="search-results" id="search-results"></div>

                <div className="pagination" id="search-pagination"></div>
            </div>
        </>
    );
}
