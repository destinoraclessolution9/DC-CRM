// Calendar — scaffold-shell island (view id 'calendar'/'month'). HIGHEST-RISK view.
//
// React owns ONLY the large static shell (welcome banner + header toolbar +
// grid containers + widgets + today/birthdays/refills sections + right glance/
// quick-action panel). EVERY stable-id container is left empty for the chunk to
// fill. ALL logic stays in the chunk (chunks/script-calendar.js): month grid
// render, optimistic badges, inline invite accept/reject, SWR snapshot, today's
// activities, birthdays, refills — unchanged (byte-identical behavior). The
// island signals onReady from useEffect (post-commit); the chunk awaits it then
// runs renderCalendar()/renderTodayActivities()/secondary fills by id. Toolbar +
// quick-action buttons call window.app.* exactly as the legacy markup.
import React, { useEffect } from 'react';

const app = () => window.app || {};
const call = (name, ...args) => { const f = app()[name]; if (typeof f === 'function') f(...args); };
const scrollTo = (id) => { const el = document.getElementById(id); if (el) el.scrollIntoView({ behavior: 'smooth' }); };

const badge = (id, bg) => ({ id, style: { width: '30px', height: '30px', borderRadius: '50%', background: bg, color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 'bold' } });

function Glance({ icon, color, countId, label, scrollId }) {
    return (
        <div className="glance-stat" onClick={() => scrollTo(scrollId)}>
            <div className={`glance-icon ${color}`}><i className={`fas ${icon}`}></i></div>
            <div className="glance-info">
                <div className="glance-count" id={countId}>—</div>
                <div className="glance-label">{label}</div>
            </div>
        </div>
    );
}

function QuickAction({ onClickName, icon, color, title, sub }) {
    return (
        <div className="quick-action-row" onClick={() => call(onClickName)}>
            <div className="qa-left">
                <div className={`qa-icon ${color}`}><i className={`fas ${icon}`}></i></div>
                <div><div className="qa-title">{title}</div><div className="qa-sub">{sub}</div></div>
            </div>
            <i className="fas fa-chevron-right qa-arrow"></i>
        </div>
    );
}

// Shared static shell (welcome banner + header toolbar + section headers +
// glance / pipeline / quick-action panel). Every dynamic part stays a stable-id
// container that the chunk fills (grid / days-header / today / birthdays /
// refills / glance counts / pending widgets) — the privacy-scoped grid render +
// name-masking live in the chunk and are reused verbatim by BOTH the scaffold
// path and the full-JSX path. The only difference between the two paths is the
// source of greeting / userName / userEmail.
function CalendarShell({ greeting, userName, userEmail }) {
    return (
        <div className="calendar-page-layout">
            <div className="calendar-main">
                <div className="cal-welcome-banner">
                    <div className="cal-welcome-text">
                        <h2>{greeting}, <span className="welcome-name">{userName}!</span> 👋</h2>
                        <p>Stay on top of your schedule and never miss an important follow-up.</p>
                        {userEmail ? (
                            <p className="cal-account-line" style={{ marginTop: '6px', fontSize: '12px', color: '#9ca3af' }}>
                                Logged in as <strong style={{ color: '#6b7280' }}>{userEmail}</strong> —{' '}
                                <a href="#" onClick={(e) => { e.preventDefault(); call('switchAccount'); }} style={{ color: '#dc2626', fontWeight: 600, textDecoration: 'underline', cursor: 'pointer' }}>not you? Switch account</a>
                            </p>
                        ) : null}
                    </div>
                    <div className="cal-welcome-illus" aria-hidden="true">📅</div>
                </div>

                <div className="calendar-view-container">
                    <div className="calendar-header-toolbar">
                        <div className="calendar-title-nav">
                            <h2 id="calendar-month-title" onClick={() => call('openMonthPicker')} style={{ cursor: 'pointer' }} title="Click to select month">Month Year</h2>
                            <div className="nav-arrows">
                                <button className="btn-nav" onClick={() => call('goToPrevious')} aria-label="Previous month"><i className="fas fa-chevron-left" aria-hidden="true"></i></button>
                                <button className="btn-nav" onClick={() => call('goToNext')} aria-label="Next month"><i className="fas fa-chevron-right" aria-hidden="true"></i></button>
                            </div>
                            <button className="btn secondary btn-sm" onClick={() => call('goToToday')}>Today</button>
                        </div>
                        <div className="calendar-controls">
                            <div className="cal-controls-pill">
                                <button className="cal-icon-btn cal-btn-filter" onClick={() => call('openCalendarFilterModal')} title="Filter"><i className="fas fa-search"></i></button>
                                <button className="cal-icon-btn cal-btn-wa" onClick={() => call('openShareCpsIntakeLinkModal')} title="Share CPS Intake Link"><i className="fab fa-whatsapp"></i></button>
                                <button className="cal-icon-btn cal-btn-add" onClick={() => call('openActivityModal')} title="Quick Add Activity"><i className="fas fa-plus"></i></button>
                            </div>
                        </div>
                    </div>

                    <div className="calendar-monthly-wrapper">
                        <div className="calendar-days-header" id="calendar-days-header"></div>
                        <div className="calendar-grid-main" id="calendar-grid"></div>
                    </div>

                    <div id="pending-cps-intakes" style={{ display: 'none', marginTop: '16px' }}></div>
                    <div id="follow-up-reminders" style={{ display: 'none' }}></div>
                    <div id="pending-solutions-widget" style={{ display: 'none' }}></div>

                    <div className="today-activities-section">
                        <h3>📅 TODAY'S ACTIVITIES</h3>
                        <div className="activity-cards-grid" id="today-activities-grid"></div>
                    </div>

                    <div className="birthday-section">
                        <h3>🎂 BIRTHDAY REMINDERS</h3>
                        <div className="birthday-columns">
                            <div className="birthday-col">
                                <div id="bday-today-header" style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '15px' }}>
                                    <div className="bday-badge today" {...badge(undefined, '#3b82f6')}>0</div>
                                    <h4 style={{ margin: 0 }}>Today</h4>
                                </div>
                                <div className="bday-list" id="bday-today-list"></div>
                            </div>
                            <div className="birthday-col">
                                <div id="bday-upcoming-header" style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '15px' }}>
                                    <div className="bday-badge upcoming" {...badge(undefined, '#f59e0b')}>0</div>
                                    <h4 style={{ margin: 0 }}>Upcoming (Next 2 Days)</h4>
                                </div>
                                <div className="bday-list" id="bday-upcoming-list"></div>
                            </div>
                        </div>
                    </div>

                    <div className="birthday-section">
                        <h3>💊 HEALTH PRODUCT REFILLS</h3>
                        <div className="birthday-columns">
                            <div className="birthday-col">
                                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '15px' }}>
                                    <div className="bday-badge" {...badge('refill-overdue-badge', '#dc2626')}>0</div>
                                    <h4 style={{ margin: 0 }}>Overdue</h4>
                                </div>
                                <div className="bday-list" id="refill-overdue-list"></div>
                            </div>
                            <div className="birthday-col">
                                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '15px' }}>
                                    <div className="bday-badge" {...badge('refill-soon-badge', '#f59e0b')}>0</div>
                                    <h4 style={{ margin: 0 }}>Due This Week</h4>
                                </div>
                                <div className="bday-list" id="refill-soon-list"></div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            <aside className="cal-right-panel" id="cal-right-panel">
                <div className="cal-panel-card">
                    <h4>Today at a Glance</h4>
                    <Glance icon="fa-bell" color="pink" countId="glance-followup-count" label="Follow-up Reminders" scrollId="follow-up-reminders" />
                    <Glance icon="fa-calendar-check" color="green" countId="glance-activity-count" label="Activities" scrollId="today-activities-grid" />
                    <Glance icon="fa-cake-candles" color="amber" countId="glance-bday-count" label="Birthdays" scrollId="bday-today-list" />
                    <Glance icon="fa-clock" color="blue" countId="glance-upcoming-count" label="Upcoming" scrollId="bday-upcoming-list" />
                </div>

                <div className="cal-pipeline-card">
                    <h4>Keep your pipeline moving forward!</h4>
                    <p>Add activities, follow-ups and never miss a customer touchpoint.</p>
                    <button className="btn-add-activity" onClick={() => call('openActivityModal')}><i className="fas fa-plus"></i> Add Activity</button>
                </div>

                <div className="cal-panel-card">
                    <h4>Quick Actions</h4>
                    <QuickAction onClickName="openFollowUpModal" icon="fa-bell" color="pink" title="Add Follow-up" sub="Schedule a follow-up" />
                    <QuickAction onClickName="openActivityModal" icon="fa-calendar-plus" color="green" title="Add Activity" sub="Log a new activity" />
                    <QuickAction onClickName="openReminderModal" icon="fa-bookmark" color="amber" title="Add Reminder" sub="Set a reminder" />
                    <QuickAction onClickName="openCreateProspectModal" icon="fa-user-plus" color="purple" title="Add Prospect" sub="Create new prospect" />
                </div>
            </aside>
        </div>
    );
}

// ── Full real-JSX render (props.data present, default-OFF flag _reactCalJsxOn).
// Renders the static chrome from props.data (greeting/userName/userEmail) as
// real React with auto-escaping. The month/week/day GRID + every dynamic list
// remain stable-id containers inside CalendarShell, so the chunk's by-id fills
// (privacy-scoped queryAdvanced + name-masking) run identically — this path
// never calls the legacy by-id switch fns. Fires onReady from its own useEffect
// (post-commit) so the chunk awaits the committed shell before filling.
function CalendarFullJsx({ data, onReady }) {
    try { window.__REACT_CAL_STATE = 'ready-jsx'; } catch (_) { /* noop */ }

    useEffect(() => {
        if (typeof onReady === 'function') {
            try { onReady(); } catch (_) { /* noop */ }
        }
    }, [onReady]);

    const greeting = data.greeting || 'Hello';
    const userName = data.userName || 'there';
    const userEmail = data.userEmail || '';
    return <CalendarShell greeting={greeting} userName={userName} userEmail={userEmail} />;
}

// Scaffold-shell render (UNCHANGED default — props.data absent). Identical to
// the original CalendarView body: signals onReady from useEffect, renders the
// shell from the greeting/userName/userEmail props, chunk fills the by-id
// containers. Extracted into its own component so each render path keeps a
// single, consistent set of hooks (no conditional-hook rule violation).
function CalendarScaffold({ greeting, userName, userEmail, onReady }) {
    try { window.__REACT_CAL_STATE = 'ready'; } catch (_) { /* noop */ }

    useEffect(() => {
        if (typeof onReady === 'function') {
            try { onReady(); } catch (_) { /* noop */ }
        }
    }, [onReady]);

    return <CalendarShell greeting={greeting} userName={userName} userEmail={userEmail} />;
}

export function CalendarView({ greeting = 'Hello', userName = 'there', userEmail = '', data, onReady }) {
    // NEW full-JSX path: when the chunk supplied a built payload (flag ON), the
    // FullJsx component owns the static chrome from props.data. The scaffold
    // branch is UNCHANGED for the default (flag-OFF / data absent) path.
    if (data) {
        return <CalendarFullJsx data={data} onReady={onReady} />;
    }
    return <CalendarScaffold greeting={greeting} userName={userName} userEmail={userEmail} onReady={onReady} />;
}
