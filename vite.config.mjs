// Phase 4.0 (#13) — Vite build for the React island(s). Produces ONE
// self-contained IIFE bundle (React + ReactDOM inlined) at react-dist/react-island.js,
// loaded by index.html alongside the legacy `node build.mjs` bundles.
//
// Strangler-fig: this build is ADDITIVE and fully independent of build.mjs — it
// only touches src/react/ → react-dist/. The Vercel buildCommand runs both
// (`node build.mjs && npm run build:react`). Output is committed-safe (no hash);
// cache-busting rides the service-worker CACHE_VERSION like the other bundles.
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
    plugins: [react()],
    build: {
        outDir: 'react-dist',
        // Don't wipe the dir — keeps the committed bundle as a fallback if a
        // future Vercel `vite build` ever fails mid-run (deploy stays safe).
        emptyOutDir: false,
        target: 'es2020',
        minify: 'esbuild',
        lib: {
            entry: 'src/react/main.jsx',
            name: 'CRMReactIsland',
            formats: ['iife'],
            fileName: () => 'react-island.js',
        },
    },
});
