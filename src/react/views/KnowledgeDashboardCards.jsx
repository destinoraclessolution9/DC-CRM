// React-island migration — Knowledge HQ Dashboard card lists (read-only).
//
// The chunk (showKnowledgeDashboard / _kbReloadDashboard in
// chunks/script-knowledge.js) keeps the vanilla quick-capture form (its inputs
// are read by app.saveQuickCapture) and passes the full owner-scoped `entries`
// set + `today` ISO date as props. This island reproduces the EXACT legacy
// buckets (_kbReloadDashboard) + .kb-card / .kb-row markup (_kbRenderList).
// Rows call window.app.showKnowledgeDetail(id) — the detail editor stays vanilla.

const TYPE_ICON = { idea: 'fa-lightbulb', task: 'fa-check-square', case_study: 'fa-flask', note: 'fa-note-sticky', reference: 'fa-bookmark' };
const TYPE_LABEL = { idea: 'Idea', task: 'Task', case_study: 'Case Study', note: 'Note', reference: 'Reference' };
const iconOf = (t) => TYPE_ICON[t] || 'fa-inbox';
const labelOf = (t) => TYPE_LABEL[t] || 'Inbox';
const fmtDate = (iso) => { if (!iso) return ''; try { return new Date(iso).toLocaleDateString(); } catch (_) { return iso; } };
const openDetail = (id) => { if (window.app && window.app.showKnowledgeDetail) window.app.showKnowledgeDetail(id); };

function CardBody({ rows, emptyMsg }) {
    if (!rows.length) return <div className="kb-empty">{emptyMsg}</div>;
    return (
        <>
            {rows.map((r) => (
                <div className="kb-row" key={r.id} onClick={() => openDetail(r.id)}>
                    <i className={`fas ${iconOf(r.type)} kb-row-icon`} title={labelOf(r.type)}></i>
                    <div className="kb-row-main">
                        <div className="kb-row-title">{r.title || '(untitled)'}</div>
                        {r.tags && r.tags.length
                            ? <div className="kb-row-tags">{r.tags.map((t, i) => <span className="kb-tag" key={i}>{t}</span>)}</div>
                            : null}
                    </div>
                    <div className="kb-row-meta">{fmtDate(r.due_date || r.created_at)}</div>
                </div>
            ))}
        </>
    );
}

function Card({ id, icon, title, rows, emptyMsg }) {
    return (
        <div className="kb-card" id={id}>
            <div className="kb-card-h"><i className={`fas ${icon}`}></i> {title} <span className="kb-count">{rows.length}</span></div>
            <div className="kb-card-body"><CardBody rows={rows} emptyMsg={emptyMsg} /></div>
        </div>
    );
}

export function KnowledgeDashboardCards({ entries = [], today = '' }) {
    const all = entries || [];
    const inbox = all.filter((e) => !e.type).sort((a, b) => (b.created_at || '').localeCompare(a.created_at || '')).slice(0, 8);
    const tasks = all.filter((e) => e.type === 'task' && ['draft', 'active', 'waiting'].includes(e.status || 'draft') && e.due_date === today).sort((a, b) => (a.priority || '').localeCompare(b.priority || ''));
    const ideas = all.filter((e) => e.type === 'idea').sort((a, b) => (b.created_at || '').localeCompare(a.created_at || '')).slice(0, 5);
    const cases = all.filter((e) => e.type === 'case_study' && (e.status || '') !== 'done').slice(0, 8);

    window.__REACT_KB_DASH_STATE = 'ready';
    window.__REACT_KB_DASH_ROWS = all.length;

    return (
        <div className="kb-dash-grid">
            <Card id="kb-card-inbox" icon="fa-inbox" title="Inbox" rows={inbox} emptyMsg="No uncategorized entries. Inbox zero." />
            <Card id="kb-card-tasks" icon="fa-check-square" title="Today's Tasks" rows={tasks} emptyMsg="No tasks due today." />
            <Card id="kb-card-ideas" icon="fa-lightbulb" title="Recent Ideas" rows={ideas} emptyMsg="No ideas yet." />
            <Card id="kb-card-cases" icon="fa-flask" title="In-progress Case Studies" rows={cases} emptyMsg="No active case studies." />
        </div>
    );
}
