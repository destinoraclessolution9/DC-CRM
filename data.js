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
            'user_milestones', 'news_highlights', 'recommendation_rewards', 'user_fudi_summary',
            // User preferences (migrated from localStorage)
            'user_preferences',
            // Special Program Fighting (incentive programs for selected agents)
            'special_programs', 'special_program_participants',
            // v6 Pipeline Scoring Rules (editable config + history)
            'pipeline_config', 'pipeline_config_history',
            // Marketing list sub-catalogs
            'bujishu', 'formula',
            // Formula Healthcare refill reminder system
            'refill_reminders',
            // Egg Purchasing system (Super Admin only)
            'egg_processed_orders', 'egg_urgent_orders', 'egg_config', 'egg_run_history'
        ];
        this.initialized = false;
        this._events = {};
        // NOTE: _srClient removed 2026-04-21. RLS is now enabled on every public
        // table with an `authenticated` policy granting full access, so the anon
        // client (with a live auth session) works for all queries. The
        // service-role key is no longer sent to the browser.

        // ── In-memory cache ──────────────────────────────────────────────
        // Keyed by tableName → { data: [], ts: Date.now() }
        // TTL: 30 s for mutable tables, 120 s for near-static ones.
        this._cache = new Map();
        this._cacheTTL = 300_000; // 5 min (was 30s — too aggressive for 500 concurrent users)
        this._staticTables = new Set([
            'users', 'roles', 'teams', 'event_categories', 'event_templates',
            'products', 'appointment_locations', 'venues', 'ai_models',
        ]);

        // ── Heavy-column exclusions for getAll() ─────────────────────────
        // Some columns carry large base64 BLOBs (CPS form PDFs stored as text)
        // that bloat every getAll('prospects') call into a ~10 MB download,
        // turning the Prospects page load into a 10-second stall for ALL users.
        //
        // The approach: keep a per-table explicit column list that OMITS the
        // heavy columns. getAll() uses this list in its PostgREST `select`
        // parameter so the bytes never leave the server. getById() still uses
        // `select=*` to fetch the full row (including the heavy column) when
        // the user actually needs it (e.g. when opening a prospect's profile
        // to view the CPS form).
        //
        // If a new column is added to the table that isn't in this list, it
        // simply won't appear in list-view results until it's added here —
        // write operations (insert/update) are unaffected, and getById returns
        // every column so the detail view still sees it. That's an acceptable
        // tradeoff for avoiding a 9.7 MB download on every list fetch.
        // IMPORTANT: this column list must match the actual prospects schema
        // (minus cps_form_data). If a new column is added to Supabase, add it
        // here so it flows into list views. Unknown columns here cause PostgREST
        // 400, which the fallback retry-with-'*' handles gracefully — but that
        // also re-downloads the 9.7 MB blob, defeating the point. So keep this
        // list authoritative.
        this._lightSelects = {
            // Prospects: verified against actual DB schema 2026-04-16.
            // EXCLUDES cps_form_data (base64 PDF blob — causes 27 MB download).
            // Added: appraisal_form_urls, apu_form_urls, cps_interest, life_chart_type (new columns).
            prospects: 'id,full_name,nickname,title,gender,nationality,phone,email,ic_number,date_of_birth,lunar_birth,ming_gua,element,occupation,company_name,income_range,address,city,state,postal_code,responsible_agent_id,cps_agent_id,cps_assignment_date,protection_deadline,pipeline_stage,deal_value,expected_close_date,status,referred_by,referred_by_id,referred_by_type,referral_relationship,cps_invitation_method,cps_invitation_details,cps_attachment,score,tags,notes,created_at,updated_at,cps_form_date,cps_form_name,closing_record,closing_records_history,conversion_status,conversion_requested_by,conversion_rejected_by,conversion_rejected_at,closed_at,closed_date,closing_date,potential_level,close_probability,is_own_business,business_name,business_industry,business_area,business_title_role,business_started,company_size,pre2025_purchases,original_source,source_id,source,lead_agent_id,appraisal_form_urls,apu_form_urls,cps_interest,manual_grade,feng_shui_audits,life_chart_type,last_activity_date',
            // Activities: verified against actual DB schema 2026-04-16.
            // Excludes: consultants (JSONB blob), payment detail columns,
            // long discussion_summary field — only needed in detail/edit view.
            // photo_urls is included: it is a JSONB array of short URLs (not a blob)
            // and must appear in list/tab views so Meet Up History can show thumbnails.
            activities: 'id,activity_type,activity_date,activity_title,prospect_id,customer_id,lead_agent_id,start_time,end_time,visibility,co_agents,event_id,closing_amount,amount_closed,is_closing,solution_sold,location_address,venue,status,unable_to_serve,unable_reason,note_key_points,note_outcome,note_next_steps,cps_invitation_method,cps_invitation_details,source,created_at,updated_at,score_value,is_closed,next_action,next_action_done,completed_at,photo_urls'
        };
    }

    // PostgREST `select` clause to use for a given table. Lets us omit heavy
    // BLOB columns from list fetches. Unknown columns in the list are ignored
    // by PostgREST with a 400 error, so we wrap the fetch in a try that falls
    // back to '*' if the column list becomes stale.
    _selectClauseForGetAll(tableName) {
        return this._lightSelects[tableName] || '*';
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
        if (this._events[event]) {
            this._events[event].forEach(cb => cb(data));
        }
        // Always dispatch dataChanged as a window event — the app's initSync
        // listener in script.js depends on this to auto-refresh the current
        // view after mutations and SWR revalidation. This fires regardless of
        // whether any internal listeners were registered.
        if (event === 'dataChanged') {
            window.dispatchEvent(new CustomEvent('dataChanged', { detail: data }));
        }
    }

    async init() {
        try {
            if (!window.supabase) {
                throw new Error('Supabase client not found.');
            }
            // Service-role client creation removed — RLS is now the source of
            // authorisation. All queries go through window.supabase (anon key +
            // auth session JWT). See the RLS migration note in index.html for
            // the policy setup.

            const { error } = await window.supabase.from('users').select('*').limit(1);
            if (error) throw error;
            this.initialized = true;

            // Permanently tombstone records deleted externally (outside AppDataStore.delete).
            // Add IDs here whenever a record is hard-deleted via Supabase API/dashboard
            // to prevent the sync queue from resurrecting them.
            this._ensureTombstones({
                activities: ['1775653728135', '1775574315672', '1775574533626']
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

    // All reads and writes go through the anon client now that RLS policies
    // are in place. The auth session JWT is automatically attached by
    // supabase-js, so `authenticated` policies see auth.uid() and auth.role()
    // as expected. These methods stay as shims so the rest of the file doesn't
    // have to change when we later introduce a different read/write client
    // (e.g. a service-side proxy).
    _writeClient() { return window.supabase; }
    _readClient()  { return window.supabase; }

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

    // ── Cache helpers ────────────────────────────────────────────────────
    _cacheGet(tableName) {
        const entry = this._cache.get(tableName);
        if (!entry) return null;
        const ttl = this._staticTables.has(tableName) ? 120_000 : this._cacheTTL;
        if (Date.now() - entry.ts > ttl) { this._cache.delete(tableName); return null; }
        return entry.data;
    }

    _cacheSet(tableName, data) {
        this._cache.set(tableName, { data, ts: Date.now() });
    }

    // Invalidate cache for a table (and any table that depends on it)
    invalidateCache(tableName) {
        this._cache.delete(tableName);
        // Derived caches that must expire whenever their source table changes.
        // `__prospects_active_{days}` is populated by getActiveProspects() and
        // depends on prospects.last_activity_date, which is kept in sync by a
        // DB trigger on activities — so a write to either table must evict it.
        if (tableName === 'prospects' || tableName === 'activities') {
            for (const k of this._cache.keys()) {
                if (typeof k === 'string' && k.startsWith('__prospects_active_')) {
                    this._cache.delete(k);
                }
            }
        }
    }

    // Force-expire everything (e.g. after bulk import)
    clearCache() {
        this._cache.clear();
    }

    // ── Stale-while-revalidate (SWR) helpers ─────────────────────────────
    // Read the previous session's snapshot from localStorage. Returns null if
    // missing, empty, or corrupt. Applies the same tombstone + soft-delete
    // filtering as the main fetch path so SWR results stay consistent.
    _swrGetLocal(tableName) {
        try {
            const raw = localStorage.getItem(`fs_crm_${tableName}`);
            if (!raw) return null;
            const data = JSON.parse(raw);
            if (!Array.isArray(data) || data.length === 0) return null;
            const tombstoneRaw = localStorage.getItem('fs_crm_tombstones');
            const tombstones = tombstoneRaw ? JSON.parse(tombstoneRaw) : {};
            const deletedIds = new Set(tombstones[tableName] || []);
            return data.filter(r =>
                !deletedIds.has(String(r.id)) &&
                !(tableName === 'users' && r.status === 'deleted')
            );
        } catch (_) {
            return null;
        }
    }

    // Background fetch that refreshes stale data. Dedupes with _inFlightGetAll
    // so a concurrent { fresh: true } call shares this network request. Only
    // emits dataChanged when the fresh rows actually differ from the stale
    // snapshot — prevents unnecessary re-renders when nothing changed.
    async _swrRevalidate(tableName) {
        if (!this._swrInFlight) this._swrInFlight = new Set();
        if (this._swrInFlight.has(tableName)) return;
        this._swrInFlight.add(tableName);

        const prevEntry = this._cache.get(tableName);
        const prevSnapshot = (prevEntry && prevEntry.data) || [];

        try {
            // ── Incremental (delta) sync ─────────────────────────────────
            // If we have a lastSync timestamp, only fetch rows changed since
            // then instead of downloading the full table. For large tables
            // (activities, prospects) this turns a 2 MB background download
            // into a near-zero payload on most revalidations.
            // Falls back to full fetch if: no timestamp, table has no
            // updated_at column (PostgREST 400), or network error.
            const lastSync = localStorage.getItem(`fs_crm_${tableName}_last_sync`);
            if (lastSync) {
                try {
                    const delta = await this.getAllSince(tableName, lastSync);
                    const now = new Date().toISOString();
                    if (delta.length > 0) {
                        // Merge delta into the existing cached snapshot.
                        // Server rows always win; tombstoned ids are filtered out.
                        const merged = new Map(prevSnapshot.map(r => [String(r.id), r]));
                        for (const r of delta) merged.set(String(r.id), r);
                        const tombstoneRaw = localStorage.getItem('fs_crm_tombstones');
                        const deletedIds = new Set(
                            tombstoneRaw ? (JSON.parse(tombstoneRaw)[tableName] || []) : []
                        );
                        const result = Array.from(merged.values())
                            .filter(r => !deletedIds.has(String(r.id)));
                        this._cacheSet(tableName, result);
                        setTimeout(() => {
                            try {
                                localStorage.setItem(`fs_crm_${tableName}`, JSON.stringify(result));
                                localStorage.setItem(`fs_crm_${tableName}_last_sync`, now);
                            } catch (_) {}
                        }, 0);
                        console.log(`[SWR] ${tableName}: delta sync — ${delta.length} changed rows merged`);
                        this.emit('dataChanged', { action: 'revalidate', table: tableName });
                    } else {
                        // No changes since last sync — just refresh the timestamp.
                        try { localStorage.setItem(`fs_crm_${tableName}_last_sync`, now); } catch (_) {}
                        console.log(`[SWR] ${tableName}: delta sync — no changes`);
                    }
                    return; // Delta path succeeded — skip full fetch below.
                } catch (_) {
                    // Delta fetch failed (e.g. table has no updated_at column,
                    // or network hiccup). Fall through to full fetch.
                    console.warn(`[SWR] ${tableName}: delta sync failed, falling back to full fetch`);
                }
            }

            // ── Full fetch (cold cache or delta fallback) ────────────────
            if (!this._inFlightGetAll) this._inFlightGetAll = new Map();
            let fetchPromise = this._inFlightGetAll.get(tableName);
            if (!fetchPromise) {
                fetchPromise = this._getAllImpl(tableName).finally(() => {
                    this._inFlightGetAll.delete(tableName);
                });
                this._inFlightGetAll.set(tableName, fetchPromise);
            }
            const fresh = await fetchPromise;

            if (this._snapshotsDiffer(prevSnapshot, fresh)) {
                // _getAllImpl already updated the in-memory cache with fresh
                // data. Emitting dataChanged triggers refreshCurrentView in
                // script.js for any view that depends on this table.
                console.log(`[SWR] ${tableName}: full revalidated (changed ${prevSnapshot.length} → ${fresh.length}), refreshing view`);
                this.emit('dataChanged', { action: 'revalidate', table: tableName });
            }
        } catch (_) {
            // Silent failure — user keeps seeing the stale data
        } finally {
            this._swrInFlight.delete(tableName);
        }
    }

    // Cheap change detection: fingerprint rows by id + last-modified stamp
    // and compare as a single string. O(n log n) on row count.
    _snapshotsDiffer(a, b) {
        if (!Array.isArray(a) || !Array.isArray(b)) return true;
        if (a.length !== b.length) return true;
        const fingerprint = (arr) =>
            arr.map(r => `${r.id}:${r.updated_at || r.created_at || r.modified_at || ''}`)
               .sort().join('|');
        return fingerprint(a) !== fingerprint(b);
    }

    async getAll(tableName, options = {}) {
        // Opt-out of SWR: callers that need guaranteed-fresh data (e.g. a
        // duplicate check before an insert) can pass { fresh: true } to force
        // a full Supabase round trip and bypass both caches.
        if (options && options.fresh) {
            this.invalidateCache(tableName);
        } else {
            // Tier 1 — in-memory cache hit (fastest path)
            const cached = this._cacheGet(tableName);
            if (cached) return cached;

            // Tier 2 — stale-while-revalidate: if the previous session wrote
            // this table to localStorage, serve it instantly and kick off a
            // background fetch to refresh it. Makes repeat page loads feel
            // instant — the list shows immediately and live values stream in
            // within 1–3 s via the dataChanged event.
            const stale = this._swrGetLocal(tableName);
            if (stale) {
                // Prime the in-memory cache with the stale snapshot so parallel
                // callers during the same render cycle reuse it instead of
                // firing more background fetches.
                this._cacheSet(tableName, stale);
                console.log(`[SWR] ${tableName}: served ${stale.length} rows instantly from cache`);
                // Fire-and-forget background refresh
                this._swrRevalidate(tableName).catch(() => {});
                return stale;
            }
        }

        // Tier 3 — cold path (first-ever visit or explicit fresh request).
        // In-flight promise deduplication: if another caller already started a
        // fetch for this table on the current cold cache, await the same promise
        // instead of firing a second network request. This is critical during
        // page loads where multiple render functions concurrently ask for the
        // same tables (activities, prospects, customers, users). Without this
        // dedupe, N concurrent callers create N Supabase round trips; with it,
        // they all share one.
        if (!this._inFlightGetAll) this._inFlightGetAll = new Map();
        const existingPromise = this._inFlightGetAll.get(tableName);
        if (existingPromise) return existingPromise;

        const fetchPromise = this._getAllImpl(tableName).finally(() => {
            this._inFlightGetAll.delete(tableName);
        });
        this._inFlightGetAll.set(tableName, fetchPromise);
        return fetchPromise;
    }

    // Fetch only rows where updated_at > sinceISO. Used by _swrRevalidate for
    // incremental (delta) sync so background revalidations download only changed
    // rows instead of the full table. Applies the same light-select as getAll.
    // Throws on error so the caller can fall back to a full fetch.
    async getAllSince(tableName, sinceISO) {
        const selectClause = this._selectClauseForGetAll(tableName);
        let { data, error } = await this._readClient()
            .from(tableName)
            .select(selectClause)
            .gt('updated_at', sinceISO);
        // If the light-select column list is stale, retry with '*'
        if (error && selectClause !== '*') {
            ({ data, error } = await this._readClient()
                .from(tableName)
                .select('*')
                .gt('updated_at', sinceISO));
        }
        if (error) throw error;
        return data || [];
    }

    async _getAllImpl(tableName) {
        const selectClause = this._selectClauseForGetAll(tableName);
        try {
            let data, error;
            ({ data, error } = await this._readClient().from(tableName).select(selectClause));
            // If the light-select column list is stale (e.g. a column was renamed
            // or dropped), PostgREST returns a 400. Fall back to '*' once so the
            // page still loads with the full row (including the heavy column).
            if (error && selectClause !== '*') {
                console.warn(`Light select failed for ${tableName}, retrying with *:`, error.message);
                ({ data, error } = await this._readClient().from(tableName).select('*'));
            }
            if (error) throw error;
            // Supabase caps getAll() implicitly at 1000 rows per request. If we
            // ever hit that cap, some rows are being silently dropped — warn so
            // the caller knows to migrate to queryAdvanced() with explicit
            // pagination.
            if (Array.isArray(data) && data.length === 1000) {
                console.warn(`[DataStore] getAll('${tableName}') returned exactly 1000 rows — may be truncated by Supabase default limit. Consider queryAdvanced() with pagination.`);
            }
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
            // The localStorage write itself is deferred off the critical path —
            // setting a ~500KB JSON string synchronously was measurably blocking
            // the calendar render on cold cache.
            try {
                const localRaw = localStorage.getItem(`fs_crm_${tableName}`);
                if (localRaw) {
                    const localItems = JSON.parse(localRaw);
                    const localMap = new Map(localItems.map(r => [String(r.id), r]));
                    const merged = result.map(r => {
                        const local = localMap.get(String(r.id));
                        return local ? { ...local, ...r } : r;
                    });
                    this._cacheSet(tableName, merged);
                    setTimeout(() => {
                        try {
                            localStorage.setItem(`fs_crm_${tableName}`, JSON.stringify(merged));
                            // Record sync time so _swrRevalidate can use delta fetch next time
                            localStorage.setItem(`fs_crm_${tableName}_last_sync`, new Date().toISOString());
                        } catch (_) {}
                    }, 0);
                    return merged;
                }
            } catch (_) {}
            this._cacheSet(tableName, result);
            setTimeout(() => {
                try {
                    localStorage.setItem(`fs_crm_${tableName}`, JSON.stringify(result));
                    // Record sync time so _swrRevalidate can use delta fetch next time
                    localStorage.setItem(`fs_crm_${tableName}_last_sync`, new Date().toISOString());
                } catch (_) {}
            }, 0);
            return result;
        } catch (e) {
            // Detect "table doesn't exist in schema" — PGRST205 or explicit not-found messages.
            // These are benign in this codebase (tables provisioned lazily), so don't log noisily,
            // don't bother retrying via direct REST, and memoize the miss so repeated getAll()
            // calls on the same cold cache don't all re-hit Supabase with the same 404.
            const isMissingTable = e?.code === 'PGRST205'
                || /schema cache|could not find the table|relation ".+" does not exist/i.test(e?.message || '');
            if (isMissingTable) {
                this._cacheSet(tableName, []);
                const local = localStorage.getItem(`fs_crm_${tableName}`);
                const tombstoneRaw = localStorage.getItem('fs_crm_tombstones');
                const tombstones = tombstoneRaw ? JSON.parse(tombstoneRaw) : {};
                const deletedIds = new Set(tombstones[tableName] || []);
                return local ? JSON.parse(local).filter(r => !deletedIds.has(String(r.id))) : [];
            }
            console.warn(`Offline/error: falling back for ${tableName}`, e);
            // Even when read fails, still try to push queued writes — write endpoint is separate from read
            this._pushQueuedWrites(tableName).catch(() => {});
            // Always strip tombstoned IDs from any fallback path so deleted records can never reappear
            const tombstoneRaw = localStorage.getItem('fs_crm_tombstones');
            const tombstones = tombstoneRaw ? JSON.parse(tombstoneRaw) : {};
            const deletedIds = new Set(tombstones[tableName] || []);
            const stripDeleted = (rows) => rows.filter(r => !deletedIds.has(String(r.id)));
            // Service-role REST fallback removed. The primary Supabase client
            // already carries the anon key + auth session JWT, and RLS policies
            // are set up so authenticated users can read. Fall straight to the
            // offline localStorage cache if the primary fetch failed.
            const local = localStorage.getItem(`fs_crm_${tableName}`);
            return local ? stripDeleted(JSON.parse(local)) : [];
        }
    }

    // Push queued writes to Supabase even when reads are failing (e.g. 400 on activities).
    // Fire-and-forget — called from getAll's catch block.
    // Honors tombstones so externally-deleted records are NEVER force-resurrected.
    async _pushQueuedWrites(tableName) {
        try {
            const queue = JSON.parse(localStorage.getItem('fs_crm_sync_queue') || '[]');
            const forTable = queue.filter(q => q.tableName === tableName);
            if (forTable.length === 0) return;
            const tombstoneRaw = localStorage.getItem('fs_crm_tombstones');
            const tombstones = tombstoneRaw ? JSON.parse(tombstoneRaw) : {};
            const deletedIds = new Set(tombstones[tableName] || []);
            const otherTable = queue.filter(q => q.tableName !== tableName);
            const stillPending = [];
            for (const item of forTable) {
                if (deletedIds.has(String(item.record.id))) continue; // dropped from queue, never resurrect
                if (item.pushed) continue; // already synced once — never re-push (prevents resurrection of externally-deleted records)
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
            // CRITICAL: an item that has already been pushed once (item.pushed === true) but is
            // NO LONGER in serverData has been deleted externally (Supabase dashboard, SQL, RLS).
            // We must NOT re-push it — that would resurrect the ghost. Instead we drop it from the
            // queue and tombstone it so future getAll calls also ignore it.
            const queue = JSON.parse(localStorage.getItem('fs_crm_sync_queue') || '[]');
            const forTable = queue.filter(q => q.tableName === tableName);
            if (forTable.length > 0) {
                const otherTable = queue.filter(q => q.tableName !== tableName);
                const stillPending = [];
                const newTombstones = [];

                for (const item of forTable) {
                    const idStr = String(item.record.id);
                    // Already in Supabase — confirmed synced, drop from queue
                    if (serverIds.has(idStr)) continue;
                    // Already tombstoned — drop from queue
                    if (deletedIds.has(idStr)) continue;
                    // Already pushed once before, but missing from server now → externally deleted
                    if (item.pushed) {
                        newTombstones.push(idStr);
                        console.log(`DataStore: dropping ghost queue item ${idStr} for ${tableName} (externally deleted)`);
                        continue;
                    }
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
                            // First push succeeded — flag as pushed so a later "missing from server"
                            // is treated as an external deletion, not a fresh sync attempt.
                            // We don't actually keep it in the queue (success path doesn't push to
                            // stillPending), but if a later code path re-queues, the flag persists.
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
                // Persist any new tombstones discovered during this pass
                if (newTombstones.length > 0) {
                    try {
                        const tomb = JSON.parse(localStorage.getItem('fs_crm_tombstones') || '{}');
                        if (!tomb[tableName]) tomb[tableName] = [];
                        for (const id of newTombstones) {
                            if (!tomb[tableName].includes(id)) tomb[tableName].push(id);
                        }
                        localStorage.setItem('fs_crm_tombstones', JSON.stringify(tomb));
                    } catch (_) {}
                }
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

        // If the whole table is already cached, do a synchronous in-memory lookup
        // instead of a network round trip. For tables with heavy columns excluded
        // from getAll (e.g. prospects.cps_form_data), the cached row will be
        // "light" — missing the blob. That's fine for most call sites (table
        // rendering, agent lookups, etc.). Callers that specifically need the
        // heavy column (e.g. rendering the CPS form image in the profile) should
        // use getByIdFull() which always does a network fetch with select=*.
        const cachedTable = this._cacheGet(tableName);
        if (cachedTable) {
            return cachedTable.find(r => String(r.id) === String(id)) || null;
        }

        // Tier 2 — stale-while-revalidate. When the in-memory cache has
        // expired (TTL 2 min for static tables, 5 min otherwise), getAll
        // already serves from localStorage + background-refreshes. getById
        // used to skip that path and go straight to the network, so any
        // screen making 3-4 serial getById calls after the in-memory cache
        // expired took 8-12 s on mobile (e.g. the Activity Details modal).
        // Mirror the getAll SWR behaviour here: serve the row from the
        // localStorage snapshot instantly, prime the in-memory cache so
        // sibling getById calls hit Tier 1, and kick off a background
        // refresh. Fall through to the network only if the row isn't in
        // the snapshot (newly created since last sync).
        const stale = this._swrGetLocal(tableName);
        if (stale && stale.length > 0) {
            this._cacheSet(tableName, stale);
            this._swrRevalidate(tableName).catch(() => {});
            const found = stale.find(r => String(r.id) === String(id));
            if (found) return found;
        }

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
            // Service-role REST fallback removed — rely on localStorage cache
            // if the primary Supabase query fails.
            const local = localStorage.getItem(`fs_crm_${tableName}`);
            if (local) {
                const records = JSON.parse(local);
                return records.find(r => String(r.id) === String(id)) || null;
            }
            return null;
        }
    }

    // Always fetch the full row from Supabase with select=*, bypassing the
    // in-memory cache. Use this when you specifically need columns that were
    // excluded from the getAll light-select (e.g. prospects.cps_form_data).
    async getByIdFull(tableName, id) {
        if (id == null || id === 'null' || id === 'undefined') return null;
        try {
            const { data, error } = await this._readClient()
                .from(tableName)
                .select('*')
                .eq('id', id)
                .maybeSingle();
            if (error) throw error;
            return data || null;
        } catch (e) {
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
                this._writeAudit('insert', tableName, data.id || insertData.id, null, data);
                this.invalidateCache(tableName);
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
        this.invalidateCache(tableName);
        this.emit('dataChanged', { action: 'add', table: tableName, record: dataToInsert });
        return dataToInsert;
    }

    // ── Audit trail (fire-and-forget) ────────────────────────────────────
    // Writes a row to audit_logs for every update/delete on business-critical
    // tables. Non-blocking: a failure here (e.g. audit_logs unreachable, RLS
    // deny) NEVER prevents the user's mutation from succeeding. The value is
    // dispute resolution — "who changed this prospect's phone last Tuesday?"
    //
    // user_id is pulled from window._currentUser (set by script.js login
    // flow). If absent (e.g. system-triggered write before login completes),
    // the row is still logged with user_id = null.
    _isAuditedTable(tableName) {
        // Static set kept as a method-local cache so the class body stays in
        // the same object-method style as the rest of the file.
        if (!this.__auditedTables) {
            this.__auditedTables = new Set([
                'prospects', 'customers', 'activities', 'users',
                'transactions', 'referrals', 'approval_queue',
                'event_attendees', 'notes', 'assignments',
            ]);
        }
        return this.__auditedTables.has(tableName);
    }

    _writeAudit(action, tableName, entityId, oldData, newData) {
        if (!this._isAuditedTable(tableName)) return;
        // Diff: only keep fields that actually changed to keep the log small.
        // Large blobs (cps_form_data, photo_urls arrays) are already excluded
        // by the light-select, so old/new here won't carry them either.
        let oldSlim = null, newSlim = null;
        if (action === 'update' && oldData && newData) {
            oldSlim = {}; newSlim = {};
            for (const k of Object.keys(newData)) {
                if (k === 'updated_at') continue; // noise
                const o = oldData[k], n = newData[k];
                if (JSON.stringify(o) !== JSON.stringify(n)) {
                    oldSlim[k] = o === undefined ? null : o;
                    newSlim[k] = n === undefined ? null : n;
                }
            }
            // If nothing changed, skip the audit row entirely.
            if (Object.keys(newSlim).length === 0) return;
        } else if (action === 'delete') {
            oldSlim = oldData || null;
            newSlim = null;
        } else if (action === 'insert') {
            oldSlim = null;
            newSlim = newData || null;
        }

        const row = {
            user_id: (window._currentUser?.id) || null,
            action,
            entity_type: tableName,
            entity_id: entityId,
            old_data: oldSlim,
            new_data: newSlim,
            user_agent: (navigator && navigator.userAgent) ? navigator.userAgent.slice(0, 255) : null,
            created_at: new Date().toISOString(),
        };
        // Fire-and-forget — swallow errors, never block the caller.
        this._writeClient().from('audit_logs').insert(row).then(
            () => {},
            (e) => console.debug('[audit] write failed (non-fatal):', e?.message)
        );
    }

    async update(tableName, id, updates) {
        let updateData = { ...updates };
        // Capture pre-update snapshot for audit diff. Best-effort: if the
        // row isn't in cache we skip the `old_data` side of the diff rather
        // than round-trip for every update.
        let _auditOldData = null;
        if (this._isAuditedTable(tableName)) {
            try {
                const cached = this._cacheGet(tableName);
                if (cached) {
                    const existing = cached.find(r => String(r.id) === String(id));
                    if (existing) _auditOldData = { ...existing };
                }
            } catch (_) {}
        }
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
                this._writeAudit('update', tableName, id, _auditOldData, data);
                this.invalidateCache(tableName);
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
                // PGRST116 = zero rows matched .single() — the row doesn't exist in Supabase.
                // Two cases:
                //   (a) Local-only record that never reached Supabase (e.g. an offline create
                //       that failed to sync). Editing it must persist the user's changes, so
                //       we INSERT the row instead of silently dropping the edit.
                //   (b) Row was explicitly deleted (tombstoned). Honor the deletion by
                //       cleaning up the stale local copy.
                if (e?.code === 'PGRST116') {
                    let isTombstoned = false;
                    try {
                        const tRaw = localStorage.getItem('fs_crm_tombstones');
                        const tombstones = tRaw ? JSON.parse(tRaw) : {};
                        isTombstoned = (tombstones[tableName] || []).map(String).includes(String(id));
                    } catch (_) {}
                    if (isTombstoned) {
                        // Case (b): row was explicitly deleted — honor it, clean up the stale
                        // local copy, return null so the caller can show "deleted" feedback.
                        try {
                            const key = `fs_crm_${tableName}`;
                            const all = JSON.parse(localStorage.getItem(key) || '[]');
                            const filtered = all.filter(r => String(r.id) !== String(id));
                            if (filtered.length !== all.length) localStorage.setItem(key, JSON.stringify(filtered));
                        } catch (_) {}
                        this.invalidateCache(tableName);
                        return null;
                    }
                    // Case (a): try to INSERT so the user's edit is preserved. Pull the
                    // existing local row to fill in fields the form didn't touch (created_at,
                    // created_by, etc.) so we don't accidentally clobber them with NULLs.
                    // Stale local rows often carry columns that no longer exist in the
                    // schema (e.g. `event_title` from before commit 7a8b725) — strip
                    // unknown columns one at a time and retry until the insert sticks.
                    let baseRow = {};
                    try {
                        const key = `fs_crm_${tableName}`;
                        const all = JSON.parse(localStorage.getItem(key) || '[]');
                        const existing = all.find(r => String(r.id) === String(id));
                        if (existing) baseRow = existing;
                    } catch (_) {}
                    let insertPayload = { ...baseRow, ...updateData, id };
                    let inserted = null;
                    let lastInsertErr = null;
                    for (let insAttempt = 0; insAttempt < 30; insAttempt++) {
                        try {
                            const { data: insData, error: insErr } = await this._writeClient()
                                .from(tableName)
                                .insert(insertPayload)
                                .select()
                                .single();
                            if (!insErr && insData) { inserted = insData; break; }
                            if (insErr) {
                                lastInsertErr = insErr;
                                const insCol = this._extractUnknownCol(insErr);
                                if (insCol && insCol in insertPayload) {
                                    delete insertPayload[insCol];
                                    continue;
                                }
                                if (this._isSchemaError(insErr)) {
                                    // Drop any object/array columns that PostgREST can't coerce.
                                    const cleaned = {};
                                    for (const [k, v] of Object.entries(insertPayload)) {
                                        if (v === null || v === undefined || typeof v !== 'object') cleaned[k] = v;
                                    }
                                    if (Object.keys(cleaned).length < Object.keys(insertPayload).length) {
                                        insertPayload = cleaned;
                                        continue;
                                    }
                                }
                                // Unknown error type — give up
                                break;
                            }
                            break;
                        } catch (thrown) {
                            lastInsertErr = thrown;
                            break;
                        }
                    }
                    if (inserted) {
                        try {
                            const key = `fs_crm_${tableName}`;
                            const all = JSON.parse(localStorage.getItem(key) || '[]');
                            const idx = all.findIndex(r => String(r.id) === String(id));
                            const full = { ...inserted, ...updates };
                            if (idx >= 0) all[idx] = full; else all.push(full);
                            localStorage.setItem(key, JSON.stringify(all));
                        } catch (_) {}
                        this.invalidateCache(tableName);
                        this.emit('dataChanged', { action: 'update', table: tableName, record: inserted });
                        return inserted;
                    }
                    // Insert failed even after stripping (RLS, FK violation, etc.). Fall
                    // through to the local-save path below — preserves the user's edit
                    // in localStorage and queues it for auto-sync on the next read.
                    console.warn(`PGRST116 on update to ${tableName} id=${id}; insert fallback failed:`, lastInsertErr?.message || lastInsertErr);
                    break;
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
        this.invalidateCache(tableName);
        this.emit('dataChanged', { action: 'update', table: tableName, record });
        return record;
    }

    async delete(tableName, id) {
        // Capture pre-delete snapshot for audit trail (best-effort from cache).
        let _auditOldData = null;
        if (this._isAuditedTable(tableName)) {
            try {
                const cached = this._cacheGet(tableName);
                if (cached) {
                    const existing = cached.find(r => String(r.id) === String(id));
                    if (existing) _auditOldData = { ...existing };
                }
            } catch (_) {}
        }
        // Hard delete: must succeed in Supabase first — no silent failures.
        // If Supabase rejects the delete, the error is thrown and localStorage is
        // left untouched so the record stays visible (no ghost-resurrection later).
        const { error } = await this._writeClient()
            .from(tableName)
            .delete()
            .eq('id', id);
        if (error) throw error;

        this._writeAudit('delete', tableName, id, _auditOldData, null);

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

        this.invalidateCache(tableName);
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
            // Service-role REST fallback removed — rely on localStorage cache.
            const local = localStorage.getItem(`fs_crm_${tableName}`);
            const all = local ? JSON.parse(local) : [];
            return all.filter(row => Object.entries(filters).every(([k, v]) => row[k] == v));
        }
    }

    // ── Server-side paginated query ────────────────────────────────────
    // Pushes filtering, sorting, searching, and scoping to Supabase so
    // only the rows the user actually needs travel over the wire.
    //
    // options = {
    //   filters:      { status: 'active' },              // eq() filters
    //   search:       'john',                             // ilike search term
    //   searchFields: ['full_name','phone','email'],      // columns to search
    //   sort:         'full_name',                        // order column
    //   sortDir:      'asc' | 'desc',                    // order direction
    //   limit:        50,                                 // page size (default 50)
    //   offset:       0,                                  // starting row
    //   scopeField:   'responsible_agent_id',             // column for scoping
    //   scopeValues:  [id1, id2],                         // allowed values (from getVisibleUserIds)
    //   scopeFields:  [{ field, values }],                // multi-field scoping (OR across fields)
    //   select:       'id,full_name,...'                   // custom select (defaults to light-select)
    //   gte:          { activity_date: '2026-04-01' },    // >= filters (date ranges)
    //   lte:          { activity_date: '2026-04-30' },    // <= filters (date ranges)
    //   countMode:    'exact' | 'planned' | null,         // count strategy (default 'planned')
    //                 'exact' = full count (slow on large tables)
    //                 'planned' = PostgreSQL planner estimate (fast)
    //                 null = skip count entirely (fastest)
    // }
    //
    // Returns { data: [], count: totalMatching, limit, offset }
    async queryAdvanced(tableName, options = {}) {
        const selectClause = options.select || this._selectClauseForGetAll(tableName);
        // Use 'planned' by default — 'exact' forces a full table scan which
        // stalls for 10+ seconds on large tables (activities, prospects).
        const countMode = options.countMode !== undefined ? options.countMode : 'planned';
        const selectOpts = countMode ? { count: countMode } : {};
        let q = this._readClient()
            .from(tableName)
            .select(selectClause, selectOpts);

        // Scoping — restrict to rows the user is allowed to see.
        // Single-field scope: scopeField + scopeValues
        // Multi-field scope: scopeFields [{ field, values }] — OR across fields
        if (options.scopeFields && options.scopeFields.length > 0) {
            // Build PostgREST OR filter: (field1.in.(v1,v2),field2.in.(v1,v2))
            const orParts = options.scopeFields.map(
                s => `${s.field}.in.(${s.values.join(',')})`
            );
            q = q.or(orParts.join(','));
        } else if (options.scopeField && options.scopeValues) {
            q = q.in(options.scopeField, options.scopeValues);
        }

        // Equality filters
        if (options.filters) {
            for (const [key, value] of Object.entries(options.filters)) {
                if (value == null || value === '' || value === 'null' || value === 'undefined') continue;
                q = q.eq(key, value);
            }
        }

        // Range filters (gte / lte) — for date ranges etc.
        if (options.gte) {
            for (const [key, value] of Object.entries(options.gte)) {
                if (value != null) q = q.gte(key, value);
            }
        }
        if (options.lte) {
            for (const [key, value] of Object.entries(options.lte)) {
                if (value != null) q = q.lte(key, value);
            }
        }

        // Full-text-style search across multiple columns (ilike OR)
        if (options.search && options.searchFields && options.searchFields.length > 0) {
            const term = options.search.replace(/%/g, '');
            const orClauses = options.searchFields
                .map(f => `${f}.ilike.%${term}%`)
                .join(',');
            q = q.or(orClauses);
        }

        // Sorting
        if (options.sort) {
            q = q.order(options.sort, { ascending: options.sortDir !== 'desc' });
        }

        // Pagination
        const limit = options.limit || 50;
        const offset = options.offset || 0;
        q = q.range(offset, offset + limit - 1);

        try {
            const { data, error, count } = await q;
            if (error) {
                // If light-select column list is stale, retry with '*'
                if (selectClause !== '*' && error.code) {
                    console.warn(`queryAdvanced light-select failed for ${tableName}, retrying with *`);
                    options.select = '*';
                    return this.queryAdvanced(tableName, options);
                }
                throw error;
            }
            return { data: data || [], count: count || 0, limit, offset };
        } catch (e) {
            console.error(`queryAdvanced error on ${tableName}:`, e);
            // Fallback: filter cached/local data client-side with pagination
            const all = await this.getAll(tableName);
            let filtered = [...all];
            // Multi-field OR scoping mirrors the PostgREST `or(...)` path above
            // so offline / fallback queries yield the same row set as the
            // online query (e.g. for the calendar's `lead_agent_id IN (visible)
            // OR visibility IN ('open','public')` rule).
            if (options.scopeFields && options.scopeFields.length > 0) {
                filtered = filtered.filter(r =>
                    options.scopeFields.some(s => {
                        const cell = r[s.field];
                        if (cell == null) return false;
                        return s.values.some(v => String(v) === String(cell));
                    })
                );
            } else if (options.scopeField && options.scopeValues) {
                filtered = filtered.filter(r => options.scopeValues.includes(r[options.scopeField]));
            }
            if (options.filters) {
                for (const [k, v] of Object.entries(options.filters)) {
                    if (v == null || v === '') continue;
                    filtered = filtered.filter(r => String(r[k]) === String(v));
                }
            }
            if (options.gte) {
                for (const [k, v] of Object.entries(options.gte)) {
                    if (v != null) filtered = filtered.filter(r => r[k] >= v);
                }
            }
            if (options.lte) {
                for (const [k, v] of Object.entries(options.lte)) {
                    if (v != null) filtered = filtered.filter(r => r[k] <= v);
                }
            }
            if (options.search && options.searchFields) {
                const term = options.search.toLowerCase();
                filtered = filtered.filter(r =>
                    options.searchFields.some(f => (r[f] || '').toLowerCase().includes(term))
                );
            }
            if (options.sort) {
                filtered.sort((a, b) => {
                    const va = a[options.sort] || '';
                    const vb = b[options.sort] || '';
                    const cmp = typeof va === 'number' ? va - vb : String(va).localeCompare(String(vb));
                    return options.sortDir === 'desc' ? -cmp : cmp;
                });
            }
            const total = filtered.length;
            return { data: filtered.slice(offset, offset + limit), count: total, limit, offset };
        }
    }

    // Bulk delete — runs all deletes in parallel instead of one-by-one
    async deleteMany(tableName, ids) {
        if (!ids || ids.length === 0) return;
        const { error } = await this._writeClient()
            .from(tableName)
            .delete()
            .in('id', ids);
        if (error) throw error;
        // Clean up local state for all deleted IDs
        try {
            const key = `fs_crm_${tableName}`;
            const all = JSON.parse(localStorage.getItem(key) || '[]');
            const idSet = new Set(ids.map(String));
            localStorage.setItem(key, JSON.stringify(all.filter(r => !idSet.has(String(r.id)))));
        } catch (_) {}
        try {
            const syncQueue = JSON.parse(localStorage.getItem('fs_crm_sync_queue') || '[]');
            const idSet = new Set(ids.map(String));
            localStorage.setItem('fs_crm_sync_queue', JSON.stringify(
                syncQueue.filter(q => !(q.tableName === tableName && idSet.has(String(q.record.id))))
            ));
        } catch (_) {}
        try {
            const tombstones = JSON.parse(localStorage.getItem('fs_crm_tombstones') || '{}');
            if (!tombstones[tableName]) tombstones[tableName] = [];
            for (const id of ids) {
                if (!tombstones[tableName].includes(String(id))) tombstones[tableName].push(String(id));
            }
            localStorage.setItem('fs_crm_tombstones', JSON.stringify(tombstones));
        } catch (_) {}
        this.invalidateCache(tableName);
        this.emit('dataChanged', { action: 'deleteMany', table: tableName, ids });
    }

    // ── Dormancy-aware prospect fetch ─────────────────────────────────────
    // Default rule (per ops requirement 2026-04-23): prospects whose
    // `last_activity_date` is older than DORMANCY_DAYS (500) should NOT be
    // loaded on first render. They stay in the DB, stay searchable by phone/
    // name/email via searchProspects(), and their full profile is still
    // fetched on demand via getById(). This avoids downloading tens of
    // thousands of cold prospect rows on every page load at scale.
    //
    // Cache key is separate from 'prospects' so the active-only snapshot
    // doesn't collide with the full getAll('prospects') cache (used by
    // reports, referral trees, admin export, etc.).
    async getActiveProspects(opts = {}) {
        const {
            includeDormant = false,
            dormantDays = 500,
            limit = 2000,
            fresh = false,
        } = opts;

        // Opt-out: caller explicitly wants the full set (admin, reports, etc.)
        if (includeDormant) return this.getAll('prospects', { fresh });

        const cacheKey = `__prospects_active_${dormantDays}`;
        if (!fresh) {
            const cached = this._cacheGet(cacheKey);
            if (cached) return cached;
        }

        const cutoff = new Date(Date.now() - dormantDays * 86400000)
            .toISOString().slice(0, 10); // YYYY-MM-DD
        const selectClause = this._selectClauseForGetAll('prospects');

        try {
            let { data, error } = await this._readClient()
                .from('prospects')
                .select(selectClause)
                .gte('last_activity_date', cutoff)
                .limit(limit);
            // Retry with '*' if light-select column list has gone stale
            if (error && selectClause !== '*') {
                ({ data, error } = await this._readClient()
                    .from('prospects')
                    .select('*')
                    .gte('last_activity_date', cutoff)
                    .limit(limit));
            }
            if (error) throw error;
            // Tombstone filter — keep parity with getAll()
            const tombstoneRaw = localStorage.getItem('fs_crm_tombstones');
            const tombstones = tombstoneRaw ? JSON.parse(tombstoneRaw) : {};
            const deletedIds = new Set(tombstones['prospects'] || []);
            const result = (data || []).filter(r => !deletedIds.has(String(r.id)));
            if (result.length === limit) {
                console.warn(`[DataStore] getActiveProspects hit limit ${limit} — raise it or paginate.`);
            }
            this._cacheSet(cacheKey, result);
            return result;
        } catch (e) {
            console.warn('getActiveProspects failed, falling back to getAll + client filter', e);
            const all = await this.getAll('prospects');
            return all.filter(p => {
                // Keep prospects with no last_activity_date (brand new rows) —
                // the trigger seeds it on insert, but a row created offline
                // might not have it set until sync completes.
                if (!p.last_activity_date) return true;
                return p.last_activity_date >= cutoff;
            });
        }
    }

    // Server-side search across phone / email / full_name / nickname.
    // Always includes dormant records by default (that's the whole point of
    // search — you type a name, you expect to find them even if they've been
    // quiet for 2 years). Caller can pass { includeDormant:false } to
    // restrict to active records only.
    //
    // Uses trigram GIN indexes under the hood (idx_prospects_full_name_trgm,
    // idx_prospects_nickname_trgm) for fast %ILIKE% performance on large tables.
    async searchProspects(term, opts = {}) {
        const {
            includeDormant = true,
            dormantDays = 500,
            limit = 100,
        } = opts;

        if (!term || !term.trim()) {
            // Empty term → regular list behavior (active only unless opted in).
            return this.getActiveProspects({ includeDormant, dormantDays });
        }

        const searchFields = ['full_name', 'nickname', 'phone', 'email'];
        const options = {
            search: term.trim(),
            searchFields,
            sort: 'last_activity_date',
            sortDir: 'desc',
            limit,
            countMode: null, // skip count — just want rows
        };
        if (!includeDormant) {
            const cutoff = new Date(Date.now() - dormantDays * 86400000)
                .toISOString().slice(0, 10);
            options.gte = { last_activity_date: cutoff };
        }
        const res = await this.queryAdvanced('prospects', options);
        return res.data || [];
    }

    // ── Paginated full-table fetch ────────────────────────────────────────
    // Supabase PostgREST caps a single `.select()` at 1000 rows. getAll()
    // today silently truncates at that limit (with a console.warn). For any
    // code path that genuinely needs EVERY row — reports, CSV exports, bulk
    // operations — use this method instead. It transparently pages through
    // 1000 rows at a time and merges the result.
    //
    // At 100K rows this is ~100 round trips; caller should confirm with the
    // user before running (or ideally switch to a server-side report).
    //
    // Options: { pageSize=1000, maxRows=250000, orderBy='id', filters }
    async getAllPaged(tableName, opts = {}) {
        const {
            pageSize = 1000,
            maxRows = 250000, // hard ceiling to prevent runaway downloads
            orderBy = 'id',
            filters = {},
        } = opts;
        const selectClause = this._selectClauseForGetAll(tableName);
        const all = [];
        let offset = 0;
        while (all.length < maxRows) {
            let q = this._readClient()
                .from(tableName)
                .select(selectClause)
                .order(orderBy, { ascending: true })
                .range(offset, offset + pageSize - 1);
            for (const [k, v] of Object.entries(filters)) {
                if (v != null && v !== '') q = q.eq(k, v);
            }
            const { data, error } = await q;
            if (error) {
                console.error(`[getAllPaged] ${tableName} page at offset ${offset} failed:`, error);
                break;
            }
            if (!data || data.length === 0) break;
            all.push(...data);
            if (data.length < pageSize) break; // last page
            offset += pageSize;
        }
        if (all.length >= maxRows) {
            console.warn(`[getAllPaged] hit maxRows=${maxRows} on ${tableName} — increase or move to a server-side report.`);
        }
        // Apply tombstone filter for consistency with getAll()
        try {
            const tRaw = localStorage.getItem('fs_crm_tombstones');
            const tombstones = tRaw ? JSON.parse(tRaw) : {};
            const deletedIds = new Set(tombstones[tableName] || []);
            return all.filter(r => !deletedIds.has(String(r.id)));
        } catch (_) {
            return all;
        }
    }

    // Server-side customer search — mirrors searchProspects(). Used by the
    // referrer/autocomplete inputs that need to show prospects + customers
    // without downloading both full tables on every keystroke. Uses
    // idx_customers_phone for phone matches; full_name/nickname fall through
    // to a seq scan today but will sit behind their own trigram index in
    // a future round once the customers row count justifies it.
    async searchCustomers(term, opts = {}) {
        const { limit = 20 } = opts;
        if (!term || !term.trim()) return [];
        const options = {
            search: term.trim(),
            searchFields: ['full_name', 'nickname', 'phone', 'email'],
            limit,
            countMode: null,
        };
        const res = await this.queryAdvanced('customers', options);
        return res.data || [];
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
