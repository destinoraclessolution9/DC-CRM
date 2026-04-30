// Service Worker — FB/IG-inspired stale-while-revalidate caching + push notifications.
//
// Philosophy: paint immediately from cache, refresh in the background.
// Same approach Instagram uses for the feed: show cached content first,
// then quietly replace with fresh data when it arrives. Repeat visits feel
// instant because we never block on the network for assets we already have.
const CACHE_NAME = 'crm-cache-v10';
const RUNTIME_CACHE = 'crm-runtime-v10';

// Minimal precache. We skip heavy files (script.js is 2.5 MB) to avoid
// breaking install if any single asset 404s — runtime cache picks them up
// on first hit instead.
const PRECACHE_ASSETS = [
    './',
    './index.html',
    './manifest.json',
    './icons/icon-192x192.png',
    './icons/icon-512x512.png'
];

self.addEventListener('install', event => {
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then(cache => Promise.all(
                PRECACHE_ASSETS.map(url =>
                    cache.add(url).catch(err => console.warn('[SW] precache skip', url, err))
                )
            ))
            .then(() => self.skipWaiting())
    );
});

self.addEventListener('activate', event => {
    event.waitUntil(
        caches.keys().then(cacheNames => {
            return Promise.all(
                cacheNames.filter(cacheName => {
                    return (cacheName.startsWith('crm-cache-') && cacheName !== CACHE_NAME)
                        || (cacheName.startsWith('crm-runtime-') && cacheName !== RUNTIME_CACHE);
                }).map(cacheName => {
                    console.log('[SW] Deleting old cache:', cacheName);
                    return caches.delete(cacheName);
                })
            );
        }).then(() => self.clients.claim())
    );
});

// staleWhileRevalidate — serve cache instantly, then update from network in background.
// This is the heart of FB/IG's perceived-instant feel: the cached response is what
// you see, the fresh one becomes what you see *next time*.
function staleWhileRevalidate(event, cacheName) {
    event.respondWith(
        caches.open(cacheName).then(cache =>
            cache.match(event.request).then(cached => {
                const networkFetch = fetch(event.request).then(resp => {
                    if (resp && resp.status === 200 && resp.type === 'basic') {
                        cache.put(event.request, resp.clone()).catch(() => {});
                    }
                    return resp;
                }).catch(() => cached || new Response('', { status: 504, statusText: 'Offline and not cached' }));
                // Return cache immediately if we have it; otherwise wait on network.
                // If both fail, networkFetch resolves to a 504 (never undefined,
                // which would break respondWith).
                return cached || networkFetch;
            })
        )
    );
}

// networkFirst — for HTML shell so users get fresh code on each visit;
// falls back to cache when offline.
function networkFirst(event, cacheName) {
    event.respondWith(
        fetch(event.request).then(resp => {
            const clone = resp.clone();
            caches.open(cacheName).then(c => c.put(event.request, clone)).catch(() => {});
            return resp;
        }).catch(() => caches.match(event.request).then(cached =>
            cached || new Response('', { status: 504, statusText: 'Offline and not cached' })
        ))
    );
}

self.addEventListener('fetch', event => {
    const req = event.request;
    if (req.method !== 'GET') return;
    if (!req.url.startsWith(self.location.origin)) return;

    const url = new URL(req.url);
    const path = url.pathname;
    const isHTML = path.endsWith('.html') || path.endsWith('/');
    const isJS = path.endsWith('.js');
    const isCSS = path.endsWith('.css');
    const isImg = /\.(png|jpe?g|gif|webp|svg|ico)$/i.test(path);
    const isFont = /\.(woff2?|ttf|eot)$/i.test(path);

    if (isHTML) {
        // HTML shell: always try network first so users get latest code on reload.
        networkFirst(event, CACHE_NAME);
    } else if (isJS || isCSS || isImg || isFont) {
        // Static assets: stale-while-revalidate for instant repeat loads.
        // Cache-busting query strings (?v=20260425) ensure new versions get picked up.
        staleWhileRevalidate(event, RUNTIME_CACHE);
    }
    // Otherwise: let the browser handle it normally (Supabase, etc.).
});

// ========== PUSH NOTIFICATIONS ==========

self.addEventListener('push', event => {
    let payload = {};
    try {
        payload = event.data ? event.data.json() : {};
    } catch (e) {
        payload = { title: 'Feng Shui CRM', body: event.data ? event.data.text() : '' };
    }

    const title = payload.title || 'Feng Shui CRM';
    const options = {
        body: payload.body || '',
        icon: payload.icon || 'icons/icon-192x192.png',
        badge: payload.badge || 'icons/icon-72x72.png',
        tag: payload.tag || 'crm-activity',
        data: payload.data || {},
        vibrate: [200, 100, 200],
        requireInteraction: false,
        renotify: true
    };

    event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', event => {
    event.notification.close();
    const targetUrl = (event.notification.data && event.notification.data.url) || './index.html';

    event.waitUntil(
        self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clientList => {
            for (const client of clientList) {
                if ('focus' in client) {
                    client.postMessage({ type: 'NOTIFICATION_CLICK', data: event.notification.data });
                    return client.focus();
                }
            }
            if (self.clients.openWindow) {
                return self.clients.openWindow(targetUrl);
            }
        })
    );
});

self.addEventListener('message', event => {
    if (event.data && event.data.type === 'SKIP_WAITING') {
        self.skipWaiting();
    }
});
