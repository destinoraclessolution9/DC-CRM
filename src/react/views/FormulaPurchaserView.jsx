// Formula Purchaser — scaffold-shell island (view id 'formula_purchaser', Super-Admin).
//
// React owns ONLY the static shell (header + Import dropdown + Refresh + 6-tab
// bar + empty #fp-tab-content). ALL logic stays in the chunk
// (chunks/script-formula.js): admin gate runs before mount; the island useEffect
// calls onReady → chunk fpLoadData() then fpSwitchTab(tab), which fills
// #fp-tab-content via fpRender* + active-tab styling. Imports (stock/POS/delisted),
// PO generation, transfers, reconciliation all stay in the chunk.
import React, { useEffect } from 'react';

const app = () => window.app || {};
const call = (name, ...args) => { const f = app()[name]; if (typeof f === 'function') f(...args); };

const hov = (on) => (e) => { e.currentTarget.style.background = on ? '#f3f4f6' : ''; };
const menuItem = { padding: '8px 14px', cursor: 'pointer' };

export function FormulaPurchaserView({ tabs = [], activeTab = 'dashboard', onReady }) {
    try { window.__REACT_FP_STATE = 'ready'; } catch (_) { /* noop */ }

    useEffect(() => {
        if (typeof onReady === 'function') {
            try { onReady(); } catch (e) { try { console.warn('[fp] onReady failed:', e && e.message); } catch (_) {} }
        }
    }, [onReady]);

    return (
        <div className="fp-view" style={{ padding: '24px' }}>
            <div className="fp-header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '20px', flexWrap: 'wrap', gap: '12px' }}>
                <div>
                    <h1 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: '10px' }}>
                        <i className="fas fa-flask" style={{ color: '#0ea5e9' }}></i> Formula Purchaser
                    </h1>
                    <div style={{ color: 'var(--gray-500)', fontSize: '13px', marginTop: '4px' }}>Stock replenishment, multi-outlet distribution &amp; PO generation. Super Admin only.</div>
                </div>
                <div style={{ display: 'flex', gap: '8px' }}>
                    <div style={{ position: 'relative' }}>
                        <button className="btn secondary" onClick={() => call('fpToggleImportMenu')}><i className="fas fa-file-import"></i> Import ▾</button>
                        <div id="fp-import-menu" style={{ display: 'none', position: 'absolute', right: 0, top: '100%', marginTop: '4px', background: '#fff', border: '1px solid var(--gray-200)', borderRadius: '8px', boxShadow: '0 4px 12px rgba(0,0,0,0.1)', minWidth: '220px', zIndex: 100 }}>
                            <div style={{ ...menuItem, borderBottom: '1px solid var(--gray-100)' }} onMouseOver={hov(true)} onMouseOut={hov(false)} onClick={() => call('fpImportStock')}>
                                <i className="fas fa-boxes" style={{ width: '18px', color: '#0ea5e9' }}></i> Stock Snapshot
                            </div>
                            <div style={{ ...menuItem, borderBottom: '1px solid var(--gray-100)' }} onMouseOver={hov(true)} onMouseOut={hov(false)} onClick={() => call('fpImportPos')}>
                                <i className="fas fa-cash-register" style={{ width: '18px', color: '#10b981' }}></i> POS Sales History
                            </div>
                            <div style={menuItem} onMouseOver={hov(true)} onMouseOut={hov(false)} onClick={() => call('fpImportDelisted')}>
                                <i className="fas fa-ban" style={{ width: '18px', color: '#dc2626' }}></i> Delisted SKUs
                            </div>
                        </div>
                    </div>
                    <button className="btn secondary" onClick={() => call('fpRefresh')}><i className="fas fa-sync-alt"></i> Refresh</button>
                </div>
            </div>

            <div className="fp-tabs" style={{ display: 'flex', gap: '4px', borderBottom: '2px solid var(--gray-200)', marginBottom: '20px', flexWrap: 'wrap' }}>
                {tabs.map((t) => {
                    const isActive = t.key === activeTab;
                    return (
                        <button key={t.key} className={`fp-tab-btn${isActive ? ' active' : ''}`} data-tab={t.key} onClick={() => call('fpSwitchTab', t.key)}
                            style={{ padding: '12px 20px', background: 'none', border: 'none', borderBottom: `3px solid ${isActive ? '#0ea5e9' : 'transparent'}`, fontWeight: 600, cursor: 'pointer', color: isActive ? '#0ea5e9' : 'var(--gray-600)' }}>
                            <i className={`fas ${t.icon}`}></i> {t.label}
                        </button>
                    );
                })}
            </div>

            <div id="fp-tab-content"><div style={{ padding: '40px', textAlign: 'center', color: 'var(--gray-500)' }}><i className="fas fa-spinner fa-spin"></i> Loading...</div></div>
        </div>
    );
}
