// CRM Service Worker — stale-while-revalidate for static assets.
//
// #15 SW cleanup: PRECACHE_URLS now lists only non-hashed, stable resources.
//   Hashed JS/CSS bundles (script.abc123.min.js etc.) are cached at runtime by
//   the SWR strategy on first request — no need to enumerate them here.
//   This keeps the SW maintainable without a build step to inject hashes.
//
// #27 PWA offline page: /offline.html added to precache; navigation requests
//   that fail network fall back to it instead of the browser's default error page.
//
// Cache version bumped on each deploy to invalidate old caches.
const CACHE_VERSION = 'crm-v2026-06-05-2';
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
    if (url.origin === self.location.origin && req.mode === 'navigate') {
        event.respondWith(
            fetch(req)
                .catch(() =>
                    caches.match('/offline.html') ||
                    caches.match('/index.html') ||
                    Response.error()
                )
        );
        return;
    }

    // Same-origin static assets (JS, CSS, images, chunks) — stale-while-revalidate.
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
    const cache  = await caches.open(RUNTIME_CACHE);
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
    const cache  = await caches.open(RUNTIME_CACHE);
    const cached = await cache.match(req);
    if (cached) return cached;
    try {
        const res = await fetch(req);
        if (res && (res.status === 200 || res.type === 'opaque')) {
            cache.put(req, res.clone()).catch(() => {});
        }
        return res;
    } catch {
        return cached || Response.error();
    }
}

// Allow the page to force-refresh the SW (e.g. after a deploy).
self.addEventListener('message', (event) => {
    if (event.data === 'skipWaiting') self.skipWaiting();
});
