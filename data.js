/**
 * Feng Shui CRM V8.7 - DataStore Layer (Async Supabase Version)
 * Replaces localStorage with Supabase while maintaining the event system.
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
            'promotion_packages', 'products', 'promotions', 'appointment_locations'
        ];
        this.initialized = false;
        // Event system
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
        
        // Also dispatch global event for cross‑module compatibility
        if (event === 'dataChanged') {
            window.dispatchEvent(new CustomEvent('dataChanged', { detail: data }));
        }
    }

    // --------------------------------------------------------------
    // Initialization – check connection
    // --------------------------------------------------------------
    async init() {
        try {
            if (!window.supabaseClient) {
                throw new Error('Supabase client not found. Ensure supabase-client.js is loaded.');
            }
            // Test connection by fetching one user record
            const { error } = await window.supabaseClient.from('users').select('*').limit(1);
            if (error) throw error;
            
            this.initialized = true;
            console.log('DataStore initialised (Supabase mode). Tables:', this.tables.length);
            this.emit('ready');
            return true;
        } catch (err) {
            console.error('Supabase init error:', err);
            this.emit('error', err);
            return false;
        }
    }

    // --------------------------------------------------------------
    // Helper: Generate Numeric ID (for tables that don't auto-gen)
    // --------------------------------------------------------------
    _generateId() {
        return Date.now() + Math.floor(Math.random() * 1000);
    }

    // --------------------------------------------------------------
    // Core CRUD methods
    // --------------------------------------------------------------
    async getAll(tableName) {
        const { data, error } = await window.supabaseClient.from(tableName).select('*');
        if (error) throw error;
        return data || [];
    }

    async get(tableName, id) {
        const { data, error } = await window.supabaseClient
            .from(tableName)
            .select('*')
            .eq('id', id)
            .maybeSingle();
        if (error) throw error;
        return data;
    }

    async add(tableName, record) {
        // If the record doesn't have an ID, we assume the DB handles it or we gen one
        const dataToInsert = { ...record };
        // if (!dataToInsert.id) dataToInsert.id = this._generateId(); 

        const { data, error } = await window.supabaseClient
            .from(tableName)
            .insert(dataToInsert)
            .select()
            .single();
        if (error) throw error;
        
        this.emit('dataChanged', { action: 'add', table: tableName, record: data });
        return data;
    }

    async update(tableName, id, updates) {
        const { data, error } = await window.supabaseClient
            .from(tableName)
            .update(updates)
            .eq('id', id)
            .select()
            .single();
        if (error) throw error;
        
        this.emit('dataChanged', { action: 'update', table: tableName, record: data });
        return data;
    }

    async delete(tableName, id) {
        const { data, error } = await window.supabaseClient
            .from(tableName)
            .delete()
            .eq('id', id)
            .select();
        if (error) throw error;
        
        this.emit('dataChanged', { action: 'delete', table: tableName, id });
        return data;
    }

    // --------------------------------------------------------------
    // Query method – translates simple filters to Supabase .eq()
    // --------------------------------------------------------------
    async query(tableName, filters = {}) {
        let query = window.supabaseClient.from(tableName).select('*');
        for (const [key, value] of Object.entries(filters)) {
            query = query.eq(key, value);
        }
        const { data, error } = await query;
        if (error) throw error;
        return data || [];
    }
}

// Create a single instance to be used throughout the app
window.DataStore = new DataStore();