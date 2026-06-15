// Potential Pipeline — scaffold-shell island (view id 'pipeline').
//
// Pure static skeleton shell. React owns ONLY the outer structure + the stable-id
// containers (#pl-header-controls, #pl-action-plan, #pl-focus-section,
// #pl-table2-count, #pipeline-list-body). ALL data + fills + drag-drop + the v6
// scoring engine stay in the chunk (chunks/script-pipeline.js): showPipelineView
// continues after mount (post-await) and fills these containers by id exactly as
// the legacy skeleton path — byte-identical behavior. No props/onReady needed;
// the chunk rAF-waits for React to commit before filling.
import React from 'react';

const cardBox = { background: 'white', borderRadius: '12px', padding: '20px', boxShadow: '0 1px 3px rgba(0,0,0,0.1)', marginBottom: '32px' };
const skel = (extra) => ({ ...{ borderRadius: '8px' }, ...extra });
const SKEL_W = [72, 88, 48, 44, 82, 58, 40];

function SkelRows({ n, cols }) {
    return (
        <>
            {Array.from({ length: n }, (_, r) => (
                <tr key={r}>
                    {Array.from({ length: cols }, (_, i) => (
                        <td key={i} style={{ padding: '10px 12px' }}>
                            <div className="skeleton" style={{ height: '14px', borderRadius: '4px', width: `${SKEL_W[i % 7]}%` }} />
                        </td>
                    ))}
                </tr>
            ))}
        </>
    );
}

const TH = ['Prospect Name', 'Target to Sign (Product/Service)', 'Amount (RM)', 'Probability', 'Action Needed to Close Deal', 'Quick Action'];

export function PipelineView() {
    try { window.__REACT_PIPELINE_STATE = 'ready'; } catch (_) { /* noop */ }

    return (
        <div className="pipeline-dual-view">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
                <div>
                    <h1 style={{ fontSize: '24px', fontWeight: 700, margin: 0 }}>Potential Pipeline Management</h1>
                    <p style={{ color: '#6B7280', marginTop: '4px' }}>Track signing probability across 6 solution categories</p>
                </div>
                <div id="pl-header-controls" style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
                    <div className="skeleton" style={{ width: '160px', height: '38px', borderRadius: '6px' }} />
                    <div className="skeleton" style={{ width: '140px', height: '38px', borderRadius: '6px' }} />
                    <button className="btn secondary" disabled><i className="fas fa-sync-alt"></i> Refresh</button>
                    <button className="btn primary" disabled><i className="fas fa-info-circle"></i> Rules</button>
                </div>
            </div>

            <div id="pl-action-plan">
                <div style={cardBox}>
                    <div className="skeleton" style={skel({ height: '28px', marginBottom: '12px' })} />
                    <div className="skeleton" style={skel({ height: '60px', marginBottom: '12px' })} />
                    <div className="skeleton" style={skel({ height: '120px', marginBottom: '12px' })} />
                </div>
            </div>

            <div id="pl-focus-section">
                <div style={cardBox}>
                    <div className="skeleton" style={skel({ height: '28px', marginBottom: '12px' })} />
                    <div style={{ overflowX: 'auto' }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: '1080px' }}>
                            <tbody><SkelRows n={4} cols={7} /></tbody>
                        </table>
                    </div>
                </div>
            </div>

            <div style={{ background: 'white', borderRadius: '12px', boxShadow: '0 1px 3px rgba(0,0,0,0.1)', padding: '20px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                        <h2 style={{ fontSize: '18px', fontWeight: 600, margin: 0 }}>📊 Auto-Generated Pipeline</h2>
                        <span id="pl-table2-count"><div className="skeleton" style={{ display: 'inline-block', width: '90px', height: '22px', borderRadius: '20px', verticalAlign: 'middle' }} /></span>
                    </div>
                    <p style={{ fontSize: '11px', color: '#9CA3AF', margin: 0 }}>Sorted: highest probability → most recent activity → name</p>
                </div>
                <div style={{ overflowX: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: '1080px' }}>
                        <thead>
                            <tr style={{ background: '#F9FAFB', borderBottom: '2px solid #E5E7EB' }}>
                                {TH.map((h) => <th key={h} scope="col" style={{ padding: '10px 12px', textAlign: 'left', fontSize: '12px', color: '#6B7280' }}>{h}</th>)}
                            </tr>
                        </thead>
                        <tbody id="pipeline-list-body"><SkelRows n={6} cols={6} /></tbody>
                    </table>
                </div>
            </div>
        </div>
    );
}
