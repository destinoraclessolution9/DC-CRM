// Egg Purchasing — scaffold-shell island (view id 'egg_purchasing', Super-Admin).
//
// React owns ONLY the static shell (header + Refresh + 4-tab bar + empty
// #egg-tab-content). ALL logic stays in the chunk (chunks/script-egg.js):
// admin gate + eggLoadConfig run before mount; the island useEffect calls
// onReady → chunk eggSwitchTab(tab), which fills #egg-tab-content via the
// eggRender*Tab fns (incl. the 3-phase Run wizard) + applies active-tab styling.
// File I/O, CSV/XLSX parse, reconciliation, Sheets webhook all stay in the chunk.
import React, { useEffect } from 'react';

const app = () => window.app || {};
const call = (name, ...args) => { const f = app()[name]; if (typeof f === 'function') f(...args); };

const baseBtn = { padding: '12px 20px', background: 'none', border: 'none', fontWeight: 600, cursor: 'pointer' };

export function EggPurchasingView({ tabs = [], activeTab = 'run', onReady }) {
    try { window.__REACT_EGG_STATE = 'ready'; } catch (_) { /* noop */ }

    useEffect(() => {
        if (typeof onReady === 'function') {
            try { onReady(); } catch (e) { try { console.warn('[egg] onReady failed:', e && e.message); } catch (_) {} }
        }
    }, [onReady]);

    return (
        <div className="egg-purchasing-view" style={{ padding: '24px' }}>
            <div className="egg-header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '20px' }}>
                <div>
                    <h1 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: '10px' }}>
                        <i className="fas fa-egg" style={{ color: '#f59e0b' }}></i> Egg Purchasing
                    </h1>
                    <div style={{ color: 'var(--gray-500)', fontSize: '13px', marginTop: '4px' }}>Weekly farm order generation. Super Admin only.</div>
                </div>
                <button className="btn secondary" onClick={() => call('eggRefresh')}><i className="fas fa-sync-alt"></i> Refresh</button>
            </div>

            <div className="egg-tabs" style={{ display: 'flex', gap: '4px', borderBottom: '2px solid var(--gray-200)', marginBottom: '20px' }}>
                {tabs.map((t) => {
                    const isActive = t.key === activeTab;
                    return (
                        <button key={t.key} className={`egg-tab-btn${isActive ? ' active' : ''}`} data-tab={t.key} onClick={() => call('eggSwitchTab', t.key)}
                            style={{ ...baseBtn, borderBottom: `3px solid ${isActive ? '#f59e0b' : 'transparent'}`, color: isActive ? '#f59e0b' : 'var(--gray-600)' }}>
                            <i className={`fas ${t.icon}`}></i> {t.label}
                        </button>
                    );
                })}
            </div>

            <div id="egg-tab-content"></div>
        </div>
    );
}
