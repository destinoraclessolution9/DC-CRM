// Phase 4.0/4.1/4.2 (#13) — React beachhead → data layer → first real view.
//
// Strangler-fig entry. Opt-in only (index.html injects this bundle for
// ?react=1 / localStorage crm_react_island=1), so the React bundle stays off
// normal users' loads until a real view is promoted to default.
//
// 4.0/4.1: a demo island (#react-island-root) fetches customers through React
//   Query → the BFF, proving React + TanStack Query + BFF end-to-end in prod.
// 4.2: exposes window.CRMReact.mountCustomersTable(container, opts) — the real
//   Customers table, rendered by chunks/script-prospects.js into the live view
//   (behind a flag, legacy table as fallback). React Query owns the cache, which
//   is what lets Phase 3 retire the bespoke per-view sync for migrated views.
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useCustomers } from './data/useCustomers.js';
import { CustomersTable } from './views/CustomersTable.jsx';
import { ProspectsTable } from './views/ProspectsTable.jsx';

const queryClient = new QueryClient({
    defaultOptions: { queries: { refetchOnWindowFocus: false } },
});

// ── 4.1 demo probe (kept for the existing end-to-end proof) ──────────────────
function CustomersProbe() {
    const { data, isLoading, error } = useCustomers({ limit: 5 });
    if (isLoading) {
        window.__REACT_ISLAND_STATE = 'loading';
        return <span data-react-island="loading" aria-hidden="true">react-island: loading…</span>;
    }
    if (error) {
        window.__REACT_ISLAND_STATE = 'error';
        return <span data-react-island="error" aria-hidden="true">react-island error: {String(error.message)}</span>;
    }
    const rows = (data && data.rows) || [];
    const sample = rows.map((r) => r.full_name).filter(Boolean).slice(0, 3).join(', ');
    window.__REACT_ISLAND_STATE = 'ready';
    window.__REACT_ISLAND_COUNT = data && data.count;
    return (
        <span data-react-island="ready" data-count={(data && data.count) ?? 0} aria-hidden="true">
            react-island: {(data && data.count) ?? 0} customers via React Query + BFF; sample: {sample}
        </span>
    );
}

function ProbeApp() {
    return (
        <QueryClientProvider client={queryClient}>
            <CustomersProbe />
        </QueryClientProvider>
    );
}

function mountProbe() {
    const el = document.getElementById('react-island-root');
    if (!el) return;
    try {
        createRoot(el).render(<ProbeApp />);
        window.__REACT_ISLAND_MOUNTED = true;
        window.__REACT_VERSION = 'bundled-19';
    } catch (e) {
        console.warn('[react-island] probe mount failed (non-fatal):', e && e.message);
    }
}

// ── 4.2 mount API — real Customers table island ──────────────────────────────
// One React root per container element (re-mounts re-render in place). The
// chunk calls this each time renderCustomersTable runs while the React path is
// active; React Query dedups + caches the underlying fetches by query key.
const _roots = new Map();

function mountCustomersTable(container, opts) {
    if (!container) return;
    let root = _roots.get(container);
    if (!root) {
        root = createRoot(container);
        _roots.set(container, root);
    }
    const o = opts || {};
    root.render(
        <QueryClientProvider client={queryClient}>
            <CustomersTable
                params={o.params || {}}
                meta={o.meta || { canReassign: false, agents: [], agentNames: {} }}
                pageSize={o.pageSize || 50}
                onNavigate={o.onNavigate || (() => {})}
            />
        </QueryClientProvider>
    );
    window.__REACT_CUSTOMERS_MOUNTED = true;
}

function unmountCustomersTable(container) {
    const root = container && _roots.get(container);
    if (root) {
        try { root.unmount(); } catch (_) {}
        _roots.delete(container);
    }
}

// ── 4.3 mount API — Prospects table island ───────────────────────────────────
// A fresh `key` per param-set remounts the component so React-local selection
// re-seeds from the chunk's _selectedProspects on page/sort/filter change.
function mountProspectsTable(container, opts) {
    if (!container) return;
    let root = _roots.get(container);
    if (!root) {
        root = createRoot(container);
        _roots.set(container, root);
    }
    const o = opts || {};
    const p = o.params || {};
    const key = `${p.page || 0}|${p.sortField || ''}|${p.sortDir || ''}|${p.q || ''}|${p.gua || ''}|${p.agent || ''}|${p.dormant ? 1 : 0}`;
    root.render(
        <QueryClientProvider client={queryClient}>
            <ProspectsTable
                key={key}
                params={p}
                meta={o.meta || { canReassign: false, canDelete: false, isAdmin: false, isMktMgr: false, agents: [], agentNames: {}, selectedIds: [] }}
                pageSize={o.pageSize || 50}
                onNavigate={o.onNavigate || (() => {})}
            />
        </QueryClientProvider>
    );
    window.__REACT_PROSPECTS_MOUNTED = true;
}

function unmountProspectsTable(container) {
    const root = container && _roots.get(container);
    if (root) {
        try { root.unmount(); } catch (_) {}
        _roots.delete(container);
    }
}

window.CRMReact = Object.assign(window.CRMReact || {}, {
    queryClient,
    mountCustomersTable,
    unmountCustomersTable,
    mountProspectsTable,
    unmountProspectsTable,
});

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mountProbe, { once: true });
} else {
    mountProbe();
}
