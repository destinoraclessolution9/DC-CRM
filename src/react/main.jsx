// Phase 4.0 (#13) — React beachhead. The strangler-fig entry point: mounts a
// minimal React island into #react-island-root (if present) WITHOUT touching the
// rest of the vanilla `window.app` shell. This proves React + Vite render in
// production inside the existing app, and is the template that migrated views
// (customers / prospects / reports) will follow in 4.2+.
//
// Today it renders an inert, hidden marker + sets window.__REACT_ISLAND_MOUNTED
// so the mount can be verified without any visible/behavioural change.
import { createRoot } from 'react-dom/client';

function IslandMarker() {
    return (
        <span data-react-island="active" aria-hidden="true" style={{ display: 'none' }}>
            react-island-active
        </span>
    );
}

function mount() {
    const el = document.getElementById('react-island-root');
    if (!el) return;
    try {
        createRoot(el).render(<IslandMarker />);
        window.__REACT_ISLAND_MOUNTED = true;
        window.__REACT_VERSION = (window.React && window.React.version) || 'bundled-19';
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
