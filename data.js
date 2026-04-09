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
            'promotion_packages', 'products', 'promotions', 'appointment_locations', 'venues',
            // New features
            'booking_slots', 'booking_appointments', 'booking_pages',
            'lead_forms', 'lead_submissions',
            'surveys', 'survey_responses',
            'contracts',
            'custom_field_definitions', 'custom_field_values',
            'portal_sessions',
            'monthly_promotions',
            'tree_interested',
            'approval_queue',
            // Level 13/14 account type tables
            'user_milestones', 'news_highlights', 'recommendation_rewards', 'user_fudi_summary'
        ];
        this.initialized = false;
        this._events = {};
        this._srClient = null; // Service-role client (bypasses RLS for writes)
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
            // Build a service-role client for write operations (bypasses RLS).
            // Falls back to the regular client if SUPABASE_SR is not set.
            if (window.SUPABASE_URL && window.SUPABASE_SR && typeof window.supabase.constructor === 'function') {
                try {
                    // The global supabase object exposed by the CDN script is the factory namespace.
                    // After supabase-client.js runs, window.supabase is already the *client* instance,
                    // but the factory is gone.  We recreate it from the CDN global if available.
                    const factory = window._supabaseFactory || window.supabase;
                    if (typeof factory.createClient === 'function') {
                        this._srClient = factory.createClient(window.SUPABASE_URL, window.SUPABASE_SR, {
                            auth: { persistSession: false, autoRefreshToken: false }
                        });
                        console.log('DataStore: service-role client initialised (RLS bypassed for writes).');
                    }
                } catch (_) {}
            }

            const { error } = await window.supabase.from('users').select('*').limit(1);
            if (error) throw error;
            this.initialized = true;

            // Permanently tombstone records deleted externally (outside AppDataStore.delete).
            // Add IDs here whenever a record is hard-deleted via Supabase API/dashboard
            // to prevent the sync queue from resurrecting them.
            this._ensureTombstones({
                activities: ['1775653728135', '1775574315672']
            });

            console.log('DataStore initialised (Supabase mode).');
            this.emit('ready');
            return true;
        } catch (err) {
            console.error('Supabase init error:', err);
            this.emit('error', err);
            return false;
        }
    }

    // Returns the service-role client if available, otherwise anon.
    // Used for both reads and writes so Supabase RLS never blocks shared CRM data.
    _writeClient() {
        return this._srClient || window.supabase;
    }

    _readClient() {
        // If _srClient already created, use it
        if (this._srClient) return this._srClient;
        // Try to build service-role client on the fly (bypasses RLS)
        try {
            const factory = window._supabaseFactory;
            if (factory && typeof factory.createClient === 'function' && window.SUPABASE_URL && window.SUPABASE_SR) {
                this._srClient = factory.createClient(window.SUPABASE_URL, window.SUPABASE_SR, {
                    auth: { persistSession: false, autoRefreshToken: false }
                });
                return this._srClient;
            }
        } catch (_) {}
        // Last resort: anon client (subject to RLS)
        return window.supabase;
    }

    _generateId() {
        return Date.now() + Math.floor(Math.random() * 1000);
    }

    // Merge hard-coded tombstones into localStorage so externally-deleted records
    // are never resurrected by the sync queue.
    _ensureTombstones(map) {
        try {
            const tombstones = JSON.parse(localStorage.getItem('fs_crm_tombstones') || '{}');
            let dirty = false;
            for (const [table, ids] of Object.entries(map)) {
                if (!tombstones[table]) tombstones[table] = [];
                for (const id of ids) {
                    if (!tombstones[table].includes(String(id))) {
                        tombstones[table].push(String(id));
                        dirty = true;
                    }
                }
            }
            if (dirty) localStorage.setItem('fs_crm_tombstones', JSON.stringify(tombstones));
        } catch (_) {}
    }

    async getAll(tableName) {
        try {
            const { data, error } = await this._readClient().from(tableName).select('*');
            if (error) throw error;
            // Filter out tombstoned records before caching — prevents deleted items reappearing
            const tombstoneRaw = localStorage.getItem('fs_crm_tombstones');
            const tombstones = tombstoneRaw ? JSON.parse(tombstoneRaw) : {};
            const deletedIds = new Set(tombstones[tableName] || []);
            const serverData = (data || []).filter(r => !deletedIds.has(String(r.id)) && !(tableName === 'users' && r.status === 'deleted'));
            // Auto-sync: push any locally-saved (offline) items to Supabase so ALL users can see them,
            // then return the merged result (includes items still pending sync).
            const result = await this._autoSync(tableName, serverData);
            // Merge with prior localStorage cache so extra fields saved locally
            // (that Supabase stripped due to schema mismatch) are preserved.
            // Server fields always win; local-only fields (extra columns) are kept.
            try {
                const localRaw = localStorage.getItem(`fs_crm_${tableName}`);
                if (localRaw) {
                    const localItems = JSON.parse(localRaw);
                    const localMap = new Map(localItems.map(r => [String(r.id), r]));
                    const merged = result.map(r => {
                        const local = localMap.get(String(r.id));
                        return local ? { ...local, ...r } : r;
                    });
                    localStorage.setItem(`fs_crm_${tableName}`, JSON.stringify(merged));
                    return merged;
                }
            } catch (_) {}
            try { localStorage.setItem(`fs_crm_${tableName}`, JSON.stringify(result)); } catch (_) {}
            return result;
        } catch (e) {
            console.warn(`Offline/error: falling back for ${tableName}`, e);
            // Even when read fails, still try to push queued writes — write endpoint is separate from read
            this._pushQueuedWrites(tableName).catch(() => {});
            // Before localStorage fallback, try direct REST fetch with service-role key
            // (bypasses RLS that may block non-admin users via the Supabase client)
            if (window.SUPABASE_URL && window.SUPABASE_SR) {
                try {
                    const resp = await fetch(`${window.SUPABASE_URL}/rest/v1/${encodeURIComponent(tableName)}?select=*`, {
                        headers: { 'Authorization': `Bearer ${window.SUPABASE_SR}`, 'apikey': window.SUPABASE_SR }
                    });
                    if (resp.ok) {
                        const data = await resp.json();
                        if (data && data.length > 0) {
                            try { localStorage.setItem(`fs_crm_${tableName}`, JSON.stringify(data)); } catch (_) {}
                            return data;
                        }
                    }
                } catch (_) {}
            }
            const local = localStorage.getItem(`fs_crm_${tableName}`);
            return local ? JSON.parse(local) : [];
        }
    }

    // Push queued writes to Supabase even when reads are failing (e.g. 400 on activities).
    // Fire-and-forget — called from getAll's catch block.
    async _pushQueuedWrites(tableName) {
        try {
            const queue = JSON.parse(localStorage.getItem('fs_crm_sync_queue') || '[]');
            const forTable = queue.filter(q => q.tableName === tableName);
            if (forTable.length === 0) return;
            const otherTable = queue.filter(q => q.tableName !== tableName);
            const stillPending = [];
            for (const item of forTable) {
                try {
                    const { error } = await this._writeClient()
                        .from(tableName)
                        .upsert(item.record);
                    if (!error) {
                        console.log(`DataStore: force-pushed queued item ${item.record.id} to ${tableName}`);
                    } else {
                        console.warn(`DataStore: force-push failed for ${item.record.id}: ${error.message}`);
                        stillPending.push(item);
                    }
                } catch (_) {
                    stillPending.push(item);
                }
            }
            localStorage.setItem('fs_crm_sync_queue', JSON.stringify([...otherTable, ...stillPending]));
        } catch (_) {}
    }

    // Auto-sync: pushes locally-saved (offline/network-error) records to Supabase
    // when we have a live connection. Called by getAll() on every successful fetch.
    // Handles BOTH:
    //   (a) Items in the sync queue (fs_crm_sync_queue) — new mechanism
    //   (b) Pre-existing localStorage items not in Supabase — migration for old offline saves
    async _autoSync(tableName, serverData) {
        try {
            const serverIds = new Set(serverData.map(r => String(r.id)));
            const merged = [...serverData];

            // Load tombstones — IDs that were intentionally deleted; never re-create these
            const _tombstoneRaw = localStorage.getItem('fs_crm_tombstones');
            const _tombstones = _tombstoneRaw ? JSON.parse(_tombstoneRaw) : {};
            const deletedIds = new Set(_tombstones[tableName] || []);

            // Step 1 — Migration: disabled. Auto-migrating all localStorage-only items back to
            // Supabase causes externally-deleted records to be resurrected on every getAll().
            // Only the explicit sync queue (step 2) is processed now.

            // Step 2 — Process the sync queue: upsert queued items to Supabase
            const queue = JSON.parse(localStorage.getItem('fs_crm_sync_queue') || '[]');
            const forTable = queue.filter(q => q.tableName === tableName);
            if (forTable.length > 0) {
                const otherTable = queue.filter(q => q.tableName !== tableName);
                const stillPending = [];

                for (const item of forTable) {
                    if (serverIds.has(String(item.record.id))) continue; // already in Supabase
                    if (deletedIds.has(String(item.record.id))) continue; // was deleted — skip
                    try {
                        const { data: inserted, error: uErr } = await this._writeClient()
                            .from(tableName)
                            .upsert(item.record)
                            .select()
                            .single();
                        if (!uErr && inserted) {
                            merged.push(inserted);
                            serverIds.add(String(inserted.id));
                            console.log(`DataStore: auto-synced local item ${item.record.id} to ${tableName}`);
                        } else {
                            // Sync failed — include item locally but keep in queue for next attempt
                            if (!serverIds.has(String(item.record.id))) merged.push(item.record);
                            stillPending.push(item);
                        }
                    } catch (_) {
                        if (!serverIds.has(String(item.record.id))) merged.push(item.record);
                        stillPending.push(item);
                    }
                }
                localStorage.setItem('fs_crm_sync_queue', JSON.stringify([...otherTable, ...stillPending]));
            }

            // Step 3 — Merge local-only extra fields (e.g. schema-mismatch fields like potential_level,
            // close_probability that Supabase stripped) back into server records so they survive the
            // getAll → localStorage overwrite cycle. Runs always, not gated on sync queue.
            try {
                const localRaw = localStorage.getItem(`fs_crm_${tableName}`);
                if (localRaw) {
                    const localMap = new Map(JSON.parse(localRaw).map(r => [String(r.id), r]));
                    for (let i = 0; i < merged.length; i++) {
                        const localRec = localMap.get(String(merged[i].id));
                        if (!localRec) continue;
                        const extra = {};
                        for (const [k, v] of Object.entries(localRec)) {
                            if (!(k in merged[i]) && v != null) extra[k] = v;
                        }
                        if (Object.keys(extra).length > 0) merged[i] = { ...merged[i], ...extra };
                    }
                }
            } catch (_) {}

            return merged;
        } catch (_) {
            return serverData;
        }
    }

    async get(tableName, id) {
        if (id == null || id === 'null' || id === 'undefined') return null;
        try {
            const { data, error } = await this._readClient()
                .from(tableName)
                .select('*')
                .eq('id', id)
                .maybeSingle();
            if (error) throw error;
            if (data) {
                // Merge with localStorage to preserve extra fields not in Supabase schema
                // (same logic as getAll) — server fields always win
                try {
                    const local = localStorage.getItem(`fs_crm_${tableName}`);
                    if (local) {
                        const records = JSON.parse(local);
                        const localRecord = records.find(r => String(r.id) === String(id));
                        if (localRecord) return { ...localRecord, ...data };
                    }
                } catch (_) {}
                return data;
            }
            // Not found in Supabase — check localStorage fallback (schema-mismatch saves)
            const local = localStorage.getItem(`fs_crm_${tableName}`);
            if (local) {
                const records = JSON.parse(local);
                return records.find(r => String(r.id) === String(id)) || null;
            }
            return null;
        } catch (e) {
            // Try direct REST fetch with service-role key before localStorage fallback
            if (window.SUPABASE_URL && window.SUPABASE_SR) {
                try {
                    const resp = await fetch(`${window.SUPABASE_URL}/rest/v1/${encodeURIComponent(tableName)}?select=*&id=eq.${encodeURIComponent(id)}`, {
                        headers: { 'Authorization': `Bearer ${window.SUPABASE_SR}`, 'apikey': window.SUPABASE_SR, 'Accept': 'application/vnd.pgrst.object+json' }
                    });
                    if (resp.ok) {
                        const data = await resp.json();
                        if (data && data.id) return data;
                    }
                } catch (_) {}
            }
            // Offline — search localStorage
            const local = localStorage.getItem(`fs_crm_${tableName}`);
            if (local) {
                const records = JSON.parse(local);
                return records.find(r => String(r.id) === String(id)) || null;
            }
            return null;
        }
    }

    _extractUnknownCol(e) {
        // Check all error fields: message, details, hint
        const sources = [e?.message, e?.details, e?.hint, e?.error].filter(Boolean).join(' ');
        if (!sources) return null;
        // PostgREST/Supabase: "Could not find the 'col' column of 'table' in the schema cache"
        return sources.match(/find the '(\w+)' column/)?.[1]
            || sources.match(/find the "(\w+)" column/)?.[1]
            // PostgreSQL: column "col" of relation / column "col" does not exist
            || sources.match(/column "?(\w+)"? of relation/)?.[1]
            || sources.match(/column "?(\w+)"? does not exist/)?.[1]
            || null;
    }

    _isSchemaError(e) {
        const s = [e?.code, e?.message, e?.details].filter(Boolean).join(' ');
        return /PGRST204|42703|schema cache|does not exist|could not find/i.test(s);
    }

    async add(tableName, record) {
        const dataToInsert = { ...record };
        if (!dataToInsert.id) dataToInsert.id = this._generateId();

        // Try inserting, stripping unknown columns one-by-one on schema errors
        // so data reaches Supabase even when the table schema is missing new columns.
        let insertData = { ...dataToInsert };
        for (let attempt = 0; attempt < 15; attempt++) {
            try {
                const { data, error } = await this._writeClient()
                    .from(tableName)
                    .insert(insertData)
                    .select()
                    .single();
                if (error) throw error;
                // Save full record (including stripped fields) to localStorage
                try {
                    const key = `fs_crm_${tableName}`;
                    const all = JSON.parse(localStorage.getItem(key) || '[]');
                    all.push({ ...insertData, ...dataToInsert, ...data });
                    localStorage.setItem(key, JSON.stringify(all));
                } catch (_) {}
                this.emit('dataChanged', { action: 'add', table: tableName, record: data });
                return data;
            } catch (e) {
                const col = this._extractUnknownCol(e);
                if (col && col in insertData) {
                    delete insertData[col];
                    continue; // retry without the unknown column
                }
                // Broader schema error but no column name extracted — strip all non-primitive fields
                if (this._isSchemaError(e)) {
                    const stripped = {};
                    for (const [k, v] of Object.entries(insertData)) {
                        if (v === null || v === undefined || typeof v !== 'object') stripped[k] = v;
                    }
                    if (Object.keys(stripped).length < Object.keys(insertData).length) {
                        insertData = stripped;
                        continue;
                    }
                }
                console.warn(`Error on insert to ${tableName}: ${e.message} (code: ${e.code}) — saving locally`);
                break;
            }
        }

        // Full localStorage fallback + sync queue so item gets pushed to Supabase when back online
        const key = `fs_crm_${tableName}`;
        try {
            const all = JSON.parse(localStorage.getItem(key) || '[]');
            all.push(dataToInsert);
            localStorage.setItem(key, JSON.stringify(all));
        } catch (_) {}
        // Queue for auto-sync to Supabase on next successful getAll()
        try {
            const syncQueue = JSON.parse(localStorage.getItem('fs_crm_sync_queue') || '[]');
            syncQueue.push({ tableName, record: dataToInsert, timestamp: Date.now() });
            localStorage.setItem('fs_crm_sync_queue', JSON.stringify(syncQueue));
        } catch (_) {}
        this.emit('dataChanged', { action: 'add', table: tableName, record: dataToInsert });
        return dataToInsert;
    }

    async update(tableName, id, updates) {
        let updateData = { ...updates };
        for (let attempt = 0; attempt < 15; attempt++) {
            try {
                const { data, error } = await this._writeClient()
                    .from(tableName)
                    .update(updateData)
                    .eq('id', id)
                    .select()
                    .single();
                if (error) throw error;
                try {
                    const key = `fs_crm_${tableName}`;
                    const all = JSON.parse(localStorage.getItem(key) || '[]');
                    const idx = all.findIndex(r => String(r.id) === String(id));
                    const full = { ...data, ...updates };
                    if (idx >= 0) { all[idx] = full; localStorage.setItem(key, JSON.stringify(all)); }
                } catch (_) {}
                this.emit('dataChanged', { action: 'update', table: tableName, record: data });
                return data;
            } catch (e) {
                const col = this._extractUnknownCol(e);
                if (col && col in updateData) { delete updateData[col]; continue; }
                if (this._isSchemaError(e)) {
                    const stripped = {};
                    for (const [k, v] of Object.entries(updateData)) {
                        if (v === null || v === undefined || typeof v !== 'object') stripped[k] = v;
                    }
                    if (Object.keys(stripped).length < Object.keys(updateData).length) { updateData = stripped; continue; }
                }
                console.warn(`Error on update to ${tableName}: ${e.message} (code: ${e.code}) — saving locally`);
                break;
            }
        }
        const key = `fs_crm_${tableName}`;
        let updatedRecord;
        try {
            const all = JSON.parse(localStorage.getItem(key) || '[]');
            const idx = all.findIndex(r => r.id == id);
            updatedRecord = idx >= 0 ? { ...all[idx], ...updates } : { id, ...updates };
            if (idx >= 0) all[idx] = updatedRecord; else all.push(updatedRecord);
            localStorage.setItem(key, JSON.stringify(all));
        } catch (_) { updatedRecord = { id, ...updates }; }
        // Queue for auto-sync to Supabase on next successful getAll()
        try {
            const syncQueue = JSON.parse(localStorage.getItem('fs_crm_sync_queue') || '[]');
            // Replace existing queue entry for same id+table, or push new
            const qIdx = syncQueue.findIndex(q => q.tableName === tableName && String(q.record.id) === String(id));
            const qEntry = { tableName, record: updatedRecord, timestamp: Date.now() };
            if (qIdx >= 0) syncQueue[qIdx] = qEntry; else syncQueue.push(qEntry);
            localStorage.setItem('fs_crm_sync_queue', JSON.stringify(syncQueue));
        } catch (_) {}
        const record = { id, ...updates };
        this.emit('dataChanged', { action: 'update', table: tableName, record });
        return record;
    }

    async delete(tableName, id) {
        // Hard delete: must succeed in Supabase first — no silent failures.
        // If Supabase rejects the delete, the error is thrown and localStorage is
        // left untouched so the record stays visible (no ghost-resurrection later).
        const { error } = await this._writeClient()
            .from(tableName)
            .delete()
            .eq('id', id);
        if (error) throw error;

        // Supabase confirmed the delete — now clean up local cache
        try {
            const key = `fs_crm_${tableName}`;
            const all = JSON.parse(localStorage.getItem(key) || '[]');
            localStorage.setItem(key, JSON.stringify(all.filter(r => String(r.id) !== String(id))));
        } catch (_) {}
        // Remove from sync queue — no point syncing a deleted item
        try {
            const syncQueue = JSON.parse(localStorage.getItem('fs_crm_sync_queue') || '[]');
            localStorage.setItem('fs_crm_sync_queue', JSON.stringify(
                syncQueue.filter(q => !(q.tableName === tableName && String(q.record.id) === String(id)))
            ));
        } catch (_) {}
        // Tombstone so the record never re-surfaces from a stale cache on next getAll
        try {
            const tombstones = JSON.parse(localStorage.getItem('fs_crm_tombstones') || '{}');
            if (!tombstones[tableName]) tombstones[tableName] = [];
            if (!tombstones[tableName].includes(String(id))) tombstones[tableName].push(String(id));
            localStorage.setItem('fs_crm_tombstones', JSON.stringify(tombstones));
        } catch (_) {}

        this.emit('dataChanged', { action: 'delete', table: tableName, id });
    }

    async query(tableName, filters = {}) {
        try {
            let q = this._readClient().from(tableName).select('*');
            for (const [key, value] of Object.entries(filters)) {
                if (value == null || value === 'null' || value === 'undefined') continue;
                q = q.eq(key, value);
            }
            const { data, error } = await q;
            if (error) throw error;
            return data || [];
        } catch (e) {
            console.warn(`Offline: falling back for ${tableName} query`, e);
            // Try direct REST fetch with service-role key before localStorage fallback
            if (window.SUPABASE_URL && window.SUPABASE_SR) {
                try {
                    const params = new URLSearchParams({ select: '*' });
                    for (const [key, value] of Object.entries(filters)) {
                        if (value != null && value !== 'null' && value !== 'undefined') params.append(key, `eq.${value}`);
                    }
                    const resp = await fetch(`${window.SUPABASE_URL}/rest/v1/${encodeURIComponent(tableName)}?${params}`, {
                        headers: { 'Authorization': `Bearer ${window.SUPABASE_SR}`, 'apikey': window.SUPABASE_SR }
                    });
                    if (resp.ok) {
                        const data = await resp.json();
                        if (data) return data;
                    }
                } catch (_) {}
            }
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
