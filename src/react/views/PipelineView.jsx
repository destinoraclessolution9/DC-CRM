// Potential Pipeline — island (view id 'pipeline').
//
// THREE render paths:
//  1. Legacy (?react=0)              → chunk renders plain HTML, no React.
//  2. Scaffold-shell (default)       → React owns ONLY the outer structure +
//     stable-id containers (#pl-header-controls, #pl-action-plan,
//     #pl-focus-section, #pl-table2-count, #pipeline-list-body). The chunk
//     (showPipelineView) fills them by id in onReady — byte-identical legacy
//     behavior. This is the UNCHANGED default when props.data is absent.
//  3. Full real-JSX (opt-in, default OFF — ?react_pipeline_jsx=1 /
//     localStorage crm_react_pipeline_jsx='1') → the chunk passes a plain
//     payload as props.data and React renders EVERY section as real JSX with
//     auto-escaping + React-state tab/month switching. The JSX owns the DOM;
//     no by-id fills. Interactions call the SAME window.app.* handlers.
import React, { useEffect, useState } from 'react';

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

// ── window.app.* bridge (same idiom as ReportsView) ─────────────────────────
const app = () => window.app || {};
const call = (name, ...args) => { const f = app()[name]; if (typeof f === 'function') return f(...args); return undefined; };
const fmtRM = (n) => Number(n).toLocaleString();
const th = (label, extra) => <th scope="col" style={{ padding: '10px 12px', textAlign: 'left', fontSize: '12px', color: '#6B7280', ...(extra || {}) }}>{label}</th>;

// ── Probability badge (clickable → score breakdown) ─────────────────────────
function ProbBadge({ prob, prospectId }) {
    const clickable = prospectId != null;
    return (
        <span
            onClick={clickable ? (e) => { e.stopPropagation(); call('showPipelineExplain', prospectId); } : undefined}
            style={clickable ? { cursor: 'pointer' } : undefined}
            title={clickable ? 'Click to see score breakdown' : undefined}
        >
            <span style={{ background: prob.color, color: 'white', padding: '2px 8px', borderRadius: '12px', fontSize: '11px', fontWeight: 600 }}>{prob.label}</span>
            <strong style={{ marginLeft: '6px' }}>{prob.prob}%</strong>
        </span>
    );
}

const CUSTOM_BADGE = '✎'; // ✎

// ── Focus-list row (current month) — mirrors renderFocusRow ─────────────────
function FocusRow({ row }) {
    const editableStyle = { cursor: 'pointer', borderBottom: '1px dashed #D1D5DB' };
    const dragProps = row.readOnly ? {} : {
        draggable: true,
        onDragStart: (e) => call('handleDragStart', e, row.recId),
        onDragOver: (e) => call('handleDragOver', e),
        onDrop: (e) => call('handleDrop', e, row.recId),
    };
    return (
        <tr data-list-id={row.recId} {...dragProps} style={{ borderBottom: '1px solid #F3F4F6' }}>
            <td style={{ padding: '14px 12px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: row.readOnly ? undefined : 'grab' }}>
                    {row.readOnly ? null : <span style={{ color: '#9CA3AF' }}>☰</span>}
                    <span style={{ fontWeight: 700, color: '#6B7280' }}>{row.idx + 1}</span>
                </div>
            </td>
            <td style={{ padding: '14px 12px' }}>
                <div style={{ fontWeight: 600, color: '#2563EB', cursor: 'pointer', textDecoration: 'underline' }} onClick={(e) => { e.stopPropagation(); call('showProspectMenu', row.prospectId); }} title="Open prospect profile">{row.name}</div>
                <div style={{ fontSize: '11px', color: '#9CA3AF' }}>Last activity: {row.lastActivity}</div>
            </td>
            <td style={{ padding: '14px 12px' }}>
                {row.product.editable ? (
                    <>
                        <select
                            defaultValue={row.product.current}
                            onClick={(e) => e.stopPropagation()}
                            onChange={(e) => { e.stopPropagation(); call('changeFocusTargetProduct', row.recId, e.target.value); }}
                            style={{ width: '100%', border: '1px solid #DBEAFE', borderRadius: '6px', padding: '6px 8px', fontSize: '12px', color: '#1E40AF', fontWeight: 500, background: 'white', cursor: 'pointer' }}
                        >
                            {row.product.options.map((o) => <option key={o} value={o}>{o}</option>)}
                        </select>
                        <input
                            type="text"
                            defaultValue={row.product.detail}
                            placeholder="Remarks / details..."
                            onClick={(e) => e.stopPropagation()}
                            onBlur={(e) => call('changeFocusTargetDetail', row.recId, e.target.value)}
                            style={{ width: '100%', border: '1px solid #E5E7EB', borderRadius: '4px', padding: '3px 6px', fontSize: '11px', color: '#6B7280', marginTop: '2px', background: '#FAFAFA' }}
                        />
                    </>
                ) : (
                    <>
                        <div style={{ fontWeight: 500, color: '#1E40AF' }}>{row.product.staticName}</div>
                        <div style={{ fontSize: '11px', color: '#9CA3AF' }}>{row.product.staticSub}</div>
                    </>
                )}
            </td>
            <td style={{ padding: '14px 12px', fontWeight: 600, color: '#059669' }}>
                <span onClick={(e) => { e.stopPropagation(); call('editFocusAmount', row.recId, row.amount || 0); }} style={editableStyle} title="Click to edit amount">
                    {row.amount == null
                        ? <><span style={{ color: '#92400E', fontWeight: 600 }}>Varies</span> <span style={{ fontSize: '10px', color: '#9CA3AF' }}>check monthly</span></>
                        : `RM ${fmtRM(row.amount)}`}
                </span>
                {row.isCustomAmount ? <span onClick={(e) => { e.stopPropagation(); call('resetFocusField', row.recId, 'custom_amount'); }} style={{ cursor: 'pointer', fontSize: '9px', color: '#F59E0B', marginLeft: '4px' }} title="Custom override (click to reset)">{CUSTOM_BADGE}</span> : null}
            </td>
            <td style={{ padding: '14px 12px' }}><ProbBadge prob={row.prob} prospectId={row.prospectId} /></td>
            <td style={{ padding: '14px 12px', fontSize: '13px', lineHeight: 1.5, maxWidth: '260px' }}>
                <span onClick={(e) => { e.stopPropagation(); call('editFocusAction', row.recId, e.currentTarget); }} style={editableStyle} title="Click to edit action">{row.action}</span>
                {row.isCustomAction ? <span onClick={(e) => { e.stopPropagation(); call('resetFocusField', row.recId, 'custom_action'); }} style={{ cursor: 'pointer', fontSize: '9px', color: '#F59E0B', marginLeft: '4px' }} title="Custom override (click to reset)">{CUSTOM_BADGE}</span> : null}
            </td>
            <td style={{ padding: '14px 12px' }}>
                <div style={{ display: 'flex', gap: '6px' }}>
                    <button className="btn-icon" onClick={(e) => { e.stopPropagation(); call('showProspectMenu', row.prospectId); }} title="View Profile"><i className="fas fa-eye"></i></button>
                    <button className="btn-icon" onClick={(e) => { e.stopPropagation(); call('showComments', row.prospectId); }} style={{ position: 'relative' }} title="Comments">
                        <i className="fas fa-comment"></i>
                        {row.noteCount > 0 ? <span style={{ position: 'absolute', top: '-4px', right: '-4px', background: '#EF4444', color: 'white', borderRadius: '50%', width: '14px', height: '14px', fontSize: '9px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{row.noteCount}</span> : null}
                    </button>
                    {row.readOnly ? null : <button className="btn-icon text-danger" onClick={(e) => { e.stopPropagation(); call('removeFromFocusList', row.recId); }} title="Remove from Priority"><i className="fas fa-trash-alt"></i></button>}
                </div>
            </td>
        </tr>
    );
}

// ── Archive focus row — mirrors renderArchiveFocusRow ───────────────────────
function ArchiveRow({ row }) {
    return (
        <tr style={{ borderBottom: '1px solid #F3F4F6', background: '#FAFAFA' }}>
            <td style={{ padding: '14px 12px' }}><span style={{ fontWeight: 700, color: '#6B7280' }}>{row.idx + 1}</span></td>
            <td style={{ padding: '14px 12px' }}><div style={{ fontWeight: 600, color: '#111827' }}>{row.name}</div></td>
            <td style={{ padding: '14px 12px' }}><div style={{ fontWeight: 500, color: '#1E40AF' }}>{row.target}</div></td>
            <td style={{ padding: '14px 12px', fontWeight: 600, color: '#059669' }}>{row.amount != null ? `RM ${fmtRM(row.amount)}` : 'N/A'}</td>
            <td style={{ padding: '14px 12px' }}><span style={{ background: row.prob.color, color: 'white', padding: '2px 8px', borderRadius: '12px', fontSize: '11px', fontWeight: 600 }}>{row.prob.label}</span><strong style={{ marginLeft: '6px' }}>{row.prob.prob}%</strong></td>
            <td style={{ padding: '14px 12px', fontSize: '13px' }}>{row.action}</td>
            <td style={{ padding: '14px 12px' }}>
                <div style={{ display: 'flex', gap: '6px' }}>
                    {row.hasProspect ? <button className="btn-icon" onClick={(e) => { e.stopPropagation(); call('showProspectMenu', row.prospectId); }} title="View Profile"><i className="fas fa-eye"></i></button> : null}
                    <button className="btn secondary btn-sm" style={{ padding: '2px 8px', fontSize: '10px' }} onClick={(e) => { e.stopPropagation(); call('reAddFromArchive', row.prospectId); }} title="Add back to current focus"><i className="fas fa-redo"></i> Re-Add</button>
                </div>
            </td>
        </tr>
    );
}

// ── Auto-generated (system) row — mirrors renderSystemRow ───────────────────
function SystemRow({ row }) {
    return (
        <tr style={{ borderBottom: '1px solid #F3F4F6' }}>
            <td style={{ padding: '14px 12px' }}>
                <div style={{ fontWeight: 600, color: '#2563EB', cursor: 'pointer', textDecoration: 'underline' }} onClick={(e) => { e.stopPropagation(); call('showProspectMenu', row.prospectId); }} title="Open prospect profile">{row.name}</div>
                <div style={{ fontSize: '11px', color: '#9CA3AF' }}>Last activity: {row.lastActivity}</div>
            </td>
            <td style={{ padding: '14px 12px' }}>
                <div style={{ fontWeight: 500, color: '#1E40AF' }}>
                    {row.target}
                    {row.referral ? <span style={{ background: '#FEF3C7', color: '#92400E', padding: '2px 5px', borderRadius: '4px', fontSize: '10px', marginLeft: '4px' }} title={`Referred by customer with recent purchase — +${row.referral.bonusPct}%`}>⭐ Customer referral +{row.referral.bonusPct}%</span> : null}
                </div>
                <div style={{ marginTop: '4px', display: 'flex', flexWrap: 'wrap', gap: '2px' }}>
                    {row.signals.map((s, i) => s.kind === 'potential'
                        ? <span key={i} style={{ background: '#EDE9FE', color: '#5B21B6', padding: '2px 5px', borderRadius: '4px', fontSize: '10px' }}>⭐ {s.label}</span>
                        : <span key={i} style={{ background: '#D1FAE5', color: '#065F46', padding: '2px 5px', borderRadius: '4px', fontSize: '10px' }}>✓ {s.label}</span>)}
                </div>
                {row.latestOppPotential ? <div style={{ fontSize: '11px', color: '#9CA3AF', marginTop: '4px' }}>{row.latestOppPotential}</div> : null}
            </td>
            <td style={{ padding: '14px 12px', fontWeight: 600, color: '#059669' }}>
                {row.amount == null
                    ? <><span style={{ color: '#92400E', fontWeight: 600 }}>Varies</span><br /><button className="btn-icon" onClick={(e) => { e.stopPropagation(); call('setAgentPackageAmount'); }} style={{ fontSize: '10px', color: '#2563EB', padding: 0, background: 'none', border: 'none', cursor: 'pointer' }}>[edit]</button></>
                    : `RM ${fmtRM(row.amount)}`}
            </td>
            <td style={{ padding: '14px 12px' }}><ProbBadge prob={row.prob} prospectId={row.prospectId} /></td>
            <td style={{ padding: '14px 12px', fontSize: '13px', lineHeight: 1.5, maxWidth: '260px' }}>{row.action}</td>
            <td style={{ padding: '14px 12px' }}>
                <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                    <button className="btn secondary btn-sm" style={{ padding: '4px 10px', fontSize: '11px' }} onClick={() => call('addToFocusList', row.prospectId)}><i className="fas fa-plus"></i> Add to Focus</button>
                    <button className="btn-icon" onClick={(e) => { e.stopPropagation(); call('showProspectMenu', row.prospectId); }} title="View"><i className="fas fa-eye"></i></button>
                    <button className="btn-icon" onClick={(e) => { e.stopPropagation(); call('showComments', row.prospectId); }} style={{ position: 'relative' }} title="Comments">
                        <i className="fas fa-comment"></i>
                        {row.noteCount > 0 ? <span style={{ position: 'absolute', top: '-4px', right: '-4px', background: '#3B82F6', color: 'white', borderRadius: '50%', width: '14px', height: '14px', fontSize: '9px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{row.noteCount}</span> : null}
                    </button>
                </div>
            </td>
        </tr>
    );
}

const FOCUS_TH = ['#', 'Prospect Name', 'Target to Sign (Product/Service)', 'Amount (RM)', 'Probability', 'Action Needed to Close Deal', 'Actions'];
const TEAM_TH = ['#', 'Prospect Name', 'Target to Sign', 'Amount (RM)', 'Probability', 'Action Needed', 'Actions'];

// ── Full real-JSX render (props.data present). Owns the DOM. ─────────────────
function PipelineFullJsx({ data, onReady }) {
    try { window.__REACT_PIPELINE_STATE = 'ready-jsx'; } catch (_) { /* noop */ }

    // Release the chunk's await gate as soon as the JSX commits — otherwise the
    // chunk only continues after the 4s safety timeout. The chunk early-returns
    // before STEP-2 on the JSX path, so this never triggers a by-id fill.
    useEffect(() => { if (typeof onReady === 'function') onReady(); }, []);

    // React-state "tab"/view switch: the active focus month. The chunk seeds the
    // initial value from data.focus.viewMonth; switching calls the app handler
    // (which persists + re-opens the view with fresh data) AND updates local
    // state so the badge/active option reflects the choice immediately.
    const [activeMonth, setActiveMonth] = useState(data.focus.viewMonth || 'current');
    const onMonthChange = (val) => { setActiveMonth(val); call('switchFocusMonth', val); };

    const ap = data.actionPlan;
    const focus = data.focus;
    const sys = data.system;

    return (
        <div className="pipeline-dual-view">
            {/* Header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
                <div>
                    <h1 style={{ fontSize: '24px', fontWeight: 700, margin: 0 }}>Potential Pipeline Management</h1>
                    <p style={{ color: '#6B7280', marginTop: '4px' }}>Track signing probability across 6 solution categories</p>
                </div>
                <div id="pl-header-controls" style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
                    <select className="form-control" style={{ width: '160px', height: '38px' }} value={data.agentFilter} onChange={(e) => call('setPipelineFilter', 'agent', e.target.value)}>
                        <option value="all">All Agents</option>
                        {data.agents.map((a) => <option key={a.id} value={String(a.id)}>{a.name}</option>)}
                    </select>
                    <select className="form-control" style={{ width: '140px', height: '38px' }} value={data.statusFilter} onChange={(e) => call('setPipelineFilter', 'status', e.target.value)}>
                        <option value="all">All Status</option>
                        <option value="prospect">Prospect</option>
                        <option value="active">Active</option>
                        <option value="warm">Warm</option>
                        <option value="hot">Hot</option>
                    </select>
                    <button className="btn secondary" onClick={() => call('refreshPipeline')}><i className="fas fa-sync-alt"></i> Refresh</button>
                    <button className="btn primary" onClick={() => call('openPipelineConfigModal')}><i className="fas fa-info-circle"></i> Rules</button>
                </div>
            </div>

            {/* Action Plan */}
            <div id="pl-action-plan" className="action-plan-section" style={{ marginBottom: '32px', background: 'white', borderRadius: '12px', padding: '20px', boxShadow: '0 1px 3px rgba(0,0,0,0.1)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                    <div>
                        <h2 style={{ fontSize: '18px', fontWeight: 600, margin: 0 }}>📋 Action Plan — {ap.monthLabel}</h2>
                        {ap.hasPlan ? <span style={{ background: '#d1fae5', color: '#065f46', padding: '2px 10px', borderRadius: '12px', fontSize: '11px', fontWeight: 600, marginTop: '4px', display: 'inline-block' }}>{ap.status}</span> : null}
                    </div>
                    <div style={{ display: 'flex', gap: '8px' }}>
                        <button className="btn secondary btn-sm" onClick={() => call('showActionPlanHistory')}>View History</button>
                        <button className="btn primary btn-sm" onClick={() => call('openActionPlanModal')}>{ap.hasPlan ? 'Edit Plan' : 'Create Plan'}</button>
                    </div>
                </div>
                {ap.hasPlan ? (
                    <>
                        <div style={{ background: '#f0fdf4', padding: '12px', borderRadius: '8px', marginBottom: '20px' }}>
                            <strong>🎯 Main Target:</strong> RM {fmtRM(ap.mainTarget)}
                        </div>
                        <div style={{ overflowX: 'auto' }}>
                            <table className="plan-items-table" style={{ width: '100%', borderCollapse: 'collapse' }}>
                                <thead>
                                    <tr style={{ background: '#f9fafb', borderBottom: '2px solid #e5e7eb' }}>
                                        {['Event Name', 'Objective', 'Target', 'Due Date', 'This Week', 'Remarks'].map((h) => th(h))}
                                    </tr>
                                </thead>
                                <tbody>
                                    {ap.items.length ? ap.items.map((item) => (
                                        <tr key={item.id} style={{ borderBottom: '1px solid #e5e7eb' }}>
                                            <td style={{ padding: '10px 12px' }}>{item.eventName}</td>
                                            <td style={{ padding: '10px 12px' }}>{item.objective}</td>
                                            <td style={{ padding: '10px 12px' }}>{item.target}</td>
                                            <td style={{ padding: '10px 12px' }}>{item.when}</td>
                                            <td style={{ padding: '10px 12px' }}>
                                                <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer' }}>
                                                    <input type="checkbox" className="plan-checkbox" defaultChecked={item.done} onChange={(e) => call('updatePlanCheck', ap.planId, item.id, e.target.checked)} />
                                                    {item.done ? <span style={{ color: '#059669', fontWeight: 600 }}>✅ Done</span> : <span style={{ color: '#9ca3af' }}>⏳ Pending</span>}
                                                </label>
                                            </td>
                                            <td style={{ padding: '10px 12px' }}>{item.remarks}</td>
                                        </tr>
                                    )) : <tr><td colSpan={6} style={{ padding: '24px', textAlign: 'center', color: '#9ca3af' }}>No items added yet. Click "Edit Plan" to add items.</td></tr>}
                                </tbody>
                            </table>
                        </div>
                        <div className="weekly-reminder" style={{ marginTop: '16px', padding: '12px', background: '#fef3c7', borderRadius: '8px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <span><i className="fas fa-bell"></i> Weekly check every Monday — mark completed items above.</span>
                            <button className="btn secondary btn-sm" onClick={() => call('sendPlanReminder')}>Send Reminder</button>
                        </div>
                    </>
                ) : (
                    <div style={{ textAlign: 'center', padding: '40px', color: '#9ca3af' }}>
                        <i className="fas fa-clipboard-list" style={{ fontSize: '40px', marginBottom: '16px', display: 'block' }}></i>
                        <p>No action plan for this month. Click <strong>"Create Plan"</strong> to get started.</p>
                    </div>
                )}
            </div>

            {/* Month Focus / Priority List */}
            <div id="pl-focus-section" style={{ marginBottom: '32px', background: 'white', borderRadius: '12px', boxShadow: '0 1px 3px rgba(0,0,0,0.1)', padding: '20px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px', flexWrap: 'wrap', gap: '8px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
                        <h2 style={{ fontSize: '18px', fontWeight: 600, margin: 0 }}>🔥 MONTH FOCUS — My Priority List</h2>
                        <span style={{ background: '#F3F4F6', padding: '4px 12px', borderRadius: '20px', fontSize: '12px', fontWeight: 600 }}>{focus.count} prospects</span>
                        <select value={activeMonth} onChange={(e) => onMonthChange(e.target.value)} style={{ border: '1px solid #D1D5DB', borderRadius: '6px', padding: '4px 10px', fontSize: '12px', color: '#374151', cursor: 'pointer' }}>
                            <option value="current">{focus.currentMonthLabel} (Current)</option>
                            {focus.archiveMonths.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
                        </select>
                    </div>
                    <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                        <button className="btn secondary btn-sm" onClick={() => call('openExpiredSearchModal')} title="Browse expired & available prospects"><i className="fas fa-search"></i> Browse Past</button>
                        {!focus.isArchiveView ? <button className="btn-icon" onClick={() => call('saveManualOrder')} title="Save Order"><i className="fas fa-save"></i></button> : null}
                    </div>
                </div>
                {focus.isArchiveView
                    ? <div style={{ background: '#FEF3C7', padding: '8px 16px', borderRadius: '8px', marginBottom: '12px', fontSize: '12px', color: '#92400E' }}><i className="fas fa-archive" style={{ marginRight: '4px' }}></i> Viewing archived month (read-only). Use "Browse Past" to re-add prospects to current month.</div>
                    : <p style={{ fontSize: '12px', color: '#9CA3AF', marginBottom: '16px' }}><i className="fas fa-arrows-alt" style={{ marginRight: '4px' }}></i> Drag ☰ to reorder priority • Add prospects from Table 2 below</p>}
                <div style={{ overflowX: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: '1080px' }}>
                        <thead>
                            <tr style={{ background: '#F9FAFB', borderBottom: '2px solid #E5E7EB' }}>
                                {FOCUS_TH.map((h, i) => th(h, i === 0 ? { width: '50px' } : undefined))}
                            </tr>
                        </thead>
                        <tbody id="focus-list-body">
                            {focus.rows.length
                                ? (focus.isArchiveView
                                    ? focus.rows.map((r) => <ArchiveRow key={r.idx} row={r} />)
                                    : focus.rows.map((r) => <FocusRow key={r.recId} row={r} />))
                                : <tr><td colSpan={7} style={{ padding: '32px', textAlign: 'center', color: '#9CA3AF' }}>No prospects in your priority list. Add from Table 2 below.</td></tr>}
                        </tbody>
                    </table>
                </div>

                {/* Team agents focus lists */}
                <div id="pl-team-sections">
                    {data.teamSections.length ? (
                        <div style={{ marginTop: '16px', borderTop: '2px solid #E5E7EB', paddingTop: '16px' }}>
                            <h3 style={{ fontSize: '15px', fontWeight: 600, color: '#374151', marginBottom: '8px' }}><i className="fas fa-users" style={{ marginRight: '6px', color: '#6366F1' }}></i> Team Agents Focus Lists</h3>
                            <p style={{ fontSize: '11px', color: '#9CA3AF', marginBottom: '8px' }}>Click agent name to expand/collapse their focus list</p>
                            {data.teamSections.map((sec, si) => <TeamSection key={si} section={sec} />)}
                        </div>
                    ) : null}
                </div>
            </div>

            {/* Auto-Generated Pipeline (system table) */}
            <div style={{ background: 'white', borderRadius: '12px', boxShadow: '0 1px 3px rgba(0,0,0,0.1)', padding: '20px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                        <h2 style={{ fontSize: '18px', fontWeight: 600, margin: 0 }}>📊 Auto-Generated Pipeline</h2>
                        <span id="pl-table2-count"><span style={{ background: '#F3F4F6', padding: '4px 12px', borderRadius: '20px', fontSize: '12px', fontWeight: 600 }}>{sys.qualifiedCount} qualified</span></span>
                    </div>
                    <p style={{ fontSize: '11px', color: '#9CA3AF', margin: 0 }}>Sorted: highest probability → most recent activity → name</p>
                </div>
                <div style={{ overflowX: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: '1080px' }}>
                        <thead>
                            <tr style={{ background: '#F9FAFB', borderBottom: '2px solid #E5E7EB' }}>
                                {TH.map((h) => th(h))}
                            </tr>
                        </thead>
                        <tbody id="pipeline-list-body">
                            {sys.rows.length
                                ? sys.rows.map((r) => <SystemRow key={r.prospectId} row={r} />)
                                : <tr><td colSpan={6} style={{ padding: '32px', textAlign: 'center', color: '#9CA3AF' }}>No qualified prospects found. Complete prerequisites for any category to appear here.</td></tr>}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
}

// Collapsible team-agent focus section — React-state expand/collapse (replaces
// the legacy app.toggleAgentFocusSection DOM toggle on the JSX path).
function TeamSection({ section }) {
    const [open, setOpen] = useState(false);
    return (
        <div style={{ marginTop: '12px' }}>
            <div onClick={() => setOpen((v) => !v)} style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '8px', padding: '12px 16px', background: '#F0F4FF', borderRadius: '8px', border: '1px solid #DBEAFE', userSelect: 'none' }}>
                <span className="agent-collapse-icon" style={{ transition: 'transform 0.2s', fontSize: '14px', transform: open ? 'rotate(90deg)' : 'none' }}>▸</span>
                <strong style={{ fontSize: '14px' }}>{section.agentName}</strong>
                <span style={{ background: '#E0E7FF', padding: '2px 10px', borderRadius: '12px', fontSize: '11px', fontWeight: 600, color: '#3730A3' }}>{section.count} prospects</span>
            </div>
            <div className="agent-focus-body" style={{ display: open ? 'block' : 'none', padding: '8px 0', overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: '1080px' }}>
                    <thead>
                        <tr style={{ background: '#F9FAFB', borderBottom: '2px solid #E5E7EB' }}>
                            {TEAM_TH.map((h, i) => th(h, i === 0 ? { width: '50px' } : undefined))}
                        </tr>
                    </thead>
                    <tbody>
                        {section.rows.map((r) => <FocusRow key={r.recId} row={r} />)}
                    </tbody>
                </table>
            </div>
        </div>
    );
}

export function PipelineView({ onReady, data }) {
    // FULL-JSX path (opt-in, default OFF). When the chunk built a payload it is
    // passed as props.data; render every section as real React. The scaffold
    // branch below is untouched and still runs when data is absent.
    if (data) {
        return <PipelineFullJsx data={data} onReady={onReady} />;
    }

    // ── SCAFFOLD-SHELL path (default, UNCHANGED) ─────────────────────────────
    try { window.__REACT_PIPELINE_STATE = 'ready'; } catch (_) { /* noop */ }

    // Signal post-commit so the chunk's STEP-2 fills target the committed shell
    // (a single rAF fired before React committed → fills hit null → skeleton stuck).
    useEffect(() => {
        if (typeof onReady === 'function') {
            try { onReady(); } catch (_) { /* noop */ }
        }
    }, [onReady]);

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
