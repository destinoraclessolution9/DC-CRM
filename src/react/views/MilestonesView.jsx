// React-island migration — Milestones / 增运九法 + 丁财贵寿四柱 (def-driven grids).
//
// The chunk (showMilestonesView in chunks/script-features2.js) computes the
// nine-method + four-pillar statuses (loading script-performance.js for the DEF
// arrays + compute fns), resolves admin status + subject + admin user list, and
// passes everything as props. Admin Mark/Reset buttons + the user picker call
// window.app.* then reload by re-invoking app.showMilestonesView (re-mounts).

const app = () => window.app || {};
const VP = () => document.getElementById('content-viewport');
const webp = (icon) => (icon || '').replace(/\.png$/i, '.webp');

export function MilestonesView({
    nineDefs = [], pillarDefs = [], nineStatuses = {}, pillarStatuses = {},
    isAdmin = false, subjectUserId = null, viewingOther = false, subjectName = '',
    adminUsers = [], targetUserId = null,
}) {
    window.__REACT_MILESTONES_STATE = 'ready';
    window.__REACT_MILESTONES_ADMIN = !!isAdmin;
    window.__REACT_MILESTONES_NINE = nineDefs.length;

    const reload = () => { const vp = VP(); if (vp) app().showMilestonesView(vp, targetUserId || null); };
    const mark = (k) => app().markMilestoneCompleted(subjectUserId, k).then(reload);
    const reset = (k) => app().resetMilestone(subjectUserId, k).then(reload);

    const AdminBtn = ({ kind, k, on }) => {
        if (!isAdmin) return null;
        const cls = kind === 'pillar' ? 'pc-admin' : 'mc-admin';
        if (on) return <button className={`${cls} reset`} onClick={(e) => { e.stopPropagation(); reset(k); }}>Reset</button>;
        return <button className={cls} onClick={(e) => { e.stopPropagation(); mark(k); }}>Mark ✓</button>;
    };

    return (
        <div className="milestone-view-wrap">
            <div className="milestone-container">
                <div className="milestone-inner">
                    <div className="milestone-header">
                        <h1>增运九法</h1>
                        {viewingOther ? <div className="viewer-note">Viewing: {subjectName}</div> : null}
                    </div>
                    {isAdmin && adminUsers.length ? (
                        <div className="milestone-admin-picker">
                            <span>View:</span>
                            <select value={viewingOther ? String(subjectUserId) : ''} onChange={(e) => { const vp = VP(); if (vp) app().showMilestonesView(vp, e.target.value || null); }}>
                                <option value="">— My own —</option>
                                {adminUsers.map((u) => <option key={u.id} value={String(u.id)}>{u.full_name}</option>)}
                            </select>
                        </div>
                    ) : null}
                    <div className="nine-method-grid">
                        {nineDefs.map((def) => {
                            const on = !!nineStatuses[def.key];
                            return (
                                <div className={`nine-method-card ${on ? 'attended' : ''}`} key={def.key}>
                                    <div className="mc-icon"><picture><source srcSet={webp(def.icon)} type="image/webp" /><img loading="lazy" decoding="async" src={def.icon} alt="" /></picture></div>
                                    <AdminBtn kind="nine" k={def.key} on={on} />
                                </div>
                            );
                        })}
                    </div>
                    <div className="four-pillar-section">
                        <h2>丁财贵寿四柱</h2>
                        <div className="four-pillar-grid">
                            {pillarDefs.map((def) => {
                                const on = !!pillarStatuses[def.key];
                                return (
                                    <div className={`four-pillar-card ${on ? 'owned' : ''}`} key={def.key}>
                                        <div className="pc-icon"><picture><source srcSet={webp(def.icon)} type="image/webp" /><img loading="lazy" decoding="async" src={def.icon} alt="" /></picture></div>
                                        <div className="pc-label">{def.label}</div>
                                        <AdminBtn kind="pillar" k={def.key} on={on} />
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
