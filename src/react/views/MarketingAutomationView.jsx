// Marketing Automation — scaffold-shell island (view id 'marketing_automation').
//
// React owns the shell (header + role-gated actions + role-gated tab bar + empty
// #marketing-tab-content). ALL logic stays in the chunk (chunks/script-marketing.js):
// the island signals onReady from useEffect (post-commit), the chunk awaits it
// (pipeline lesson — a bare rAF fires too early), then its STEP-2
// renderMarketingTabContent() fills #marketing-tab-content by id exactly as legacy.
// Tab switches + every modal/mutation call window.app.*.
import React, { useEffect } from 'react';

const app = () => window.app || {};
const call = (name, ...args) => { const f = app()[name]; if (typeof f === 'function') f(...args); };

const BASE_TABS = [
    { key: 'forms', icon: 'fa-clipboard-list', label: 'Forms 表格' },
    { key: 'templates', icon: 'fa-layer-group', label: 'Message Templates' },
    { key: 'campaigns', icon: 'fa-bullhorn', label: 'Active Campaigns' },
    { key: 'automation', icon: 'fa-cogs', label: 'Automation' },
    { key: 'analytics', icon: 'fa-chart-line', label: 'Campaign Analytics' },
];
// Marketing-manager/admin-only extra tabs. NOTE: legacy renders "Monthly
// Promotions" TWICE (a pre-existing copy-paste dup) — reproduced for parity.
const EXTRA_TABS = [
    { key: 'products', icon: 'fa-box', label: 'Products & Services' },
    { key: 'promotions', icon: 'fa-calendar-alt', label: 'Monthly Promotions' },
    { key: 'promotions', icon: 'fa-calendar-alt', label: 'Monthly Promotions' },
];

export function MarketingAutomationView({ canExport = false, canTabs = false, activeTab = 'forms', onReady }) {
    try { window.__REACT_MKTAUTO_STATE = 'ready'; } catch (_) { /* noop */ }

    useEffect(() => {
        if (typeof onReady === 'function') {
            try { onReady(); } catch (_) { /* noop */ }
        }
    }, [onReady]);

    const tabs = canTabs ? [...BASE_TABS, ...EXTRA_TABS] : BASE_TABS;

    return (
        <div className="marketing-view">
            <div className="marketing-header">
                <div>
                    <h1>Marketing Automation</h1>
                    <p>WhatsApp Focus - Create templates and manage campaigns</p>
                </div>
                <div className="marketing-header-actions">
                    <button className="btn primary" onClick={() => call('openCreateTemplateModal')}><i className="fas fa-plus"></i> Create Template</button>
                    <button className="btn secondary" onClick={() => call('openCreateCampaignModal')}><i className="fas fa-bullhorn"></i> New Campaign</button>
                    <button className="btn secondary" onClick={() => call('switchMarketingTab', 'analytics')}><i className="fas fa-chart-bar"></i> Analytics</button>
                    {canExport ? <button className="btn secondary" onClick={() => call('exportKPIDashboard')}><i className="fas fa-download"></i> Export Data</button> : null}
                </div>
            </div>

            <div className="marketing-tabs">
                {tabs.map((t, i) => (
                    <button key={i} className={`marketing-tab ${activeTab === t.key ? 'active' : ''}`} onClick={() => call('switchMarketingTab', t.key)}>
                        <i className={`fas ${t.icon}`}></i> {t.label}
                    </button>
                ))}
            </div>

            <div id="marketing-tab-content" className="marketing-tab-content">
                <div className="marketing-tab-loading" style={{ padding: '48px', textAlign: 'center', color: '#6B7280' }}>
                    <i className="fas fa-spinner fa-spin" style={{ fontSize: '24px', marginBottom: '12px' }}></i>
                    <div>Loading…</div>
                </div>
            </div>
        </div>
    );
}
