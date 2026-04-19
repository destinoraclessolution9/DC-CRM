// Service Worker — offline caching + push notifications
const CACHE_NAME = 'crm-cache-v5';

// Minimal precache. We skip heavy files (script.js is 18k lines) to
// avoid breaking install if any single asset 404s.
const PRECACHE_ASSETS = [
    './',
    './index.html',
    './manifest.json',
    './icons/icon-192x192.png',
    './icons/icon-512x512.png'
];

// Install event — cache core assets. Use individual adds so a single
// missing file does not reject the whole install.
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

// Activate event - clean up old caches
self.addEventListener('activate', event => {
    event.waitUntil(
        caches.keys().then(cacheNames => {
            return Promise.all(
                cacheNames.filter(cacheName => {
                    return cacheName.startsWith('crm-cache-') && cacheName !== CACHE_NAME;
                }).map(cacheName => {
                    console.log('Deleting old cache:', cacheName);
                    return caches.delete(cacheName);
                })
            );
        }).then(() => self.clients.claim())
    );
});

// Fetch event — network-first for HTML + API, cache-first for static assets.
self.addEventListener('fetch', event => {
    const req = event.request;

    // Only handle GET
    if (req.method !== 'GET') return;

    // Skip Supabase and other cross-origin API traffic entirely
    if (!req.url.startsWith(self.location.origin)) return;

    // Network-first for HTML & JS (always get latest code); cache-first for static assets
    const isCodeAsset = req.url.endsWith('.html') || req.url.endsWith('.js') || req.url.endsWith('/');
    if (isCodeAsset) {
        event.respondWith(
            fetch(req).then(resp => {
                const clone = resp.clone();
                caches.open(CACHE_NAME).then(c => c.put(req, clone));
                return resp;
            }).catch(() => caches.match(req))
        );
    } else {
        event.respondWith(
            caches.match(req).then(cached => cached || fetch(req).catch(() => cached))
        );
    }
});

// ========== PUSH NOTIFICATIONS ==========

// Push event — fired by the push service when a notification is pushed to this device.
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

// Notification click — focus an existing tab or open a new one and route to the target URL.
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

// Allow page to trigger an immediate activate (used after new SW install)
self.addEventListener('message', event => {
    if (event.data && event.data.type === 'SKIP_WAITING') {
        self.skipWaiting();
    }
});
