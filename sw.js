// CRM Service Worker — Phase D performance: stale-while-revalidate for static assets.
// Cache version is keyed by date so a deploy invalidates old caches.
const CACHE_VERSION = 'crm-v2026-06-05-1';
const STATIC_CACHE = `${CACHE_VERSION}-static`;
const RUNTIME_CACHE = `${CACHE_VERSION}-runtime`;

// Same-origin static assets we want pre-warmed. CDN libs (fontawesome, supabase-js)
// are still cached at runtime via the SWR strategy below.
// Precache the .min.* variants — those are what index.html actually loads; the
// non-minified sources are dev-only and would waste ~50% bandwidth on first visit.
const PRECACHE_URLS = [
    '/',
    '/index.html',
    '/styles-fixed.min.css',
    '/styles-mobile.min.css',
    '/styles-mobile-v2.min.css',
    '/styles-theme.min.css',
    '/data.min.js',
    '/auth.min.js',
    '/ui.min.js',
    '/script.min.js',
    '/supabase-init.min.js',
    '/app-init.min.js',
    '/manifest.json',
    '/fonts/local-fonts.css'
];

self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(STATIC_CACHE).then((cache) =>
            // Don't fail install if a single optional asset is missing.
            Promise.all(PRECACHE_URLS.map((u) => cache.add(u).catch(() => null)))
        ).then(() => self.skipWaiting())
    );
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((keys) =>
            Promise.all(
                keys.filter((k) => !k.startsWith(CACHE_VERSION)).map((k) => caches.delete(k))
            )
        ).then(() => self.clients.claim())
    );
});

// Strategy:
//   - Supabase / API / auth requests → network only (never cache user data).
//   - Same-origin JS/CSS/HTML       → stale-while-revalidate (instant load, update in background).
//   - Fonts + 3rd-party static CDN  → cache-first.
self.addEventListener('fetch', (event) => {
    const req = event.request;
    if (req.method !== 'GET') return;

    const url = new URL(req.url);

    // Never cache API / auth / realtime — always go to network.
    if (
        url.hostname.includes('supabase.co') ||
        url.hostname.includes('supabase.io') ||
        url.pathname.startsWith('/rest/') ||
        url.pathname.startsWith('/auth/') ||
        url.pathname.startsWith('/realtime/') ||
        url.pathname.startsWith('/functions/')
    ) {
        return; // default network handling
    }

    // Same-origin static assets — stale-while-revalidate.
    if (url.origin === self.location.origin) {
        event.respondWith(staleWhileRevalidate(req));
        return;
    }

    // Third-party CDN (fonts, fontawesome, papaparse, chart.js, etc.) — cache-first.
    if (
        url.hostname.includes('cdn.jsdelivr.net') ||
        url.hostname.includes('cdnjs.cloudflare.com') ||
        url.hostname.includes('fonts.googleapis.com') ||
        url.hostname.includes('fonts.gstatic.com')
    ) {
        event.respondWith(cacheFirst(req));
    }
});

async function staleWhileRevalidate(req) {
    const cache = await caches.open(RUNTIME_CACHE);
    const cached = await cache.match(req);
    const fetchPromise = fetch(req)
        .then((res) => {
            if (res && res.status === 200 && res.type !== 'opaque') {
                cache.put(req, res.clone()).catch(() => {});
            }
            return res;
        })
        .catch(() => cached);
    return cached || fetchPromise;
}

async function cacheFirst(req) {
    const cache = await caches.open(RUNTIME_CACHE);
    const cached = await cache.match(req);
    if (cached) return cached;
    try {
        const res = await fetch(req);
        if (res && (res.status === 200 || res.type === 'opaque')) {
            cache.put(req, res.clone()).catch(() => {});
        }
        return res;
    } catch (e) {
        return cached || Response.error();
    }
}

// Allow the page to force-refresh the SW (e.g. after a deploy).
self.addEventListener('message', (event) => {
    if (event.data === 'skipWaiting') self.skipWaiting();
});
