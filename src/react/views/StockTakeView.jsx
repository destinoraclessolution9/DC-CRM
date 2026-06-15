// Stock Take — scaffold-shell island (view id 'stock_take').
//
// React owns ONLY the static shell (header + #st-session-chip + tab bar +
// empty #st-tab-body). ALL logic stays in the chunk (chunks/script-stock-take.js):
// admin gate + session bootstrap run before mount; after mount the island's
// useEffect calls onReady → the chunk's stSwitchTab(tab), which fills
// #st-session-chip + #st-tab-body via the _stRender* fns and applies active-tab
// styling to .st-tab-btn. So all 9 tabs, QR scanning, reconciliation, realtime
// sync and counts are byte-identical to legacy. Tab buttons call window.app.stSwitchTab.
import React, { useEffect } from 'react';

const app = () => window.app || {};
const call = (name, ...args) => { const f = app()[name]; if (typeof f === 'function') f(...args); };

const tabBtnStyle = { padding: '10px 16px', border: 'none', background: 'none', cursor: 'pointer', fontWeight: 600, whiteSpace: 'nowrap', borderBottom: '3px solid transparent', color: 'var(--gray-600)' };

export function StockTakeView({ tabs = [], onReady }) {
    try { window.__REACT_ST_STATE = 'ready'; } catch (_) { /* noop */ }

    useEffect(() => {
        if (typeof onReady === 'function') {
            try { onReady(); } catch (e) { try { console.warn('[stock-take] onReady failed:', e && e.message); } catch (_) {} }
        }
    }, [onReady]);

    return (
        <div className="stock-take-view" style={{ padding: '24px', maxWidth: '1400px', margin: '0 auto' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px', flexWrap: 'wrap', gap: '12px' }}>
                <div>
                    <h1 style={{ margin: 0, fontSize: '24px' }}><i className="fas fa-boxes"></i> Stock Take</h1>
                    <div style={{ color: 'var(--gray-600)', fontSize: '13px', marginTop: '4px' }}>Shelf-by-shelf physical count reconciliation</div>
                </div>
                <div id="st-session-chip"></div>
            </div>
            <div className="st-tabs" style={{ display: 'flex', gap: '4px', borderBottom: '2px solid var(--gray-200)', marginBottom: '16px', overflowX: 'auto' }}>
                {tabs.map((t) => (
                    <button key={t.key} className="st-tab-btn" data-tab={t.key} onClick={() => call('stSwitchTab', t.key)} style={tabBtnStyle}>
                        {t.label}
                    </button>
                ))}
            </div>
            <div id="st-tab-body"></div>
        </div>
    );
}
