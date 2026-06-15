// Success Case Library — card-grid island (Screen 15).
//
// Render-only. The cases chunk (chunks/script-cases.js) owns ALL of:
//   • fetching the six tables (case_studies, users, tags, entity_tags,
//     prospects, customers),
//   • visibility/permission filtering (public · owner · admin),
//   • the search / product / agent / date / tag / visibility filters,
//   • sorting, count-pill text, empty-state toggling,
//   • every mutation (New / View / Edit / Delete) via window.app.*.
//
// It derives one plain card-model per visible case (chunk-side `cardModel()`,
// shared with the legacy `renderCardHtml()` fallback so both paths are
// byte-identical) and mounts this component into #cases-list-cps /
// #cases-list-closed. React auto-escapes every interpolated field — the legacy
// path hand-escaped each one, so the visible output matches exactly.
//
// Cover photos use the same `data-attach-bg` contract as the legacy markup:
// the global MutationObserver in app-init.js (resolveAttachmentImages) resolves
// the signed URL after mount, so no attachment wiring lives here.
import React from 'react';

const app = () => window.app || {};
const stop = (e) => e.stopPropagation();

function MetaPills({ pills }) {
    // Legacy always emits the wrapper div (even when empty) — keep parity.
    return (
        <div className="case-card-meta">
            {(pills || []).map((p, i) => (
                <span className="case-meta-pill" key={i}><i className={`fas ${p.icon}`}></i> {p.text}</span>
            ))}
        </div>
    );
}

function Tags({ tags, extra }) {
    return (
        <div className="case-card-tags">
            {(tags || []).map((t, i) => (
                <span
                    className="case-tag-pill"
                    key={i}
                    style={{ background: `${t.bg}22`, color: t.text, border: `1px solid ${t.bg}55` }}
                >
                    {t.name}
                </span>
            ))}
            {extra > 0 ? <span className="case-tag-pill case-tag-more">+{extra}</span> : null}
        </div>
    );
}

function Card({ m }) {
    const coverStyle = m.coverPhoto ? undefined : { background: m.coverGradient };
    const coverProps = m.coverPhoto ? { 'data-attach-bg': m.coverPhoto } : {};
    const open = () => { const f = app().showCaseStudyDetail; if (f) f(m.id); };
    return (
        <div className={m.type === 'closed' ? 'case-card closed' : 'case-card'} onClick={open}>
            <div className="case-card-cover" {...coverProps} style={coverStyle}>
                {!m.coverPhoto ? <div className="case-card-cover-icon"><i className={`fas ${m.coverIcon}`}></i></div> : null}
                <div className="case-card-cover-badges">
                    <span className={`case-type-chip ${m.type}`}>{m.type === 'cps' ? 'CPS' : 'Closed'}</span>
                    {m.isPublic ? <span className="case-type-chip public"><i className="fas fa-globe"></i> Public</span> : null}
                </div>
                {m.type === 'closed' && m.amountStr ? <div className="case-card-amount">{m.amountStr}</div> : null}
                {m.totalPhotos > 1 ? <div className="case-card-photo-count"><i className="fas fa-images"></i> {m.totalPhotos}</div> : null}
            </div>
            <div className="case-card-body">
                <h3 className="case-card-title">{m.title}</h3>
                {m.type === 'cps' && m.subtitle ? <p className="case-card-subtitle">{m.subtitle}</p> : null}
                <MetaPills pills={m.metaPills} />
                <p className="case-card-desc">{m.desc}</p>
                <div className="case-card-footer">
                    <div className="case-card-agent" title={m.creatorName}>
                        <span className="case-avatar">{m.creatorInitial}</span>
                        <span className="case-agent-name">{m.creatorName}</span>
                    </div>
                    <Tags tags={m.tags} extra={m.extraTagCount} />
                </div>
            </div>
            <div className="case-card-actions" onClick={stop}>
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
        </div>
    );
}

export function CasesGrid({ cards = [], type = 'cps' }) {
    try {
        window.__REACT_CASES_STATE = 'ready';
        window['__REACT_CASES_ROWS_' + String(type).toUpperCase()] = cards.length;
    } catch (_) { /* noop */ }
    return <>{cards.map((m) => <Card m={m} key={m.id} />)}</>;
}
