// Phase 4.0/4.1 (#13) — React beachhead + first React Query data flow.
//
// Strangler-fig entry: mounts a React island into #react-island-root (if present)
// WITHOUT touching the vanilla window.app shell. Opt-in only (index.html injects
// this bundle for ?react=1 / localStorage crm_react_island=1), so the React
// bundle stays off normal users' loads until a real view migrates (4.2+).
//
// 4.1: the demo island fetches customers through React Query → the BFF
// (/api/customers, server-verified JWT + scope), proving the React + TanStack
// Query + BFF stack end-to-end in production. It renders into the (hidden)
// #react-island-root; verify via window.__REACT_ISLAND_* + the node's text.
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useCustomers } from './data/useCustomers.js';

const queryClient = new QueryClient({
    defaultOptions: { queries: { refetchOnWindowFocus: false } },
});

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
    const sample = rows.map(r => r.full_name).filter(Boolean).slice(0, 3).join(', ');
    window.__REACT_ISLAND_STATE = 'ready';
    window.__REACT_ISLAND_COUNT = data && data.count;
    return (
        <span data-react-island="ready" data-count={(data && data.count) ?? 0} aria-hidden="true">
            react-island: {(data && data.count) ?? 0} customers via React Query + BFF; sample: {sample}
        </span>
    );
}

function App() {
    return (
        <QueryClientProvider client={queryClient}>
            <CustomersProbe />
        </QueryClientProvider>
    );
}

function mount() {
    const el = document.getElementById('react-island-root');
    if (!el) return;
    try {
        createRoot(el).render(<App />);
        window.__REACT_ISLAND_MOUNTED = true;
        window.__REACT_VERSION = 'bundled-19';
    } catch (e) {
        // Never let the island crash the host app.
        console.warn('[react-island] mount failed (non-fatal):', e && e.message);
    }
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mount, { once: true });
} else {
    mount();
}
