// Mobile Home — scaffold-shell island (view id 'home').
//
// Default path (props.data falsy): React owns ONLY the greeting header + the
// #mhome-body container (seeded with the chunk's cached-snapshot HTML for
// instant restore). ALL logic stays in the chunk (chunks/script-mobile.js,
// showMobileHomeView): the 8h snapshot cache, multi-tier foreground/background
// fetches, _composeBody (which fills #mhome-body by id), the progressive
// repaints, and pull-to-refresh — unchanged. The island signals onReady from
// useEffect; the chunk awaits it then runs its fetch + _composeBody fills.
// Bell / avatar call window.app.*.
//
// Full-JSX path (SW-108, default-off, props.data truthy): the chunk passes a
// control object { body, initBody, registerUpdate, unregister }. We render the
// #mhome-body parts (AI snapshot card, Today's Schedule, Needs Your Attention,
// quick-action tiles) as real JSX from the plain payload and re-render via
// React state when the chunk pushes progressive payloads through registerUpdate
// — never calling the by-id _composeBody fill. Text is JSX auto-escaped;
// interactions call window.app.* handlers.
import React, { useEffect, useState } from 'react';

const app = () => window.app || {};
const call = (name) => { const f = app()[name]; if (typeof f === 'function') f(); };
const callArgs = (name, ...args) => { const f = app()[name]; if (typeof f === 'function') f(...args); };

const runAction = (action) => {
    if (!action) return;
    if (action.kind === 'wa') { callArgs('mhomeWa', action.id, action.phone || ''); return; }
    if (action.kind === 'nav') { callArgs('navigateTo', action.view); return; }
};

// Pending spinner — mirrors the legacy _pendNum marker for the cold partial pass.
function Pend() {
    return <i className="fas fa-spinner fa-spin" style={{ fontSize: '11px', opacity: 0.55 }}></i>;
}

// Loading snapshot card — matches the chunk's _mhomeInitBody default markup so
// the very first JSX paint (before any payload) looks like the scaffold restore.
function LoadingBody() {
    return (
        <div className="mhome-ai-card">
            <div className="mhome-ai-top" style={{ minHeight: '160px' }}>
                <span className="mhome-arc"></span>
                <span className="mhome-orb o1"></span><span className="mhome-orb o2"></span><span className="mhome-orb o3"></span>
                <div className="mhome-ai-head">
                    <div className="mhome-ai-icon"><i className="fas fa-wand-magic-sparkles"></i></div>
                    <div><div className="mhome-ai-title">AI Assistant</div><div className="mhome-ai-sub">Loading today's snapshot…</div></div>
                </div>
            </div>
        </div>
    );
}

function AiCard({ data }) {
    const s = data.stats;
    const allCaught = data.suggestedName === '—';
    return (
        <div className="mhome-ai-card">
            <div className="mhome-ai-top">
                <span className="mhome-arc"></span>
                <span className="mhome-orb o1"></span><span className="mhome-orb o2"></span><span className="mhome-orb o3"></span>
                <span className="mhome-ring r1"></span><span className="mhome-ring r2"></span>
                <span className="mhome-spk s1">✦</span><span className="mhome-spk s2">✧</span><span className="mhome-spk s3">✦</span>
                <span className="mhome-spk s4">✦</span><span className="mhome-spk s5">✧</span><span className="mhome-spk s6">✦</span><span className="mhome-spk s7">✧</span>
                <span className="mhome-dot d1"></span><span className="mhome-dot d2"></span><span className="mhome-dot d3"></span>
                <span className="mhome-cross c1">＋</span><span className="mhome-cross c2">＋</span>
                <div className="mhome-ai-head">
                    <div className="mhome-ai-icon"><i className="fas fa-wand-magic-sparkles"></i></div>
                    <div>
                        <div className="mhome-ai-title">AI Assistant</div>
                        <div className="mhome-ai-sub">Here's what's happening today.</div>
                    </div>
                </div>
                <div className="mhome-ai-stats">
                    <div className="mhome-ai-stat ais-red">
                        <div className="mhome-ai-stat-ico"><i className="far fa-calendar"></i></div>
                        <div className="mhome-ai-stat-num">{s.apptCount}</div>
                        <div className="mhome-ai-stat-lbl">Appointments</div>
                    </div>
                    <div className="mhome-ai-stat ais-purple">
                        <div className="mhome-ai-stat-ico"><i className="fas fa-check"></i></div>
                        <div className="mhome-ai-stat-num">{s.followCount}</div>
                        <div className="mhome-ai-stat-lbl">Follow-ups</div>
                    </div>
                    <div className="mhome-ai-stat ais-pink">
                        <div className="mhome-ai-stat-ico"><i className="fas fa-cake-candles"></i></div>
                        <div className="mhome-ai-stat-num">{data.peoplePending ? <Pend /> : s.bdayCount}</div>
                        <div className="mhome-ai-stat-lbl">Birthday</div>
                    </div>
                    <div className="mhome-ai-stat ais-wood">
                        <div className="mhome-ai-stat-ico"><i className="fas fa-prescription-bottle-medical"></i></div>
                        <div className="mhome-ai-stat-num">{s.refillCount}</div>
                        <div className="mhome-ai-stat-lbl">Refill Due</div>
                    </div>
                </div>
            </div>
            <div className="mhome-ai-bot">
                <div className="mhome-ai-bot-text">
                    <div className="mhome-ai-bot-l1">Suggested next action</div>
                    <div className="mhome-ai-bot-l2">{allCaught ? 'All caught up' : 'Follow up with ' + data.suggestedName}</div>
                </div>
                <button className="mhome-ai-bot-btn" onClick={() => runAction(data.suggestedAction)}>
                    <i className="fab fa-whatsapp"></i> Send Message
                </button>
            </div>
        </div>
    );
}

function ScheduleCard({ rows }) {
    return (
        <div className="mhome-card">
            <div className="mhome-card-head">
                <div className="mhome-card-title"><span className="ico"><i className="far fa-calendar"></i></span> Today's Schedule</div>
                <button className="mhome-card-link" onClick={() => callArgs('navigateTo', 'calendar')}>View Calendar ›</button>
            </div>
            <div className="mhome-sched">
                {rows && rows.length ? rows.map((r, i) => (
                    <div className="mhome-sched-row" key={i} onClick={() => callArgs('navigateTo', 'calendar')}>
                        <div className="mhome-sched-time">{r.time}</div>
                        <div className="mhome-sched-text">
                            <div className="mhome-sched-t1">{r.title}</div>
                            <div className="mhome-sched-t2">{r.sub}</div>
                        </div>
                        <div className="mhome-sched-act"><i className={r.icon}></i></div>
                    </div>
                )) : (
                    <div className="mhome-sched-empty">No activities scheduled today.</div>
                )}
            </div>
        </div>
    );
}

function AttentionCard({ rows }) {
    if (!rows || rows.length === 0) return null;
    return (
        <div className="mhome-card">
            <div className="mhome-card-head">
                <div className="mhome-card-title"><span className="ico purple"><i className="fas fa-list-check"></i></span> Today's Follow-ups</div>
                <button className="mhome-card-link" onClick={() => call('mhomeOpenFollowups')}>View All ›</button>
            </div>
            {rows.map((r, i) => r.type === 'followup' ? (
                <div className="mhome-att-row followup" key={i}>
                    <div className="mhome-att-avatar">{r.initials}</div>
                    <div className="mhome-att-text" style={r.personId != null ? { cursor: 'pointer' } : undefined} onClick={() => { if (r.personId != null) callArgs('mcalOpenPerson', String(r.personId)); }}>
                        <div className="mhome-att-name">{r.name}{r.agent ? <span style={{ fontSize: '10px', color: '#9CA3AF', fontWeight: 400 }}> · {r.agent}</span> : null}</div>
                        <div className="mhome-att-need">{r.need}</div>
                        <div className="mhome-att-sub">{r.sub}</div>
                    </div>
                    <button className="mhome-att-btn wa" onClick={(e) => { e.stopPropagation(); callArgs('mhomeFollowupWa', r.draftId, String(r.personId), r.waPhone || '', !!r.isCustomer); }}>
                        <i className="fab fa-whatsapp"></i> WhatsApp
                    </button>
                </div>
            ) : (
                <div className="mhome-att-row birthday" key={i}>
                    <div className="mhome-att-avatar"><i className="fas fa-gift"></i></div>
                    <div className="mhome-att-text">
                        <div className="mhome-att-name">{r.name}{r.isAgent ? <span style={{ fontSize: '10px', color: 'var(--gray-400)' }}> Agent</span> : null}</div>
                        <div className="mhome-att-need">{r.need}</div>
                        <div className="mhome-att-sub">{r.sub}</div>
                    </div>
                    <button className="mhome-att-btn wish" onClick={() => callArgs('mhomeWa', r.waId, r.waPhone || '')}>
                        <i className="fas fa-heart"></i> Send Wish
                    </button>
                </div>
            ))}
        </div>
    );
}

function Tiles({ tiles, peoplePending }) {
    return (
        <div className="mhome-tiles">
            <button className="mhome-tile red" onClick={() => call('mhomeOpenFollowups')}>
                <div className="mhome-tile-ico"><i className="fas fa-user-clock"></i></div>
                <div className="mhome-tile-lbl">Overdue Follow-ups</div>
                <div className="mhome-tile-num">{tiles.overdueFollowups}</div>
                <div className="mhome-tile-arrow"><i className="fas fa-chevron-right"></i></div>
            </button>
            <button className="mhome-tile wood" onClick={() => call('mhomeOpenRefills')}>
                <div className="mhome-tile-ico"><i className="fas fa-prescription-bottle-medical"></i></div>
                <div className="mhome-tile-lbl">Refills Due</div>
                <div className="mhome-tile-num">{tiles.refillCount}</div>
                <div className="mhome-tile-arrow"><i className="fas fa-chevron-right"></i></div>
            </button>
        </div>
    );
}

// Full real-JSX home body. Renders the greeting (same as scaffold) + the
// #mhome-body parts from the live payload (React-state, pushed by the chunk).
function FullJsxHome({ greetWord, userName, dateStr, avatarUrl, control, onReady }) {
    // `body` is the current plain payload; null = still loading (show the
    // snapshot card). Subscribes to the chunk's push channel for progressive
    // re-renders.
    const [body, setBody] = useState(control && control.body ? control.body : null);

    try { window.__REACT_HOME_STATE = 'ready'; window.__REACT_HOME_JSX = true; } catch (_) { /* noop */ }

    useEffect(() => {
        let alive = true;
        if (control && typeof control.registerUpdate === 'function') {
            control.registerUpdate((payload) => { if (alive) setBody(payload || null); });
        }
        if (typeof onReady === 'function') {
            try { onReady(); } catch (_) { /* noop */ }
        }
        return () => {
            alive = false;
            if (control && typeof control.unregister === 'function') {
                try { control.unregister(); } catch (_) { /* noop */ }
            }
        };
    }, [control, onReady]);

    return (
        <div className="mhome">
            <div className="mhome-greet">
                <div className="mhome-greet-text">
                    <p className="mhome-greet-hi">{greetWord}, <span className="name">{userName}</span> <span className="wave">👋</span></p>
                    <div className="mhome-greet-date">{dateStr}</div>
                </div>
                <div className="mhome-greet-actions">
                    <div className="mhome-bell" onClick={() => call('toggleNotifPanel')} role="button" aria-label="Notifications">
                        <i className="far fa-bell"></i><span className="dot"></span>
                    </div>
                    <div className="mhome-avatar" onClick={() => call('openMobileDrawer')} role="button" aria-label="Profile" style={{ backgroundImage: `url('${avatarUrl}')` }}></div>
                </div>
            </div>
            {/* Keep id="mhome-body" so the chunk's "view still mounted" guard
                (getElementById('mhome-body')) stays valid in the JSX path. */}
            <div id="mhome-body">
                {body ? (
                    <>
                        <AiCard data={body} />
                        <ScheduleCard rows={body.scheduleRows} />
                        <AttentionCard rows={body.attention} />
                        <Tiles tiles={body.tiles} peoplePending={body.peoplePending} />
                    </>
                ) : (
                    <LoadingBody />
                )}
            </div>
        </div>
    );
}

export function MobileHomeView({ greetWord = 'Hello', userName = 'there', dateStr = '', avatarUrl = '', initBody = '', onReady, data }) {
    // Full-JSX opt-in path (SW-108, default-off). The chunk only passes `data`
    // when _reactHomeJsxOn() is true and the payload builds; otherwise data is
    // undefined and we fall through to the unchanged scaffold branch below.
    const isJsx = !!data;

    try { window.__REACT_HOME_STATE = 'ready'; } catch (_) { /* noop */ }

    // Rules of Hooks: this hook must run on EVERY render of MobileHomeView, in the
    // same order, regardless of which branch the `data` prop selects — otherwise
    // toggling `data` truthy↔falsy across re-renders throws "Rendered fewer/more
    // hooks". We therefore call useEffect unconditionally here and branch INSIDE
    // it: in the JSX path FullJsxHome owns the onReady signal, so we skip it to
    // avoid firing onReady twice; in the scaffold path we fire it as before.
    useEffect(() => {
        if (isJsx) return;
        if (typeof onReady === 'function') {
            try { onReady(); } catch (_) { /* noop */ }
        }
    }, [isJsx, onReady]);

    if (isJsx) {
        return (
            <FullJsxHome
                greetWord={greetWord}
                userName={userName}
                dateStr={dateStr}
                avatarUrl={avatarUrl}
                control={data}
                onReady={onReady}
            />
        );
    }

    // ── Existing scaffold branch — markup UNCHANGED ──────────────────────────
    return (
        <div className="mhome">
            <div className="mhome-greet">
                <div className="mhome-greet-text">
                    <p className="mhome-greet-hi">{greetWord}, <span className="name">{userName}</span> <span className="wave">👋</span></p>
                    <div className="mhome-greet-date">{dateStr}</div>
                </div>
                <div className="mhome-greet-actions">
                    <div className="mhome-bell" onClick={() => call('toggleNotifPanel')} role="button" aria-label="Notifications">
                        <i className="far fa-bell"></i><span className="dot"></span>
                    </div>
                    <div className="mhome-avatar" onClick={() => call('openMobileDrawer')} role="button" aria-label="Profile" style={{ backgroundImage: `url('${avatarUrl}')` }}></div>
                </div>
            </div>
            <div id="mhome-body" dangerouslySetInnerHTML={{ __html: initBody }} />
        </div>
    );
}
