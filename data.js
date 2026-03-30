/**
 * Feng Shui CRM V8.7 - DataStore Layer
 * Manages localStorage persistence and CRUD operations for core tables.
 */

const DataStore = (() => {
    const TABLES = [
        'users', 'roles', 'teams', 'prospects', 'customers',
        'activities', 'transactions', 'events', 'event_registrations',
        'referrals', 'documents', 'notes', 'tags', 'entity_tags',
        'names', 'proposed_solutions', 'platform_ids', 'purchases',
        'agent_stats', 'assignments', 'agent_targets',
        'my_potential_list', 'manual_overrides',
        'event_categories', 'event_templates',
        'yearly_targets', 'quarterly_targets', 'monthly_targets', 'weekly_targets',
        'folders', 'document_versions', 'document_shares', 'document_tags', 'document_tag_mappings',
        'whatsapp_templates', 'whatsapp_campaigns', 'campaign_messages',
        'import_jobs', 'import_errors', 'import_templates',
        'reassignment_history', 'agent_followup_stats', 'inactivity_alerts',
        'integrations', 'integration_connections', 'sync_history',
        'whatsapp_messages', 'whatsapp_conversations',
        'ai_models', 'ai_predictions', 'lead_scores', 'churn_risk',  // NEW TABLES Phase 17
        'forecast_history', 'performance_insights',                    // NEW TABLES Phase 17
        'offline_changes', 'sync_queue', 'sync_log', 'mobile_devices', // NEW TABLES Phase 18
        'audit_logs', 'security_incidents', 'consent_records', 'consent_revocations',
        'dsar_requests', 'dsar_reports', 'retention_jobs', 'archived_records',
        'encryption_keys', 'mfa_devices', 'login_attempts', 'ip_whitelist', 'data_classification', // NEW TABLES Phase 19
        'tenants', 'tenant_settings', 'health_checks', 'system_alerts', 'performance_metrics',
        'performance_warnings', 'backups', 'backup_schedules', 'deployments', 'system_config',
        'system_logs', 'maintenance_windows', 'audit_logs_archive', // NEW TABLES Phase 20
        'event_attendees', 'agent_event_attendees', 'case_studies', // NEW TABLES
        'promotion_packages', // NEW TABLES Promotion Packages
        'products', 'events', 'promotions', // NEW TABLES Marketing Manager Listings
        'appointment_locations' // NEW TABLES Appointment Locations
    ];

    const _listeners = {};
    const _memoryStorage = {};

    const _loadTable = (tableName) => {
        try {
            const data = localStorage.getItem(`fs_crm_${tableName}`);
            return data ? JSON.parse(data) : [];
        } catch (e) {
            console.warn(`localStorage access blocked for ${tableName}, using memory fallback`);
            return _memoryStorage[tableName] || [];
        }
    };

    const _saveTable = (tableName, data) => {
        try {
            localStorage.setItem(`fs_crm_${tableName}`, JSON.stringify(data));
        } catch (e) {
            console.warn(`localStorage save blocked for ${tableName}, storing in memory only`);
            _memoryStorage[tableName] = data;
        }
        DataStore.emit(`${tableName}:changed`, data);
    };

    return {
        getAll: (tableName) => {
            if (!TABLES.includes(tableName)) return [];
            return _loadTable(tableName);
        },

        getById: (tableName, id) => {
            const table = DataStore.getAll(tableName);
            return table.find(item => item.id == id) || null;
        },

        create: (tableName, data) => {
            const table = DataStore.getAll(tableName);
            const newRecord = {
                id: data.id || (Date.now() + Math.floor(Math.random() * 1000)),
                ...data,
                created_at: data.created_at || new Date().toISOString()
            };
            table.push(newRecord);
            _saveTable(tableName, table);

            // Dispatch internal event
            DataStore.emit(`${tableName}:created`, newRecord);

            // Dispatch global event for cross-module sync
            window.dispatchEvent(new CustomEvent('dataChanged', {
                detail: { table: tableName, action: 'create', id: newRecord.id }
            }));

            return newRecord;
        },

        update: (tableName, id, data) => {
            let table = DataStore.getAll(tableName);
            const index = table.findIndex(item => item.id == id);
            if (index === -1) return null;

            table[index] = { ...table[index], ...data, updated_at: new Date().toISOString() };
            _saveTable(tableName, table);

            // Dispatch internal event
            DataStore.emit(`${tableName}:updated`, table[index]);

            // Dispatch global event for cross-module sync
            window.dispatchEvent(new CustomEvent('dataChanged', {
                detail: { table: tableName, action: 'update', id: id }
            }));

            return table[index];
        },

        delete: (tableName, id) => {
            let table = DataStore.getAll(tableName);
            const initialLength = table.length;
            table = table.filter(item => item.id != id);

            if (table.length !== initialLength) {
                _saveTable(tableName, table);

                // Dispatch internal event
                DataStore.emit(`${tableName}:deleted`, id);

                // Dispatch global event for cross-module sync
                window.dispatchEvent(new CustomEvent('dataChanged', {
                    detail: { table: tableName, action: 'delete', id: id }
                }));

                return true;
            }
            return false;
        },

        query: (tableName, filters) => {
            const table = DataStore.getAll(tableName);
            return table.filter(item => {
                for (let key in filters) {
                    if (item[key] !== filters[key]) return false;
                }
                return true;
            });
        },

        on: (eventName, callback) => {
            if (!_listeners[eventName]) _listeners[eventName] = [];
            _listeners[eventName].push(callback);
        },

        emit: (eventName, data) => {
            if (!_listeners[eventName]) return;
            _listeners[eventName].forEach(cb => cb(data));
        },

        init: () => {
            if (window.location.search.includes('reset=true')) {
                localStorage.clear();
                window.history.replaceState({}, document.title, window.location.pathname);
                console.log('LocalStorage cleared via reset parameter.');
            }
            TABLES.forEach(table => {
                try {
                    if (localStorage.getItem(`fs_crm_${table}`) === null) {
                        localStorage.setItem(`fs_crm_${table}`, JSON.stringify([]));
                    }
                } catch (e) {
                    if (!_memoryStorage[table]) _memoryStorage[table] = [];
                }
            });
            console.log('DataStore initialized.');
        }
    };
})();

DataStore.init();
