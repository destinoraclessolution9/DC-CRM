// ========== OFFLINE STORAGE MANAGEMENT ==========

const DB_NAME = 'CRMOfflineDB';
const DB_VERSION = 1;

// Offline database schema
const OFFLINE_STORES = {
    prospects: { keyPath: 'id', indexes: ['phone', 'email'] },
    customers: { keyPath: 'id', indexes: ['phone', 'email'] },
    activities: { keyPath: 'id', indexes: ['prospect_id', 'customer_id', 'activity_date'] },
    transactions: { keyPath: 'id', indexes: ['customer_id', 'transaction_date'] },
    documents: { keyPath: 'id', indexes: ['entity_type', 'entity_id'] },
    whatsapp_messages: { keyPath: 'id', indexes: ['entity_id', 'status'] },
    sync_queue: { keyPath: 'id' },
    sync_log: { keyPath: 'id', indexes: ['timestamp'] },
    user_preferences: { keyPath: 'id' }
};

// Open IndexedDB connection
const openOfflineDB = () => {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);

        request.onerror = (event) => {
            console.error('IndexedDB error:', event.target.error);
            reject(event.target.error);
        };

        request.onsuccess = (event) => {
            const db = event.target.result;
            resolve(db);
        };

        request.onupgradeneeded = (event) => {
            const db = event.target.result;
            const oldVersion = event.oldVersion;

            // Create object stores based on schema
            Object.keys(OFFLINE_STORES).forEach(storeName => {
                if (!db.objectStoreNames.contains(storeName)) {
                    const storeConfig = OFFLINE_STORES[storeName];
                    const store = db.createObjectStore(storeName, { keyPath: storeConfig.keyPath });

                    // Create indexes
                    if (storeConfig.indexes) {
                        storeConfig.indexes.forEach(indexName => {
                            store.createIndex(indexName, indexName, { unique: false });
                        });
                    }
                }
            });
        };
    });
};

// Offline DataStore wrapper
const OfflineDataStore = {
    // Get all records from a store with optional filter
    getAll: async (storeName, filter = null) => {
        const db = await openOfflineDB();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(storeName, 'readonly');
            const store = tx.objectStore(storeName);
            const request = store.getAll();

            request.onsuccess = () => {
                let results = request.result;
                if (filter) {
                    results = results.filter(filter);
                }
                resolve(results);
            };

            request.onerror = () => reject(request.error);
        });
    },

    // Get record by ID
    getById: async (storeName, id) => {
        const db = await openOfflineDB();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(storeName, 'readonly');
            const store = tx.objectStore(storeName);
            const request = store.get(id);

            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    },

    // Create or update record
    save: async (storeName, data) => {
        const db = await openOfflineDB();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(storeName, 'readwrite');
            const store = tx.objectStore(storeName);

            // Add sync metadata
            const record = {
                ...data,
                _sync_status: 'pending',
                _sync_version: data._sync_version || 1,
                _last_modified: new Date().toISOString()
            };

            const request = store.put(record);

            request.onsuccess = () => {
                // Queue for sync if online
                if (navigator.onLine) {
                    queueForSync('create', storeName, record);
                }
                resolve(record);
            };

            request.onerror = () => reject(request.error);
        });
    },

    // Delete record
    delete: async (storeName, id) => {
        const db = await openOfflineDB();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(storeName, 'readwrite');
            const store = tx.objectStore(storeName);
            const request = store.delete(id);

            request.onsuccess = () => {
                if (navigator.onLine) {
                    queueForSync('delete', storeName, { id });
                }
                resolve();
            };

            request.onerror = () => reject(request.error);
        });
    },

    // Query with indexes
    query: async (storeName, indexName, value) => {
        const db = await openOfflineDB();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(storeName, 'readonly');
            const store = tx.objectStore(storeName);
            const index = store.index(indexName);
            const request = index.getAll(value);

            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    },

    // Clear store
    clear: async (storeName) => {
        const db = await openOfflineDB();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(storeName, 'readwrite');
            const store = tx.objectStore(storeName);
            const request = store.clear();

            request.onsuccess = () => resolve();
            request.onerror = () => reject(request.error);
        });
    }
};

// Queue operations for sync
const queueForSync = (operation, storeName, data) => {
    const syncItem = {
        id: `sync_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        operation: operation,
        store: storeName,
        data: data,
        timestamp: new Date().toISOString(),
        attempts: 0
    };

    return OfflineDataStore.save('sync_queue', syncItem);
};

// Sync manager
const SyncManager = {
    // Start sync process
    sync: async () => {
        if (!navigator.onLine) {
            console.log('Offline - sync deferred');
            return { success: false, message: 'Offline' };
        }

        const syncItems = await OfflineDataStore.getAll('sync_queue');

        if (syncItems.length === 0) {
            return { success: true, message: 'Nothing to sync' };
        }

        const results = {
            success: [],
            failed: []
        };

        for (const item of syncItems) {
            try {
                await SyncManager.processSyncItem(item);

                // Remove from queue on success
                await OfflineDataStore.delete('sync_queue', item.id);
                results.success.push(item);
            } catch (error) {
                console.error('Sync failed:', error);

                // Increment attempt count
                item.attempts++;

                if (item.attempts >= 5) {
                    // Mark as failed permanently
                    item.status = 'failed_permanent';
                    await OfflineDataStore.save('sync_queue', item);
                    results.failed.push(item);
                } else {
                    // Update attempt count
                    await OfflineDataStore.save('sync_queue', item);
                }
            }
        }

        // Log sync results
        await SyncManager.logSync(results);

        return results;
    },

    // Process individual sync item
    processSyncItem: async (item) => {
        const { operation, store, data } = item;

        // Map to API endpoints
        const endpoints = {
            prospects: '/api/prospects',
            customers: '/api/customers',
            activities: '/api/activities',
            transactions: '/api/transactions'
        };

        const endpoint = endpoints[store];
        if (!endpoint) return;

        let url = endpoint;
        let method = 'POST';

        if (operation === 'update') {
            method = 'PUT';
            url = `${endpoint}/${data.id}`;
        } else if (operation === 'delete') {
            method = 'DELETE';
            url = `${endpoint}/${data.id}`;
        }

        const response = await fetch(url, {
            method: method,
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${Auth.getToken()}`
            },
            body: operation !== 'delete' ? JSON.stringify(data) : undefined
        });

        if (!response.ok) {
            throw new Error(`Sync failed: ${response.statusText}`);
        }

        return await response.json();
    },

    // Log sync results
    logSync: async (results) => {
        const logEntry = {
            id: `log_${Date.now()}`,
            timestamp: new Date().toISOString(),
            success_count: results.success.length,
            failed_count: results.failed.length,
            results: results
        };

        await OfflineDataStore.save('sync_log', logEntry);
    },

    // Get sync status
    getStatus: async () => {
        const queue = await OfflineDataStore.getAll('sync_queue');
        const logs = await OfflineDataStore.getAll('sync_log');

        return {
            pending: queue.length,
            last_sync: logs.length > 0 ? logs[logs.length - 1].timestamp : null,
            queue: queue
        };
    }
};

// Network status monitor
const initNetworkMonitor = () => {
    window.addEventListener('online', () => {
        console.log('Network is online');
        UI.toast.success('You are back online - syncing data...');

        // Trigger sync
        SyncManager.sync().then(results => {
            if (results.success && results.success.length > 0) {
                UI.toast.success(`Synced ${results.success.length} items`);
            }

            // Refresh current view
            refreshCurrentView();
        });
    });

    window.addEventListener('offline', () => {
        console.log('Network is offline');
        UI.toast.warning('You are offline - changes will sync when connection returns');

        // Show offline indicator
        showOfflineIndicator();
    });
};

// Offline indicator
const showOfflineIndicator = () => {
    const indicator = document.createElement('div');
    indicator.className = 'offline-indicator';
    indicator.innerHTML = `
        <i class="fas fa-wifi-slash"></i>
        <span>You are offline - working in offline mode</span>
    `;

    document.body.appendChild(indicator);

    // Remove when online
    window.addEventListener('online', () => {
        indicator.remove();
    }, { once: true });
};

// Refresh current view based on route
const refreshCurrentView = () => {
    const currentPath = window.location.hash;

    if (currentPath.includes('prospects')) {
        loadProspects();
    } else if (currentPath.includes('customers')) {
        loadCustomers();
    } else if (currentPath.includes('calendar')) {
        loadCalendar();
    }
};
