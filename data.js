/**
 * Feng Shui CRM V8.7 - DataStore Layer (Async Supabase Version)
 * Protected against accidental overwrites.
 */

class DataStore {
    constructor() {
        this.tables = [
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
            'ai_models', 'ai_predictions', 'lead_scores', 'churn_risk',
            'forecast_history', 'performance_insights',
            'offline_changes', 'sync_queue', 'sync_log', 'mobile_devices',
            'audit_logs', 'security_incidents', 'consent_records', 'consent_revocations',
            'dsar_requests', 'dsar_reports', 'retention_jobs', 'archived_records',
            'encryption_keys', 'mfa_devices', 'login_attempts', 'ip_whitelist', 'data_classification',
            'tenants', 'tenant_settings', 'health_checks', 'system_alerts', 'performance_metrics',
            'performance_warnings', 'backups', 'backup_schedules', 'deployments', 'system_config',
            'system_logs', 'maintenance_windows', 'audit_logs_archive',
            'event_attendees', 'agent_event_attendees', 'case_studies',
            'promotion_packages', 'products', 'promotions', 'appointment_locations',
            'tree_interested'
        ];
        this.initialized = false;
        this._events = {};
    }

    on(event, callback) {
        if (!this._events[event]) this._events[event] = [];
        this._events[event].push(callback);
    }

    off(event, callback) {
        if (!this._events[event]) return;
        this._events[event] = this._events[event].filter(cb => cb !== callback);
    }

    emit(event, data) {
        if (!this._events[event]) return;
        this._events[event].forEach(cb => cb(data));
        if (event === 'dataChanged') {
            window.dispatchEvent(new CustomEvent('dataChanged', { detail: data }));
        }
    }

    async init() {
        try {
            if (!window.supabase) {
                throw new Error('Supabase client not found.');
            }
            const { error } = await window.supabase.from('users').select('*').limit(1);
            if (error) throw error;
            this.initialized = true;
            console.log('DataStore initialised (Supabase mode).');
            this.emit('ready');
            return true;
        } catch (err) {
            console.error('Supabase init error:', err);
            this.emit('error', err);
            return false;
        }
    }

    _generateId() {
        return Date.now() + Math.floor(Math.random() * 1000);
    }

    async getAll(tableName) {
        try {
            const { data, error } = await window.supabase.from(tableName).select('*');
            if (error) throw error;
            const result = data || [];
            try { localStorage.setItem(`fs_crm_${tableName}`, JSON.stringify(result)); } catch (_) {}
            return result;
        } catch (e) {
            console.warn(`Offline: falling back to localStorage for ${tableName}`, e);
            const local = localStorage.getItem(`fs_crm_${tableName}`);
            return local ? JSON.parse(local) : [];
        }
    }

    async get(tableName, id) {
        const { data, error } = await window.supabase
            .from(tableName)
            .select('*')
            .eq('id', id)
            .maybeSingle();
        if (error) throw error;
        return data;
    }

    async add(tableName, record) {
        const dataToInsert = { ...record };
        if (!dataToInsert.id) dataToInsert.id = this._generateId();
        try {
            const { data, error } = await window.supabase
                .from(tableName)
                .insert(dataToInsert)
                .select()
                .single();
            if (error) throw error;
            this.emit('dataChanged', { action: 'add', table: tableName, record: data });
            return data;
        } catch (e) {
            if (e.code === 'PGRST204') {
                console.warn(`Schema mismatch on insert to ${tableName}: ${e.message} — saving locally`);
                const key = `fs_crm_${tableName}`;
                try {
                    const all = JSON.parse(localStorage.getItem(key) || '[]');
                    all.push(dataToInsert);
                    localStorage.setItem(key, JSON.stringify(all));
                } catch (_) {}
                this.emit('dataChanged', { action: 'add', table: tableName, record: dataToInsert });
                return dataToInsert;
            }
            throw e;
        }
    }

    async update(tableName, id, updates) {
        try {
            const { data, error } = await window.supabase
                .from(tableName)
                .update(updates)
                .eq('id', id)
                .select()
                .single();
            if (error) throw error;
            this.emit('dataChanged', { action: 'update', table: tableName, record: data });
            return data;
        } catch (e) {
            if (e.code === 'PGRST204') {
                console.warn(`Schema mismatch on update to ${tableName}: ${e.message} — saving locally`);
                const key = `fs_crm_${tableName}`;
                try {
                    const all = JSON.parse(localStorage.getItem(key) || '[]');
                    const idx = all.findIndex(r => r.id == id);
                    const updated = idx >= 0 ? { ...all[idx], ...updates } : { id, ...updates };
                    if (idx >= 0) all[idx] = updated; else all.push(updated);
                    localStorage.setItem(key, JSON.stringify(all));
                } catch (_) {}
                const record = { id, ...updates };
                this.emit('dataChanged', { action: 'update', table: tableName, record });
                return record;
            }
            throw e;
        }
    }

    async delete(tableName, id) {
        const { data, error } = await window.supabase
            .from(tableName)
            .delete()
            .eq('id', id)
            .select();
        if (error) throw error;
        this.emit('dataChanged', { action: 'delete', table: tableName, id });
        return data;
    }

    async query(tableName, filters = {}) {
        try {
            let q = window.supabase.from(tableName).select('*');
            for (const [key, value] of Object.entries(filters)) {
                q = q.eq(key, value);
            }
            const { data, error } = await q;
            if (error) throw error;
            return data || [];
        } catch (e) {
            console.warn(`Offline: falling back to localStorage for ${tableName} query`, e);
            const local = localStorage.getItem(`fs_crm_${tableName}`);
            const all = local ? JSON.parse(local) : [];
            return all.filter(row => Object.entries(filters).every(([k, v]) => row[k] == v));
        }
    }

    // Aliases used throughout script.js
    async getById(tableName, id) { return this.get(tableName, id); }
    async create(tableName, record) { return this.add(tableName, record); }
}

// Create and protect the global instance
const _dataStoreInstance = new DataStore();

// Use Object.defineProperty to make window.AppDataStore read‑only and non‑configurable
Object.defineProperty(window, 'AppDataStore', {
    value: _dataStoreInstance,
    writable: false,
    configurable: false,
    enumerable: true
});
console.log('AppDataStore instance created and locked.');
