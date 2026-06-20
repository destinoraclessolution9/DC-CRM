// Egg Purchasing — island (view id 'egg_purchasing', Super-Admin).
//
// THREE render paths:
//  1. Legacy (?react=0 / kill-switch)  — chunk renders vanilla HTML into the view
//     container directly (this component is never mounted).
//  2. Scaffold-shell (DEFAULT, live)   — props.data ABSENT. React renders ONLY the
//     header + 4-tab bar + an empty #egg-tab-content; the chunk fills that
//     container by id via eggSwitchTab in the useEffect(onReady). Unchanged.
//  3. Full-JSX (NEW, default-OFF; gated by chunk flag _reactEggJsxOn, opt-in via
//     ?react_egg_jsx=1 / localStorage crm_react_egg_jsx='1') — props.data PRESENT.
//     React renders ALL 4 tabs (run wizard / urgent / history / config) as real
//     JSX with React-state tab switching. The chunk DOES NOT fill #egg-tab-content
//     (it isn't rendered on this path). Mutating actions call the existing
//     window.app.* handlers, then app.eggRerenderJsx() rebuilds the payload + remounts.
//
// All heavy logic (CSV/XLSX parse, dedup, reconcile, commit/DB writes, Sheets push,
// drag-drop file ingestion) stays in the chunk; this view only wires onClick/onDrop
// to the existing app.* fns. React auto-escapes curly-brace values (no esc() in JSX).
import React, { useEffect, useState } from 'react';

const app = () => window.app || {};
const call = (name, ...args) => { const f = app()[name]; if (typeof f === 'function') return f(...args); };
// Run a mutating app handler, then re-render the JSX island from fresh state.
const callThenRerender = async (name, ...args) => {
    try { const r = call(name, ...args); if (r && typeof r.then === 'function') await r; }
    finally { try { await call('eggRerenderJsx'); } catch (_) { /* noop */ } }
};

const baseBtn = { padding: '12px 20px', background: 'none', border: 'none', fontWeight: 600, cursor: 'pointer' };

const EGG_TABS = [
    { key: 'run', label: 'Run This Week', icon: 'fa-play-circle' },
    { key: 'urgent', label: 'Urgent Orders', icon: 'fa-bolt' },
    { key: 'history', label: 'Run History', icon: 'fa-history' },
    { key: 'config', label: 'Configuration', icon: 'fa-cog' },
];

// ── Phase banner (mirrors the legacy 3-step banner) ─────────────────────────
function PhaseBanner({ phase }) {
    const steps = [
        { n: 1, label: 'Upload' },
        { n: 2, label: 'Reconcile' },
        { n: 3, label: 'Preview & Commit' },
    ];
    return (
        <div className="egg-phase-banner" style={{ display: 'flex', gap: '8px', marginBottom: '20px' }}>
            {steps.map((s) => {
                const active = s.n === phase;
                return (
                    <div key={s.n} style={{
                        flex: 1, padding: '10px', borderRadius: '6px',
                        background: active ? '#fef3c7' : 'var(--gray-100)',
                        borderLeft: `4px solid ${active ? '#f59e0b' : 'var(--gray-300)'}`,
                        color: active ? undefined : 'var(--gray-500)',
                    }}>
                        <strong>Phase {s.n}:</strong> {s.label}
                    </div>
                );
            })}
        </div>
    );
}

// ── RUN TAB ─────────────────────────────────────────────────────────────────
function RunPhase1({ run }) {
    const dropZone = (which, accept, inputId, icon, iconColor, title, info) => {
        const dropFn = which === 'csv' ? 'eggHandleCsvDrop' : 'eggHandleXlsxDrop';
        const inputFn = which === 'csv' ? 'eggHandleCsvInput' : 'eggHandleXlsxInput';
        return (
            <div className="egg-drop-zone"
                style={{ padding: '24px', border: '2px dashed var(--gray-300)', borderRadius: '8px', textAlign: 'center', cursor: 'pointer' }}
                onDragOver={(e) => { e.preventDefault(); e.currentTarget.style.borderColor = '#f59e0b'; }}
                onDragLeave={(e) => { e.currentTarget.style.borderColor = 'var(--gray-300)'; }}
                onDrop={(e) => { e.preventDefault(); e.currentTarget.style.borderColor = 'var(--gray-300)'; callThenRerender(dropFn, e.nativeEvent || e); }}
                onClick={() => { const el = document.getElementById(inputId); if (el) el.click(); }}>
                <i className={`fas ${icon}`} style={{ fontSize: '32px', color: iconColor, marginBottom: '10px' }}></i>
                <div style={{ fontWeight: 600 }}>{title}</div>
                <div style={{ color: 'var(--gray-500)', fontSize: '12px', margin: '6px 0' }}>Drop file here or click to browse</div>
                {info ? (
                    <div style={{ color: '#059669' }}><i className="fas fa-check-circle"></i> {info.name} — {info.rows} rows</div>
                ) : (
                    <div style={{ color: 'var(--gray-400)' }}>No file selected</div>
                )}
                <input type="file" id={inputId} accept={accept} style={{ display: 'none' }}
                    onChange={(e) => callThenRerender(inputFn, e.nativeEvent || e)} />
            </div>
        );
    };

    return (
        <>
            <PhaseBanner phase={1} />
            <div style={{ background: 'white', padding: '24px', borderRadius: '12px', border: '1px solid var(--gray-200)' }}>
                <h3 style={{ marginTop: 0 }}>Upload Invoice Files</h3>
                <p style={{ color: 'var(--gray-500)', fontSize: '13px' }}>Drop both files below. CSV is the Order Tracking Details export, XLSX is the Download Egg Order file.</p>

                <div style={{ margin: '16px 0' }}>
                    <label style={{ fontWeight: 600, display: 'block', marginBottom: '6px' }}>Week Start (Monday)</label>
                    <input type="date" id="egg-week-start" defaultValue={run.weekIso} onChange={(e) => call('eggSetWeekStart', e.target.value)}
                        style={{ padding: '8px 12px', border: '1px solid var(--gray-300)', borderRadius: '6px', fontSize: '14px' }} />
                    <span style={{ color: 'var(--gray-500)', fontSize: '12px', marginLeft: '10px' }}>This identifies which urgent orders to pull for reconciliation.</span>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginTop: '16px' }}>
                    {dropZone('csv', '.csv', 'egg-csv-input', 'fa-file-csv', '#10b981', 'Order Tracking Details (.csv)', run.csv)}
                    {dropZone('xlsx', '.xlsx,.xls', 'egg-xlsx-input', 'fa-file-excel', '#059669', 'Download Egg Order (.xlsx)', run.xlsx)}
                </div>

                <div style={{ marginTop: '24px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <button className="btn secondary" onClick={() => callThenRerender('eggResetRun')}><i className="fas fa-redo"></i> Reset</button>
                    <button className="btn primary" onClick={() => callThenRerender('eggGoToPhase2')} disabled={!run.ready}
                        style={run.ready ? undefined : { opacity: 0.5, cursor: 'not-allowed' }}>
                        Next: Reconcile <i className="fas fa-arrow-right"></i>
                    </button>
                </div>
            </div>
        </>
    );
}

function PushUpCounter({ pushUp }) {
    const { goldSum, kingSum, goldTarget, kingTarget } = pushUp;
    const goldOk = goldSum === goldTarget;
    const kingOk = kingSum === kingTarget;
    return (
        <div style={{ marginTop: '12px', fontSize: '13px' }}>
            <span style={{ color: 'var(--gray-600)' }}>Pushed up so far:</span>
            <span style={{ color: goldOk ? '#059669' : '#b45309', fontWeight: 600, marginLeft: '8px' }}>
                <i className={`fas ${goldOk ? 'fa-check-circle' : 'fa-exclamation-triangle'}`}></i> GOLD {goldSum} / {goldTarget}
            </span>
            <span style={{ color: kingOk ? '#059669' : '#b45309', fontWeight: 600, marginLeft: '12px' }}>
                <i className={`fas ${kingOk ? 'fa-check-circle' : 'fa-exclamation-triangle'}`}></i> KING {kingSum} / {kingTarget}
            </span>
        </div>
    );
}

function RunPhase2({ run }) {
    const { candidateRows, newRowCount, prev } = run;

    // Local state so ticking a row (or typing a top-up) re-renders ONLY this
    // subtree IN PLACE — React reconciles the existing DOM nodes, preserving the
    // user's scroll position. The previous code called eggRerenderJsx() on every
    // tick, which remounted the WHOLE island (container.innerHTML reset + DB
    // re-query) and snapped the page back to the top. We still call the chunk
    // handlers so _eggState stays the source of truth for Phase 3 + commit — we
    // just skip the remount.
    const [excluded, setExcluded] = useState(() => {
        const s = new Set();
        candidateRows.forEach((r) => { if (r.pushed) s.add(r.unique_key); });
        return s;
    });
    const [topUp, setTopUp] = useState({ GOLD: run.topUp.GOLD, KING: run.topUp.KING });

    const toggleRow = (uniqueKey) => {
        call('eggToggleExclude', uniqueKey); // keep _eggState.excludedKeys in sync
        setExcluded((prevSet) => {
            const next = new Set(prevSet);
            if (next.has(uniqueKey)) next.delete(uniqueKey); else next.add(uniqueKey);
            return next;
        });
    };
    const setTopUpVal = (product, val) => {
        call('eggSetLastWeekTopUp', product, val); // keep _eggState in sync
        setTopUp((p) => ({ ...p, [product]: Number(val) || 0 }));
    };

    // Live push-up counter computed from local state (mirrors eggPushUpCounterHtml).
    const goldSum = candidateRows.filter((r) => r.product === 'GOLD' && excluded.has(r.unique_key)).reduce((s, r) => s + Number(r.quantity || 0), 0);
    const kingSum = candidateRows.filter((r) => r.product === 'KING' && excluded.has(r.unique_key)).reduce((s, r) => s + Number(r.quantity || 0), 0);
    const pushUp = { goldSum, kingSum, goldTarget: Number(topUp.GOLD) || 0, kingTarget: Number(topUp.KING) || 0 };

    return (
        <>
            <PhaseBanner phase={2} />

            <div style={{ background: '#fffbeb', border: '1px solid #f59e0b', borderRadius: '8px', padding: '16px', marginBottom: '20px' }}>
                <strong><i className="fas fa-question-circle"></i> Last Week Top-Up</strong>
                <div style={{ color: 'var(--gray-600)', fontSize: '13px', margin: '6px 0 12px 0' }}>
                    Did you add any ad-hoc orders last week that bypassed the normal sales flow? Enter the quantities you added, then tick the rows below that were actually placed last week so they&apos;re excluded from this week&apos;s farm order.
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', maxWidth: '480px' }}>
                    <div>
                        <label style={{ fontWeight: 600, display: 'block', marginBottom: '4px', fontSize: '13px' }}>GOLD (cartons)</label>
                        <input type="number" min="0" step="1" defaultValue={run.topUp.GOLD}
                            onInput={(e) => setTopUpVal('GOLD', e.target.value)}
                            style={{ width: '100%', padding: '8px 12px', border: '1px solid var(--gray-300)', borderRadius: '6px', fontSize: '14px' }} />
                    </div>
                    <div>
                        <label style={{ fontWeight: 600, display: 'block', marginBottom: '4px', fontSize: '13px' }}>KIN / KING (cartons)</label>
                        <input type="number" min="0" step="1" defaultValue={run.topUp.KING}
                            onInput={(e) => setTopUpVal('KING', e.target.value)}
                            style={{ width: '100%', padding: '8px 12px', border: '1px solid var(--gray-300)', borderRadius: '6px', fontSize: '14px' }} />
                    </div>
                </div>
                <PushUpCounter pushUp={pushUp} />
            </div>

            <PrevRunPanel prev={prev} />

            <div style={{ background: 'white', padding: '20px', borderRadius: '12px', border: '1px solid var(--gray-200)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                    <h3 style={{ margin: 0 }}>Orders in this run ({newRowCount} new rows after dedup)</h3>
                    <div>
                        <button className="btn secondary btn-sm" onClick={() => callThenRerender('eggClearExclusions')}>Clear push-ups</button>
                    </div>
                </div>
                <div style={{ color: 'var(--gray-500)', fontSize: '12px', marginBottom: '8px' }}>
                    Tick a row to <strong>push it up</strong> — marks it as already placed last week and excludes it from this week&apos;s farm order.
                </div>
                {candidateRows.length === 0 ? (
                    <div style={{ padding: '16px', textAlign: 'center', color: 'var(--gray-500)' }}>No new orders to reconcile.</div>
                ) : (
                    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                        <thead>
                            <tr style={{ background: 'var(--gray-50)', textAlign: 'left' }}>
                                <th scope="col" style={{ padding: '8px', width: '40px' }}></th>
                                <th scope="col" style={{ padding: '8px' }}>Agent</th>
                                <th scope="col" style={{ padding: '8px' }}>Order Date</th>
                                <th scope="col" style={{ padding: '8px' }}>Order No</th>
                                <th scope="col" style={{ padding: '8px' }}>Product</th>
                                <th scope="col" style={{ padding: '8px' }}>Region</th>
                                <th scope="col" style={{ padding: '8px', textAlign: 'right' }}>Qty</th>
                                <th scope="col" style={{ padding: '8px' }}>Channel</th>
                                <th scope="col" style={{ padding: '8px' }}>Match</th>
                            </tr>
                        </thead>
                        <tbody>
                            {candidateRows.map((r) => {
                                const pushed = excluded.has(r.unique_key);
                                return (
                                <tr key={r.unique_key} style={{ borderTop: '1px solid var(--gray-200)', background: pushed ? '#fef2f2' : undefined }}>
                                    <td style={{ padding: '8px' }}>
                                        <input type="checkbox" checked={pushed} onChange={() => toggleRow(r.unique_key)} />
                                    </td>
                                    <td style={{ padding: '8px' }}>{r.agent_name}</td>
                                    <td style={{ padding: '8px', fontSize: '12px' }}>{r.dateStr}</td>
                                    <td style={{ padding: '8px', fontFamily: 'monospace', fontSize: '12px' }}>{r.order_no}</td>
                                    <td style={{ padding: '8px' }}>{r.product}</td>
                                    <td style={{ padding: '8px' }}>{r.region}</td>
                                    <td style={{ padding: '8px', textAlign: 'right' }}>{r.quantity}</td>
                                    <td style={{ padding: '8px' }}>{r.channel}</td>
                                    <td style={{ padding: '8px' }}>
                                        {pushed
                                            ? <span style={{ background: '#dc2626', color: 'white', padding: '2px 8px', borderRadius: '10px', fontSize: '11px' }}>PUSHED UP</span>
                                            : '-'}
                                    </td>
                                </tr>
                                );
                            })}
                        </tbody>
                    </table>
                )}
            </div>

            <div style={{ marginTop: '20px', display: 'flex', justifyContent: 'space-between' }}>
                <button className="btn secondary" onClick={() => callThenRerender('eggGoToPhase1')}><i className="fas fa-arrow-left"></i> Back to Upload</button>
                <button className="btn primary" onClick={() => callThenRerender('eggGoToPhase3')}>Next: Preview Farm Order <i className="fas fa-arrow-right"></i></button>
            </div>
        </>
    );
}

function PrevRunPanel({ prev }) {
    const [open, setOpen] = useState(true);
    const titleText = prev.hasMeta ? `Last Week's Orders — Week of ${prev.weekLabel}` : `Last Week's Orders`;
    const shownNote = prev.hiddenCount > 0 ? ` • showing last ${prev.shownCount} of ${prev.totalCount}` : '';
    const headerSubtitle = prev.hasMeta
        ? `${prev.count} orders • GOLD ${prev.goldTotal} • KING ${prev.kingTotal}${shownNote}`
        : `No previous run found — this is your first reconcile.`;
    return (
        <div style={{ background: 'white', border: '1px solid var(--gray-200)', borderRadius: '12px', marginBottom: '20px' }}>
            <div onClick={() => setOpen((o) => !o)}
                style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '14px 20px', cursor: 'pointer', userSelect: 'none' }}>
                <div>
                    <strong>{titleText}</strong>
                    <span style={{ marginLeft: '12px', fontSize: '12px', color: 'var(--gray-500)' }}>{headerSubtitle}</span>
                </div>
                <i className="fas fa-chevron-down" style={{ transition: 'transform 0.2s', transform: open ? 'rotate(180deg)' : 'rotate(0deg)', color: 'var(--gray-400)' }}></i>
            </div>
            {open && (
                <div style={{ borderTop: '1px solid var(--gray-200)', overflowX: 'auto' }}>
                    {prev.hasMeta && prev.count > 0 ? (
                        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
                            <thead>
                                <tr style={{ background: 'var(--gray-50)', textAlign: 'left' }}>
                                    <th scope="col" style={{ padding: '6px 8px' }}>Agent</th>
                                    <th scope="col" style={{ padding: '6px 8px' }}>Order Date</th>
                                    <th scope="col" style={{ padding: '6px 8px' }}>Order No</th>
                                    <th scope="col" style={{ padding: '6px 8px' }}>Product</th>
                                    <th scope="col" style={{ padding: '6px 8px' }}>Region</th>
                                    <th scope="col" style={{ padding: '6px 8px', textAlign: 'right' }}>Qty</th>
                                    <th scope="col" style={{ padding: '6px 8px' }}>Channel</th>
                                </tr>
                            </thead>
                            <tbody>
                                {prev.rows.map((r, i) => (
                                    <tr key={i} style={{ borderTop: '1px solid var(--gray-100)' }}>
                                        <td style={{ padding: '6px 8px' }}>{r.agent_name}</td>
                                        <td style={{ padding: '6px 8px', fontSize: '12px' }}>{r.dateStr}</td>
                                        <td style={{ padding: '6px 8px', fontFamily: 'monospace', fontSize: '12px' }}>{r.order_no}</td>
                                        <td style={{ padding: '6px 8px' }}>{r.product}</td>
                                        <td style={{ padding: '6px 8px' }}>{r.region}</td>
                                        <td style={{ padding: '6px 8px', textAlign: 'right' }}>{r.quantity}</td>
                                        <td style={{ padding: '6px 8px' }}>{r.channel}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    ) : (
                        <div style={{ padding: '16px', textAlign: 'center', color: 'var(--gray-500)', fontSize: '13px' }}>
                            Once you commit your first weekly run, last week&apos;s orders will appear here for reference.
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}

function ChannelBreakdown({ channelBreakdown }) {
    const { sections, groupRows } = channelBreakdown;
    return (
        <div>
            {sections.map((sec, si) => (
                <div key={si} style={{ marginBottom: '14px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#f8fafc', padding: '8px 12px', border: '1px solid var(--gray-200)', borderBottom: 'none', borderTopLeftRadius: '6px', borderTopRightRadius: '6px' }}>
                        <strong>{sec.title}</strong>
                        <span style={{ fontSize: '12px', color: 'var(--gray-600)' }}>GOLD {sec.totalGold} • KING {sec.totalKing}</span>
                    </div>
                    <table style={{ width: '100%', borderCollapse: 'collapse', border: '1px solid var(--gray-200)' }}>
                        <thead>
                            <tr style={{ background: 'var(--gray-50)', textAlign: 'left', fontSize: '12px' }}>
                                <th scope="col" style={{ padding: '6px 8px' }}>Agent</th>
                                <th scope="col" style={{ padding: '6px 8px' }}>Order Date</th>
                                <th scope="col" style={{ padding: '6px 8px' }}>Order No</th>
                                <th scope="col" style={{ padding: '6px 8px' }}>Product Code</th>
                                <th scope="col" style={{ padding: '6px 8px' }}>Product</th>
                                <th scope="col" style={{ padding: '6px 8px', textAlign: 'right' }}>Qty</th>
                            </tr>
                        </thead>
                        <tbody>
                            {sec.rows.length === 0 ? (
                                <tr><td colSpan="6" style={{ padding: '10px', textAlign: 'center', color: 'var(--gray-400)', fontSize: '12px' }}>No orders</td></tr>
                            ) : (
                                sec.rows.map((r, ri) => (
                                    <tr key={ri} style={{ borderTop: '1px solid var(--gray-200)' }}>
                                        <td style={{ padding: '6px 8px' }}>{r.agent_name}</td>
                                        <td style={{ padding: '6px 8px', fontSize: '12px' }}>{r.dateStr}</td>
                                        <td style={{ padding: '6px 8px', fontFamily: 'monospace', fontSize: '12px' }}>{r.order_no}</td>
                                        <td style={{ padding: '6px 8px', fontFamily: 'monospace', fontSize: '12px', color: 'var(--gray-500)' }}>{r.product_code}</td>
                                        <td style={{ padding: '6px 8px' }}>{r.product}</td>
                                        <td style={{ padding: '6px 8px', textAlign: 'right' }}>{r.quantity}</td>
                                    </tr>
                                ))
                            )}
                        </tbody>
                    </table>
                </div>
            ))}
            {groupRows.length > 0 && (
                <div style={{ marginBottom: '14px', border: '1px solid #d1fae5', borderRadius: '8px', overflow: 'hidden' }}>
                    <div style={{ background: '#ecfdf5', padding: '8px 12px', fontWeight: 600, fontSize: '13px', color: '#065f46' }}>
                        <i className="fas fa-layer-group"></i> Wholesales Group Summary
                    </div>
                    {groupRows.map((g, gi) => (
                        <div key={gi} style={{ display: 'flex', justifyContent: 'space-between', padding: '7px 12px', borderBottom: '1px solid var(--gray-100)' }}>
                            <span style={{ fontSize: '13px' }}>{g.group}</span>
                            <strong style={{ fontSize: '13px' }}>{g.qty} cartons</strong>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}

function RunPhase3({ run }) {
    const s = run.stats || {};
    const stat = (label, value, color) => (
        <div style={{ background: 'white', padding: '14px', borderRadius: '8px', border: '1px solid var(--gray-200)', textAlign: 'center' }}>
            <div style={{ color: 'var(--gray-500)', fontSize: '11px', textTransform: 'uppercase' }}>{label}</div>
            <div style={{ fontSize: '22px', fontWeight: 700, color }}>{value}</div>
        </div>
    );
    return (
        <>
            <PhaseBanner phase={3} />

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: '12px', marginBottom: '20px' }}>
                {stat('Total Processed', s.totalProcessed || 0)}
                {stat('New After Dedup', s.newAfterDedup || 0, '#059669')}
                {stat('Reconciled (excluded)', s.excluded || 0, '#dc2626')}
                {stat('To Ship', s.finalCount || 0, '#f59e0b')}
                {stat('Total Cartons', s.totalCartons || 0)}
            </div>

            <div style={{ background: 'white', padding: '20px', borderRadius: '12px', border: '1px solid var(--gray-200)', marginBottom: '16px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                    <h3 style={{ margin: 0 }}>Farm Order <span style={{ fontSize: '12px', color: 'var(--gray-500)', fontWeight: 'normal' }}>(editable — fill in JB values manually before sending)</span></h3>
                    <div>
                        <button className="btn secondary btn-sm" onClick={() => call('eggResetFarmOrderText')}><i className="fas fa-undo"></i> Reset</button>
                        <button className="btn secondary btn-sm" onClick={() => call('eggCopyFarmOrder')}><i className="fas fa-copy"></i> Copy</button>
                        <button className="btn secondary btn-sm" onClick={() => call('eggDownloadFarmOrder')}><i className="fas fa-download"></i> Download .txt</button>
                    </div>
                </div>
                <textarea id="egg-farm-order-text" defaultValue={run.farmOrderText}
                    style={{ width: '100%', background: '#f8fafc', padding: '16px', border: '1px solid var(--gray-200)', borderRadius: '6px', fontFamily: 'monospace', fontSize: '13px', lineHeight: 1.6, minHeight: '340px', resize: 'vertical', boxSizing: 'border-box' }} />
                <div style={{ fontSize: '11px', color: 'var(--gray-500)', marginTop: '6px' }}>
                    <i className="fas fa-info-circle"></i> JB numbers default to 0 — edit this text directly to enter the actual JB KING/GOLD cartons before copying to the farm.
                </div>
            </div>

            <div style={{ background: 'white', padding: '20px', borderRadius: '12px', border: '1px solid var(--gray-200)', marginBottom: '16px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                    <h3 style={{ margin: 0 }}>Channel Breakdown (KL / PG)</h3>
                    <div style={{ display: 'flex', gap: '8px' }}>
                        <button className="btn secondary btn-sm" onClick={() => call('eggCopyChannelBreakdown')}><i className="fas fa-copy"></i> Copy</button>
                        <button className="btn secondary btn-sm" onClick={() => call('eggDownloadChannelBreakdownXlsx')}><i className="fas fa-file-excel"></i> Download Excel</button>
                    </div>
                </div>
                <div style={{ color: 'var(--gray-500)', fontSize: '12px', marginBottom: '10px' }}>
                    Rows you pushed up to last week are excluded automatically — they are not in this download.
                </div>
                <ChannelBreakdown channelBreakdown={run.channelBreakdown} />
            </div>

            <div style={{ marginTop: '24px', display: 'flex', justifyContent: 'space-between' }}>
                <button className="btn secondary" onClick={() => callThenRerender('eggGoToPhase2')}><i className="fas fa-arrow-left"></i> Back to Reconcile</button>
                <div>
                    <button className="btn secondary" onClick={() => callThenRerender('eggDiscardRun')}><i className="fas fa-times"></i> Discard Run</button>
                    <button className="btn primary" onClick={() => callThenRerender('eggCommitRun')} style={{ background: '#059669', borderColor: '#059669' }}><i className="fas fa-check"></i> Commit &amp; Save</button>
                </div>
            </div>
        </>
    );
}

function RunTab({ run }) {
    if (run.phase === 2) return <RunPhase2 run={run} />;
    if (run.phase === 3) return <RunPhase3 run={run} />;
    return <RunPhase1 run={run} />;
}

// ── URGENT TAB ───────────────────────────────────────────────────────────────
const URGENT_STATUS_COLOR = {
    pending: '#f59e0b', applied: '#3b82f6', reconciled: '#059669',
    absorbed: '#6b7280', expired: '#6b7280', cancelled: '#6b7280',
};

function UrgentTab({ urgent }) {
    const { filter, activeCount, appliedCount, rows } = urgent;
    const filterBtn = (key, label) => (
        <button className={`btn ${filter === key ? 'primary' : 'secondary'} btn-sm`} onClick={() => callThenRerender('eggSetUrgentFilter', key)}>{label}</button>
    );
    return (
        <>
            <div style={{ background: '#eff6ff', border: '1px solid #3b82f6', borderRadius: '8px', padding: '14px', marginBottom: '16px' }}>
                <strong><i className="fas fa-eye"></i> Watch Board:</strong>{' '}
                {appliedCount} urgent order{appliedCount === 1 ? '' : 's'} currently applied and watching for matching invoices.{' '}
                {activeCount} total active (pending + applied).
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                <div style={{ display: 'flex', gap: '6px' }}>
                    {filterBtn('active', 'Active')}
                    {filterBtn('resolved', 'Resolved')}
                    {filterBtn('stale', 'Stale')}
                    {filterBtn('all', 'All')}
                </div>
                <button className="btn primary" onClick={() => call('eggOpenAddUrgentModal')}><i className="fas fa-plus"></i> Add Urgent Order</button>
            </div>

            <div style={{ background: 'white', padding: '16px', borderRadius: '12px', border: '1px solid var(--gray-200)' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead>
                        <tr style={{ background: 'var(--gray-50)', textAlign: 'left' }}>
                            <th scope="col" style={{ padding: '8px' }}>Week</th>
                            <th scope="col" style={{ padding: '8px' }}>Agent</th>
                            <th scope="col" style={{ padding: '8px' }}>Product</th>
                            <th scope="col" style={{ padding: '8px' }}>Region</th>
                            <th scope="col" style={{ padding: '8px', textAlign: 'right' }}>Qty</th>
                            <th scope="col" style={{ padding: '8px' }}>Channel</th>
                            <th scope="col" style={{ padding: '8px' }}>Status</th>
                            <th scope="col" style={{ padding: '8px' }}>Notes</th>
                            <th scope="col" style={{ padding: '8px' }}>Actions</th>
                        </tr>
                    </thead>
                    <tbody>
                        {rows.length === 0 ? (
                            <tr><td colSpan="9" style={{ textAlign: 'center', padding: '20px', color: 'var(--gray-500)' }}>No urgent orders.</td></tr>
                        ) : (
                            rows.map((u) => (
                                <tr key={u.id} style={{ borderTop: '1px solid var(--gray-200)' }}>
                                    <td style={{ padding: '8px' }}>{u.week_start_date}</td>
                                    <td style={{ padding: '8px' }}>{u.agent_name}</td>
                                    <td style={{ padding: '8px' }}>{u.product}</td>
                                    <td style={{ padding: '8px' }}>{u.region}</td>
                                    <td style={{ padding: '8px', textAlign: 'right' }}>{u.quantity}</td>
                                    <td style={{ padding: '8px' }}>{u.channel}</td>
                                    <td style={{ padding: '8px' }}>
                                        <span style={{ background: URGENT_STATUS_COLOR[u.status] || '#6b7280', color: 'white', padding: '2px 8px', borderRadius: '10px', fontSize: '11px' }}>{u.status}</span>
                                    </td>
                                    <td style={{ padding: '8px', fontSize: '12px', color: 'var(--gray-600)' }}>{u.notes}</td>
                                    <td style={{ padding: '8px' }}>
                                        {u.status === 'pending' && (
                                            <>
                                                <button className="btn-icon" title="Edit" onClick={(e) => { e.stopPropagation(); call('eggEditUrgent', u.id); }}><i className="fas fa-edit"></i></button>
                                                <button className="btn-icon" title="Cancel" onClick={(e) => { e.stopPropagation(); callThenRerender('eggCancelUrgent', u.id); }}><i className="fas fa-times"></i></button>
                                            </>
                                        )}
                                        {u.status === 'applied' && (
                                            <>
                                                <button className="btn-icon" title="Reconcile manually" onClick={(e) => { e.stopPropagation(); call('eggReconcileManually', u.id); }}><i className="fas fa-link"></i></button>
                                                <button className="btn-icon" title="Mark expired" onClick={(e) => { e.stopPropagation(); callThenRerender('eggExpireUrgent', u.id); }}><i className="fas fa-clock"></i></button>
                                            </>
                                        )}
                                    </td>
                                </tr>
                            ))
                        )}
                    </tbody>
                </table>
            </div>
        </>
    );
}

// ── HISTORY TAB ──────────────────────────────────────────────────────────────
function HistoryTab({ history }) {
    const { rows } = history;
    return (
        <div style={{ background: 'white', padding: '16px', borderRadius: '12px', border: '1px solid var(--gray-200)' }}>
            <h3 style={{ marginTop: 0 }}>Run History</h3>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                    <tr style={{ background: 'var(--gray-50)', textAlign: 'left' }}>
                        <th scope="col" style={{ padding: '8px' }}>Run At</th>
                        <th scope="col" style={{ padding: '8px' }}>Week</th>
                        <th scope="col" style={{ padding: '8px' }}>Files</th>
                        <th scope="col" style={{ padding: '8px', textAlign: 'right' }}>Rows</th>
                        <th scope="col" style={{ padding: '8px', textAlign: 'right' }}>Excluded</th>
                        <th scope="col" style={{ padding: '8px', textAlign: 'right' }}>Cartons</th>
                        <th scope="col" style={{ padding: '8px' }}>Run By</th>
                        <th scope="col" style={{ padding: '8px' }}>Actions</th>
                    </tr>
                </thead>
                <tbody>
                    {rows.length === 0 ? (
                        <tr><td colSpan="8" style={{ textAlign: 'center', padding: '20px', color: 'var(--gray-500)' }}>No runs yet.</td></tr>
                    ) : (
                        rows.map((r) => (
                            <tr key={r.id} style={{ borderTop: '1px solid var(--gray-200)' }}>
                                <td style={{ padding: '8px', fontSize: '12px' }}>{r.runAtLabel}</td>
                                <td style={{ padding: '8px' }}>{r.week_start_date}</td>
                                <td style={{ padding: '8px', fontSize: '12px' }}>{r.files}</td>
                                <td style={{ padding: '8px', textAlign: 'right' }}>{r.rows_new}</td>
                                <td style={{ padding: '8px', textAlign: 'right' }}>{r.rows_excluded}</td>
                                <td style={{ padding: '8px', textAlign: 'right' }}>{r.cartons}</td>
                                <td style={{ padding: '8px' }}>{r.run_by}</td>
                                <td style={{ padding: '8px' }}>
                                    <button className="btn-icon" title="View" onClick={() => call('eggViewRun', r.id)}><i className="fas fa-eye"></i></button>
                                    <button className="btn-icon" title="Re-push to Google Sheets" onClick={() => call('eggRePushRunToSheets', r.id)}><i className="fas fa-share-square" style={{ color: '#0ea5e9' }}></i></button>
                                </td>
                            </tr>
                        ))
                    )}
                </tbody>
            </table>
        </div>
    );
}

// ── CONFIG TAB ───────────────────────────────────────────────────────────────
function ConfigTab({ config }) {
    return (
        <>
            <div style={{ background: 'white', padding: '20px', borderRadius: '12px', border: '1px solid var(--gray-200)', marginBottom: '16px' }}>
                <h3 style={{ marginTop: 0 }}>Configuration</h3>
                <p style={{ color: 'var(--gray-500)', fontSize: '13px' }}>
                    Edit the JSON configuration for region rules, product mapping, and wholesale groups.
                </p>
                <textarea id="egg-config-json" className="form-control" defaultValue={config.json}
                    style={{ width: '100%', height: '380px', fontFamily: 'monospace', fontSize: '13px' }} />
                <div style={{ marginTop: '14px', display: 'flex', gap: '8px' }}>
                    <button className="btn primary" onClick={() => callThenRerender('eggSaveConfigFromTextarea')}><i className="fas fa-save"></i> Save</button>
                    <button className="btn secondary" onClick={() => callThenRerender('eggResetConfigToDefault')}><i className="fas fa-undo"></i> Reset to Defaults</button>
                </div>
            </div>
            <div style={{ background: 'white', padding: '20px', borderRadius: '12px', border: '1px solid var(--gray-200)' }}>
                <h3 style={{ marginTop: 0 }}>Wholesales Group Data</h3>
                <p style={{ color: 'var(--gray-500)', fontSize: '13px' }}>
                    Patch historical runs that are missing the wholesales group breakdown (by_group).
                    Safe to run multiple times — only updates runs that are missing the data.
                </p>
                <button className="btn secondary" onClick={() => call('eggResyncGroupData')}>
                    <i className="fas fa-sync-alt"></i> Re-sync Group Data on All Runs
                </button>
                <div id="egg-resync-status" style={{ marginTop: '10px', fontSize: '13px' }}></div>
            </div>
        </>
    );
}

// ── Shared header + tab bar ──────────────────────────────────────────────────
function EggHeader() {
    return (
        <div className="egg-header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '20px' }}>
            <div>
                <h1 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <i className="fas fa-egg" style={{ color: '#f59e0b' }}></i> Egg Purchasing
                </h1>
                <div style={{ color: 'var(--gray-500)', fontSize: '13px', marginTop: '4px' }}>Weekly farm order generation. Super Admin only.</div>
            </div>
            <button className="btn secondary" onClick={() => callThenRerender('eggRefresh')}><i className="fas fa-sync-alt"></i> Refresh</button>
        </div>
    );
}

// ── FULL-JSX view (path 3) ───────────────────────────────────────────────────
function EggFullJsx({ data }) {
    const [activeTab, setActiveTab] = useState(data.activeTab || 'run');
    const switchTab = (key) => {
        setActiveTab(key);
        // Keep _eggState.currentTab in sync (eggSwitchTab early-returns on the JSX
        // path — #egg-tab-content is absent — so this just records the tab).
        try { call('eggSwitchTab', key); } catch (_) { /* noop */ }
    };
    return (
        <div className="egg-purchasing-view" style={{ padding: '24px' }}>
            <EggHeader />
            <div className="egg-tabs" style={{ display: 'flex', gap: '4px', borderBottom: '2px solid var(--gray-200)', marginBottom: '20px' }}>
                {EGG_TABS.map((t) => {
                    const isActive = t.key === activeTab;
                    return (
                        <button key={t.key} className={`egg-tab-btn${isActive ? ' active' : ''}`} data-tab={t.key} onClick={() => switchTab(t.key)}
                            style={{ ...baseBtn, borderBottom: `3px solid ${isActive ? '#f59e0b' : 'transparent'}`, color: isActive ? '#f59e0b' : 'var(--gray-600)' }}>
                            <i className={`fas ${t.icon}`}></i> {t.label}
                        </button>
                    );
                })}
            </div>
            <div id="egg-tab-content-jsx">
                {activeTab === 'run' && <RunTab run={data.run} />}
                {activeTab === 'urgent' && <UrgentTab urgent={data.urgent} />}
                {activeTab === 'history' && <HistoryTab history={data.history} />}
                {activeTab === 'config' && <ConfigTab config={data.config} />}
            </div>
        </div>
    );
}

export function EggPurchasingView({ tabs = [], activeTab = 'run', onReady, data }) {
    try { window.__REACT_EGG_STATE = 'ready'; } catch (_) { /* noop */ }

    // Path 3 — full-JSX render (only when the chunk built & passed a data payload).
    if (data) {
        return <EggFullJsx data={data} />;
    }

    // Path 2 — scaffold-shell (DEFAULT). UNCHANGED: empty #egg-tab-content + the
    // chunk's eggSwitchTab fill via useEffect(onReady).
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
