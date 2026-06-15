// React-island migration — Knowledge HQ "All Entries" (stateful list/table).
//
// The chunk (showKnowledgeAllEntries in chunks/script-knowledge.js) mounts this
// island into the kb-slot and passes a `loadEntries(query)` callback that wraps
// the exact legacy data access (knowledge_search RPC when searching, otherwise
// AppDataStore.query owner-scoped) — keeping supabase/AppDataStore inside the
// chunk closure. This island owns the chip-filter + search state (search box
// keeps focus while typing), client-filters by chip + sorts, and reproduces the
// legacy .kb-all-bar / .kb-table markup. Rows call window.app.showKnowledgeDetail.
import { useState, useEffect, Fragment } from 'react';

const TYPE_ICON = { idea: 'fa-lightbulb', task: 'fa-check-square', case_study: 'fa-flask', note: 'fa-note-sticky', reference: 'fa-bookmark' };
const TYPE_LABEL = { idea: 'Idea', task: 'Task', case_study: 'Case Study', note: 'Note', reference: 'Reference' };
const STATUS_LABEL = { draft: 'Draft', active: 'Active', waiting: 'Waiting', done: 'Done', archived: 'Archived' };
const iconOf = (t) => TYPE_ICON[t] || 'fa-inbox';
const labelOf = (t) => TYPE_LABEL[t] || 'Inbox';
const statusLabelOf = (s) => STATUS_LABEL[s] || s || '';
const fmtDate = (iso) => { if (!iso) return ''; try { return new Date(iso).toLocaleDateString(); } catch (_) { return iso; } };
const openDetail = (id) => { if (window.app && window.app.showKnowledgeDetail) window.app.showKnowledgeDetail(id); };

const CHIPS = ['all', 'inbox', 'idea', 'task', 'case_study', 'note', 'reference', 'done', 'archived'];
const CHIP_LABEL = (f) =>
    f === 'all' ? 'All' : f === 'inbox' ? 'Inbox' : f === 'case_study' ? 'Case Studies'
    : f === 'idea' ? 'Ideas' : f === 'task' ? 'Tasks' : f === 'note' ? 'Notes'
    : f === 'reference' ? 'References' : f === 'done' ? 'Done' : 'Archived';

function applyChip(rows, f) {
    if (f === 'inbox') return rows.filter((r) => !r.type);
    if (f === 'idea') return rows.filter((r) => r.type === 'idea');
    if (f === 'task') return rows.filter((r) => r.type === 'task');
    if (f === 'case_study') return rows.filter((r) => r.type === 'case_study');
    if (f === 'note') return rows.filter((r) => r.type === 'note');
    if (f === 'reference') return rows.filter((r) => r.type === 'reference');
    if (f === 'done') return rows.filter((r) => r.status === 'done');
    if (f === 'archived') return rows.filter((r) => r.status === 'archived');
    return rows;
}

export function KnowledgeAllEntries({ loadEntries, initialFilter = 'all', onFilterChange }) {
    const [filter, setFilter] = useState(initialFilter || 'all');
    const [query, setQuery] = useState('');
    const [base, setBase] = useState(null); // null = initial loading
    const [err, setErr] = useState(null);   // { kind: 'signin' | 'load', msg? }

    useEffect(() => {
        let cancelled = false;
        const run = async () => {
            try {
                const rows = await (loadEntries ? loadEntries(query) : Promise.resolve([]));
                if (!cancelled) { setErr(null); setBase(rows || []); }
            } catch (e) {
                if (cancelled) return;
                if (e && e.message === 'SIGN_IN') setErr({ kind: 'signin' });
                else setErr({ kind: 'load', msg: (e && e.message) || 'unknown' });
                setBase([]);
            }
        };
        const t = setTimeout(run, query ? 250 : 0); // initial load immediate; typing debounced 250ms
        return () => { cancelled = true; clearTimeout(t); };
    }, [query, loadEntries]);

    const chooseFilter = (f) => { setFilter(f); if (onFilterChange) onFilterChange(f); };

    let rows = applyChip(base || [], filter);
    rows = rows.slice().sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));

    window.__REACT_KB_ALL_STATE = base === null ? 'loading' : (err ? 'error' : 'ready');
    window.__REACT_KB_ALL_ROWS = base === null ? -1 : rows.length;

    let listInner;
    if (base === null) {
        listInner = <div className="kb-empty">Loading…</div>;
    } else if (err && err.kind === 'signin') {
        listInner = <div className="kb-empty">Sign in first.</div>;
    } else if (err && err.kind === 'load') {
        listInner = <div className="kb-empty">Cannot load entries ({err.msg}). Did you run the migration?</div>;
    } else if (!rows.length) {
        listInner = <div className="kb-empty">No entries match.</div>;
    } else {
        listInner = (
            <table className="kb-table">
                <thead><tr><th>Title</th><th>Type</th><th>Tags</th><th>Status</th><th>Created</th><th>Due</th></tr></thead>
                <tbody>
                    {rows.map((r) => (
                        <tr key={r.id} onClick={() => openDetail(r.id)}>
                            <td><i className={`fas ${iconOf(r.type)} kb-row-icon`}></i> {r.title || '(untitled)'}</td>
                            <td>{labelOf(r.type)}</td>
                            <td>{(r.tags || []).map((t, i) => <Fragment key={i}><span className="kb-tag">{t}</span>{i < (r.tags.length - 1) ? ' ' : ''}</Fragment>)}</td>
                            <td><span className={`kb-status kb-status-${r.status || 'draft'}`}>{statusLabelOf(r.status)}</span></td>
                            <td>{fmtDate(r.created_at)}</td>
                            <td>{r.due_date ? fmtDate(r.due_date) : ''}</td>
                        </tr>
                    ))}
                </tbody>
            </table>
        );
    }

    return (
        <>
            <div className="kb-all-bar">
                <div className="kb-chips">
                    {CHIPS.map((f) => (
                        <button key={f} className={`kb-chip ${filter === f ? 'active' : ''}`} onClick={() => chooseFilter(f)}>{CHIP_LABEL(f)}</button>
                    ))}
                </div>
                <div className="kb-search">
                    <i className="fas fa-search"></i>
                    <input type="text" id="kb-search-input" placeholder="Search title + content..." value={query} onInput={(e) => setQuery(e.target.value)} onChange={(e) => setQuery(e.target.value)} />
                </div>
            </div>
            <div id="kb-all-list" className="kb-all-list">{listInner}</div>
        </>
    );
}
