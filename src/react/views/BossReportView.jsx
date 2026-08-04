// Boss Report — Super-Admin weekly summary generator (Screen 34 / boss_report).
//
// MOUNT-ONCE static form scaffold. All heavy logic stays in the chunk
// (chunks/script-boss-report.js): xlsx/csv parsing, report generation, target
// save, final save, copy. Those handlers read/write the DOM by id
// (br-run-select, br-bal-*, br-tgt-*, br-inp-*, br-lbl-*, br-output, br-text),
// so this island reproduces the EXACT same ids + inline app.* wiring and the
// chunk's getElementById calls keep working verbatim. The island is never
// re-rendered after mount, so the handlers' direct DOM mutations (label
// textContent, output display, textarea value) persist safely alongside React.
//
// Props (computed in the chunk): runs [{id,label}], bals {key:val}, tgts
// {key:val}, monthLabel, skusLabel. Inputs are uncontrolled (defaultValue) so
// the user + chunk handlers mutate freely. React auto-escapes the run labels.
import React from 'react';

const app = () => window.app || {};

const card = { background: 'white', padding: '20px', borderRadius: '12px', border: '1px solid var(--gray-200)', marginBottom: '16px' };
const dropzone = { border: '2px dashed var(--gray-300)', borderRadius: '8px', padding: '14px', textAlign: 'center', cursor: 'pointer' };
const dzIcon = (color) => ({ fontSize: '22px', color, display: 'block', marginBottom: '6px' });
const dzTitle = { fontWeight: 600, fontSize: '13px' };
const dzSub = { fontSize: '11px', color: 'var(--gray-500)' };
const dzLbl = { fontSize: '11px', color: '#059669', marginTop: '4px', minHeight: '14px' };

// Balance rows are CATALOG-DRIVEN and arrive as the `balGroups` prop (chunk →
// br_product_group). This island used to hold a 4th hardcoded copy of the group
// list, which had to be edited in lockstep with three sites in the chunk. The
// fallback below is only used if the prop is missing (a stale chunk paired with
// a fresh bundle), and matches the pre-catalog hardcoded list exactly.
const BAL_GROUPS_FALLBACK = [
    { key: 'oceanSold', label: 'Ocean sold' },
    { key: 'yangPower', label: 'Yang power sold' },
    { key: 'd3k2', label: 'D3k2 Sold' },
    { key: 'eyePlus', label: 'Eye+' },
];
const TGT_GROUPS = [
    { key: 'klKepong', label: 'KL Kepong + SG Puchong & Sunway' },
    { key: 'klCheras', label: 'KL Cheras' },
    { key: 'pgCenter', label: 'PG Center' },
    { key: 'pgMainland', label: 'PG Mainland' },
    { key: 'pgSouth', label: 'PG South' },
];

function NumRow({ idPrefix, g, value, labelWidth }) {
    return (
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '8px' }}>
            <label style={{ width: labelWidth, fontSize: '13px', color: 'var(--gray-700)' }}>{g.label}</label>
            {/* nullish-aware default: a stored 0 is a meaningful value (sold out /
                zero carryover), so `0 || ''` must NOT blank the field. Only render
                '' when there is genuinely no saved value (null/undefined). */}
            <input type="number" id={`${idPrefix}-${g.key}`} className="form-control" style={{ width: '110px' }}
                defaultValue={value == null ? '' : value} placeholder="0" min="0" />
        </div>
    );
}

function Dropzone({ inputId, lblId, icon, iconColor, title, sub, accept, onChangeName, lblText }) {
    return (
        <div style={dropzone} onClick={() => { const el = document.getElementById(inputId); if (el) el.click(); }}>
            <i className={`fas ${icon}`} style={dzIcon(iconColor)}></i>
            <div style={dzTitle}>{title}</div>
            <div style={dzSub}>{sub}</div>
            <div id={lblId} style={dzLbl}>{lblText || ''}</div>
            <input type="file" id={inputId} accept={accept} style={{ display: 'none' }}
                onChange={(e) => { const f = app()[onChangeName]; if (f) f(e.target); }} />
        </div>
    );
}

export function BossReportView({ runs = [], bals = {}, tgts = {}, monthLabel = '', skusLabel = 'Not loaded', balGroups }) {
    const balRows = (Array.isArray(balGroups) && balGroups.length) ? balGroups : BAL_GROUPS_FALLBACK;

    try {
        window.__REACT_BOSSREPORT_STATE = 'ready';
        window.__REACT_BOSSREPORT_RUNS = runs.length;
    } catch (_) { /* noop */ }

    return (
        <div style={{ padding: '24px', maxWidth: '860px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '20px' }}>
                <div>
                    <h1 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: '10px' }}>
                        <i className="fas fa-chart-bar" style={{ color: '#8b5cf6' }}></i> Boss Report
                    </h1>
                    <div style={{ color: 'var(--gray-500)', fontSize: '13px', marginTop: '4px' }}>Weekly boss summary generator • Super Admin only</div>
                </div>
            </div>

            {/* 1. Egg Run */}
            <div style={card}>
                <h3 style={{ marginTop: 0, marginBottom: '6px' }}>1. Select Egg Purchase Run</h3>
                <p style={{ color: 'var(--gray-500)', fontSize: '13px', margin: '0 0 12px' }}>Egg KL/PG/JB totals and wholesales group data are read directly from the committed run.</p>
                {runs.length === 0
                    ? <p style={{ color: '#ef4444', margin: 0 }}>No committed egg runs found.</p>
                    : (
                        <select id="br-run-select" className="form-control" style={{ maxWidth: '620px' }}>
                            <option value="">— Select a run —</option>
                            {runs.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
                        </select>
                    )}
            </div>

            {/* 2. Product Balance Files */}
            <div style={card}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '6px' }}>
                    <h3 style={{ margin: 0 }}>2. Product Balance Files</h3>
                    <button className="btn secondary" style={{ fontSize: '12px' }} onClick={() => { const f = app().brManageCatalog; if (f) f(); }}>
                        <i className="fas fa-sliders-h"></i> Manage Catalog
                    </button>
                </div>
                <p style={{ color: 'var(--gray-500)', fontSize: '13px', margin: '0 0 16px' }}>Upload both sales files each week. Product codes and product lines are managed in <strong>Manage Catalog</strong> — no code change needed to add one.</p>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: '12px', marginBottom: '20px' }}>
                    <Dropzone inputId="br-inp-sales" lblId="br-lbl-sales" icon="fa-file-excel" iconColor="#16a34a"
                        title="FORMULA Sales" sub="POS retail (.xlsx)" accept=".xlsx" onChangeName="brLoadSales" />
                    <Dropzone inputId="br-inp-track" lblId="br-lbl-track" icon="fa-file-csv" iconColor="#2563eb"
                        title="Order Tracking" sub="Online sales (.csv)" accept=".csv" onChangeName="brLoadTracking" />
                    <Dropzone inputId="br-inp-skus" lblId="br-lbl-skus" icon="fa-table" iconColor="#f59e0b"
                        title="SKUs Mapping" sub="Bulk import (.xlsx)" accept=".xlsx" onChangeName="brLoadSkus" lblText={skusLabel} />
                </div>
                {/* Filled by the chunk after each generate: codes sold with no catalog row. */}
                <div id="br-unmapped" style={{ display: 'none', marginBottom: '16px' }}></div>
                <div style={{ fontWeight: 600, fontSize: '13px', marginBottom: '10px' }}>Last week's balances</div>
                {/* Stable host id — the chunk rewrites these rows in place when the
                    catalog changes, preserving typed values. Safe because this island
                    is mount-once and never re-rendered. */}
                <div id="br-bal-rows">
                    {balRows.map((g) => <NumRow key={g.key} idPrefix="br-bal" g={g} value={bals[g.key]} labelWidth="160px" />)}
                </div>
            </div>

            {/* 3. Monthly Targets */}
            <div style={{ ...card, marginBottom: '20px' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '6px' }}>
                    <h3 style={{ margin: 0 }}>3. Monthly Targets — {monthLabel}</h3>
                    <button className="btn secondary" style={{ fontSize: '12px' }} onClick={() => { const f = app().brSaveTargets; if (f) f(); }}>
                        <i className="fas fa-save"></i> Save
                    </button>
                </div>
                <p style={{ color: 'var(--gray-500)', fontSize: '13px', margin: '0 0 14px' }}>Set once on the 1st of each month. Carton targets per wholesale group.</p>
                {TGT_GROUPS.map((g) => <NumRow key={g.key} idPrefix="br-tgt" g={g} value={tgts[g.key]} labelWidth="260px" />)}
            </div>

            <button className="btn primary" style={{ width: '100%', padding: '14px', fontSize: '15px', marginBottom: '20px' }}
                onClick={() => { const f = app().brGenerate; if (f) f(); }}>
                <i className="fas fa-magic"></i> Generate Boss Report
            </button>

            {/* Output */}
            <div id="br-output" style={{ display: 'none', background: 'white', padding: '20px', borderRadius: '12px', border: '1px solid var(--gray-200)' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '6px' }}>
                    <h3 style={{ margin: 0 }}>Report</h3>
                    <div style={{ display: 'flex', gap: '8px' }}>
                        <button className="btn secondary" onClick={() => { const f = app().brCopy; if (f) f(); }}><i className="fas fa-copy"></i> Copy</button>
                        <button className="btn primary" onClick={() => { const f = app().brSaveFinal; if (f) f(); }}><i className="fas fa-save"></i> Save Final</button>
                    </div>
                </div>
                <p style={{ color: 'var(--gray-500)', fontSize: '12px', margin: '0 0 10px' }}>Edit any values below, then click <strong>Save Final</strong>. Next week's balance fields will pre-fill from what you save here.</p>
                <textarea id="br-text" className="form-control" style={{ width: '100%', minHeight: '520px', fontFamily: 'monospace', fontSize: '13px' }}></textarea>
            </div>
        </div>
    );
}
