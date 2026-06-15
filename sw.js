// CRM Service Worker — explicit offline strategy (#27).
//
// ┌─────────────────────────────────────────────────────────────────────────┐
// │ Fetch strategy summary                                                  │
// ├──────────────────────────┬──────────────────────────────────────────────┤
// │ Supabase / auth / RT     │ Network-only. Never cache user data.         │
// │ Same-origin navigation   │ Network-first → /offline.html fallback.      │
// │ Hashed static assets     │ Cache-first. Content-addressed = immutable.  │
// │   (*.abc12345.min.js/css)│                                              │
// │ Other same-origin assets │ Stale-while-revalidate. Serve cached         │
// │   (images, fonts, etc.)  │ immediately, update in background.           │
// │ 3rd-party CDN assets     │ Cache-first (fonts, fontawesome, papaparse). │
// └──────────────────────────┴──────────────────────────────────────────────┘
//
// Install precache: shell assets that must be available offline (non-hashed,
//   stable filenames). Hashed bundles are NOT listed here — they get SWR-cached
//   on first request, which is equivalent to cache-first for content-addressed
//   URLs (the hash changes → new URL → new cache entry).
//
// #15 SW cleanup: see sw-init.js for the legacy-SW unregistration logic.
//   sw-init.js is loaded as <script defer> from index.html.
//
// Cache version: bump CACHE_VERSION on each deploy to expire old caches.
const CACHE_VERSION = 'crm-v2026-06-15-52';
const STATIC_CACHE  = `${CACHE_VERSION}-static`;
const RUNTIME_CACHE = `${CACHE_VERSION}-runtime`;

// Only precache assets that are truly stable (no content hash in the filename).
// Hashed bundles (script.*.min.js, data.*.min.js, styles-*.*.min.css, chunks/*)
// are served with long Cache-Control max-age by Vercel and get SWR-cached on
// first request. Adding them here would just race the build hash update.
const PRECACHE_URLS = [
    '/',
    '/index.html',
    '/offline.html',       // #27 — navigation fallback when offline
    '/manifest.json',
    '/fonts/local-fonts.css',
];

self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(STATIC_CACHE)
            .then((cache) =>
                // Soft install — don't fail if one optional asset is missing.
                Promise.all(PRECACHE_URLS.map((u) => cache.add(u).catch(() => null)))
            )
            .then(() => self.skipWaiting())
    );
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys()
            .then((keys) =>
                Promise.all(
                    keys
                        .filter((k) => !k.startsWith(CACHE_VERSION))
                        .map((k) => caches.delete(k))
                )
            )
            .then(() => self.clients.claim())
            .then(() => self.clients.matchAll({ type: 'window', includeUncontrolled: true }))
            .then((clients) => {
                // Tell every open tab to reload so they pick up the new index.html
                // and fixed chunks immediately, without waiting for a manual refresh.
                clients.forEach((c) => c.postMessage({ type: 'SW_ACTIVATED', version: CACHE_VERSION }));
            })
    );
});

// Fetch strategy:
//   Supabase / API / auth / realtime → network only (never cache user data)
//   Same-origin navigation (HTML)    → network-first, fall back to /offline.html
//   Same-origin JS / CSS / assets    → stale-while-revalidate
//   3rd-party CDN (fonts, FA, etc.)  → cache-first
self.addEventListener('fetch', (event) => {
    const req = event.request;
    if (req.method !== 'GET') return;

    const url = new URL(req.url);

    // Never cache Supabase API traffic.
    if (
        url.hostname.includes('supabase.co') ||
        url.hostname.includes('supabase.io') ||
        url.pathname.startsWith('/rest/') ||
        url.pathname.startsWith('/auth/') ||
        url.pathname.startsWith('/realtime/') ||
        url.pathname.startsWith('/functions/')
    ) {
        return;
    }

    // Same-origin navigation (page loads): network-first → offline fallback.
    // NOTE: caches.match() returns a Promise (always truthy), so we must chain
    // .then() to inspect the resolved value — never use || on Promise objects.
    if (url.origin === self.location.origin && req.mode === 'navigate') {
        event.respondWith(
            fetch(req).catch(() =>
                caches.match('/offline.html')
                    .then((r) => r || caches.match('/index.html'))
                    .then((r) => r || Response.error())
            )
        );
        return;
    }

    // Hashed same-origin assets (content-addressed, immutable) — cache-first.
    // Pattern: filename contains an 8-12 hex char hash segment before .min.js/.min.css
    if (url.origin === self.location.origin && /\.[a-f0-9]{8,12}\.min\.(js|css)$/.test(url.pathname)) {
        event.respondWith(cacheFirst(req));
        return;
    }

    // Other same-origin static assets — stale-while-revalidate.
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
        return;
    }
});

async function staleWhileRevalidate(req) {
    const cache  = await caches.open(RUNTIME_CACHE);
    const cached = await cache.match(req);
    const fetchPromise = fetch(req)
        .then((res) => {
            if (res && res.status === 200 && res.type !== 'opaque') {
                cache.put(req, res.clone()).catch(() => {});
            }
            return res;
        })
        // #fix: when cached is undefined AND fetch fails, return Response.error()
        // so event.respondWith() always gets a valid Response — never undefined.
        // Previously: .catch(() => cached)  →  resolves to undefined  →
        //   TypeError: Failed to convert value to 'Response'
        .catch(() => cached || Response.error());
    return cached || fetchPromise;
}

async function cacheFirst(req) {
    const cache  = await caches.open(RUNTIME_CACHE);
    const cached = await cache.match(req);
    if (cached) return cached;
    try {
        const res = await fetch(req);
        // Never cache opaque responses (status 0) — a network error returns opaque
        // with status 0 and would be permanently cached, breaking the asset forever.
        if (res && res.status === 200 && res.type !== 'opaque') {
            cache.put(req, res.clone()).catch(() => {});
        }
        return res;
    } catch (err) {
        // #13 — log cache+network misses so blank-screen failures are diagnosable.
        console.warn('[SW] cache+network miss:', req.url, err && err.message);
        return cached || Response.error();
    }
}

// Allow the page to force-refresh the SW (e.g. after a deploy).
self.addEventListener('message', (event) => {
    if (event.data === 'skipWaiting') self.skipWaiting();
});
