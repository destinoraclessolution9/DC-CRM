// Marketing Automation — scaffold-shell island (view id 'marketing_automation').
//
// React owns the shell (header + role-gated actions + role-gated tab bar + empty
// #marketing-tab-content). ALL logic stays in the chunk (chunks/script-marketing.js):
// the island signals onReady from useEffect (post-commit), the chunk awaits it
// (pipeline lesson — a bare rAF fires too early), then its STEP-2
// renderMarketingTabContent() fills #marketing-tab-content by id exactly as legacy.
// Tab switches + every modal/mutation call window.app.*.
//
// THIRD render path (default-OFF, gated in the chunk by _reactMktAutoJsxOn /
// ?react_mktauto_jsx=1 / crm_react_mktauto_jsx='1'): when the chunk hands us a
// `data` payload, we render ALL tabs as real JSX with React-state tab switching
// and call the existing window.app.* handlers for every interaction. The scaffold
// branch below is UNCHANGED and still runs whenever `data` is absent (flag off,
// or payload build threw → chunk falls back to the by-id fill).
import React, { useEffect, useState } from 'react';

const app = () => window.app || {};
const call = (name, ...args) => { const f = app()[name]; if (typeof f === 'function') return f(...args); };

const BASE_TABS = [
    { key: 'forms', icon: 'fa-clipboard-list', label: 'Forms 表格' },
    { key: 'templates', icon: 'fa-layer-group', label: 'Message Templates' },
    { key: 'campaigns', icon: 'fa-bullhorn', label: 'Active Campaigns' },
    { key: 'automation', icon: 'fa-cogs', label: 'Automation' },
    { key: 'analytics', icon: 'fa-chart-line', label: 'Campaign Analytics' },
];
// Marketing-manager/admin-only extra tabs. (The legacy view rendered "Monthly
// Promotions" twice — a pre-existing copy-paste dup, now removed here + in the
// chunk fallback.)
const EXTRA_TABS = [
    { key: 'products', icon: 'fa-box', label: 'Products & Services' },
    { key: 'promotions', icon: 'fa-calendar-alt', label: 'Monthly Promotions' },
];

// ── Full-JSX helpers (data-path only) ───────────────────────────────────────
const CATEGORY_COLORS = { after_cps: '#3b82f6', on_event_attendance: '#8b5cf6', on_apu_photo: '#f59e0b', on_birthday: '#ec4899' };
const CATEGORY_LABELS = { after_cps: 'After CPS', on_event_attendance: 'Event Attendance', on_apu_photo: 'APU Photo', on_birthday: 'Birthday' };
const TEMPLATE_BADGE = {
    'Birthday': 'badge-blue', 'Follow-up': 'badge-orange', 'Event': 'badge-green',
    'CPS': 'badge-purple', 'Promotion': 'badge-red', 'Appointment Reminder': 'badge-yellow', 'Thank You': 'badge-teal'
};

function fmtDate(d) {
    if (!d) return '—';
    try {
        const U = window.UI;
        if (U && typeof U.formatDate === 'function') return U.formatDate(d);
        return new Date(d).toLocaleDateString();
    } catch (_) { return String(d); }
}
function fmtNum(n) {
    try {
        const U = window.UI;
        if (U && typeof U.formatNumber === 'function') return U.formatNumber(n);
    } catch (_) { /* noop */ }
    return Number(n || 0).toLocaleString();
}
function stop(e) { if (e && typeof e.stopPropagation === 'function') e.stopPropagation(); }

// ── Forms tab (JSX mirror of renderFormsTab) ────────────────────────────────
function FormsTab({ rows }) {
    const Badge = ({ val, label }) => val
        ? <span className="cf-badge cf-badge-done" title={`${label} · ${fmtDate(val.created_at)}`}><i className="fas fa-check"></i> {label}</span>
        : <span className="cf-badge cf-badge-pending">{label}</span>;
    return (
        <div className="cf-wrap">
            <div className="cf-header">
                <div>
                    <h2>Customer Forms 客户表格</h2>
                    <p>Survey → CPS Analysis → APU Appraisal. Pick a prospect to start.</p>
                </div>
                <input type="search" className="cf-search" placeholder="Search by name or phone…"
                    onInput={(e) => call('cfSearchProspects', e.target.value)} />
            </div>
            <div className="cf-flow">
                <span><span className="num">1</span> 新客户调查表 Survey</span>
                <i className="fas fa-arrow-right" style={{ color: '#9CA3AF' }}></i>
                <span><span className="num">2</span> 細解命盤 CPS Form</span>
                <i className="fas fa-arrow-right" style={{ color: '#9CA3AF' }}></i>
                <span><span className="num">3</span> APU Appraisal 反馈</span>
                <i className="fas fa-arrow-right" style={{ color: '#9CA3AF' }}></i>
                <span><span className="num">4</span> 九運改命藍圖表 Blueprint</span>
            </div>
            {rows.length === 0 ? (
                <div className="cf-empty">
                    <i className="fas fa-clipboard-list" style={{ fontSize: '42px', marginBottom: '10px' }}></i>
                    <div>No prospects yet.</div>
                </div>
            ) : (
                <div className="cf-list">
                    {rows.map((p) => (
                        <div className="cf-row" key={p.id}>
                            <div className="cf-name">
                                {p.name}
                                <span className="sub">{p.phone || 'No phone'}</span>
                            </div>
                            <div className="cf-badges">
                                <Badge val={p.survey} label="Survey" />
                                <Badge val={p.cps} label="CPS" />
                                <Badge val={p.apu} label="APU" />
                                <Badge val={p.blueprint} label="Blueprint" />
                            </div>
                            <div className="cf-actions">
                                <button className="cf-btn cf-btn-survey" onClick={() => p.survey ? call('openCustomerSurveyModal', p.id, p.survey.id) : call('openCustomerSurveyModal', p.id)}>
                                    <i className="fas fa-edit"></i> {p.survey ? 'Edit' : 'Fill'} Survey
                                </button>
                                <button className="cf-btn cf-btn-cps" onClick={() => p.cps ? call('openCpsAnalysisModal', p.id, p.cps.id) : call('openCpsAnalysisModal', p.id)}>
                                    <i className="fas fa-edit"></i> {p.cps ? 'Edit' : 'Fill'} CPS
                                </button>
                                <button className="cf-btn cf-btn-apu" onClick={() => p.apu ? call('openApuAppraisalModal', p.id, p.apu.id) : call('openApuAppraisalModal', p.id)}>
                                    <i className="fas fa-edit"></i> {p.apu ? 'Edit' : 'Fill'} APU
                                </button>
                                <button className="cf-btn cf-btn-blueprint" onClick={() => p.blueprint ? call('openDestinyBlueprintInTab', p.id, p.blueprint.id) : call('openDestinyBlueprintInTab', p.id)}>
                                    <i className="fas fa-external-link-alt"></i> {p.blueprint ? 'Edit' : 'Fill'} Blueprint
                                </button>
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}

// ── Templates tab (JSX mirror of renderTemplatesTab) ────────────────────────
function TemplatesTab({ rows }) {
    return (
        <div className="templates-layout">
            <div className="templates-list">
                <div className="templates-search">
                    <i className="fas fa-search"></i>
                    <input type="text" id="template-search" placeholder="Search templates..." onKeyUp={() => call('searchTemplates')} />
                </div>
                <div className="templates-grid" id="templates-grid">
                    {rows.map((t) => {
                        const colorClass = TEMPLATE_BADGE[t.category] || 'badge-gray';
                        const preview = (t.content || '').substring(0, 80) + ((t.content || '').length > 80 ? '...' : '');
                        return (
                            <div className="template-card" key={t.id} onClick={() => call('previewTemplate', t.id)}>
                                <div className="template-card-header">
                                    <span className={`template-badge ${colorClass}`}>{t.category}</span>
                                    <div className="template-card-actions">
                                        <button className="btn-icon" onClick={(e) => { stop(e); call('editTemplate', t.id); }} title="Edit"><i className="fas fa-edit"></i></button>
                                        <button className="btn-icon" onClick={(e) => { stop(e); call('copyTemplate', t.id); }} title="Copy"><i className="fas fa-copy"></i></button>
                                        <button className="btn-icon" onClick={(e) => { stop(e); call('deleteTemplate', t.id); }} title="Delete"><i className="fas fa-trash"></i></button>
                                    </div>
                                </div>
                                <h4 className="template-title">{t.template_name}</h4>
                                <p className="template-preview">{preview}</p>
                                <div className="template-variables">
                                    {(t.variables || []).map((v, i) => <span className="variable-tag" key={i}>{`{{${v}}}`}</span>)}
                                </div>
                            </div>
                        );
                    })}
                </div>
            </div>
            <div className="template-preview-panel">
                <h3><i className="fas fa-eye"></i> WhatsApp Preview</h3>
                <div className="whatsapp-preview-frame" id="whatsapp-preview">
                    <div className="whatsapp-header">
                        <div className="whatsapp-avatar"></div>
                        <div className="whatsapp-contact">Michelle Tan</div>
                        <div className="whatsapp-time">10:24 PM</div>
                    </div>
                    <div className="whatsapp-body">
                        <div className="message-bubble received">
                            Hi Michelle, wishing you a very happy birthday! May the Horse year bring you prosperity and success!
                            <div className="message-time">10:24 PM</div>
                        </div>
                    </div>
                </div>
                <div className="placeholder-tags">
                    <p><strong>Available Placeholders:</strong></p>
                    <div className="tag-cloud">
                        {['{{name}}', '{{zodiac}}', '{{mg}}', '{{expiry}}', '{{date}}', '{{agent}}', '{{event_date}}', '{{event_title}}', '{{location}}'].map((ph, i) => (
                            <span className="placeholder-tag" key={i} onClick={() => call('insertVariable', ph)}>{ph}</span>
                        ))}
                    </div>
                </div>
            </div>
        </div>
    );
}

// ── Campaigns tab (JSX mirror of renderCampaignsTab + renderCampaignRow) ─────
function CampaignsTab({ rows }) {
    return (
        <>
            <div className="campaigns-filters">
                <div className="form-group-inline">
                    <label>Status:</label>
                    <select id="campaign-status-filter" onChange={() => call('filterCampaigns')}>
                        <option value="all">All Status</option>
                        <option value="active">Active</option>
                        <option value="scheduled">Scheduled</option>
                        <option value="completed">Completed</option>
                        <option value="draft">Draft</option>
                    </select>
                </div>
                <div className="form-group-inline">
                    <label>Sort By:</label>
                    <select id="campaign-sort" onChange={() => call('filterCampaigns')}>
                        <option value="date-desc">Newest First</option>
                        <option value="date-asc">Oldest First</option>
                        <option value="name">Name</option>
                    </select>
                </div>
            </div>
            <div className="campaigns-table-container">
                <table className="campaigns-table">
                    <thead>
                        <tr>
                            <th scope="col">Campaign Name</th>
                            <th scope="col">Status</th>
                            <th scope="col">Schedule</th>
                            <th scope="col">Recipients</th>
                            <th scope="col">Open Rate</th>
                            <th scope="col">Response</th>
                            <th scope="col">Actions</th>
                        </tr>
                    </thead>
                    <tbody id="campaigns-list-body">
                        {rows.length === 0 ? (
                            <tr><td colSpan="7" style={{ textAlign: 'center', padding: '40px' }}>No campaigns found. Click "New Campaign" to start.</td></tr>
                        ) : rows.map((c) => {
                            const openRate = c.sent_count > 0 ? Math.round((c.opened_count / c.sent_count) * 100) : 0;
                            const responseRate = c.sent_count > 0 ? Math.round((c.replied_count / c.sent_count) * 100) : 0;
                            return (
                                <tr key={c.id} onClick={() => call('viewCampaignDetails', c.id)}>
                                    <td>
                                        <strong>{c.campaign_name}</strong><br />
                                        <small className="text-muted">{c.template_name}</small>
                                    </td>
                                    <td><span className={`status-badge status-${c.status}`}>{String(c.status).toUpperCase()}</span></td>
                                    <td>{c.scheduled_date ? fmtDate(c.scheduled_date) : 'Not scheduled'}</td>
                                    <td>{c.total_recipients}</td>
                                    <td>
                                        <div className="progress-container" style={{ width: '100px' }}>
                                            <div className="progress-bar" style={{ width: `${openRate}%` }}></div>
                                        </div>
                                        <small>{openRate}%</small>
                                    </td>
                                    <td>{responseRate}%</td>
                                    <td>
                                        <div className="table-actions">
                                            {c.status === 'draft' ? <button className="btn-icon" onClick={(e) => { stop(e); call('editCampaign', c.id); }} title="Edit"><i className="fas fa-edit"></i></button> : null}
                                            {c.status === 'active' ? <button className="btn-icon" onClick={(e) => { stop(e); call('pauseCampaign', c.id); }} title="Pause"><i className="fas fa-pause"></i></button> : null}
                                            {c.status === 'paused' ? <button className="btn-icon" onClick={(e) => { stop(e); call('resumeCampaign', c.id); }} title="Resume"><i className="fas fa-play"></i></button> : null}
                                            <button className="btn-icon" onClick={(e) => { stop(e); call('duplicateCampaign', c.id); }} title="Duplicate"><i className="fas fa-copy"></i></button>
                                            <button className="btn-icon" onClick={(e) => { stop(e); call('deleteCampaign', c.id); }} title="Delete"><i className="fas fa-trash"></i></button>
                                        </div>
                                    </td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            </div>
        </>
    );
}

// ── Automation tab (JSX mirror of renderAutomationTab) ──────────────────────
function AutomationTab({ data, isAdmin }) {
    const { followUps = [], draftStats = {}, workflowCardsHtml = [], hasWorkflows = false } = data || {};
    const QUICK = [
        ['Birthday Greeting', 'birthday', 'Send WhatsApp greeting on customer birthday', 'fas fa-birthday-cake'],
        ['Protection Expiring', 'protection_expiring', 'Alert agent 7 days before protection expires', 'fas fa-shield-alt'],
        ['Inactivity Alert', 'inactivity', 'Flag prospects with >7 days no follow-up', 'fas fa-exclamation-triangle'],
        ['New Prospect Welcome', 'new_prospect', 'Send welcome message when prospect created', 'fas fa-user-plus'],
        ['Event Follow-up', 'event_attendance', 'Create follow-up task after event attendance', 'fas fa-calendar-check'],
        ['Score Threshold', 'score_change', 'Notify agent when prospect reaches 600+ score', 'fas fa-chart-line'],
    ];
    return (
        <div>
            {/* Section 1: Follow-Up Triggers */}
            <div style={{ marginBottom: '32px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
                    <div>
                        <h2 style={{ margin: '0 0 8px' }}><i className="fas fa-paper-plane" style={{ color: 'var(--primary)' }}></i> Follow-Up Triggers</h2>
                        <p style={{ color: 'var(--gray-500)', fontSize: '14px', margin: 0 }}>Automation triggers that create WhatsApp reminder drafts on the calendar.</p>
                    </div>
                    {isAdmin ? <button className="btn primary" onClick={() => call('openAddTriggerModal')}><i className="fas fa-plus"></i> Add Trigger</button> : null}
                </div>
                <div style={{ background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: '8px', padding: '12px 16px', marginBottom: '20px', fontSize: '13px', color: '#1e40af' }}>
                    <strong>Variables:</strong> <code>{'{name}'}</code> <code>{'{date}'}</code> <code>{'{time}'}</code> <code>{'{venue}'}</code> <code>{'{event_name}'}</code> <code>{'{agent_name}'}</code> <code>{'{photo_url}'}</code> <small style={{ color: '#666' }}>(APU only)</small>
                </div>

                {isAdmin ? (
                    <div style={{ overflowX: 'auto' }}>
                        <table className="data-table" style={{ width: '100%', fontSize: '13px' }}>
                            <thead>
                                <tr>
                                    <th scope="col" style={{ width: '30px' }}>#</th>
                                    <th scope="col" style={{ width: '30px' }}></th>
                                    <th scope="col">Name</th>
                                    <th scope="col">Category</th>
                                    <th scope="col">Event Categories</th>
                                    <th scope="col">CPS Interest</th>
                                    <th scope="col">Solution Match</th>
                                    <th scope="col" style={{ width: '50px' }}>Delay</th>
                                    <th scope="col" style={{ width: '60px' }}>Window</th>
                                    <th scope="col" style={{ width: '60px' }}>Active</th>
                                    <th scope="col" style={{ width: '80px' }}>Actions</th>
                                </tr>
                            </thead>
                            <tbody>
                                {followUps.map((tpl) => {
                                    const catLabel = CATEGORY_LABELS[tpl.trigger_category] || tpl.trigger_category || '—';
                                    const catColor = CATEGORY_COLORS[tpl.trigger_category] || '#6b7280';
                                    const cats = (tpl.event_keywords || '').split(',').map((s) => s.trim()).filter(Boolean);
                                    return (
                                        <tr key={tpl.id}>
                                            <td style={{ color: 'var(--gray-400)' }}>{tpl.sort_order || '—'}</td>
                                            <td style={{ fontSize: '18px', textAlign: 'center' }}>{tpl.icon || '📩'}</td>
                                            <td>
                                                <strong>{tpl.template_name || tpl.trigger_type}</strong>
                                                <div style={{ fontSize: '11px', color: 'var(--gray-500)', maxWidth: '250px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{tpl.description || ''}</div>
                                            </td>
                                            <td><span style={{ fontSize: '11px', padding: '2px 8px', borderRadius: '10px', background: `${catColor}20`, color: catColor, whiteSpace: 'nowrap' }}>{catLabel}</span></td>
                                            <td style={{ fontSize: '12px', color: 'var(--gray-600)', maxWidth: '220px' }}>
                                                {cats.length === 0 ? <span style={{ color: 'var(--gray-300)' }}>—</span> : cats.map((c, i) => (
                                                    <span key={i} style={{ display: 'inline-block', background: '#fef3c7', color: '#92400e', border: '1px solid #fde68a', borderRadius: '10px', padding: '1px 6px', margin: '1px 2px 1px 0', fontSize: '10px' }}>{c}</span>
                                                ))}
                                            </td>
                                            <td style={{ fontSize: '12px', color: 'var(--gray-600)', maxWidth: '100px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={tpl.cps_interest_match || ''}>{tpl.cps_interest_match || '—'}</td>
                                            <td style={{ fontSize: '12px', color: 'var(--gray-600)', maxWidth: '150px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={tpl.solution_match || ''}>{tpl.solution_match || '—'}</td>
                                            <td style={{ textAlign: 'center' }}>{tpl.delay_days || 0}d</td>
                                            <td style={{ textAlign: 'center' }}>{tpl.event_window_days || 0}d</td>
                                            <td style={{ textAlign: 'center' }}>
                                                <input type="checkbox" defaultChecked={!!tpl.is_active} onChange={(e) => { stop(e); call('toggleFollowUpTemplate', tpl.id, e.target.checked); }} style={{ accentColor: '#3b82f6', cursor: 'pointer' }} />
                                            </td>
                                            <td>
                                                <div style={{ display: 'flex', gap: '4px' }}>
                                                    <button className="btn secondary btn-sm" onClick={(e) => { stop(e); call('openEditTriggerModal', tpl.id); }} style={{ fontSize: '11px', padding: '4px 8px' }}><i className="fas fa-edit"></i></button>
                                                    <button className="btn secondary btn-sm" onClick={(e) => { stop(e); call('deleteTrigger', tpl.id); }} style={{ fontSize: '11px', padding: '4px 8px', color: 'var(--danger)' }}><i className="fas fa-trash"></i></button>
                                                </div>
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                        {followUps.map((tpl) => (
                            <div key={tpl.id} style={{ background: 'var(--white,#fff)', border: '1px solid var(--gray-200,#e5e7eb)', borderRadius: '10px', padding: '16px', position: 'relative' }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '10px' }}>
                                    <div>
                                        <h3 style={{ margin: 0, fontSize: '15px', color: 'var(--gray-800)' }}>{tpl.icon || '📩'} {tpl.template_name || tpl.trigger_type}</h3>
                                        <p style={{ margin: '4px 0 0', fontSize: '12px', color: 'var(--gray-500)' }}>{tpl.description || ''}</p>
                                    </div>
                                    <span style={{ fontSize: '12px', padding: '2px 8px', borderRadius: '10px', background: tpl.is_active ? '#dcfce7' : '#f3f4f6', color: tpl.is_active ? '#059669' : 'var(--gray-400)' }}>{tpl.is_active ? 'Active' : 'Inactive'}</span>
                                </div>
                                <div style={{ background: 'var(--gray-50,#f9fafb)', borderRadius: '6px', padding: '10px 12px', fontSize: '13px', color: 'var(--gray-700)', whiteSpace: 'pre-wrap', maxHeight: '80px', overflow: 'hidden', lineHeight: 1.5 }}>{tpl.message_template || ''}</div>
                                <div style={{ display: 'flex', gap: '16px', marginTop: '10px', fontSize: '12px', color: 'var(--gray-500)' }}>
                                    {tpl.delay_days > 0 ? <span><i className="fas fa-clock"></i> Delay: {tpl.delay_days} day{tpl.delay_days > 1 ? 's' : ''}</span> : null}
                                    {tpl.event_window_days > 0 ? <span><i className="fas fa-calendar-alt"></i> Event window: {tpl.event_window_days} days</span> : null}
                                </div>
                            </div>
                        ))}
                    </div>
                )}

                <div style={{ marginTop: '24px', background: 'var(--white,#fff)', border: '1px solid var(--gray-200)', borderRadius: '10px', padding: '16px' }}>
                    <h3 style={{ margin: '0 0 12px', fontSize: '15px' }}>Follow-Up Statistics</h3>
                    <div style={{ display: 'flex', gap: '24px' }}>
                        <div style={{ textAlign: 'center' }}>
                            <div style={{ fontSize: '28px', fontWeight: 700, color: '#f59e0b' }}>{draftStats.pending || 0}</div>
                            <div style={{ fontSize: '12px', color: 'var(--gray-500)' }}>Pending</div>
                        </div>
                        <div style={{ textAlign: 'center' }}>
                            <div style={{ fontSize: '28px', fontWeight: 700, color: '#059669' }}>{draftStats.sent || 0}</div>
                            <div style={{ fontSize: '12px', color: 'var(--gray-500)' }}>Sent</div>
                        </div>
                        <div style={{ textAlign: 'center' }}>
                            <div style={{ fontSize: '28px', fontWeight: 700, color: 'var(--gray-400)' }}>{draftStats.dismissed || 0}</div>
                            <div style={{ fontSize: '12px', color: 'var(--gray-500)' }}>Dismissed</div>
                        </div>
                    </div>
                </div>
            </div>

            <hr style={{ margin: '32px 0', border: 'none', borderTop: '1px solid var(--gray-200)' }} />

            {/* Section 2: Custom Workflows */}
            <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
                    <div>
                        <h2 style={{ margin: '0 0 8px' }}><i className="fas fa-sitemap" style={{ color: 'var(--primary)' }}></i> Custom Workflows</h2>
                        <p style={{ color: 'var(--gray-500)', fontSize: '14px', margin: 0 }}>Create automated IF → THEN workflows with triggers and actions.</p>
                    </div>
                    <button className="btn primary" onClick={() => call('openCreateWorkflowModal')}><i className="fas fa-plus"></i> Create Workflow</button>
                </div>

                {hasWorkflows ? (
                    <div id="workflows-list" dangerouslySetInnerHTML={{ __html: workflowCardsHtml.join('') }} />
                ) : (
                    <div style={{ textAlign: 'center', padding: '40px', color: 'var(--gray-500)', background: 'var(--gray-50)', borderRadius: '10px', border: '1px solid var(--gray-200)' }}>
                        <i className="fas fa-cogs" style={{ fontSize: '48px', marginBottom: '12px', color: 'var(--gray-300)' }}></i>
                        <p>No custom workflows yet</p>
                        <p style={{ fontSize: '12px' }}>Create your first workflow to automate tasks like scoring updates, reassignment alerts, and follow-up reminders.</p>
                        <button className="btn primary" style={{ marginTop: '12px' }} onClick={() => call('openCreateWorkflowModal')}><i className="fas fa-plus"></i> Create First Workflow</button>
                    </div>
                )}

                <div style={{ marginTop: '24px' }}>
                    <h3 style={{ margin: '0 0 12px', fontSize: '15px' }}><i className="fas fa-clipboard-list"></i> Quick Templates</h3>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(250px, 1fr))', gap: '12px' }}>
                        {QUICK.map(([title, , desc, icon], i) => (
                            <div key={i} style={{ background: 'var(--white,#fff)', border: '1px solid var(--gray-200)', borderRadius: '10px', padding: '16px' }}>
                                <h4 style={{ margin: '0 0 6px', fontSize: '14px' }}><i className={icon} style={{ color: 'var(--primary)', marginRight: '6px' }}></i>{title}</h4>
                                <p style={{ margin: 0, fontSize: '12px', color: 'var(--gray-500)' }}>{desc}</p>
                            </div>
                        ))}
                    </div>
                </div>
            </div>
        </div>
    );
}

// ── Analytics tab (JSX mirror of renderAnalyticsTab) ────────────────────────
function AnalyticsTab({ analytics, canExport }) {
    const a = analytics || {};
    const top = a.topCampaigns || [];
    return (
        <>
            <div className="analytics-stats-grid">
                <div className="analytics-card">
                    <div className="analytics-icon blue"><i className="fas fa-bullhorn"></i></div>
                    <div className="analytics-content">
                        <span className="analytics-label">Total Campaigns</span>
                        <span className="analytics-value">{a.totalCampaigns || 0}</span>
                        <span className="analytics-trend up"><i className="fas fa-arrow-up"></i> 12% vs last month</span>
                    </div>
                </div>
                <div className="analytics-card">
                    <div className="analytics-icon green"><i className="fas fa-envelope-open"></i></div>
                    <div className="analytics-content">
                        <span className="analytics-label">Avg Open Rate</span>
                        <span className="analytics-value">{a.avgOpenRate || 0}%</span>
                        <span className="analytics-trend up"><i className="fas fa-arrow-up"></i> {a.openRateTrend || 0}% vs last month</span>
                    </div>
                </div>
                <div className="analytics-card">
                    <div className="analytics-icon orange"><i className="fas fa-reply"></i></div>
                    <div className="analytics-content">
                        <span className="analytics-label">Avg Response Rate</span>
                        <span className="analytics-value">{a.avgResponseRate || 0}%</span>
                        <span className="analytics-trend down"><i className="fas fa-arrow-down"></i> 1.5% vs last month</span>
                    </div>
                </div>
                <div className="analytics-card">
                    <div className="analytics-icon purple"><i className="fas fa-user-check"></i></div>
                    <div className="analytics-content">
                        <span className="analytics-label">Conversion Rate</span>
                        <span className="analytics-value">{a.avgConversionRate || 0}%</span>
                        <span className="analytics-trend up"><i className="fas fa-arrow-up"></i> 0.8% vs last month</span>
                    </div>
                </div>
            </div>
            <div className="chart-row">
                <div className="chart-container">
                    <h3>Message Volume Trend</h3>
                    <canvas id="message-volume-chart"></canvas>
                </div>
                <div className="chart-container">
                    <h3>Campaign Performance Comparison</h3>
                    <canvas id="campaign-performance-chart"></canvas>
                </div>
            </div>
            <div className="chart-row">
                <div className="chart-container">
                    <h3>Audience Segmentation</h3>
                    <canvas id="audience-segment-chart"></canvas>
                </div>
                <div className="top-campaigns">
                    <h3>Top Performing Campaigns</h3>
                    <table className="campaigns-table">
                        <thead>
                            <tr>
                                <th scope="col">Campaign</th>
                                <th scope="col">Sent</th>
                                <th scope="col">Open Rate</th>
                                <th scope="col">Score</th>
                            </tr>
                        </thead>
                        <tbody>
                            {top.map((c, i) => (
                                <tr key={i}>
                                    <td>{c.campaign_name || ''}</td>
                                    <td>{c.sent_count}</td>
                                    <td>{c.sent_count > 0 ? Math.round((c.opened_count / c.sent_count) * 100) : 0}%</td>
                                    <td><span className="badge-green">High</span></td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                    <button className="btn-sm secondary" style={{ width: '100%', marginTop: '12px' }} onClick={() => call('exportAnalyticsReport')}>Export Detailed Report</button>
                </div>
            </div>
        </>
    );
}

// ── Products tab (JSX mirror of renderProductsTab) ──────────────────────────
function ProductsTab({ rows }) {
    return (
        <div className="products-layout" style={{ padding: '24px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
                <h3>Product & Service Directory</h3>
                <button className="btn primary" onClick={() => call('openAddProductModal')}>+ Add New Product</button>
            </div>
            <table className="data-table" style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                    <tr style={{ background: 'var(--gray-100)', textAlign: 'left' }}>
                        <th scope="col" style={{ padding: '12px', borderBottom: '1px solid var(--gray-200)' }}>Name</th>
                        <th scope="col" style={{ padding: '12px', borderBottom: '1px solid var(--gray-200)' }}>Category</th>
                        <th scope="col" style={{ padding: '12px', borderBottom: '1px solid var(--gray-200)' }}>Status</th>
                        <th scope="col" style={{ padding: '12px', borderBottom: '1px solid var(--gray-200)' }}>Actions</th>
                    </tr>
                </thead>
                <tbody>
                    {rows.length === 0 ? (
                        <tr><td colSpan="4" style={{ padding: '12px', textAlign: 'center' }}>No products found.</td></tr>
                    ) : rows.map((p) => (
                        <tr key={p.id}>
                            <td style={{ padding: '12px', borderBottom: '1px solid var(--gray-200)' }}><strong>{p.name}</strong></td>
                            <td style={{ padding: '12px', borderBottom: '1px solid var(--gray-200)' }}>{p.category || 'N/A'}</td>
                            <td style={{ padding: '12px', borderBottom: '1px solid var(--gray-200)' }}>
                                <span className={`status-badge ${p.is_active ? 'status-active' : 'status-inactive'}`}>{p.is_active ? 'Active' : 'Inactive'}</span>
                            </td>
                            <td style={{ padding: '12px', borderBottom: '1px solid var(--gray-200)' }}>
                                <button className="btn btn-sm secondary" onClick={() => call('openAddProductModal', p.id)}>Edit</button>
                                <button className={`btn btn-sm ${p.is_active ? 'danger' : 'primary'}`} onClick={() => call('toggleProductStatus', p.id, p.is_active)}>
                                    {p.is_active ? 'Deactivate' : 'Activate'}
                                </button>
                            </td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
}

// ── Monthly Promotions tab (JSX mirror of renderMonthlyPromotionsTab) ───────
function PromotionsTab({ rows, canManage }) {
    const monthYear = (my) => {
        if (!my) return '—';
        try { return new Date(my + 'T00:00:00').toLocaleDateString('en-MY', { month: 'short', year: 'numeric' }); } catch (_) { return '—'; }
    };
    const timeFrame = (p) => {
        if (!p.start_date || !p.end_date) return '—';
        try {
            const sd = new Date(p.start_date + 'T00:00:00');
            const ed = new Date(p.end_date + 'T00:00:00');
            const days = Math.round((ed - sd) / 86400000) + 1;
            const fmt = (d) => d.toLocaleDateString('en-MY', { day: '2-digit', month: 'short', year: 'numeric' });
            return `${fmt(sd)} – ${fmt(ed)} (${days}d)`;
        } catch (_) { return '—'; }
    };
    const truncate = (s, n) => (s && s.length > n ? s.slice(0, n - 2) + '…' : s);
    return (
        <div style={{ padding: '24px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
                <div>
                    <h3>Monthly Promotions</h3>
                    <p className="text-muted">Full history of all monthly promotions — sorted newest first, never deleted</p>
                </div>
                <div style={{ display: 'flex', gap: '10px' }}>
                    <button className="btn secondary" onClick={() => call('exportMonthlyPromotions')}><i className="fas fa-download"></i> Export CSV</button>
                    {canManage ? <button className="btn primary" onClick={() => call('openMonthlyPromotionModal')}><i className="fas fa-plus"></i> New Promotion</button> : null}
                </div>
            </div>
            <div style={{ display: 'flex', gap: '15px', marginBottom: '20px' }}>
                <div style={{ position: 'relative', flex: 1 }}>
                    <i className="fas fa-search" style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: 'var(--gray-400)' }}></i>
                    <input type="text" id="promo-search" className="form-control" placeholder="Search by promotion name or package..." style={{ paddingLeft: '35px' }} onInput={() => call('filterMonthlyPromotions')} />
                </div>
                <select id="promo-status-filter" className="form-control" style={{ width: '170px' }} onChange={() => call('filterMonthlyPromotions')}>
                    <option value="all">All Status</option>
                    <option value="Draft">Draft</option>
                    <option value="Active">Active</option>
                    <option value="Ended">Ended</option>
                    <option value="Archived">Archived</option>
                </select>
            </div>
            <div style={{ overflowX: 'auto' }}>
                <table className="data-table" style={{ width: '100%', borderCollapse: 'collapse', minWidth: '900px' }}>
                    <thead>
                        <tr style={{ background: 'var(--gray-100)', textAlign: 'left' }}>
                            <th scope="col" style={{ padding: '12px', borderBottom: '1px solid var(--gray-200)' }}>Promotion Name</th>
                            <th scope="col" style={{ padding: '12px', borderBottom: '1px solid var(--gray-200)' }}>Month/Year</th>
                            <th scope="col" style={{ padding: '12px', borderBottom: '1px solid var(--gray-200)' }}>Time Frame</th>
                            <th scope="col" style={{ padding: '12px', borderBottom: '1px solid var(--gray-200)' }}>Special Package</th>
                            <th scope="col" style={{ padding: '12px', borderBottom: '1px solid var(--gray-200)' }}>Payment Mode</th>
                            <th scope="col" style={{ padding: '12px', borderBottom: '1px solid var(--gray-200)' }}>Target Customer</th>
                            <th scope="col" style={{ padding: '12px', borderBottom: '1px solid var(--gray-200)' }}>Entitlement Req.</th>
                            <th scope="col" style={{ padding: '12px', borderBottom: '1px solid var(--gray-200)' }}>Status</th>
                            <th scope="col" style={{ padding: '12px', borderBottom: '1px solid var(--gray-200)' }}>Actions</th>
                        </tr>
                    </thead>
                    <tbody id="monthly-promotions-tbody">
                        {rows.length === 0 ? (
                            <tr><td colSpan="9" style={{ padding: '40px', textAlign: 'center', color: 'var(--gray-500)' }}>No monthly promotions yet. Click "+ New Promotion" to create the first one.</td></tr>
                        ) : rows.map((p) => {
                            const statusClass = `status-${String(p.status || 'draft').toLowerCase()}`;
                            const isArchived = p.status === 'Archived';
                            return (
                                <tr key={p.id} style={{ cursor: 'pointer' }} onClick={() => call('viewMonthlyPromotionDetails', p.id)}>
                                    <td style={{ padding: '12px', borderBottom: '1px solid var(--gray-200)' }}><strong>{p.name || ''}</strong></td>
                                    <td style={{ padding: '12px', borderBottom: '1px solid var(--gray-200)' }}>{monthYear(p.month_year)}</td>
                                    <td style={{ padding: '12px', borderBottom: '1px solid var(--gray-200)', fontSize: '12px', color: 'var(--gray-600)' }}>{timeFrame(p)}</td>
                                    <td style={{ padding: '12px', borderBottom: '1px solid var(--gray-200)' }} title={p.special_package || ''}>{truncate(p.special_package, 25) || '—'}</td>
                                    <td style={{ padding: '12px', borderBottom: '1px solid var(--gray-200)' }}>
                                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '2px' }}>
                                            {(p.payment_modes || []).length === 0 ? '—' : (p.payment_modes || []).map((m, i) => (
                                                <span className="badge badge-gray" key={i} style={{ fontSize: '10px', margin: '1px' }}>{String(m)}</span>
                                            ))}
                                        </div>
                                    </td>
                                    <td style={{ padding: '12px', borderBottom: '1px solid var(--gray-200)' }} title={p.target_customer || ''}>{truncate(p.target_customer, 20) || '—'}</td>
                                    <td style={{ padding: '12px', borderBottom: '1px solid var(--gray-200)' }} title={p.entitlement_requirement || ''}>{truncate(p.entitlement_requirement, 22) || '—'}</td>
                                    <td style={{ padding: '12px', borderBottom: '1px solid var(--gray-200)' }}>
                                        <span className={`status-badge ${statusClass}`}>{p.status || 'Draft'}</span>
                                    </td>
                                    <td style={{ padding: '12px', borderBottom: '1px solid var(--gray-200)' }}>
                                        <div className="table-actions" onClick={stop}>
                                            <button className="btn-icon" onClick={() => call('viewMonthlyPromotionDetails', p.id)} title="View Details"><i className="fas fa-eye"></i></button>
                                            {!isArchived ? <button className="btn-icon" onClick={() => call('openMonthlyPromotionModal', p.id)} title="Edit"><i className="fas fa-edit"></i></button> : null}
                                            <button className="btn-icon" onClick={() => call('duplicateMonthlyPromotion', p.id)} title="Duplicate"><i className="fas fa-copy"></i></button>
                                            {!isArchived ? <button className="btn-icon" onClick={() => call('archiveMonthlyPromotion', p.id)} title="Archive"><i className="fas fa-archive"></i></button> : null}
                                            <button className="btn-icon text-danger" onClick={() => call('deleteMonthlyPromotion', p.id)} title="Delete"><i className="fas fa-trash"></i></button>
                                        </div>
                                    </td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            </div>
        </div>
    );
}

// ── Full-JSX view (the third render path) ───────────────────────────────────
function MarketingAutomationFullJsx({ data, canExport, canTabs }) {
    const [activeTab, setActiveTab] = useState(data.activeTab || 'forms');

    // Analytics charts are drawn imperatively into <canvas> by the chunk's
    // initMarketingCharts (Chart.js). Trigger it when the analytics tab mounts.
    useEffect(() => {
        if (activeTab === 'analytics') {
            const f = app().refreshAnalytics || app().initMarketingCharts;
            if (typeof f === 'function') { try { f(); } catch (_) { /* noop */ } }
        }
    }, [activeTab]);

    const tabs = canTabs ? [...BASE_TABS, ...EXTRA_TABS] : BASE_TABS;

    // Tab switching is React state ONLY — we NEVER call the chunk's
    // switchMarketingTab (it does getElementById('marketing-tab-content').innerHTML,
    // which would clobber this React-owned node). We only mirror the active tab
    // into _state.cmt so app.* mutation handlers that gate on _state.cmt (e.g.
    // saveProduct, toggleFollowUpTemplate) stay consistent.
    const onTab = (key) => {
        try { if (window._appState) window._appState.cmt = key; } catch (_) { /* noop */ }
        setActiveTab(key);
    };

    const renderActive = () => {
        switch (activeTab) {
            case 'forms': return <FormsTab rows={(data.forms && data.forms.rows) || []} />;
            case 'templates': return <TemplatesTab rows={(data.templates && data.templates.rows) || []} />;
            case 'campaigns': return <CampaignsTab rows={(data.campaigns && data.campaigns.rows) || []} />;
            case 'automation': return <AutomationTab data={data.automation} isAdmin={!!data.isAdmin} />;
            case 'analytics': return <AnalyticsTab analytics={data.analytics} canExport={canExport} />;
            case 'products': return canTabs ? <ProductsTab rows={(data.products && data.products.rows) || []} /> : null;
            case 'promotions': return canTabs ? <PromotionsTab rows={(data.promotions && data.promotions.rows) || []} canManage={!!data.canManage} /> : null;
            default: return <FormsTab rows={(data.forms && data.forms.rows) || []} />;
        }
    };

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
                    <button className="btn secondary" onClick={() => onTab('analytics')}><i className="fas fa-chart-bar"></i> Analytics</button>
                    {canExport ? <button className="btn secondary" onClick={() => call('exportKPIDashboard')}><i className="fas fa-download"></i> Export Data</button> : null}
                </div>
            </div>

            <div className="marketing-tabs">
                {tabs.map((t, i) => (
                    <button key={i} className={`marketing-tab ${activeTab === t.key ? 'active' : ''}`} onClick={() => onTab(t.key)}>
                        <i className={`fas ${t.icon}`}></i> {t.label}
                    </button>
                ))}
            </div>

            <div id="marketing-tab-content" className="marketing-tab-content">
                {renderActive()}
            </div>
        </div>
    );
}

export function MarketingAutomationView({ canExport = false, canTabs = false, activeTab = 'forms', onReady, data }) {
    try { window.__REACT_MKTAUTO_STATE = 'ready'; } catch (_) { /* noop */ }

    // THIRD render path (default-OFF): when the chunk supplies a serializable
    // `data` payload, render the full view as real JSX with React-state tab
    // switching. The scaffold branch below is UNCHANGED.
    if (data) {
        return <MarketingAutomationFullJsx data={data} canExport={canExport} canTabs={canTabs} />;
    }

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
