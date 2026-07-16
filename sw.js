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
const CACHE_VERSION = 'crm-v2026-07-16-116';
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
    // Must match the exact URL index.html requests (query included) — cache.match
    // keys on the full URL, so the bare '/fonts/local-fonts.css' would never be
    // served. Bump this ?v= token in lockstep with index.html when the font CSS
    // is revved.
    '/fonts/local-fonts.css?v=20260531o',
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
            .then((keys) => {
                // Only consider caches this SW owns (named `<version>-static` /
                // `<version>-runtime`). The data layer's own Cache API store
                // (data.js `crm-data-v1`) and any other origin caches MUST NOT
                // be counted as prior-version caches nor deleted here, or every
                // upgrade would wipe overflowed table data and force a full
                // fleet re-fetch from Supabase.
                const isSwCache   = (k) => /^crm-v.*-(static|runtime)$/.test(k);
                const isStale     = (k) => isSwCache(k) && !k.startsWith(CACHE_VERSION);
                // First-install guard: if NO cache from a prior CACHE_VERSION
                // exists, this is a brand-new visitor (no SW controlled the page
                // before). Broadcasting SW_ACTIVATED here would make sw-init.js
                // schedule a spurious forced reload of the just-loaded page.
                // Only an actual upgrade (a different-version SW cache present)
                // should trigger the reload signal.
                const isUpgrade = keys.some(isStale);
                return Promise.all(
                    keys
                        .filter(isStale)
                        .map((k) => caches.delete(k))
                ).then(() => isUpgrade);
            })
            .then((isUpgrade) =>
                self.clients.claim().then(() => isUpgrade)
            )
            .then((isUpgrade) =>
                self.clients.matchAll({ type: 'window', includeUncontrolled: true })
                    .then((clients) => ({ clients, isUpgrade }))
            )
            .then(({ clients, isUpgrade }) => {
                // Tell every open tab to reload so they pick up the new index.html
                // and fixed chunks immediately, without waiting for a manual refresh.
                // Skip on first install — there is nothing to upgrade from.
                if (!isUpgrade) return;
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

    // Never cache Supabase API traffic, nor same-origin BFF (/api/*) responses.
    // The Vercel BFF (api/customers.mjs, api/prospects.mjs) returns role-scoped
    // PII with `Cache-Control: no-store`. These are same-origin GETs that would
    // otherwise fall through to staleWhileRevalidate and get cached in
    // RUNTIME_CACHE, leaking one user's scoped customer/prospect list to the
    // next user on a shared device. Bypass the cache entirely so no-store holds.
    if (
        url.hostname.includes('supabase.co') ||
        url.hostname.includes('supabase.io') ||
        url.pathname.startsWith('/api/') ||
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
                    .then((r) => r ? cleanRedirect(r) : Response.error())
            )
        );
        return;
    }

    // Bootstrap scripts (sw-init.js, obs-init.js) AND the React island bundle —
    // network-first. These are loaded unhashed (the island via a manual ?v= token),
    // so under staleWhileRevalidate a deploy would not take effect until the SECOND
    // post-deploy load (the first runs the stale cached copy). For react-island.js
    // specifically, a missed ?v= bump (the project avoids CACHE_VERSION bumps to
    // prevent reload storms) would otherwise serve stale React UI indefinitely.
    // Serve fresh bytes when online, fall back to cache offline.
    if (
        url.origin === self.location.origin &&
        (/\/(sw-init|obs-init)\.js$/.test(url.pathname) || /\/react-island\.js$/.test(url.pathname))
    ) {
        event.respondWith(networkFirst(req));
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

// Cap RUNTIME_CACHE so unbounded hashed-bundle accumulation can't grow without
// limit and trigger a browser-wide origin eviction (which would also wipe the
// STATIC_CACHE offline shell). CACHE_VERSION is deliberately not bumped per
// deploy (bumps cause fleet-wide reload/re-auth spikes → 521), so old hashed
// URLs are never purged by the activate handler — trim here instead. The Cache
// API returns keys() in insertion order, so deleting from the front is an
// approximate FIFO eviction of the oldest superseded bundles. Runs after put()
// and swallows errors so a trim failure never breaks the response.
const RUNTIME_CACHE_MAX = 220;
async function trimRuntimeCache() {
    try {
        const cache = await caches.open(RUNTIME_CACHE);
        const keys  = await cache.keys();
        if (keys.length <= RUNTIME_CACHE_MAX) return;
        // Protect the offline app shell + core boot bundles from FIFO eviction — they
        // may have been cached early and would otherwise be the first deleted, breaking
        // offline mode / the app boot while CDN images and superseded chunks pile up.
        // Evict only the oldest NON-protected entries.
        const PROTECTED = /(^|\/)(index\.html|offline\.html|offline|manifest\.json)(\?|$)|react-island|app-init|sw-init|supabase-init/i;
        const deletable = keys.filter(k => !PROTECTED.test(k.url));
        let toDelete = keys.length - RUNTIME_CACHE_MAX;
        for (let i = 0; i < deletable.length && toDelete > 0; i++) {
            await cache.delete(deletable[i]);
            toDelete--;
        }
    } catch (_) { /* best-effort — never surface trim errors */ }
}

// A cached response whose stored URL 308-redirected (Vercel cleanUrls turns
// /offline.html → /offline, /index.html → /) carries `redirected:true`. The
// browser refuses to use a redirected response to satisfy a navigation request
// ("a redirected response was used for a request whose redirect mode is not
// 'follow'"), so the offline fallback never renders. Re-wrap the body in a
// fresh Response to clear the flag. No-op for non-redirected responses.
async function cleanRedirect(res) {
    if (!res || !res.redirected) return res;
    try {
        const body = await res.clone().blob();
        return new Response(body, {
            status: res.status,
            statusText: res.statusText,
            headers: res.headers,
        });
    } catch (_) {
        return res;
    }
}

async function staleWhileRevalidate(req) {
    const cache  = await caches.open(RUNTIME_CACHE);
    const cached = await cache.match(req);
    const fetchPromise = fetch(req)
        .then((res) => {
            if (res && res.status === 200 && res.type !== 'opaque') {
                cache.put(req, res.clone()).then(trimRuntimeCache).catch(() => {});
            }
            return res;
        })
        // #fix: when cached is undefined AND fetch fails, fall back to any
        // install-time precache (STATIC_CACHE) via the global caches.match —
        // this is how precached shell assets (fonts, manifest) become reachable
        // offline, since the runtime cache above only sees RUNTIME_CACHE. Then
        // Response.error() so event.respondWith() always gets a valid Response
        // — never undefined (TypeError: Failed to convert value to 'Response').
        .catch(() => cached || caches.match(req).then((r) => r || Response.error()));
    return cached || fetchPromise;
}

// Network-first: prefer fresh bytes, fall back to cache when offline. Used for
// unhashed bootstrap scripts so SW-registration fixes land on the next load.
async function networkFirst(req) {
    const cache = await caches.open(RUNTIME_CACHE);
    try {
        const res = await fetch(req);
        if (res && res.status === 200 && res.type !== 'opaque') {
            cache.put(req, res.clone()).then(trimRuntimeCache).catch(() => {});
        }
        return res;
    } catch (err) {
        const cached = await cache.match(req);
        return cached || Response.error();
    }
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
            cache.put(req, res.clone()).then(trimRuntimeCache).catch(() => {});
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

// ── Web Push ────────────────────────────────────────────────────────────────
// push-notifications.js subscribes with userVisibleOnly:true and the Supabase
// Edge Function `send-activity-push` fans out encrypted payloads of the shape:
//   { title, body, tag, icon, badge, data: { type, activityId, url } }
// userVisibleOnly REQUIRES the SW to show a notification for every push, or the
// browser drops it / shows a generic "site updated in background" notice. This
// handler renders the real notification; notificationclick focuses/opens the
// target URL. (Previously these handlers existed only in the unregistered
// dist/sw.js, so the entire push feature was non-functional.)
self.addEventListener('push', (event) => {
    let data = {};
    try {
        // event.data may be absent (e.g. a tickle push). Guard before .json().
        if (event.data) data = event.data.json();
    } catch (_) {
        try { data = { body: event.data && event.data.text() }; } catch (_e) { data = {}; }
    }

    const title = data.title || 'DestinOracles CRM';
    const options = {
        body:  data.body || '',
        // Fall back to the installed PWA icons if the payload omits them.
        icon:  data.icon  || 'icons/icon-192x192.png',
        badge: data.badge || 'icons/icon-72x72.png',
        // tag de-dupes repeated notifications for the same entity.
        tag:   data.tag || undefined,
        data:  data.data || {},
    };

    event.waitUntil(self.registration.showNotification(title, options));
});

// Clicking a notification focuses an existing tab (navigating it to the target
// URL) or opens a new one. Without this, clicks did nothing.
self.addEventListener('notificationclick', (event) => {
    event.notification.close();

    const targetUrl = (event.notification.data && event.notification.data.url) ||
        './index.html#calendar';

    event.waitUntil(
        self.clients.matchAll({ type: 'window', includeUncontrolled: true })
            .then((clientList) => {
                // Resolve the target against the SW scope so a relative URL
                // ("./index.html#calendar") compares correctly against client URLs.
                const absTarget = new URL(targetUrl, self.location.origin).href;
                // Normalize the SPA root: senders pass "./index.html#…" (pathname
                // "/index.html") but live tabs / the installed PWA sit at "/"
                // (manifest start_url). Treat "/index.html" and "/" as the same
                // page so an open tab is reused instead of spawning a duplicate.
                const normPath = (p) => (p === '/index.html' ? '/' : p);
                for (const client of clientList) {
                    // Match on origin/path (ignore hash) so an already-open CRM
                    // tab is reused rather than spawning a duplicate window.
                    try {
                        const cu = new URL(client.url);
                        const tu = new URL(absTarget);
                        if (cu.origin === tu.origin && normPath(cu.pathname) === normPath(tu.pathname) && 'focus' in client) {
                            if ('navigate' in client && cu.hash !== tu.hash) {
                                return client.navigate(absTarget).then((c) => (c || client).focus());
                            }
                            return client.focus();
                        }
                    } catch (_) { /* ignore unparseable client URLs */ }
                }
                if (self.clients.openWindow) return self.clients.openWindow(absTarget);
                return undefined;
            })
    );
});
