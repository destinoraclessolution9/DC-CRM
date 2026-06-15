// Mobile Home — scaffold-shell island (view id 'home').
//
// React owns ONLY the greeting header + the #mhome-body container (seeded with
// the chunk's cached-snapshot HTML for instant restore). ALL logic stays in the
// chunk (chunks/script-mobile.js, showMobileHomeView): the 8h snapshot cache,
// multi-tier foreground/background fetches, _composeBody (which fills #mhome-body
// by id), the progressive repaints, and pull-to-refresh — unchanged. The island
// signals onReady from useEffect; the chunk awaits it then runs its fetch +
// _composeBody fills. Bell / avatar call window.app.*.
import React, { useEffect } from 'react';

const app = () => window.app || {};
const call = (name) => { const f = app()[name]; if (typeof f === 'function') f(); };

export function MobileHomeView({ greetWord = 'Hello', userName = 'there', dateStr = '', avatarUrl = '', initBody = '', onReady }) {
    try { window.__REACT_HOME_STATE = 'ready'; } catch (_) { /* noop */ }

    useEffect(() => {
        if (typeof onReady === 'function') {
            try { onReady(); } catch (_) { /* noop */ }
        }
    }, [onReady]);

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
