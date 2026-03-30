// Service Worker for offline caching
const CACHE_NAME = 'crm-cache-v1';
const OFFLINE_URL = '/offline.html';

// Assets to cache on install
const PRECACHE_ASSETS = [
    '/',
    '/index.html',
    '/offline.html',
    '/styles.css',
    '/script.js',
    '/data.js',
    '/auth.js',
    '/manifest.json',
    '/icons/icon-72x72.png',
    '/icons/icon-96x96.png',
    '/icons/icon-128x128.png',
    '/icons/icon-144x144.png',
    '/icons/icon-152x152.png',
    '/icons/icon-192x192.png',
    '/icons/icon-384x384.png',
    '/icons/icon-512x512.png',
    'https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap',
    'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/5.15.4/css/all.min.css'
];

// Install event - cache core assets
self.addEventListener('install', event => {
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then(cache => {
                console.log('Caching precompiled assets');
                return cache.addAll(PRECACHE_ASSETS);
            })
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

// Fetch event - serve from cache, fallback to network
self.addEventListener('fetch', event => {
    // Skip cross-origin requests
    if (!event.request.url.startsWith(self.location.origin) &&
        !event.request.url.includes('fonts.googleapis.com') &&
        !event.request.url.includes('cdnjs.cloudflare.com')) {
        return;
    }

    // Handle API requests differently
    if (event.request.url.includes('/api/')) {
        return handleAPIRequest(event);
    }

    // For static assets, try cache first, then network
    event.respondWith(
        caches.match(event.request)
            .then(cachedResponse => {
                if (cachedResponse) {
                    return cachedResponse;
                }

                return fetch(event.request)
                    .then(networkResponse => {
                        // Cache new responses
                        if (networkResponse && networkResponse.status === 200) {
                            const responseToCache = networkResponse.clone();
                            caches.open(CACHE_NAME)
                                .then(cache => {
                                    cache.put(event.request, responseToCache);
                                });
                        }
                        return networkResponse;
                    })
                    .catch(() => {
                        // If offline and HTML request, return offline page
                        if (event.request.headers.get('accept').includes('text/html')) {
                            return caches.match(OFFLINE_URL);
                        }
                    });
            })
    );
});

// Handle API requests with offline queue
const handleAPIRequest = (event) => {
    event.respondWith(
        fetch(event.request)
            .then(response => {
                return response;
            })
            .catch(() => {
                // Store failed request for later sync
                return saveRequestForSync(event.request.clone())
                    .then(() => {
                        return new Response(
                            JSON.stringify({
                                offline: true,
                                message: 'You are offline. Request queued for sync.'
                            }),
                            {
                                status: 202,
                                headers: { 'Content-Type': 'application/json' }
                            }
                        );
                    });
            })
    );
};

// Save failed request to IndexedDB for later sync
const saveRequestForSync = (request) => {
    return request.clone().text().then(body => {
        const syncData = {
            id: 'req_' + Date.now(),
            url: request.url,
            method: request.method,
            headers: Array.from(request.headers.entries()),
            body: body,
            timestamp: new Date().toISOString()
        };

        // Open IndexedDB and store
        return openSyncDB().then(db => {
            const tx = db.transaction('sync_queue', 'readwrite');
            const store = tx.objectStore('sync_queue');
            return store.add(syncData);
        });
    });
};

// Background sync event
self.addEventListener('sync', event => {
    if (event.tag === 'sync-crm-data') {
        event.waitUntil(syncPendingRequests());
    }
});

// Sync pending requests
const syncPendingRequests = () => {
    return openSyncDB().then(db => {
        const tx = db.transaction('sync_queue', 'readonly');
        const store = tx.objectStore('sync_queue');
        return store.getAll().then(pendingRequests => {
            return Promise.all(pendingRequests.map(requestData => {
                return fetch(requestData.url, {
                    method: requestData.method,
                    headers: new Headers(requestData.headers),
                    body: requestData.body
                }).then(response => {
                    if (response.ok) {
                        // Remove from queue on success
                        const deleteTx = db.transaction('sync_queue', 'readwrite');
                        const deleteStore = deleteTx.objectStore('sync_queue');
                        return deleteStore.delete(requestData.id);
                    }
                });
            }));
        });
    });
};

// Open IndexedDB for sync queue
const openSyncDB = () => {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open('SyncDB', 1);

        request.onupgradeneeded = (event) => {
            const db = event.target.result;
            if (!db.objectStoreNames.contains('sync_queue')) {
                db.createObjectStore('sync_queue', { keyPath: 'id' });
            }
        };

        request.onsuccess = (event) => resolve(event.target.result);
        request.onerror = (event) => reject(event.target.error);
    });
};
