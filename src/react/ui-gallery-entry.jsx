// Phase 4 — standalone entry for the UI gallery. Built into its OWN bundle
// (react-dist/ui-gallery.bundle.js) by esbuild, NOT imported by main.jsx — so
// nothing here ships in the production react-island.js. Mock data only; no auth,
// no network. Loaded by /ui-gallery.html.
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Gallery } from './ui/Gallery.jsx';

const qc = new QueryClient({ defaultOptions: { queries: { refetchOnWindowFocus: false, retry: false } } });

function mount() {
    const el = document.getElementById('gallery-root');
    if (!el) return;
    createRoot(el).render(
        <QueryClientProvider client={qc}><Gallery /></QueryClientProvider>
    );
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount, { once: true });
else mount();
