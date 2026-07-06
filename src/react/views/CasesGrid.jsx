// Success Case Library — table island (Screen 15).
//
// Render-only. The cases chunk (chunks/script-cases.js) owns ALL of:
//   • fetching the six tables (case_studies, users, tags, entity_tags,
//     prospects, customers),
//   • visibility/permission filtering (public · owner · admin),
//   • dropping empty-detail CPS shells,
//   • the search / product / agent / date / tag / visibility filters,
//   • sorting, count-pill text, empty-state toggling,
//   • every mutation (New / View / Edit / Delete) via window.app.*.
//
// PRIVACY: this is a cross-agent STUDY surface. The chunk-side cardModel()
// deliberately does NOT emit the prospect/customer name — CPS rows carry an
// anonymized profile label (gender · age · occupation) instead. Nothing here
// renders an identity field; there is none in the model to render.
//
// It derives one plain card-model per visible case and mounts this component
// into #cases-list-cps / #cases-list-closed. React auto-escapes every
// interpolated field.
import React from 'react';

const app = () => window.app || {};
const stop = (e) => e.stopPropagation();

function VisBadge({ isPublic }) {
    return isPublic
        ? <span className="cases-vis cases-vis-public"><i className="fas fa-globe"></i> Public</span>
        : <span className="cases-vis cases-vis-private"><i className="fas fa-lock"></i> Private</span>;
}

function Agent({ m }) {
    return (
        <div className="cases-td-agent" title={m.creatorName}>
            <span className="case-avatar">{m.creatorInitial}</span>
            <span className="case-agent-name">{m.creatorName}</span>
        </div>
    );
}

function Actions({ m }) {
    return (
        <div className="cases-td-actions" onClick={stop}>
            <button className="btn-icon" title="View" onClick={() => { const f = app().showCaseStudyDetail; if (f) f(m.id); }}>
                <i className="fas fa-eye"></i>
            </button>
            {m.canEdit ? (
                <>
                    <button className="btn-icon" title="Edit" onClick={() => { const f = app().openCaseStudyModal; if (f) f(m.id); }}>
                        <i className="fas fa-pen"></i>
                    </button>
                    <button className="btn-icon text-danger" title="Delete" onClick={() => { const f = app().deleteCaseStudy; if (f) f(m.id); }}>
                        <i className="fas fa-trash"></i>
                    </button>
                </>
            ) : null}
        </div>
    );
}

function CpsRow({ m }) {
    const open = () => { const f = app().showCaseStudyDetail; if (f) f(m.id); };
    return (
        <tr className="cases-row" onClick={open}>
            <td className="cases-td-profile">
                <span className="cases-anon-icon"><i className="fas fa-user-secret"></i></span>
                <span className="cases-anon-label">{m.profileLabel || 'CPS Prospect'}</span>
            </td>
            <td>{m.method ? <span className="cases-chip"><i className="fas fa-paper-plane"></i> {m.method}</span> : <span className="cases-muted">—</span>}</td>
            <td>{m.referral ? <span className="cases-chip"><i className="fas fa-people-arrows"></i> {m.referral}</span> : <span className="cases-muted">—</span>}</td>
            <td className="cases-td-story"><span className="cases-story-clamp">{m.story || '—'}</span></td>
            <td><Agent m={m} /></td>
            <td><VisBadge isPublic={m.isPublic} /></td>
            <td><Actions m={m} /></td>
        </tr>
    );
}

function ClosedRow({ m }) {
    const open = () => { const f = app().showCaseStudyDetail; if (f) f(m.id); };
    return (
        <tr className="cases-row" onClick={open}>
            <td className="cases-td-title">{m.title}</td>
            <td>{m.product ? <span className="cases-chip"><i className="fas fa-box"></i> {m.product}</span> : <span className="cases-muted">—</span>}</td>
            <td className="cases-td-amount">{m.amountStr || <span className="cases-muted">—</span>}</td>
            <td className="cases-td-date">{m.closedDate || <span className="cases-muted">—</span>}</td>
            <td className="cases-td-story"><span className="cases-story-clamp">{m.story || '—'}</span></td>
            <td><Agent m={m} /></td>
            <td><VisBadge isPublic={m.isPublic} /></td>
            <td><Actions m={m} /></td>
        </tr>
    );
}

export function CasesGrid({ cards = [], type = 'cps' }) {
    try {
        window.__REACT_CASES_STATE = 'ready';
        window['__REACT_CASES_ROWS_' + String(type).toUpperCase()] = cards.length;
    } catch (_) { /* noop */ }

    const isCps = type !== 'closed';
    const head = isCps
        ? ['Profile', 'Method', 'Referral', 'Invitation Story', 'Agent', 'Visibility', '']
        : ['Case', 'Product', 'Amount', 'Closed', 'Story', 'Agent', 'Visibility', ''];

    return (
        <div className="cases-table-scroll">
            <table className={`cases-table ${isCps ? 'cases-table-cps' : 'cases-table-closed'}`}>
                <thead>
                    <tr>{head.map((h, i) => <th key={i} className={h === '' ? 'cases-th-actions' : ''}>{h}</th>)}</tr>
                </thead>
                <tbody>
                    {cards.map((m) => isCps ? <CpsRow m={m} key={m.id} /> : <ClosedRow m={m} key={m.id} />)}
                </tbody>
            </table>
        </div>
    );
}
