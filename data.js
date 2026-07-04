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
            // Automation config singleton (admin-managed birthday posters, etc.)
            'automation_config',
            // Egg Purchasing system (Super Admin only)
            'egg_processed_orders', 'egg_urgent_orders', 'egg_config', 'egg_run_history',
            // Knowledge HQ — personal knowledge hub
            'knowledge_entries', 'knowledge_links', 'knowledge_daily_notes',
            // Product price history
            'product_price_history',
            // Journey System — 5-year automated follow-up (2026-06-06)
            'journey_templates', 'journey_touchpoints', 'journey_stage_log',
            'conditional_rules', 'prospect_score_log'
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
        // LRU cap: limit to _cacheMaxEntries entries so a long-running session
        // that navigates through 100+ distinct entities can't grow unbounded.
        this._cache = new Map();
        this._cacheTTL = 300_000; // 5 min (was 30s — too aggressive for 500 concurrent users)
        this._cacheMaxEntries = 256; // LRU eviction threshold (app has 70+ tables; 64 was too aggressive)

        // ── Primed-row side cache ─────────────────────────────────────────
        // Some rows reach the client via SECURITY DEFINER RPCs (e.g. the calendar
        // hot-detail RPC pulls activities where the user is a consultant or
        // co-agent — rows that the user's own RLS would NOT return on a direct
        // `activities.select().eq('id', x)`). Before, callers stashed those rows
        // in script-local Maps and any downstream handler that called
        // AppDataStore.getById went straight to the network, got nothing back,
        // and surfaced a confusing "X not found" toast next to the already-open
        // detail modal. primeRow() lets a caller hand the row to us so getById
        // returns it instantly. Keyed by `tableName -> Map(idString -> row)`.
        // Cleared on update/delete/invalidateCache so we never serve stale data.
        this._primedRows = new Map();

        // ── In-flight request cancellation ──────────────────────────────────
        // A single AbortController whose signal is chained onto every Supabase
        // read (.abortSignal(signal) — supported since supabase-js@2.20). When
        // the user navigates away, script.js calls AppDataStore.abortInflight()
        // which aborts every in-flight read and creates a fresh controller for
        // the new view. Result: an orphan getAll('prospects') that's mid-flight
        // when the user clicks away to /calendar doesn't land 800ms later and
        // overwrite the calendar's cache with stale prospect data.
        // Reads catch AbortError and return [] silently rather than poisoning
        // the cache or surfacing an error toast — view-change is not an error.
        this._inflightController = (typeof AbortController === 'function') ? new AbortController() : null;
        this._staticTables = new Set([
            'users', 'roles', 'teams', 'event_categories', 'event_templates',
            'products', 'appointment_locations', 'venues', 'ai_models',
        ]);

        // ── Append-only high-volume tables ────────────────────────────────
        // These grow without bound and must be read with a date/scope window
        // (getActivitiesInRange / getPurchasesInRange), never whole via getAll.
        // Canonical set adapted to this schema: `calendar_events` is not a real
        // table (calendar data lives in `activities` keyed by activity_date) and
        // the audit table is `audit_logs` (not `audit_trail`); only names that
        // exist in this.tables are listed so a caller can't window a phantom
        // table.
        this.HIGH_VOLUME_TABLES = new Set([
            'activities', 'purchases', 'notes', 'audit_logs',
        ]);

        // ── Realtime SWR persistence coalescing (MEMO-1) ──────────────────
        // The realtime push handler used to re-stringify the ENTIRE cached
        // array to localStorage on every single org-wide INSERT (one full
        // JSON.stringify of a 10K-row table per event). Under a burst of
        // inserts this stalled the main thread and thrashed localStorage.
        // Instead we now COALESCE writes: each event marks the table dirty
        // and (re)arms a single debounced flush. One write lands per
        // ~REALTIME_PERSIST_DEBOUNCE_MS quiet window (or immediately on
        // visibilitychange/pagehide so a backgrounded/closing tab still
        // persists). Correctness is unchanged: the in-memory cache is updated
        // synchronously per event (callers read live data), and on the next
        // reload the delta poll fetches anything that wasn't flushed.
        this._realtimePersistDebounceMs = 4000;       // one write per ~4s quiet window
        this._realtimePersistDirty = new Set();        // table names pending a snapshot write
        this._realtimePersistTimer = null;             // setTimeout handle for the debounced flush
        // Hard cap on the in-memory realtime-grown list for high-volume tables
        // so a long-lived tab receiving a flood of org-wide inserts can't grow
        // the cached array without bound. Past the cap we drop the OLDEST rows
        // (the realtime handler unshifts newest to the front, so the tail is
        // oldest). The next reload re-syncs from server truth regardless.
        this._realtimeListCap = 10000;
        this._installRealtimePersistFlushHooks();

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
        // (minus the legacy cps_form_data BLOB column, which has been migrated
        // to Storage and is always NULL post-2026-05-03). If a new column is
        // added to Supabase, add it here so it flows into list views. Unknown
        // columns here cause PostgREST 400, which the fallback retry-with-'*'
        // handles gracefully — but a fallback to '*' would re-include any
        // legacy heavy column, so keep this list authoritative.
        this._lightSelects = {
            // Prospects: verified against actual DB schema 2026-04-25.
            // 2026-05-03: cps_form_data BLOB migrated to Storage; cps_form_url
            //   replaced it as a short text URL pointer. The original column
            //   is left in place (always NULL) for one deploy cycle, then
            //   dropped in a follow-up migration once cached older clients
            //   have rolled over.
            prospects: 'id,full_name,nickname,title,gender,nationality,phone,email,ic_number,date_of_birth,lunar_birth,ming_gua,element,occupation,company_name,income_range,address,city,state,postal_code,responsible_agent_id,cps_agent_id,cps_assignment_date,protection_deadline,pipeline_stage,deal_value,expected_close_date,status,referred_by,referred_by_id,referred_by_type,referral_relationship,cps_invitation_method,cps_invitation_details,cps_attachment,score,tags,notes,created_at,updated_at,cps_form_date,cps_form_name,cps_form_url,closing_record,closing_records_history,conversion_status,conversion_requested_by,conversion_rejected_by,conversion_rejected_at,closed_at,closed_date,closing_date,potential_level,close_probability,is_own_business,business_name,business_industry,business_area,business_title_role,business_started,company_size,pre2025_purchases,original_source,source_id,source,lead_agent_id,cps_interest,manual_grade,feng_shui_audits,last_activity_date,unable_to_serve,unable_reason,revived_at,revive_notes,apu_namelist_at',
            // Lean variant for the Prospects LIST view only. Enough to render
            // every column, run all client-side filters, and drive the SWR
            // cache. ~75% fewer columns than the full prospects select.
            // Detail view always uses getById('prospects', id) which sends
            // select=* and gets every column including those omitted here.
            prospects_listing: 'id,full_name,nickname,phone,email,ming_gua,score,occupation,company_name,responsible_agent_id,status,conversion_status,last_activity_date,protection_deadline,manual_grade,tags,unable_to_serve',
            // Lean users select — covers every use-case in list views:
            // hierarchy traversal (reporting_to, team_id), role checks,
            // agent name display, reassign dropdowns. Profile/edit views
            // call getById which gets *.
            // NOTE: agent_code + team are the TEXT columns the Agents list
            // actually renders (Agent ID + Team) and filters on — saveAgent
            // writes both as text, NOT team_id. Omitting them made every row
            // show "N/A" / "Unassigned" regardless of the saved value.
            users: 'id,full_name,email,phone,role,agent_code,team,status,team_id,reporting_to,date_of_birth,employment_type,created_at,updated_at',
            // Activities: verified against actual DB schema 2026-04-16.
            // Excludes: consultants (JSONB blob), payment detail columns,
            // long discussion_summary field — only needed in detail/edit view.
            // photo_urls is included: it is a JSONB array of short URLs (not a blob)
            // and must appear in list/tab views so Meet Up History can show thumbnails.
            activities: 'id,activity_type,activity_date,activity_title,prospect_id,customer_id,lead_agent_id,start_time,end_time,visibility,co_agents,event_id,closing_amount,amount_closed,is_closing,solution_sold,location_address,venue,status,unable_to_serve,unable_reason,note_key_points,note_outcome,note_next_steps,cps_invitation_method,cps_invitation_details,source,created_at,updated_at,score_value,is_closed,next_action,next_action_done,completed_at,photo_urls,opportunity_potential'
        };

        // Prune the SWR cache at startup if localStorage is close to its
        // ~5 MB browser quota. The Supabase auth token writes to the same
        // bucket, and a quota error there hard-blocks login (the user has
        // to clear site data manually). The cached table snapshots are
        // recoverable from Supabase, so they're safe to drop — pick the
        // largest fs_crm_ keys first.
        try { this._pruneStorageIfFull(); } catch (_) { /* intentional: startup pruning is best-effort; never block construction */ }

        // Clear delta cursors poisoned by pre-guard builds (see method docs).
        try { this._healPoisonedSyncCursors(); } catch (_) { /* intentional: cursor heal is best-effort; never block construction */ }
    }

    // Drop fs_crm_ snapshots when localStorage usage approaches the quota.
    // Conservative threshold: 3.5 MB used. Browsers cap at ~5 MB per origin,
    // and supabase-js's auth-token write is a few KB — keeping ~1.5 MB free
    // leaves room for auth + any in-flight setItem calls during render.
    _pruneStorageIfFull() {
        const PROTECTED = new Set([
            'offline_queue',
            'fs_crm_sync_queue',
            'fs_crm_tombstones',
            'remember_me',
            'remember_me_email',
            // The live Supabase auth session — MUST be protected or a prune can
            // evict it and silently log the user out. supabase-init.js configures
            // storageKey='fs-crm-auth-v1'; the old 'sb-crm-auth-token' entry never
            // matched the real key (kept as a legacy no-op).
            (typeof window !== 'undefined' && window.SUPABASE_AUTH_STORAGE_KEY) || 'fs-crm-auth-v1',
            'sb-crm-auth-token',
        ]);
        const THRESHOLD_BYTES = 3.5 * 1024 * 1024;
        const TARGET_BYTES = 2.0 * 1024 * 1024; // prune down to 2 MB

        const entries = [];
        let total = 0;
        for (let i = 0; i < localStorage.length; i++) {
            const k = localStorage.key(i);
            if (!k) continue;
            const v = localStorage.getItem(k) || '';
            // Each char is 2 bytes in UTF-16 (browser localStorage spec).
            const bytes = (k.length + v.length) * 2;
            entries.push({ k, bytes });
            total += bytes;
        }
        if (total < THRESHOLD_BYTES) return;

        // Drop largest fs_crm_ snapshots first (excluding the protected
        // sync/queue keys) until we're under TARGET_BYTES.
        const candidates = entries
            .filter(e => e.k.startsWith('fs_crm_') && !PROTECTED.has(e.k))
            .sort((a, b) => b.bytes - a.bytes);
        // `total` includes protected/non-prunable keys (auth token, sync queue,
        // tombstones). Only the candidate bytes are reclaimable — so the floor we
        // can ever reach is `total - reclaimable`. If that floor already exceeds
        // TARGET (protected keys dominate), no prune brings usage under target;
        // we still drop every candidate to free what we can, and warn that the
        // remainder is unprunable rather than silently believing we hit target.
        const reclaimable = candidates.reduce((s, c) => s + c.bytes, 0);
        const unprunableFloor = total - reclaimable;
        let freed = 0;
        const dropped = [];
        for (const c of candidates) {
            // Remaining usage after this point is (total - freed); stop once it's
            // under target (real usage, not an approximation).
            if (total - freed <= TARGET_BYTES) break;
            try {
                localStorage.removeItem(c.k);
                freed += c.bytes;
                dropped.push(c.k);
            } catch (_) { /* intentional: skip un-removable key, keep pruning others */ }
        }
        if (dropped.length) {
            console.warn(
                `[DataStore] localStorage at ${(total / 1024 / 1024).toFixed(2)} MB; ` +
                `pruned ${dropped.length} cache entries (${(freed / 1024 / 1024).toFixed(2)} MB freed)`
            );
        }
        if (unprunableFloor > TARGET_BYTES && (total - freed) > TARGET_BYTES) {
            console.warn(
                `[DataStore] localStorage still at ${((total - freed) / 1024 / 1024).toFixed(2)} MB after prune — ` +
                `${(unprunableFloor / 1024 / 1024).toFixed(2)} MB is non-prunable (auth/sync/tombstones); ` +
                `auth-token writes may still hit quota.`
            );
        }
    }

    // PostgREST `select` clause to use for a given table. Lets us omit heavy
    // BLOB columns from list fetches. Unknown columns in the list are ignored
    // by PostgREST with a 400 error, so we wrap the fetch in a try that falls
    // back to '*' if the column list becomes stale.
    _selectClauseForGetAll(tableName) {
        return this._lightSelects[tableName] || '*';
    }

    // Project a full row down to just the columns the getAll light-select keeps,
    // so realtime splices (which receive the FULL row from the realtime
    // publication) don't re-introduce the heavy BLOB-adjacent columns that
    // _lightSelects was designed to exclude from list snapshots. Tables with no
    // light select ('*') are returned unchanged.
    _projectToLightSelect(tableName, row) {
        if (!row || typeof row !== 'object') return row;
        const clause = this._lightSelects[tableName];
        if (!clause || clause === '*') return row;
        const cols = clause.split(',').map(c => c.trim()).filter(Boolean);
        const out = {};
        for (const c of cols) {
            if (c in row) out[c] = row[c];
        }
        // Always preserve the id even if it somehow wasn't listed.
        if (!('id' in out) && 'id' in row) out.id = row.id;
        return out;
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
            // No pre-login network probe here. Making an unauthenticated request
            // to supabase.co at startup can poison iOS's connection state for that
            // host, causing the subsequent signInWithPassword to get "Load failed"
            // even when the network is fine. Connectivity is tested lazily on the
            // first real authenticated query instead.
            this.initialized = true;

            this._ensureTombstones({
                activities: ['1775653728135', '1775574315672', '1775574533626']
            });

            console.log('DataStore initialised (Supabase mode).');
            // Start Realtime SWR after the auth client is ready. Wrapped in a
            // try/catch and runs lazily (background idle if available) so it
            // never blocks the ready event.
            try {
                const start = () => this._startRealtimeSWR();
                if (typeof window.scheduler !== 'undefined' && typeof window.scheduler.postTask === 'function') {
                    window.scheduler.postTask(start, { priority: 'background' });
                } else if (typeof window.requestIdleCallback === 'function') {
                    window.requestIdleCallback(start, { timeout: 2000 });
                } else {
                    setTimeout(start, 1);
                }
            } catch (_) { /* intentional: Realtime SWR is best-effort, must not block ready */ }
            this.emit('ready');
            return true;
        } catch (err) {
            console.error('DataStore init error:', err);
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

    _generateId(tableName) {
        // fp_* tables use uuid primary keys — a numeric id is rejected by
        // Postgres (22P02 invalid input syntax for type uuid), and the failed
        // row would sit in the sync queue retrying forever.
        if (tableName && /^fp_/.test(String(tableName)) && window.crypto && typeof crypto.randomUUID === 'function') {
            return crypto.randomUUID();
        }
        // Numeric id = Date.now()*1000 + a per-instance monotonic counter (0..999).
        // The old `Date.now() + rand(0..999)` drew every id in a bulk insert (all
        // stamped in the same tick) from the SAME ~1000-value window, so a batch of
        // 50+ rows almost always produced a duplicate PK → the bulk INSERT 23505'd
        // and createMany degraded to N sequential add() round-trips. A monotonic
        // counter guarantees uniqueness across same-millisecond calls in this tab.
        this._idSeq = ((this._idSeq || 0) + 1) % 1000;
        return Date.now() * 1000 + this._idSeq;
    }

    // True when a Supabase auth session with an unexpired access token is
    // present in localStorage (key set in supabase-init.js). Synchronous on
    // purpose: supabase-js's async getSession() can block on the cross-tab
    // auth lock during boot races — exactly the moments this check guards.
    //
    // Why it matters: without a live session, PostgREST answers RLS-protected
    // reads with 200 + 0 rows (not an error). Treating that as table truth
    // overwrites the local snapshot and advances the delta cursor — the
    // wiped rows then never come back (the "calendar all gone" bug).
    hasLiveSession() {
        try {
            const raw = localStorage.getItem('fs-crm-auth-v1');
            if (!raw) return false;
            const s = JSON.parse(raw);
            const token = (s && s.access_token) || (s && s.currentSession && s.currentSession.access_token);
            if (!token) return false;
            const exp = (s && s.expires_at) || (s && s.currentSession && s.currentSession.expires_at);
            return !exp || (exp * 1000) > Date.now();
        } catch (_) {
            /* intentional: corrupt/absent auth token JSON ⇒ treat as no live session */
            return false;
        }
    }

    // True ONLY when there is a stored auth session whose token is missing or expired —
    // i.e. a session that *died*, as opposed to "never logged in" (no stored blob at all).
    // hasLiveSession() can't tell those apart (both return false). Used by getAll()'s
    // read-failure path to recognise an expired session masquerading as a network outage.
    _sessionLikelyDead() {
        try {
            const raw = localStorage.getItem('fs-crm-auth-v1');
            if (!raw) return false;                          // never logged in / cleanly signed out
            const s = JSON.parse(raw);
            const token = (s && s.access_token) || (s && s.currentSession && s.currentSession.access_token);
            if (!token) return true;                         // stored blob but no usable token
            const exp = (s && s.expires_at) || (s && s.currentSession && s.currentSession.expires_at);
            return exp ? (exp * 1000) <= Date.now() : false; // expired
        } catch (_) {
            /* intentional: corrupt auth JSON ⇒ don't claim the session is dead */
            return false;
        }
    }

    // One-time (per epoch) repair: earlier builds let unauthenticated reads
    // overwrite table snapshots and advance the fs_crm_*_last_sync delta
    // cursors, leaving hollowed-out caches that delta sync can never backfill
    // (e.g. calendar showing 16 of 155 activities). Clearing the cursors
    // forces one full refetch per table on its next read; the snapshots
    // themselves are kept so views still paint instantly meanwhile.
    _healPoisonedSyncCursors() {
        const EPOCH = '2026-06-11-rls-empty-read-guard';
        if (localStorage.getItem('fs_crm_cache_epoch') === EPOCH) return;
        const toRemove = [];
        for (let i = 0; i < localStorage.length; i++) {
            const k = localStorage.key(i);
            if (k && k.startsWith('fs_crm_') && k.endsWith('_last_sync')) toRemove.push(k);
        }
        for (const k of toRemove) localStorage.removeItem(k);
        localStorage.setItem('fs_crm_cache_epoch', EPOCH);
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
        } catch (_) { /* intentional: best-effort tombstone seed; storage unavailable/corrupt is non-fatal */ }
    }

    // ── Dashboard RPC: single-call calendar boot ─────────────────────────
    // Calls calendar_dashboard_payload(agent_id, since, until) — a Postgres
    // function that returns activities + users + prospects (lean) + customers
    // (lean) in ONE round-trip with server-side filtering. Replaces the 4
    // parallel getAll() calls the calendar mount does today.
    //
    // After fetch, primes the in-memory cache + localStorage snapshot for
    // each table so subsequent code paths that call getAll('activities') etc.
    // hit the warm cache instead of firing a second HTTP request.
    //
    // Falls back to parallel getAll() if the RPC isn't deployed yet (PGRST
    // error code 'PGRST202' = function not found) so calling code is safe to
    // adopt before the migration has been applied. Returns whatever shape it
    // got — callers should null-check.
    async loadCalendarDashboard(agentId, sinceISO, untilISO) {
        try {
            // Never issue this cache-priming RPC without a live session: it would go out as
            // an anon read, come back with empty arrays (RLS), and then prime the
            // prospects/customers caches + snapshots with [] — poisoning full-table reads
            // until the next delta-sync backfills. Bail to the caller's null path instead.
            // (bug 2026-07: a silent session drop wiped mobile data across views)
            if (!this.hasLiveSession()) return null;
            const signal = this._inflightSignal();
            let rpc = this._readClient().rpc('calendar_dashboard_payload', {
                p_agent_id: agentId || null,
                p_since:    sinceISO || new Date(Date.now() - 60 * 86400 * 1000).toISOString(),
                p_until:    untilISO || new Date(Date.now() + 60 * 86400 * 1000).toISOString(),
            });
            if (signal && typeof rpc.abortSignal === 'function') rpc = rpc.abortSignal(signal);
            const { data, error } = await rpc;
            if (error) {
                if (this._isAbortError(error)) return null;
                // PGRST202 = function not found (RPC not deployed). Caller falls back.
                if (error.code === 'PGRST202' || /function .+ does not exist/i.test(error.message || '')) {
                    return null;
                }
                throw error;
            }
            if (!data || typeof data !== 'object') return null;
            // Prime caches so subsequent getAll() reads hit warm cache.
            // IMPORTANT: when agentId is set the RPC returns a scoped subset of
            // prospects/customers for that agent only. Writing those subsets under
            // the canonical 'prospects'/'customers' cache keys would poison the
            // full-table cache used by admin/manager views. Skip those tables when
            // a scoped agent query was issued.
            // 'activities' from this RPC is a ±60-day WINDOWED subset. Priming it
            // under the canonical 'activities' cache key (and bumping its last_sync
            // cursor below) would make every getAll('activities') consumer see only
            // a ~120-day slice, and delta-sync could never backfill the older rows
            // (their updated_at predates the new cursor) — the 'hollow snapshot'
            // class behind the 2026-06-11 incident. The calendar grid renders from
            // its own get_calendar_window RPC, not this cache, so skipping it is safe.
            const _scopedTables = new Set(['activities']);
            if (agentId) { _scopedTables.add('prospects'); _scopedTables.add('customers'); }
            // NEVER prime 'users' from this RPC: its users CTE returns a LEAN row
            // (id, full_name, email, phone, role, status, team_id, reporting_to,
            // date_of_birth, timestamps) that OMITS agent_code, team and
            // employment_type — the exact columns _lightSelects.users documents as
            // mandatory. Priming it under the canonical 'users' cache + snapshot (and
            // bumping fs_crm_users_last_sync) makes every Agents-list row show
            // Agent ID "N/A" / Team "Unassigned" and misclassifies FT/PT for the
            // operating-hours KPI, and the advanced delta cursor prevents unchanged
            // rows from ever regaining the missing columns this session.
            _scopedTables.add('users');
            const tablesPrimed = [];
            for (const t of ['activities', 'users', 'prospects', 'customers']) {
                if (_scopedTables.has(t)) continue; // scoped/lean subset — do not poison full-table cache
                const rows = data[t];
                if (Array.isArray(rows)) {
                    this._cacheSet(t, rows);
                    tablesPrimed.push(t);
                    // Persist async — same pattern as _getAllImpl writes.
                    setTimeout(() => {
                        try {
                            localStorage.setItem(`fs_crm_${t}`, JSON.stringify(this._sanitizeForStorage(t, rows)));
                            localStorage.setItem(`fs_crm_${t}_last_sync`, new Date().toISOString());
                        } catch (_) { /* intentional: snapshot persist is a cache optimization; quota/storage failure is non-fatal */ }
                    }, 0);
                }
            }
            if (window.__FS_DEBUG_SWR) console.log(`[Dashboard RPC] primed: ${tablesPrimed.join(', ')}`);
            this.emit('dataChanged', { action: 'dashboard_rpc', tables: tablesPrimed });
            return data;
        } catch (e) {
            if (this._isAbortError(e)) return null;
            console.warn('[Dashboard RPC] failed, caller should fall back:', e?.message);
            return null;
        }
    }

    // ── Realtime SWR push ────────────────────────────────────────────────
    // After init, subscribe to postgres_changes for the core CRM tables. When
    // a change lands on a connected tab, splice the new row directly into the
    // in-memory cache + localStorage snapshot. This eliminates the
    // updated_at>lastSync delta poll for any tab that's been continuously open
    // — and on the next reload, the delta poll fetches only what happened
    // while disconnected (already the existing behavior).
    //
    // Tables subscribed: those added to supabase_realtime publication by
    //   migrations/realtime_publication_2026-05-03.sql        (cps_intake_requests, refill_reminders, activities)
    //   migrations/realtime_publication_extend_2026-05-31.sql (prospects, customers, users)
    //
    // Idempotent: bails if window.supabase missing or already subscribed.
    // Reconnect: the supabase-js channel handles websocket reconnect itself;
    // we don't tear down on visibility-hidden because RLS still gates the
    // events anyway.
    _startRealtimeSWR() {
        if (this._realtimeChannel) return;
        if (!window.supabase || typeof window.supabase.channel !== 'function') return;
        const TABLES = ['prospects', 'customers', 'users', 'activities', 'cps_intake_requests', 'refill_reminders'];
        const onChange = (payload) => {
            try {
                const table = payload?.table;
                if (!table) return;
                const evt = payload?.eventType;        // INSERT | UPDATE | DELETE
                // For DELETE, payload.new is an empty object {} (not null) in supabase-js realtime,
                // so use event-type-aware selection to avoid discarding the old row's id.
                const row = evt === 'DELETE' ? payload?.old : (payload?.new || payload?.old);
                if (!row || !row.id) return;
                // Update in-memory cache if present (LRU): splice the row.
                const cached = this._cache.get(table);
                if (cached && Array.isArray(cached.data)) {
                    const idStr = String(row.id);
                    const idx = cached.data.findIndex(r => String(r.id) === idStr);
                    if (evt === 'DELETE') {
                        if (idx >= 0) cached.data.splice(idx, 1);
                    } else {
                        // Project the full realtime row down to the light-select
                        // shape before splicing, so heavy columns (e.g.
                        // closing_records_history) never leak into the lean list
                        // cache / persisted snapshot the way the full row would.
                        const lean = this._projectToLightSelect(table, row);
                        if (idx >= 0) cached.data[idx] = { ...cached.data[idx], ...lean };
                        else cached.data.unshift(lean);
                    }
                    // Cap the in-memory list for high-volume tables so a flood
                    // of org-wide inserts on a long-lived tab can't grow the
                    // cached array without bound. Only cap on INSERT: an unshift
                    // guarantees the tail is the oldest row, so truncating the
                    // tail evicts oldest-first. UPDATE/DELETE mutate in place and
                    // don't reorder, so capping there could drop a recently-active
                    // row that happens to sit at the tail.
                    if (evt === 'INSERT' && this.HIGH_VOLUME_TABLES.has(table) && cached.data.length > this._realtimeListCap) {
                        cached.data.length = this._realtimeListCap;
                    }
                    cached.ts = Date.now();
                    // Coalesce the localStorage write: mark the table dirty and
                    // (re)arm a single debounced flush instead of re-stringifying
                    // the whole array on every event. (MEMO-1)
                    this._queueRealtimePersist(table);
                } else {
                    // Table not in cache yet — just mark the table dirty so the
                    // next getAll() does a fresh fetch instead of an old snapshot.
                    this.invalidateCache(table);
                }
                this.emit('dataChanged', { action: 'realtime', table });
            } catch (e) {
                console.warn('[Realtime SWR] handler error:', e);
            }
        };
        try {
            const ch = window.supabase.channel('crm-swr');
            for (const t of TABLES) {
                ch.on('postgres_changes', { event: '*', schema: 'public', table: t }, onChange);
            }
            ch.subscribe((status) => {
                if (status === 'SUBSCRIBED') {
                    if (window.__FS_DEBUG_SWR) console.log('[Realtime SWR] subscribed to', TABLES.join(', '));
                }
            });
            this._realtimeChannel = ch;
        } catch (e) {
            console.warn('[Realtime SWR] failed to subscribe:', e);
        }
    }

    _stopRealtimeSWR() {
        if (this._realtimeChannel) {
            try { window.supabase.removeChannel(this._realtimeChannel); } catch (_) { /* intentional: best-effort channel teardown */ }
            this._realtimeChannel = null;
        }
    }

    // ── Realtime SWR persistence coalescing helpers (MEMO-1) ──────────────
    // Mark a table's in-memory snapshot dirty and (re)arm a single debounced
    // flush. Coalesces a burst of realtime events into ONE localStorage write
    // per quiet window instead of one full-array re-stringify per event.
    _queueRealtimePersist(table) {
        if (!table) return;
        this._realtimePersistDirty.add(table);
        if (this._realtimePersistTimer) return; // a flush is already armed
        if (typeof setTimeout !== 'function') { this._flushRealtimePersist(); return; }
        this._realtimePersistTimer = setTimeout(() => {
            this._realtimePersistTimer = null;
            this._flushRealtimePersist();
        }, this._realtimePersistDebounceMs);
    }

    // Write every dirty table's current in-memory snapshot to localStorage in
    // one pass, then clear the dirty set. Best-effort: quota/storage failures
    // are non-fatal (the next reload delta-syncs from server truth).
    _flushRealtimePersist() {
        if (!this._realtimePersistDirty || this._realtimePersistDirty.size === 0) return;
        const tables = Array.from(this._realtimePersistDirty);
        this._realtimePersistDirty.clear();
        for (const table of tables) {
            const cached = this._cache.get(table);
            if (!cached || !Array.isArray(cached.data)) continue;
            try { localStorage.setItem(`fs_crm_${table}`, JSON.stringify(this._sanitizeForStorage(table, cached.data))); } catch (_) { /* intentional: realtime snapshot persist is best-effort cache write */ }
            // Do NOT advance fs_crm_<table>_last_sync here. Receiving realtime events
            // proves nothing about events MISSED during a websocket drop/reconnect
            // (supabase-js does not replay missed postgres_changes). Bumping the cursor
            // past the gap would make those missed rows (updated_at < new cursor)
            // permanently un-delta-fetchable until a full reconcile/reload. Leaving the
            // cursor at the last SERVER-VERIFIED fetch lets the next delta revalidation
            // re-pull the gap window. Only the snapshot DATA is persisted (harmless).
        }
    }

    // Flush pending realtime snapshots when the tab is backgrounded or closing
    // so a tab that never hits a quiet window (continuous inserts then close)
    // still persists. Registered once at construction; guarded for non-DOM.
    _installRealtimePersistFlushHooks() {
        if (this._realtimePersistHooksInstalled) return;
        if (typeof document === 'undefined' && typeof window === 'undefined') return;
        const flush = () => {
            if (this._realtimePersistTimer) {
                try { clearTimeout(this._realtimePersistTimer); } catch (_) { /* intentional: best-effort timer clear */ }
                this._realtimePersistTimer = null;
            }
            try { this._flushRealtimePersist(); } catch (_) { /* intentional: flush on hide/unload is best-effort */ }
        };
        try {
            if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
                document.addEventListener('visibilitychange', () => {
                    if (document.visibilityState === 'hidden') flush();
                });
            }
            if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
                window.addEventListener('pagehide', flush);
            }
        } catch (_) { /* intentional: hook registration is best-effort */ }
        this._realtimePersistHooksInstalled = true;
    }

    // ── In-flight abort helpers ──────────────────────────────────────────
    // Return the current AbortSignal so reads can chain .abortSignal(signal).
    // Returns undefined if AbortController is unsupported (very old browsers),
    // so the chain becomes a no-op rather than throwing.
    _inflightSignal() {
        return this._inflightController ? this._inflightController.signal : undefined;
    }

    // Public: abort every in-flight read tied to the current signal, then
    // create a fresh controller for subsequent reads. Called from
    // script.js navigateTo() at the START of a view switch — cancels stale
    // reads so they don't land after the new view starts rendering.
    // `reason` is optional and only used for debugging.
    abortInflight(reason) {
        try {
            if (this._inflightController) {
                this._inflightController.abort(reason || 'navigate');
            }
        } catch (_) { /* intentional: aborting an already-settled controller is harmless */ }
        this._inflightController = (typeof AbortController === 'function') ? new AbortController() : null;
        // Clear in-flight dedupe map so the next view gets fresh promises
        // even if the old aborted promises haven't settled yet.
        if (this._inFlightGetAll) this._inFlightGetAll.clear();
    }

    // Race a Supabase query against a timeout so a TCP-reachable-but-slow
    // server never leaves a view stuck on a skeleton loader indefinitely.
    // On timeout the error is NOT an AbortError, so it falls through to the
    // offline-fallback catch block (shows banner, reads localStorage).
    // Default 8 s — fast enough to feel responsive on a poor 4G connection.
    _timedFetch(query, ms = 8000) {
        return Promise.race([
            Promise.resolve(query),
            new Promise((_, reject) =>
                setTimeout(() => {
                    const e = new Error(`Supabase fetch timed out after ${ms}ms`);
                    e.code = 'NETWORK_TIMEOUT';
                    reject(e);
                }, ms)
            ),
        ]);
    }

    // True if err looks like an AbortError from any of: fetch, supabase-js,
    // or our own abort() call. Different layers report the abort differently:
    //   - native fetch:    err.name === 'AbortError'
    //   - supabase-js v2:  err.message contains 'abort' or 'cancel'
    //   - postgrest-js:    err.code === '20' or err.message includes 'aborted'
    // Cheap, defensive — false positives are fine since the caller treats
    // it as "view changed, drop silently".
    _isAbortError(err) { return window._dataHelpers.isAbortError(err); }

    // ── Cache helpers ────────────────────────────────────────────────────
    _cacheGet(tableName) {
        const entry = this._cache.get(tableName);
        if (!entry) return null;
        // Near-static tables (users, roles, teams, products…) are cached LONGER than
        // volatile ones, per the constructor comment. When _cacheTTL was raised from
        // 30s to 300s the static branch was left at a hard-coded 120s, INVERTING the
        // relationship (static refetched 2.5x more often than mutable). Static TTL
        // must be >= the mutable TTL; use 2x so it stays longer than any future bump.
        const ttl = this._staticTables.has(tableName) ? Math.max(600_000, this._cacheTTL * 2) : this._cacheTTL;
        if (Date.now() - entry.ts > ttl) { this._cache.delete(tableName); return null; }
        return entry.data;
    }

    _cacheSet(tableName, data) {
        // LRU behavior: delete-then-set to move the key to the end of Map's
        // insertion order, then evict the oldest if we're over the cap.
        if (this._cache.has(tableName)) this._cache.delete(tableName);
        this._cache.set(tableName, { data, ts: Date.now() });
        if (this._cache.size > this._cacheMaxEntries) {
            const oldestKey = this._cache.keys().next().value;
            if (oldestKey !== undefined) this._cache.delete(oldestKey);
        }
    }

    // Hand a single row to the store from an out-of-band source (RPC, push event,
    // server-render hydration, …). Subsequent get(tableName, id) calls return it
    // instantly without a network round-trip. Use this when you already have the
    // row in hand and want sibling code paths to see it — particularly when the
    // row was obtained via a SECURITY DEFINER RPC and the calling user's own
    // RLS would not return it on a direct table SELECT.
    primeRow(tableName, row) {
        if (!row || row.id == null) return;
        let bucket = this._primedRows.get(tableName);
        if (!bucket) { bucket = new Map(); this._primedRows.set(tableName, bucket); }
        bucket.set(String(row.id), row);
    }

    primeRows(tableName, rows) {
        if (!Array.isArray(rows)) return;
        for (const r of rows) this.primeRow(tableName, r);
    }

    _getPrimedRow(tableName, id) {
        const bucket = this._primedRows.get(tableName);
        if (!bucket) return null;
        return bucket.get(String(id)) || null;
    }

    _evictPrimedRow(tableName, id) {
        const bucket = this._primedRows.get(tableName);
        if (!bucket) return;
        bucket.delete(String(id));
        if (bucket.size === 0) this._primedRows.delete(tableName);
    }

    // Strip fields that must never be sent to the client (e.g. legacy plaintext password
    // column on public.users — column is now REVOKED at DB level but guard here too).
    _sanitizeForStorage(tableName, records) {
        if (tableName !== 'users' || !Array.isArray(records)) return records;
        return records.map(r => {
            if (!r.password) return r;
            const { password: _pw, ...safe } = r;
            return safe;
        });
    }

    // Strip sensitive fields from a single user record.
    _sanitizeUserRecord(record) {
        if (!record || typeof record !== 'object') return record;
        const { password: _pw, ...safe } = record;
        return safe;
    }

    // Invalidate cache for a table (and any table that depends on it).
    // opts.keepSnapshot — when true, drop only the in-memory cache and derived
    //   caches but PRESERVE the persisted localStorage snapshot + delta cursor.
    //   Used by add()/update()/delete() after they have just written the mutated
    //   row INTO the fs_crm_<table> mirror: blowing that mirror away one line later
    //   made the mirror write dead code, blanked offline lists on the next read,
    //   and forced a full-table cold re-download (cursor gone) after every single
    //   write. Keeping the snapshot lets the next getAll() serve the up-to-date
    //   mirror + delta-revalidate instead of re-downloading the whole table.
    invalidateCache(tableName, opts = {}) {
        const keepSnapshot = !!(opts && opts.keepSnapshot);
        this._cache.delete(tableName);
        // Also remove the persisted localStorage snapshot so a page refresh
        // doesn't load stale data from the local copy — UNLESS the caller just
        // wrote the fresh row into that snapshot (keepSnapshot).
        if (!keepSnapshot) {
            try {
                localStorage.removeItem(`fs_crm_${tableName}`);
                localStorage.removeItem(`fs_crm_${tableName}_last_sync`);
            } catch (_) { /* intentional: best-effort snapshot eviction; in-memory cache already cleared */ }
        }
        // Drop any primed rows for this table — they're a side cache and must
        // never outlive a write or a deliberate refresh.
        this._primedRows.delete(tableName);
        // Derived caches that must expire whenever their source table changes.
        // `__prospects_active_{days}` is populated by getActiveProspects() and
        // depends on prospects.last_activity_date, which is kept in sync by a
        // DB trigger on activities — so a write to either table must evict it.
        if (tableName === 'prospects' || tableName === 'activities') {
            for (const k of this._cache.keys()) {
                if (typeof k === 'string' && (
                    k.startsWith('__prospects_active_') ||
                    k.startsWith('__latact_')
                )) this._cache.delete(k);
            }
            // Wipe persisted snapshots from localStorage for both
            // active-prospect and per-page activity caches.
            try {
                const toRemove = [];
                for (let i = 0; i < localStorage.length; i++) {
                    const lsKey = localStorage.key(i);
                    if (lsKey && (
                        lsKey.startsWith('fs_crm___prospects_active_') ||
                        lsKey.startsWith('fs_crm___latact_')
                    )) toRemove.push(lsKey);
                }
                for (const k of toRemove) localStorage.removeItem(k);
            } catch (_) { /* intentional: best-effort derived-snapshot eviction */ }
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
            /* intentional: missing/corrupt snapshot ⇒ no stale data, fall through to network */
            return null;
        }
    }

    // ── Cache API tier (async, large-quota overflow tier) ───────────────
    // localStorage caps at ~5 MB per origin. Large tables (activities,
    // prospects, customers) can each be 500 KB+ of JSON, so the pruner
    // kicks in and removes them — the next page load hits Supabase cold.
    //
    // The Cache API has 100+ MB quota and is available from the same context
    // (plus the SW). It's async, so we can't use it for the sync hot-path
    // in _swrGetLocal — but we CAN use it as an overflow fallback:
    //   1. If _swrGetLocal returns null (localStorage miss or quota eviction),
    //      check the Cache API async before firing Supabase.
    //   2. When we write a fresh fetch result to localStorage and it throws
    //      a QuotaExceededError, fall through to Cache API instead.
    //
    // Tables stored in Cache API use the key:
    //   crm-data/fs_crm_<tableName>   → Response{json(array)}
    //
    // Tombstone + sanitise logic is applied before storage, same as localStorage.
    static get _DATA_CACHE_NAME() { return 'crm-data-v1'; }

    async _cacheApiGet(tableName) {
        try {
            if (typeof caches === 'undefined') return null;
            const cache = await caches.open(DataStore._DATA_CACHE_NAME);
            const resp = await cache.match(`/crm-data/fs_crm_${tableName}`);
            if (!resp) return null;
            const data = await resp.json();
            if (!Array.isArray(data) || data.length === 0) return null;
            const tombstoneRaw = localStorage.getItem('fs_crm_tombstones');
            const tombstones = tombstoneRaw ? JSON.parse(tombstoneRaw) : {};
            const deletedIds = new Set(tombstones[tableName] || []);
            return data.filter(r =>
                !deletedIds.has(String(r.id)) &&
                !(tableName === 'users' && r.status === 'deleted')
            );
        } catch (_) {
            /* intentional: Cache API miss/unavailable ⇒ overflow tier empty, fall through */
            return null;
        }
    }

    async _cacheApiSet(tableName, rows) {
        try {
            if (typeof caches === 'undefined') return;
            const cache = await caches.open(DataStore._DATA_CACHE_NAME);
            const sanitised = this._sanitizeForStorage(tableName, rows);
            await cache.put(
                `/crm-data/fs_crm_${tableName}`,
                new Response(JSON.stringify(sanitised), {
                    headers: { 'Content-Type': 'application/json' }
                })
            );
        } catch (_) { /* intentional: overflow-tier write is best-effort; data still in memory/server */ }
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
            // Skip background revalidation entirely while unauthenticated —
            // an RLS-filtered (empty/partial) response must never overwrite
            // the snapshot or advance the delta cursor. The post-login read
            // revalidates normally.
            if (!this.hasLiveSession()) return;
            // ── Incremental (delta) sync ─────────────────────────────────
            // If we have a lastSync timestamp, only fetch rows changed since
            // then instead of downloading the full table. For large tables
            // (activities, prospects) this turns a 2 MB background download
            // into a near-zero payload on most revalidations.
            // Falls back to full fetch if: no timestamp, table has no
            // updated_at column (PostgREST 400), or network error.
            // Tables known to lack updated_at — skip delta to avoid 400 spam.
            const _NO_DELTA_TABLES = new Set([
                'special_program_participants', 'cps_intake_requests',
                'pipeline_config', 'pipeline_config_history',
            ]);
            const lastSync = localStorage.getItem(`fs_crm_${tableName}_last_sync`);
            // Once per session per table, force the FULL fetch path instead of
            // delta. The delta path only ADDS/UPDATES rows — it can never REMOVE
            // one — so a record deleted on the server by another user would
            // otherwise persist in this device's snapshot indefinitely (even
            // across reloads, because the snapshot + cursor live in localStorage).
            // The full fetch below replaces the snapshot with server truth, which
            // reconciles those deletions. It runs through the same hasLiveSession-
            // guarded path as a cold load, so it cannot be poisoned by RLS-empty.
            if (!this._fullReconciledThisSession) this._fullReconciledThisSession = new Set();
            const _needsReconcile = !this._fullReconciledThisSession.has(tableName);
            if (lastSync && !_NO_DELTA_TABLES.has(tableName) && !_needsReconcile) {
                try {
                    const delta = await this.getAllSince(tableName, lastSync);
                    // null = the read was ABORTED (user navigated away mid-fetch).
                    // Must NOT advance the cursor or merge: doing so would move the
                    // cursor past rows that changed in this window, dropping those
                    // updates forever. Leave everything untouched; a later
                    // revalidation retries from the same lastSync.
                    if (delta === null) return;
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
                            // Mirror the full-fetch filter (see _getAllImpl): the delta
                            // path only ADDS/UPDATES, so a user soft-deleted on the server
                            // (status='deleted') arrives as an updated row and would
                            // otherwise resurface here — the full path drops it, the delta
                            // path must too.
                            .filter(r => !deletedIds.has(String(r.id))
                                && !(tableName === 'users' && r.status === 'deleted'));
                        this._cacheSet(tableName, result);
                        // Advance the cursor to the MAX server-side updated_at among the
                        // fetched rows, NOT the client clock. A device whose clock runs
                        // ahead of the server would otherwise stamp the cursor in the
                        // future and permanently skip other users' writes that landed in
                        // the skew window (their updated_at < the future cursor). Falling
                        // back to lastSync (never past it) is safe — the next revalidation
                        // just re-queries the same window.
                        let _cursor = lastSync;
                        for (const r of delta) {
                            const u = r && r.updated_at;
                            if (u && (!_cursor || String(u) > String(_cursor))) _cursor = u;
                        }
                        const nextSync = _cursor || lastSync;
                        setTimeout(() => {
                            try {
                                localStorage.setItem(`fs_crm_${tableName}`, JSON.stringify(this._sanitizeForStorage(tableName, result)));
                                if (nextSync) localStorage.setItem(`fs_crm_${tableName}_last_sync`, nextSync);
                            } catch (_) { /* intentional: delta-merge persist is best-effort cache write */ }
                        }, 0);
                        if (window.__FS_DEBUG_SWR) console.log(`[SWR] ${tableName}: delta sync — ${delta.length} changed rows merged`);
                        this.emit('dataChanged', { action: 'revalidate', table: tableName });
                    } else {
                        // No changes since last sync — leave the cursor at lastSync.
                        // Advancing it to the client clock could skip rows other users
                        // modified in a clock-skew window; re-querying the same (empty)
                        // window next time is near-zero cost.
                    }
                    return; // Delta path succeeded — skip full fetch below.
                } catch (_) {
                    /* intentional: delta fetch failed (no updated_at / network) — fall through to full fetch */
                    // Delta fetch failed (e.g. table has no updated_at column,
                    // or network hiccup). Fall through to full fetch.
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
            // Mark reconciled: the full fetch replaced the snapshot with server
            // truth, so any server-side deletions are now reflected. Subsequent
            // revalidations this session use the fast delta path again.
            this._fullReconciledThisSession.add(tableName);

            if (this._snapshotsDiffer(prevSnapshot, fresh)) {
                // _getAllImpl already updated the in-memory cache with fresh
                // data. Emitting dataChanged triggers refreshCurrentView in
                // script.js for any view that depends on this table.
                if (window.__FS_DEBUG_SWR) console.log(`[SWR] ${tableName}: full revalidated (changed ${prevSnapshot.length} → ${fresh.length}), refreshing view`);
                this.emit('dataChanged', { action: 'revalidate', table: tableName });
            }
        } catch (_) {
            /* intentional: background revalidation is best-effort — user keeps the stale snapshot */
            // Silent failure — user keeps seeing the stale data
        } finally {
            this._swrInFlight.delete(tableName);
        }
    }

    // Cheap change detection: fingerprint rows by id + last-modified stamp
    // and compare as a single string. O(n log n) on row count.
    _snapshotsDiffer(a, b) { return window._dataHelpers.snapshotsDiffer(a, b); }

    async getAll(tableName, options = {}) {
        // Opt-in: include soft-deleted user rows in the result. _getAllImpl
        // strips status='deleted' so list pickers don't show ex-staff, but
        // some views (e.g. prospects table agent column) need to resolve
        // an owning agent by id even if that agent has since been deleted.
        // The deleted set is fetched once and merged on top of the cached
        // active set; the cached active set is NOT mutated.
        if (options && options.includeDeleted && tableName === 'users') {
            const active = await this.getAll(tableName, { ...options, includeDeleted: false });
            const deleted = await this._getDeletedUsers();
            if (!deleted.length) return active;
            const seen = new Set(active.map(r => String(r.id)));
            return active.concat(deleted.filter(r => !seen.has(String(r.id))));
        }
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
                if (window.__FS_DEBUG_SWR) console.log(`[SWR] ${tableName}: served ${stale.length} rows instantly from localStorage cache`);
                // Fire-and-forget background refresh
                this._swrRevalidate(tableName).catch(() => {});
                return stale;
            }

            // Tier 2.5 — Cache API overflow tier (async, 100+ MB quota).
            // Checked when localStorage missed — either the table was never
            // persisted there, or the quota pruner evicted it. The Cache API
            // check is async so it can't block; we fire it as a background
            // promise that primes the in-memory cache and emits dataChanged
            // (exactly like SWR revalidation). The Supabase fetch (Tier 3)
            // fires immediately in parallel so there's no extra RTT added.
            this._cacheApiGet(tableName).then(cacheApiRows => {
                if (!cacheApiRows || cacheApiRows.length === 0) return;
                // Only prime if Tier 3 hasn't already returned fresh data AND no
                // Tier-3 fetch is still in flight. Without the in-flight check
                // there's a window where the Cache-API promise resolves while the
                // fresh Supabase fetch is still running: _cacheGet returns null
                // (nothing cached yet), so we'd prime + emit stale rows that the
                // about-to-land fresh result immediately overwrites — a flash of
                // stale data and a redundant re-render.
                const inFlight = this._inFlightGetAll && this._inFlightGetAll.has(tableName);
                if (!this._cacheGet(tableName) && !inFlight) {
                    this._cacheSet(tableName, cacheApiRows);
                    if (window.__FS_DEBUG_SWR) console.log(`[SWR] ${tableName}: served ${cacheApiRows.length} rows from Cache API overflow tier`);
                    this.emit('dataChanged', { action: 'cache_api_hit', table: tableName });
                }
            }).catch(() => {});
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

        const fetchPromise = this._getAllImpl(tableName)
            .catch((err) => {
                // Defense-in-depth (NOT the primary mitigation). The live
                // "Property description must be an object" crash root cause was
                // pinned to esbuild's es2020 lowering of React Query's private
                // class fields in react-island.js (it emitted
                // Object.defineProperty(obj, key, null)), already fixed by
                // setting target: 'es2022' in vite.config.mjs. This .catch is
                // belt-and-suspenders: _getAllImpl owns a graceful offline/error
                // fallback path, but if ANY unexpected error still escapes it,
                // getAll must never reject — a rejected getAll() cascades into
                // empty/broken data-heavy views via an unhandled rejection.
                // Serve the last-known local snapshot (tombstone-filtered) or [].
                try {
                    console.warn(`[DataStore] getAll('${tableName}') hard-failed — serving local snapshot/[]:`, err && err.message || err);
                } catch (_) { /* intentional: console unavailable is non-fatal to the fallback */ }
                try { return this._swrGetLocal(tableName) || []; } catch (_) { /* intentional: snapshot read failed ⇒ serve empty array */ return []; }
            })
            .finally(() => {
                this._inFlightGetAll.delete(tableName);
            });
        this._inFlightGetAll.set(tableName, fetchPromise);
        return fetchPromise;
    }

    // One-shot fetch of soft-deleted users, memoized for the session so the
    // prospect list can resolve an owning agent's name without bloating the
    // shared users cache (which intentionally hides deleted staff).
    async _getDeletedUsers() {
        if (this._deletedUsersPromise) return this._deletedUsersPromise;
        this._deletedUsersPromise = (async () => {
            try {
                const { data, error } = await this._timedFetch(
                    this._readClient()
                        .from('users')
                        .select(this._selectClauseForGetAll('users'))
                        .eq('status', 'deleted')
                );
                if (error) throw error;
                return data || [];
            } catch (e) {
                console.warn('[DataStore] _getDeletedUsers failed:', e?.message);
                this._deletedUsersPromise = null;
                return [];
            }
        })();
        return this._deletedUsersPromise;
    }

    // Targeted lookup: given a list of user ids, return any that aren't in
    // the standard users cache (e.g. deleted, or otherwise excluded). Used
    // by the prospect list to resolve owning-agent names as a safety net
    // after the primary getAll('users') call.
    async getUsersByIds(ids) {
        const unique = Array.from(new Set((ids || []).map(String).filter(Boolean)));
        if (!unique.length) return [];
        try {
            const { data, error } = await this._readClient()
                .from('users')
                .select(this._selectClauseForGetAll('users'))
                .in('id', unique);
            if (error) throw error;
            return data || [];
        } catch (e) {
            console.warn('[DataStore] getUsersByIds failed:', e?.message);
            return [];
        }
    }

    // Paginated query — use this for ANY list view whose table may grow past
    // 1000 rows (prospects, activities, audit_trail, etc.). Bypasses Supabase's
    // implicit 1000-row cap by looping with explicit .range() windows until
    // we get a short page. Honors an optional `filters` map: { column: value }
    // for equality matching. Returns up to opts.max rows (default 50 000 —
    // set a sane upper bound so a buggy caller can't exhaust memory).
    async queryPaged(tableName, opts = {}) {
        const pageSize = Math.max(1, Math.min(1000, opts.pageSize || 1000));
        const max = Math.max(pageSize, Math.min(200000, opts.max || 50000));
        const filters = opts.filters || {};
        const orderBy = opts.orderBy || 'id';
        const ascending = opts.ascending !== false;
        const selectClause = opts.select || this._selectClauseForGetAll(tableName);

        const out = [];
        for (let offset = 0; offset < max; offset += pageSize) {
            // Request a FULL pageSize window (don't clamp `end` to max-1). Clamping
            // made the final window short, so a genuinely-truncated dataset returned
            // a short page and the `< pageSize` break fired — silently capping at
            // `max` rows with NO error. We page full windows and instead throw below
            // when the budget is exhausted while the server still has more, so the
            // caller narrows filters rather than receiving a partial set silently.
            let q = this._readClient()
                .from(tableName)
                .select(selectClause)
                .order(orderBy, { ascending })
                .range(offset, offset + pageSize - 1);
            for (const [col, val] of Object.entries(filters)) {
                if (Array.isArray(val)) q = q.in(col, val);
                else q = q.eq(col, val);
            }
            const { data, error } = await q;
            if (error) throw error;
            if (!data || data.length === 0) break;
            out.push(...data);
            if (data.length < pageSize) break; // last page (genuinely short)
            // Budget filled with a FULL final page. Off-by-one guard (mirrors
            // _getInRange): a dataset of EXACTLY `max` rows must NOT throw. Probe
            // one row past the budget — only throw when the server genuinely has
            // more than `max`; otherwise return the complete set.
            if (offset + pageSize >= max) {
                let probeQ = this._readClient().from(tableName).select('id')
                    .order(orderBy, { ascending }).range(max, max);
                for (const [col, val] of Object.entries(filters)) {
                    if (Array.isArray(val)) probeQ = probeQ.in(col, val);
                    else probeQ = probeQ.eq(col, val);
                }
                const { data: probeData, error: probeErr } = await probeQ;
                if (probeErr) throw probeErr;
                if (probeData && probeData.length > 0) {
                    throw new Error(`queryPaged(${tableName}): result exceeds ${max} rows — narrow filters or raise opts.max`);
                }
                break; // exactly `max` rows, no more — return the complete set
            }
        }
        this._clearOfflineNotice();
        return this._stripTombstones(tableName, out);
    }

    // ── Bounded, server-side date+scope-windowed readers ────────────────────
    // Append-only high-volume tables grow without bound; pulling them whole
    // (getAll) is a memory/bandwidth hazard at scale. The set of such tables is
    // declared as this.HIGH_VOLUME_TABLES in the constructor (matching the
    // _staticTables / _lightSelects instance-property style). The readers below
    // push a mandatory date window (and optional scope) to PostgREST so callers
    // fetch only the slice they render, never the whole table.

    // Shared windowed reader: pages explicit .range() windows between
    // fromISO..toISO (inclusive) on `dateCol`, newest-first, optionally scoped via
    // `scopeCol IN opts.scopeIds`. Mirrors _getAllImpl's RLS empty-read guard +
    // abort/error/tombstone handling. NEVER pulls the whole table — on overflow it
    // throws so the caller narrows the window (no silent truncation).
    async _getInRange(table, dateCol, scopeCol, fromISO, toISO, opts = {}) {
        if (!fromISO || !toISO) throw new Error(`_getInRange(${table}): fromISO and toISO are required`);
        const pageSize = 1000;
        const max = Math.max(1000, Math.min(50000, opts.max || 20000));
        const selectClause = opts.select || this._selectClauseForGetAll(table);
        const scopeIds = (scopeCol && Array.isArray(opts.scopeIds) && opts.scopeIds.length)
            ? opts.scopeIds.map(String) : null;

        if (!this.hasLiveSession()) {   // RLS empty-read guard — serve a filtered local slice
            const local = this._swrGetLocal(table);
            if (local && local.length > 0) {
                const slice = local.filter(r => {
                    const d = r && r[dateCol];
                    if (!d || d < fromISO || d > toISO) return false;
                    if (scopeIds && !scopeIds.includes(String(r[scopeCol]))) return false;
                    return true;
                });
                if (slice.length > 0) return slice;
            }
        }

        const signal = this._inflightSignal();
        const out = [];
        for (let offset = 0; offset < max; offset += pageSize) {
            const end = Math.min(offset + pageSize - 1, max - 1);
            let q = this._readClient().from(table).select(selectClause)
                .gte(dateCol, fromISO).lte(dateCol, toISO)
                .order(dateCol, { ascending: false }).range(offset, end);
            if (scopeIds) q = q.in(scopeCol, scopeIds);
            if (signal && typeof q.abortSignal === 'function') q = q.abortSignal(signal);
            let data, error;
            try { ({ data, error } = await q); }
            catch (e) { if (this._isAbortError(e)) return this._stripTombstones(table, out); throw e; }
            if (this._isAbortError(error)) return this._stripTombstones(table, out);
            if (error) throw error;
            if (!data || data.length === 0) break;
            out.push(...data);
            if (data.length < pageSize) break;   // last page
            // Budget filled with a FULL final page. Off-by-one guard: a dataset of
            // EXACTLY `max` rows (no more on the server) must NOT throw. Probe for a
            // single row past the budget — only throw when the probe actually finds
            // one (i.e. the server genuinely has more than `max`).
            if (offset + pageSize >= max) {
                let probeQ = this._readClient().from(table).select('id')
                    .gte(dateCol, fromISO).lte(dateCol, toISO)
                    .order(dateCol, { ascending: false }).range(max, max);
                if (scopeIds) probeQ = probeQ.in(scopeCol, scopeIds);
                if (signal && typeof probeQ.abortSignal === 'function') probeQ = probeQ.abortSignal(signal);
                let probeData, probeErr;
                try { ({ data: probeData, error: probeErr } = await probeQ); }
                catch (e) { if (this._isAbortError(e)) return this._stripTombstones(table, out); throw e; }
                if (this._isAbortError(probeErr)) return this._stripTombstones(table, out);
                if (probeErr) throw probeErr;
                if (probeData && probeData.length > 0) {
                    throw new Error(`_getInRange(${table}): window exceeds ${max} rows — narrow the date range or scope`);
                }
                break;   // exactly `max` rows, no more — return them
            }
        }
        this._clearOfflineNotice();
        return this._stripTombstones(table, out);
    }

    // Windowed `activities` read (inclusive date window + optional agent scope via lead_agent_id).
    async getActivitiesInRange(fromISO, toISO, opts = {}) {
        return this._getInRange('activities', 'activity_date', 'lead_agent_id', fromISO, toISO, { ...opts, scopeIds: opts.agentIds });
    }

    // Windowed `purchases` read (inclusive date window + optional customer scope;
    // purchases has no agent_id — agent is resolved via customer.responsible_agent_id).
    // Date column is `date` (NOT purchase_date — that lives on refill_reminders).
    // CAVEAT: a gte/lte window EXCLUDES null-date rows. Reporting deliberately KEEPS
    // null-date purchases (see report_purchase_details RPC), so those getters must
    // NOT use this — use the RPC or getAll for null-inclusive purchase reads.
    async getPurchasesInRange(fromISO, toISO, opts = {}) {
        return this._getInRange('purchases', 'date', 'customer_id', fromISO, toISO, { ...opts, scopeIds: opts.customerIds });
    }

    // Fetch only rows where updated_at > sinceISO. Used by _swrRevalidate for
    // incremental (delta) sync so background revalidations download only changed
    // rows instead of the full table. Applies the same light-select as getAll.
    // Throws on error so the caller can fall back to a full fetch.
    async getAllSince(tableName, sinceISO) {
        const selectClause = this._selectClauseForGetAll(tableName);
        const signal = this._inflightSignal();
        // Paginate with explicit .range() windows (ordered by updated_at) so a
        // change-set larger than PostgREST's implicit 1000-row cap isn't silently
        // truncated. Without this, >1000 changed rows returned only an arbitrary
        // 1000 and the caller advanced the delta cursor past the rest — those rows
        // then predated the cursor and could never be delta-fetched again (they
        // healed only at the next full reconcile / reload). Mirror getAll()'s
        // auto-pagination. `useStar` retries with '*' once if the light-select
        // column list is stale.
        const PAGE = 1000;
        const HARD_MAX = 200000; // safety bound so a huge change-set can't exhaust memory
        const runPage = async (useStar, offset) => {
            let q = this._readClient()
                .from(tableName)
                .select(useStar ? '*' : selectClause)
                .gte('updated_at', sinceISO)
                .order('updated_at', { ascending: true })
                .range(offset, offset + PAGE - 1);
            if (signal && typeof q.abortSignal === 'function') q = q.abortSignal(signal);
            return q;
        };
        try {
            const out = [];
            let useStar = false;
            for (let offset = 0; offset < HARD_MAX; offset += PAGE) {
                let { data, error } = await runPage(useStar, offset);
                // If the light-select column list is stale, retry this page with '*'
                // and switch subsequent pages to '*' too.
                if (error && !useStar && selectClause !== '*' && !this._isAbortError(error)) {
                    useStar = true;
                    ({ data, error } = await runPage(true, offset));
                }
                if (error) {
                    if (this._isAbortError(error)) return null;  // view changed mid-fetch — signal abort (NOT empty)
                    throw error;
                }
                if (!data || data.length === 0) break;
                out.push(...data);
                if (data.length < PAGE) break; // last page
            }
            return out;
        } catch (e) {
            if (this._isAbortError(e)) return null;  // signal abort distinctly from "no changes"
            throw e;
        }
    }

    async _getAllImpl(tableName) {
        // ── RLS empty-read guard ──────────────────────────────────────────
        // Without a live auth session (boot race, expired token mid-refresh,
        // offline session restore) PostgREST silently RLS-filters every
        // protected table to 0 rows with HTTP 200. That result must never be
        // mistaken for table truth: serve the local snapshot instead and let
        // the next authenticated read revalidate.
        const hasSession = this.hasLiveSession();
        if (!hasSession) {
            const local = this._swrGetLocal(tableName);
            if (local && local.length > 0) return local;
        }
        const selectClause = this._selectClauseForGetAll(tableName);
        const signal = this._inflightSignal();
        try {
            let data, error;
            let q1 = this._readClient().from(tableName).select(selectClause);
            if (signal && typeof q1.abortSignal === 'function') q1 = q1.abortSignal(signal);
            ({ data, error } = await this._timedFetch(q1));
            // Abort: view changed mid-fetch — drop silently, don't poison cache.
            if (this._isAbortError(error)) return [];
            // If the light-select column list is stale (e.g. a column was renamed
            // or dropped), PostgREST returns a 400. Fall back to '*' once so the
            // page still loads with the full row (including the heavy column).
            if (error && selectClause !== '*' && !this._isAbortError(error)) {
                console.warn(`Light select failed for ${tableName}, retrying with *:`, error.message);
                let q2 = this._readClient().from(tableName).select('*');
                if (signal && typeof q2.abortSignal === 'function') q2 = q2.abortSignal(signal);
                ({ data, error } = await this._timedFetch(q2));
                if (this._isAbortError(error)) return [];
            }
            if (error) throw error;
            // A successful server read proves connectivity — clear any stuck
            // offline banner. Its own dismissal relies on an 'online' event or a
            // visibility/pageshow probe, which can MISS when a transient fetch
            // error fired the banner while navigator.onLine never actually
            // flipped (cold boot / SW update) — leaving it stuck on a healthy
            // connection. A successful read is the authoritative "back online".
            if (window._offlineNotified) {
                try { document.getElementById('offline-banner')?.remove(); } catch (_) { /* intentional: best-effort banner removal */ }
                window._offlineNotified = false;
            }
            // Supabase caps getAll() implicitly at 1000 rows per request. When
            // we hit that cap, auto-page through the rest so list views never
            // silently show a truncated dataset. This is transparent to callers.
            if (Array.isArray(data) && data.length === 1000) {
                console.warn(`[DataStore] getAll('${tableName}') hit 1000-row cap — auto-paginating remainder`);
                try {
                    const rest = await this.queryPaged(tableName, {
                        pageSize: 1000,
                        max: 200000,
                        select: selectClause,
                        orderBy: 'id',
                    });
                    if (rest.length > data.length) data = rest;
                } catch (e2) {
                    console.warn(`[DataStore] auto-paginate failed for ${tableName}:`, e2?.message);
                }
            }
            // Filter out tombstoned records before caching — prevents deleted items reappearing
            const tombstoneRaw = localStorage.getItem('fs_crm_tombstones');
            const tombstones = tombstoneRaw ? JSON.parse(tombstoneRaw) : {};
            const deletedIds = new Set(tombstones[tableName] || []);
            const serverData = (data || []).filter(r => !deletedIds.has(String(r.id)) && !(tableName === 'users' && r.status === 'deleted'));
            // Unauthenticated read reached the network (no local snapshot to
            // serve above): return what came back but do NOT run _autoSync,
            // cache, persist, or bump last_sync — the result is RLS-filtered
            // junk and _autoSync could tombstone or push against it.
            if (!hasSession) return serverData;
            // (Phase 11.1) Reconcile SYNCHRONOUSLY for the rows we return/display
            // (optimistic merge of pending offline items + tombstone filter + local-
            // only fields — NO network), then drain the write-queue to Supabase in the
            // BACKGROUND so a pending offline write never blocks the read hot-path.
            // The common case (empty sync queue) is byte-identical to the prior awaited
            // path; only when offline writes are pending does the push move off-read.
            // _autoSync is unchanged and still owns the push/classify/park/tombstone
            // logic; we just no longer await it (its return value is now redundant with
            // _reconcile, which produces the same optimistic display set without network).
            const result = this._reconcile(tableName, serverData);
            this._autoSync(tableName, serverData).catch(() => { /* background push; transient failures retried on the next read */ });
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
                            localStorage.setItem(`fs_crm_${tableName}`, JSON.stringify(this._sanitizeForStorage(tableName, merged)));
                            // Record sync time so _swrRevalidate can use delta fetch next time
                            localStorage.setItem(`fs_crm_${tableName}_last_sync`, new Date().toISOString());
                        } catch (_) { /* intentional: snapshot persist is best-effort cache write */ }
                    }, 0);
                    return merged;
                }
            } catch (_) { /* intentional: local-field merge is an enhancement; fall through to plain server result */ }
            this._cacheSet(tableName, result);
            setTimeout(() => {
                try {
                    localStorage.setItem(`fs_crm_${tableName}`, JSON.stringify(this._sanitizeForStorage(tableName, result)));
                    // Record sync time so _swrRevalidate can use delta fetch next time
                    localStorage.setItem(`fs_crm_${tableName}_last_sync`, new Date().toISOString());
                } catch (lsErr) {
                    // QuotaExceededError — localStorage full. Write to Cache API
                    // overflow tier so this table isn't lost for the next reload.
                    const isQuota = lsErr && (
                        lsErr.name === 'QuotaExceededError' ||
                        lsErr.name === 'NS_ERROR_DOM_QUOTA_REACHED' ||
                        (lsErr.code !== undefined && lsErr.code === 22)
                    );
                    if (isQuota) {
                        this._cacheApiSet(tableName, result).catch(() => {});
                        if (window.__FS_DEBUG_SWR) console.log(`[SWR] ${tableName}: localStorage quota exceeded — wrote to Cache API overflow`);
                    }
                }
            }, 0);
            return result;
        } catch (e) {
            // Detect "table doesn't exist in schema" — PGRST205 or explicit not-found messages.
            // These are benign in this codebase (tables provisioned lazily), so don't log noisily,
            // don't bother retrying via direct REST, and memoize the miss so repeated getAll()
            // calls on the same cold cache don't all re-hit Supabase with the same 404.
            // AbortError: navigateTo() cancelled this read because the user moved to a
            // different view. Drop silently — caching [] would poison the next page
            // load, and surfacing it as an error toast would be confusing.
            if (this._isAbortError(e)) return [];
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
            const isNetworkError = !navigator.onLine
                || e?.code === 'NETWORK_TIMEOUT'
                || (e instanceof TypeError && /failed to fetch|network request failed|load failed/i.test(e.message || ''));
            if (isNetworkError && !window._offlineNotified) {
                window._offlineNotified = true;
                // A read just failed at the transport layer. Two very different causes look
                // identical here (both surface as `TypeError: Failed to fetch`):
                //   (a) genuine offline — keep the cached-data banner so the user can work.
                //   (b) the live session silently expired (token gone/expired) and the failed
                //       read is really an auth problem (the token-refresh fetch threw). Telling
                //       the user to "check your network" is misleading — route them to re-login.
                // Only treat it as (b) when we appear to be online (navigator.onLine); when truly
                // offline the user can't re-auth anyway, so the cached-data banner is correct.
                // _showSessionExpired (script.js) is idempotent and self-guards via _sessionExpiredShown.
                if (navigator.onLine && this._sessionLikelyDead()
                    && typeof window._showSessionExpired === 'function' && !window._sessionExpiredShown) {
                    window._showSessionExpired('read_failed');
                } else {
                const banner = document.createElement('div');
                banner.id = 'offline-banner';
                banner.setAttribute('role', 'alert');
                banner.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:99998;background:#b45309;color:#fff;text-align:center;padding:8px 16px;font-size:13px;font-weight:600;';
                banner.textContent = '⚠️ 离线模式 — 无法连接服务器，显示缓存数据。请检查网络后刷新。';
                document.body?.prepend(banner);
                // #7 — iOS Safari doesn't reliably fire 'online' on WiFi reconnection.
                // Belt-and-suspenders: also probe on visibilitychange (tab re-focus)
                // and pageshow (back-navigation). Both are reliable cross-platform.
                const _onVisibilityChange = () => { if (document.visibilityState === 'visible') _dismissOfflineBanner(); };
                const _onPageShow = () => _dismissOfflineBanner();
                // Single detach for THIS episode's listeners. The two most common
                // recovery paths (_clearOfflineNotice on any successful read, and the
                // _offlineRecoverTick probe) previously cleared the banner + flag but
                // NOT these listeners, so every offline blip stranded 2 handlers that
                // reactivated (and re-fired a /manifest.json probe) on the next blip.
                // Publish the detach on window so those paths can call it; each episode
                // overwrites the previous (only one episode's listeners live at a time).
                const _detachOfflineListeners = () => {
                    try { document.removeEventListener('visibilitychange', _onVisibilityChange); } catch (_) { /* intentional: best-effort detach */ }
                    try { window.removeEventListener('pageshow', _onPageShow); } catch (_) { /* intentional: best-effort detach */ }
                    if (window._removeOfflineListeners === _detachOfflineListeners) window._removeOfflineListeners = null;
                };
                window._removeOfflineListeners = _detachOfflineListeners;
                const _dismissOfflineBanner = () => {
                    if (!window._offlineNotified) return;
                    // Quick connectivity probe — if it reaches the server, we're back online.
                    fetch('/manifest.json', { cache: 'no-store', signal: AbortSignal.timeout ? AbortSignal.timeout(4000) : undefined })
                        .then(() => {
                            document.getElementById('offline-banner')?.remove();
                            window._offlineNotified = false;
                            _detachOfflineListeners();
                        })
                        .catch(() => {}); // still offline — leave banner
                };
                window.addEventListener('online', function _removeOfflineBanner() {
                    document.getElementById('offline-banner')?.remove();
                    window._offlineNotified = false;
                    _detachOfflineListeners();
                }, { once: true });
                document.addEventListener('visibilitychange', _onVisibilityChange);
                window.addEventListener('pageshow', _onPageShow);
                // Belt-and-suspenders auto-recovery: poll a real (network-only)
                // Supabase read so the banner self-dismisses within a few seconds
                // once the server is reachable again — even on screens whose reads
                // go through BFF/RPC paths that don't hit _clearOfflineNotice, and
                // even if no online/visibility/pageshow event ever fires. Reaching
                // the server at all (even an RLS error resolves, not rejects) = online.
                // Exponential backoff + jitter (was a fixed 4s setInterval). During a
                // real backend outage EVERY offline client polling 'users' every 4s
                // becomes a thundering-herd retry storm that keeps a small/recovering
                // instance pinned — this amplified the 2026-06-16 outage (NANO compute
                // couldn't drain the reconnect storm). Back off 4s → 8s → 16s … capped
                // at 60s, with ±30% jitter so clients don't re-sync into lockstep after
                // a deploy/reconnect. Self-stops when _offlineNotified clears (online/
                // visibility/pageshow handlers set it false).
                let _offlineRecoverStopped = false;
                let _offlineRecoverDelay = 4000;
                const _offlineRecoverTick = async () => {
                    if (_offlineRecoverStopped) return;
                    if (!window._offlineNotified) { _offlineRecoverStopped = true; return; }
                    try {
                        await this._readClient().from('users').select('id').limit(1);
                        try { document.getElementById('offline-banner')?.remove(); } catch (_) { /* intentional: best-effort banner removal */ }
                        window._offlineNotified = false;
                        _detachOfflineListeners();   // detach this episode's stranded listeners on recovery
                        _offlineRecoverStopped = true;
                        return;
                    } catch (_) { /* intentional: still offline — back off and retry */ }
                    _offlineRecoverDelay = Math.min(_offlineRecoverDelay * 2, 60000);
                    setTimeout(_offlineRecoverTick, _offlineRecoverDelay * (0.7 + Math.random() * 0.6));
                };
                // First probe fires fast (≈0.7–1.7s, jittered) so a brief connectivity
                // blip clears the banner almost immediately instead of lingering several
                // seconds. Subsequent probes still back off (4s→8s→…→60s) so a real outage
                // never becomes a thundering-herd retry storm.
                setTimeout(_offlineRecoverTick, 1200 * (0.6 + Math.random() * 0.8));
                }
            }
            // Even when read fails, still try to push queued writes — write endpoint is separate from read.
            // Only when authenticated: anon writes just bounce off RLS and spam the network.
            if (this.hasLiveSession()) this._pushQueuedWrites(tableName).catch(() => {});
            // Always strip tombstoned IDs from any fallback path so deleted records can never reappear.
            // (Inlined the former `const stripDeleted = …` named arrow — the live error stack pinned the
            //  crash to this exact construct's esbuild keepNames wrapper; the getAll()-level catch above
            //  is the authoritative guard, this just removes the suspected trigger.)
            const tombstoneRaw = localStorage.getItem('fs_crm_tombstones');
            const tombstones = tombstoneRaw ? JSON.parse(tombstoneRaw) : {};
            const deletedIds = new Set(tombstones[tableName] || []);
            // Service-role REST fallback removed. The primary Supabase client
            // already carries the anon key + auth session JWT, and RLS policies
            // are set up so authenticated users can read. Fall straight to the
            // offline localStorage cache if the primary fetch failed.
            const local = localStorage.getItem(`fs_crm_${tableName}`);
            return local ? JSON.parse(local).filter(r => !deletedIds.has(String(r.id))) : [];
        }
    }

    // Classify a PostgREST/Postgres write error for sync-queue handling.
    //   'duplicate' — unique-key hit: the row already exists server-side
    //                 (typically inserted under a different id by a retry or
    //                 another device). Treat as already-synced and drop.
    //   'permanent' — data/constraint/schema/permission error: retrying the
    //                 identical payload can never succeed. Park to the dead
    //                 queue instead of retrying on every read forever (this
    //                 was the egg_processed_orders 409 / fp_* 400 storm).
    //   'transient' — network/5xx/everything else: keep and retry later.
    // Thin delegator — pure logic extracted to data-helpers.js (window._dataHelpers).
    _classifyQueueError(error) { return window._dataHelpers.classifyQueueError(error); }

    // True only for a GENUINE network/offline transport failure (fetch never
    // reached the server), NOT a server-side rejection. A permanent server
    // rejection (RLS 42501, NOT NULL 23502, FK 23503, unique 23505, type
    // 22007/22P02, or any error carrying a Postgres .code) must NOT be silently
    // queued-and-reported-success — add()/update() throw so the caller's own
    // failure toast fires. This is the inverse of "should we optimistically
    // queue this write and pretend it succeeded".
    _isGenuineOfflineError(err) {
        if (!err) return false;
        // An explicit Postgres/PostgREST error code means the request reached
        // the server and was rejected — never treat that as offline.
        if (err.code !== undefined && err.code !== null && err.code !== ''
            && err.code !== 'NETWORK_TIMEOUT') {
            return false;
        }
        if (typeof navigator !== 'undefined' && navigator.onLine === false) return true;
        const msg = String(err.message || err.details || err || '');
        if (err.code === 'NETWORK_TIMEOUT') return true;
        return /Failed to fetch|NetworkError|network request failed|load failed/i.test(msg);
    }

    // Move an unsyncable queue item to fs_crm_sync_queue_dead so its data is
    // preserved for inspection without retrying (and failing) on every read.
    _parkQueueItem(item, reason) {
        try {
            const dead = JSON.parse(localStorage.getItem('fs_crm_sync_queue_dead') || '[]');
            dead.push({ ...item, parkedAt: new Date().toISOString(), reason: String(reason || '').slice(0, 300) });
            localStorage.setItem('fs_crm_sync_queue_dead', JSON.stringify(dead.slice(-200)));
        } catch (_) { /* intentional: dead-letter persist is best-effort; warn below still fires */ }
        console.warn(`DataStore: parked unsyncable ${item.tableName} record ${item.record && item.record.id} — ${reason}. Kept in fs_crm_sync_queue_dead.`);
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
                if (!item || !item.record) continue; // skip legacy/corrupt queue entry (no .record) instead of TypeError-aborting the whole drain
                if (deletedIds.has(String(item.record.id))) continue; // dropped from queue, never resurrect
                if (item.pushed) continue; // already synced once — never re-push (prevents resurrection of externally-deleted records)
                try {
                    const { error } = await this._writeClient()
                        .from(tableName)
                        .upsert(item.record);
                    if (error) {
                        const kind = this._classifyQueueError(error);
                        if (kind === 'duplicate') {
                            console.warn(`DataStore: dropping queued ${tableName} ${item.record.id} — already on server (${error.message})`);
                            continue;
                        }
                        if (kind === 'fk') {
                            // Parent row not synced yet — keep retrying up to a bound
                            // so a later pass (after the parent lands) can succeed.
                            item._fkRetries = (item._fkRetries || 0) + 1;
                            if (item._fkRetries < 5) { stillPending.push(item); }
                            else { this._parkQueueItem({ tableName, ...item }, 'FK unresolved after 5 retries: ' + error.message); }
                            continue;
                        }
                        if (kind === 'permanent') {
                            this._parkQueueItem({ tableName, ...item }, error.message);
                            continue;
                        }
                        console.warn(`DataStore: force-push failed for ${item.record.id}: ${error.message}`);
                        // Bounded transient retry (audit #19): an unclassified server error
                        // retried on every read forever is a latent poison-queue storm. The
                        // offline network-throw is the catch below and stays uncapped; only a
                        // persistently-failing server RESPONSE parks (preserved in dead-letter).
                        item._txRetries = (item._txRetries || 0) + 1;
                        if (item._txRetries < 50) stillPending.push(item);
                        else this._parkQueueItem({ tableName, ...item }, `transient error after 50 retries: ${error.message}`);
                    }
                } catch (_) {
                    /* intentional: network throw ⇒ keep item queued for the next drain */
                    stillPending.push(item);
                }
            }
            // Re-read the queue at write time: a concurrent drain for another
            // table (getAll runs for many tables in parallel at boot) may have
            // synced-and-removed its items while we awaited the network. Rebuilding
            // from the stale `otherTable` snapshot captured before those awaits
            // would resurrect them. Read fresh and replace only THIS table's rows —
            // a synchronous read+write is atomic relative to other passes.
            const _freshQueue = JSON.parse(localStorage.getItem('fs_crm_sync_queue') || '[]');
            const _qKey = (q) => `${q.tableName}|${q.record && q.record.id}|${q.timestamp}`;
            // Remove ONLY the items consumed this pass (synced / dropped / tombstoned /
            // parked) plus the pre-await copies of still-pending items (re-appended below
            // carrying their mutated _fkRetries). Everything ELSE in the CURRENT queue is
            // preserved — crucially, this-table writes ENQUEUED DURING our network awaits,
            // which the old `[..._keptOther, ...stillPending]` rebuild silently DROPPED by
            // reconstructing from the stale pre-await snapshot (= lost offline writes).
            const _consumedKeys = new Set(forTable.filter(it => !stillPending.includes(it)).map(_qKey));
            const _stillKeys = new Set(stillPending.map(_qKey));
            const _next = _freshQueue.filter(q => !_consumedKeys.has(_qKey(q)) && !_stillKeys.has(_qKey(q)));
            localStorage.setItem('fs_crm_sync_queue', JSON.stringify([..._next, ...stillPending]));
        } catch (_) { /* intentional: fire-and-forget drain; queue persists and retries on next read */ }
    }

    // Auto-sync: pushes locally-saved (offline/network-error) records to Supabase
    // when we have a live connection. Called by getAll() on every successful fetch.
    // Handles BOTH:
    //   (a) Items in the sync queue (fs_crm_sync_queue) — new mechanism
    //   (b) Pre-existing localStorage items not in Supabase — migration for old offline saves
    // (Phase 11.1) Synchronous read-path reconcile — produces the rows getAll
    // returns WITHOUT any network. Mirrors _autoSync's NON-network merge exactly:
    //   • start from serverData
    //   • optimistically include each pending sync-queue item for this table that
    //     is NOT already on the server, NOT tombstoned, and NOT a confirmed-pushed
    //     ghost (item.pushed && missing from server → externally deleted; excluded,
    //     and _autoSync's background pass tombstones it permanently)
    //   • re-merge local-only extra fields (schema-mismatch columns Supabase stripped)
    // For an EMPTY queue (the common online case) this returns exactly what _autoSync
    // returned (serverData + local-field merge), byte-for-byte. The push itself is
    // done by _autoSync in the background (fired, not awaited, by getAll).
    _reconcile(tableName, serverData) {
        try {
            const serverIds = new Set(serverData.map(r => String(r.id)));
            const merged = [...serverData];
            const _tombstoneRaw = localStorage.getItem('fs_crm_tombstones');
            const _tombstones = _tombstoneRaw ? JSON.parse(_tombstoneRaw) : {};
            const deletedIds = new Set(_tombstones[tableName] || []);
            const queue = JSON.parse(localStorage.getItem('fs_crm_sync_queue') || '[]');
            for (const item of queue) {
                if (item.tableName !== tableName) continue;
                if (!item || !item.record) continue;   // legacy/corrupt entry — skip, don't crash the whole reconcile pass
                const idStr = String(item.record.id);
                if (serverIds.has(idStr)) continue;   // already confirmed on the server
                if (deletedIds.has(idStr)) continue;   // intentionally deleted
                if (item.pushed) continue;             // pushed before but gone from server → ghost (drain tombstones it)
                merged.push(item.record);              // optimistic local row, still pending sync
            }
            // Re-merge local-only extra fields (same as _autoSync Step 3).
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
            } catch (_) { /* intentional: local-only field re-merge is an enhancement; skip on failure */ }
            return merged;
        } catch (_) {
            /* intentional: reconcile is opportunistic — any failure ⇒ return untouched server rows */
            return serverData;
        }
    }

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
                    if (!item || !item.record) continue;   // legacy/corrupt entry — skip, don't crash the whole sync pass
                    const idStr = String(item.record.id);
                    // Already in Supabase — confirmed synced, drop from queue
                    if (serverIds.has(idStr)) continue;
                    // Already tombstoned — drop from queue
                    if (deletedIds.has(idStr)) continue;
                    // Already pushed once before, but missing from server now → externally deleted
                    if (item.pushed) {
                        newTombstones.push(idStr);
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
                            // First push succeeded — flag as pushed so a later "missing from server"
                            // is treated as an external deletion, not a fresh sync attempt.
                            // We don't actually keep it in the queue (success path doesn't push to
                            // stillPending), but if a later code path re-queues, the flag persists.
                            // Phase J followup: clear the ⚠ optimistic chip for activities so the
                            // calendar drops the local overlay row now that the real row has landed.
                            if (tableName === 'activities'
                                && item.record.client_request_id
                                && typeof window._confirmOptimisticActivity === 'function') {
                                try { window._confirmOptimisticActivity(item.record.client_request_id); } catch (_) { /* intentional: optimistic-chip clear is best-effort UI */ }
                            }
                        } else {
                            const kind = uErr ? this._classifyQueueError(uErr) : 'transient';
                            if (kind === 'duplicate') {
                                // Unique-key hit: the row already lives on the
                                // server under another id. Server copy wins —
                                // drop the queued one and don't merge it.
                                console.warn(`DataStore: dropping queued ${tableName} ${item.record.id} — already on server (${uErr.message})`);
                                continue;
                            }
                            if (kind === 'fk') {
                                // Parent row not synced yet (e.g. activity queued
                                // before its prospect). Bounded retry so it isn't
                                // lost to the dead queue before the parent lands.
                                item._fkRetries = (item._fkRetries || 0) + 1;
                                if (item._fkRetries < 5) {
                                    if (!serverIds.has(String(item.record.id))) merged.push(item.record);
                                    stillPending.push(item);
                                } else {
                                    this._parkQueueItem({ tableName, ...item }, 'FK unresolved after 5 retries: ' + (uErr && uErr.message));
                                }
                                continue;
                            }
                            if (kind === 'permanent') {
                                // Unfixable payload (bad id type, RLS deny, bad
                                // column…) — park it; retrying every read was the
                                // endless 400 storm in the console.
                                this._parkQueueItem({ tableName, ...item }, uErr && uErr.message);
                                continue;
                            }
                            // Transient — include item locally but keep in queue, BOUNDED
                            // (audit #19): an unclassified server error retried on every read
                            // forever is a latent poison-queue storm. The offline network-throw
                            // (catch below) stays uncapped; only a persistently-failing server
                            // RESPONSE parks (preserved in dead-letter).
                            item._txRetries = (item._txRetries || 0) + 1;
                            if (item._txRetries < 50) {
                                if (!serverIds.has(String(item.record.id))) merged.push(item.record);
                                stillPending.push(item);
                            } else {
                                this._parkQueueItem({ tableName, ...item }, `transient error after 50 retries: ${uErr && uErr.message}`);
                            }
                        }
                    } catch (_) {
                        /* intentional: network throw ⇒ keep item locally-visible + queued for retry */
                        if (!serverIds.has(String(item.record.id))) merged.push(item.record);
                        stillPending.push(item);
                    }
                }
                // Re-read the queue at write time: a concurrent drain for another
            // table (getAll runs for many tables in parallel at boot) may have
            // synced-and-removed its items while we awaited the network. Rebuilding
            // from the stale `otherTable` snapshot captured before those awaits
            // would resurrect them. Read fresh and replace only THIS table's rows —
            // a synchronous read+write is atomic relative to other passes.
            const _freshQueue = JSON.parse(localStorage.getItem('fs_crm_sync_queue') || '[]');
            const _qKey = (q) => `${q.tableName}|${q.record && q.record.id}|${q.timestamp}`;
            // Remove ONLY the items consumed this pass (synced / dropped / tombstoned /
            // parked) plus the pre-await copies of still-pending items (re-appended below
            // carrying their mutated _fkRetries). Everything ELSE in the CURRENT queue is
            // preserved — crucially, this-table writes ENQUEUED DURING our network awaits,
            // which the old `[..._keptOther, ...stillPending]` rebuild silently DROPPED by
            // reconstructing from the stale pre-await snapshot (= lost offline writes).
            const _consumedKeys = new Set(forTable.filter(it => !stillPending.includes(it)).map(_qKey));
            const _stillKeys = new Set(stillPending.map(_qKey));
            const _next = _freshQueue.filter(q => !_consumedKeys.has(_qKey(q)) && !_stillKeys.has(_qKey(q)));
            localStorage.setItem('fs_crm_sync_queue', JSON.stringify([..._next, ...stillPending]));
                // Persist any new tombstones discovered during this pass
                if (newTombstones.length > 0) {
                    try {
                        const tomb = JSON.parse(localStorage.getItem('fs_crm_tombstones') || '{}');
                        if (!tomb[tableName]) tomb[tableName] = [];
                        for (const id of newTombstones) {
                            if (!tomb[tableName].includes(id)) tomb[tableName].push(id);
                        }
                        localStorage.setItem('fs_crm_tombstones', JSON.stringify(tomb));
                    } catch (_) { /* intentional: best-effort tombstone persist; re-derived next pass */ }
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
            } catch (_) { /* intentional: local-only field re-merge is an enhancement; skip on failure */ }

            return merged;
        } catch (_) {
            /* intentional: auto-sync is opportunistic — any failure ⇒ return untouched server rows */
            return serverData;
        }
    }

    async get(tableName, id) {
        if (id == null || id === 'null' || id === 'undefined') return null;

        // Primed-row side cache — see primeRow(). Rows handed to us via an RPC
        // or other out-of-band path live here so callers under tighter RLS
        // still resolve them via getById without a network miss.
        const primed = this._getPrimedRow(tableName, id);
        if (primed) return primed;

        // If the whole table is already cached, do a synchronous in-memory lookup
        // instead of a network round trip. For tables with heavy columns excluded
        // from getAll (e.g. prospects.cps_form_data), the cached row will be
        // "light" — missing the blob. That's fine for most call sites (table
        // rendering, agent lookups, etc.). Callers that specifically need the
        // heavy column (e.g. rendering the CPS form image in the profile) should
        // use getByIdFull() which always does a network fetch with select=*.
        const cachedTable = this._cacheGet(tableName);
        if (cachedTable) {
            const found = cachedTable.find(r => String(r.id) === String(id));
            if (found) return found;
            // Not found in cache — the cache may be a partial agent-scoped
            // snapshot (e.g. primed by loadCalendarDashboard RPC). Fall through
            // to Supabase so we don't false-positive a "Deleted" warning for
            // a record that exists but was excluded from the filtered cache.
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
                let result = data;
                try {
                    const local = localStorage.getItem(`fs_crm_${tableName}`);
                    if (local) {
                        const records = JSON.parse(local);
                        const localRecord = records.find(r => String(r.id) === String(id));
                        if (localRecord) result = { ...localRecord, ...data };
                    }
                } catch (_) { /* intentional: local-field merge is an enhancement; return server row on failure */ }
                return tableName === 'users' ? this._sanitizeUserRecord(result) : result;
            }
            // Not found in Supabase — check localStorage fallback (schema-mismatch saves).
            // Apply tombstone filtering so a deleted row that is still in localStorage
            // (because localStorage is not pruned on every delete) is never returned.
            const local = localStorage.getItem(`fs_crm_${tableName}`);
            if (local) {
                const tombstoneRaw = localStorage.getItem('fs_crm_tombstones');
                const deletedIds = new Set(((tombstoneRaw ? JSON.parse(tombstoneRaw) : {})[tableName] || []).map(String));
                const records = JSON.parse(local);
                const found = records.find(r => String(r.id) === String(id) && !deletedIds.has(String(r.id))) || null;
                return tableName === 'users' ? this._sanitizeUserRecord(found) : found;
            }
            return null;
        } catch (e) {
            // Service-role REST fallback removed — rely on localStorage cache
            // if the primary Supabase query fails. Apply tombstone filtering here too.
            const local = localStorage.getItem(`fs_crm_${tableName}`);
            if (local) {
                const tombstoneRaw = localStorage.getItem('fs_crm_tombstones');
                const deletedIds = new Set(((tombstoneRaw ? JSON.parse(tombstoneRaw) : {})[tableName] || []).map(String));
                const records = JSON.parse(local);
                return records.find(r => String(r.id) === String(id) && !deletedIds.has(String(r.id))) || null;
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
            console.warn('[getByIdFull] fetch failed for', tableName, id, e);
            return null;
        }
    }

    _extractUnknownCol(e) { return window._dataHelpers.extractUnknownCol(e); }

    _isSchemaError(e) { return window._dataHelpers.isSchemaError(e); }

    // opts.suppressEmit — skip the per-row dataChanged emit (used by createMany's
    // per-row fallback so it can fire ONE batch event instead of N, honoring the
    // createMany contract even when the bulk path falls back to sequential add()).
    async add(tableName, record, opts = {}) {
        const dataToInsert = { ...record };
        if (!dataToInsert.id) dataToInsert.id = this._generateId(tableName);

        // Phase F: server-side idempotency. Stamp a UUID on inserts to tables
        // that have a unique client_request_id index (see migrations/perf_indexes_2026-05-26.sql).
        // If the column doesn't exist yet, the schema-error retry loop below strips it
        // safely — so this is backward-compatible until the migration is applied.
        const IDEMPOTENT_TABLES = new Set(['activities', 'prospects', 'customers']);
        if (IDEMPOTENT_TABLES.has(tableName) && !dataToInsert.client_request_id) {
            try {
                dataToInsert.client_request_id = (window.Perf && window.Perf.uuid)
                    ? window.Perf.uuid()
                    : (crypto && crypto.randomUUID ? crypto.randomUUID() : null);
            } catch (_) { /* intentional: non-fatal — idempotency key is optional */ }
        }

        // Phase J: optimistic UI for activities — push the row into the calendar
        // overlay BEFORE we hit the network, so the user sees their appointment
        // instantly. Cleared on success; flagged 'failed' on error.
        const _isActivityInsert = tableName === 'activities' && dataToInsert.client_request_id;
        if (_isActivityInsert && typeof window._addOptimisticActivity === 'function') {
            try { window._addOptimisticActivity(dataToInsert); } catch (_) { /* intentional: optimistic overlay is best-effort UI */ }
        }

        // Try inserting, stripping unknown columns one-by-one on schema errors
        // so data reaches Supabase even when the table schema is missing new columns.
        let insertData = { ...dataToInsert };
        let lastError = null; // remember the final error so we can surface it on the ⚠ chip
        const _strippedFKCols = []; // FK columns dropped by a 23503 retry — warn the user the link was lost
        for (let attempt = 0; attempt < 15; attempt++) {
            try {
                const { data, error } = await this._writeClient()
                    .from(tableName)
                    .insert(insertData)
                    .select()
                    .single();
                if (error) throw error;
                // A 23503 retry dropped an FK column to let the row save. The row
                // is now orphaned from its referenced record — tell the user so a
                // missing prospect/customer link isn't silently lost.
                if (_strippedFKCols.length && window.UI?.toast?.warning) {
                    try { window.UI.toast.warning(`Saved, but couldn't link to ${_strippedFKCols.join(', ')} — that record no longer exists.`); } catch (_) { /* intentional: toast is best-effort UI feedback */ }
                }
                // Save the ACTUALLY-saved record to localStorage. Do NOT spread the
                // original `dataToInsert` — on a 23503 retry it still carries the
                // dropped (broken) FK value, which the server response `data` omits.
                // Spreading it back would re-inject the stale FK as a "local-only
                // field" that _autoSync/_reconcile re-merge onto the row, silently
                // re-attaching the link the user was just warned was lost.
                let _mirrorHadRows = false;
                try {
                    const key = `fs_crm_${tableName}`;
                    const all = JSON.parse(localStorage.getItem(key) || '[]');
                    _mirrorHadRows = all.length > 0; // only a real full snapshot is safe to keep
                    all.push({ ...insertData, ...data });
                    localStorage.setItem(key, JSON.stringify(this._sanitizeForStorage(tableName, all)));
                } catch (_) { /* intentional: local mirror is best-effort; server insert already succeeded */ }
                this._writeAudit('insert', tableName, data.id || insertData.id, null, data);
                // Keep the fs_crm_<table> mirror we just appended the new server row to
                // (and its delta cursor) instead of deleting it — otherwise the next
                // read cold-re-downloads the whole table after every insert. Only keep
                // it when the mirror was already a populated full snapshot; if it was
                // empty (list never loaded), drop it so the next read does a proper
                // full fetch instead of serving a 1-row snapshot as the whole list.
                this.invalidateCache(tableName, { keepSnapshot: _mirrorHadRows });
                if (!opts.suppressEmit) this.emit('dataChanged', { action: 'add', table: tableName, record: data });
                // Phase J: confirm optimistic row — clears the ⏳ overlay.
                if (_isActivityInsert && typeof window._confirmOptimisticActivity === 'function') {
                    try { window._confirmOptimisticActivity(dataToInsert.client_request_id); } catch (_) { /* intentional: optimistic-chip clear is best-effort UI */ }
                }
                return data;
            } catch (e) {
                lastError = e;
                const col = this._extractUnknownCol(e);
                if (col && col in insertData) {
                    delete insertData[col];
                    continue; // retry without the unknown column
                }
                // Table has a uuid primary key but the auto-id was numeric —
                // regenerate as a uuid and retry. Only for ids WE stamped;
                // caller-supplied ids are left alone (failing loudly beats
                // silently renaming a record the caller still references).
                if (record.id === undefined
                    && insertData.id !== undefined
                    && /invalid input syntax for type uuid/i.test([e?.message, e?.details].filter(Boolean).join(' '))
                    && window.crypto && typeof crypto.randomUUID === 'function') {
                    insertData.id = crypto.randomUUID();
                    dataToInsert.id = insertData.id;
                    continue;
                }
                // FK violation (23503): strip the offending FK column and retry.
                // PostgREST surfaces the column in the detail field: "Key (customer_id)=(uuid) is not present in..."
                if (e?.code === '23503') {
                    const fkSrc = [e?.details, e?.detail, e?.message, e?.hint].filter(Boolean).join(' ');
                    const fkCol = fkSrc.match(/Key \((\w+)\)=/)?.[1];
                    if (fkCol && fkCol in insertData) {
                        console.warn(`FK violation on ${fkCol} — retrying without it`);
                        delete insertData[fkCol];
                        _strippedFKCols.push(fkCol);
                        continue;
                    }
                    // Column not identifiable — strip all known FK columns
                    const knownFKs = ['customer_id', 'prospect_id', 'referrer_id'];
                    let anyStripped = false;
                    for (const fc of knownFKs) {
                        if (fc in insertData) { delete insertData[fc]; _strippedFKCols.push(fc); anyStripped = true; }
                    }
                    if (anyStripped) continue;
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

        // The insert loop exhausted. Distinguish a GENUINE offline/network failure
        // (queue locally + optimistically report success — the original, correct
        // behavior) from a PERMANENT server rejection (RLS 42501, NOT NULL 23502,
        // FK 23503, unique 23505, type 22*, or any error carrying a Postgres .code).
        // A permanent rejection must NOT be silently queued and reported as success:
        // it would show a success toast, close the modal, and later be parked to the
        // dead-letter queue and vanish. Throw so the caller's own failure toast fires.
        const _genuineOffline = this._isGenuineOfflineError(lastError);

        // Update the Phase J optimistic chip (activities only) for BOTH paths so the
        // calendar overlay reflects the real reason — offline (auto-sync) vs a hard
        // server rejection (needs user action).
        if (_isActivityInsert && typeof window._failOptimisticActivity === 'function') {
            const _rawMsg = lastError?.message || '';
            const _code = lastError?.code || (lastError && /Failed to fetch|NetworkError/i.test(_rawMsg) ? 'OFFLINE' : null);
            const _humanMsg = !lastError
                ? 'Offline — will auto-sync when reconnected'
                : (_code === 'OFFLINE' || /Failed to fetch|NetworkError/i.test(_rawMsg))
                    ? 'Offline — will auto-sync when reconnected'
                    : _code === '42501'
                        ? 'Permission denied (RLS) — check your role'
                        : _code === '23505'
                            ? 'Duplicate — already saved'
                            : _code === '23502'
                                ? `Missing required field: ${(_rawMsg.match(/column "([^"]+)"/) || [])[1] || 'unknown'}`
                                : _code === '23503'
                                    ? 'Linked record no longer exists'
                                    : (_rawMsg || 'Save failed') + (lastError.code ? ` (${lastError.code})` : '');
            try { window._failOptimisticActivity(dataToInsert.client_request_id, _humanMsg, _code, _rawMsg); } catch (_) { /* intentional: failure-chip update is best-effort UI */ }
        }

        if (!_genuineOffline) {
            // Permanent server rejection — surface it. Do NOT queue-and-succeed.
            throw (lastError instanceof Error ? lastError : new Error(String(lastError?.message || lastError || 'insert failed')));
        }

        // Genuine offline: full localStorage fallback + sync queue so item gets
        // pushed to Supabase when back online, and optimistically return success.
        const key = `fs_crm_${tableName}`;
        let _mirrorHadRows = false;
        try {
            const all = JSON.parse(localStorage.getItem(key) || '[]');
            _mirrorHadRows = all.length > 0; // only a real full snapshot is safe to keep
            all.push(dataToInsert);
            localStorage.setItem(key, JSON.stringify(this._sanitizeForStorage(tableName, all)));
        } catch (_) { /* intentional: offline local mirror is best-effort */ }
        // Queue for auto-sync to Supabase on next successful getAll()
        try {
            const syncQueue = JSON.parse(localStorage.getItem('fs_crm_sync_queue') || '[]');
            syncQueue.push({ tableName, record: dataToInsert, timestamp: Date.now() });
            localStorage.setItem('fs_crm_sync_queue', JSON.stringify(syncQueue));
        } catch (_) { /* intentional: sync-queue persist is best-effort; offline write may not auto-sync */ }
        // Offline path only: clear the in-memory cache but KEEP the localStorage
        // mirror we just wrote (the offline row) so lists still render it — but only
        // when the mirror was already a populated snapshot. keepSnapshot=false on an
        // empty mirror lets the next read do a proper full fetch instead of serving a
        // 1-row snapshot as the whole list. Either way the sync queue holds the write.
        this.invalidateCache(tableName, { keepSnapshot: _mirrorHadRows });
        if (!opts.suppressEmit) this.emit('dataChanged', { action: 'add', table: tableName, record: dataToInsert });
        return dataToInsert;
    }

    // Batched insert: one round-trip for N rows on the happy path, falling back
    // to per-row add() (full schema-strip / FK / uuid-PK / offline-queue recovery)
    // on ANY error — so behavior matches a sequential add() loop whenever the bulk
    // path can't be used. Emits a single 'add' event (records[]) instead of N.
    // Used for bulk inserts like WhatsApp campaign_messages where the per-recipient
    // loop was an N+1 (and was sequential to avoid the sync-queue race a parallel
    // loop would cause). Safe there: nothing listens per-record to that table.
    async createMany(tableName, records) {
        if (!Array.isArray(records) || records.length === 0) return [];
        const rows = records.map(r => {
            const row = { ...r };
            if (!row.id) row.id = this._generateId(tableName);
            return row;
        });
        try {
            const { data, error } = await this._writeClient()
                .from(tableName)
                .insert(rows)
                .select();
            if (error) throw error;
            const saved = (data && data.length) ? data : rows;
            try {
                const key = `fs_crm_${tableName}`;
                const all = JSON.parse(localStorage.getItem(key) || '[]');
                for (const d of saved) all.push(d);
                localStorage.setItem(key, JSON.stringify(this._sanitizeForStorage(tableName, all)));
            } catch (_) { /* intentional: local mirror is best-effort; bulk insert already succeeded */ }
            for (const d of saved) this._writeAudit('insert', tableName, d.id, null, d);
            this.invalidateCache(tableName);
            this.emit('dataChanged', { action: 'add', table: tableName, records: saved });
            return saved;
        } catch (e) {
            console.warn(`createMany bulk insert failed for ${tableName}, falling back to per-row add: ${e?.message || e}`);
            const out = [];
            // Suppress each add()'s per-row emit and fire ONE batch event after the
            // loop — honors the documented "single dataChanged add event (records[])"
            // contract even on the bulk-failure fallback path.
            for (const r of records) out.push(await this.add(tableName, r, { suppressEmit: true }));
            this.emit('dataChanged', { action: 'add', table: tableName, records: out });
            return out;
        }
    }

    // Batched UPSERT keyed by a natural unique column: one round-trip that inserts
    // the rows and (with ignoreDuplicates) treats a clash on `onConflict` as a
    // no-op for that row rather than an error — so re-running a partially-committed
    // batch cannot create duplicates. Returns ONLY the rows the server actually
    // inserted (skipped clashes are omitted, so `.length` = new rows). Throws on a
    // NON-clash error (e.g. NOT NULL / type), letting the caller fall back to
    // per-row handling. Use for idempotent bulk writes (e.g. egg_processed_orders
    // keyed by unique_key). NOTE: requires a live write client — not offline-queued.
    async upsertMany(tableName, records, { onConflict, ignoreDuplicates = true } = {}) {
        if (!Array.isArray(records) || records.length === 0) return [];
        const { data, error } = await this._writeClient()
            .from(tableName)
            .upsert(records, { onConflict, ignoreDuplicates })
            .select();
        if (error) throw error;
        const saved = data || [];
        // Drop caches so the next read reflects the new rows. Deliberately NO
        // local-mirror append: appending `saved` (only the newly-inserted rows,
        // not the full table) then invalidating would either be dead work or
        // persist a PARTIAL snapshot a later read could serve as if complete. A
        // bulk upsert is infrequent, so a clean revalidate-from-server is safer.
        this.invalidateCache(tableName);
        if (saved.length) this.emit('dataChanged', { action: 'add', table: tableName, records: saved });
        return saved;
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
        let lastError = null; // remember the final server error to decide throw-vs-queue below
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
            } catch (_) { /* intentional: audit-diff baseline is best-effort; skip old_data on miss */ }
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
                let _mirrorUpdated = false;
                try {
                    const key = `fs_crm_${tableName}`;
                    const all = JSON.parse(localStorage.getItem(key) || '[]');
                    const idx = all.findIndex(r => String(r.id) === String(id));
                    // Server response wins: spread updates first so data (server-canonical) takes precedence.
                    const full = { ...updates, ...data };
                    if (idx >= 0) { all[idx] = full; localStorage.setItem(key, JSON.stringify(this._sanitizeForStorage(tableName, all))); _mirrorUpdated = true; }
                } catch (_) { /* intentional: local mirror is best-effort; server update already succeeded */ }
                this._writeAudit('update', tableName, id, _auditOldData, data);
                // Keep the fs_crm_<table> mirror (with the updated row spliced in) +
                // its delta cursor when we successfully patched it in place — deleting
                // it forced a full-table cold re-download after every edit. If the row
                // wasn't in the mirror we couldn't patch it, so fall back to a normal
                // invalidate (drop the snapshot) to avoid serving a stale copy.
                this.invalidateCache(tableName, { keepSnapshot: _mirrorUpdated });
                this.emit('dataChanged', { action: 'update', table: tableName, record: data });
                return data;
            } catch (e) {
                lastError = e;
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
                    } catch (_) { /* intentional: tombstone read is best-effort; treat as not-tombstoned on failure */ }
                    if (isTombstoned) {
                        // Case (b): row was explicitly deleted — honor it, clean up the stale
                        // local copy, return null so the caller can show "deleted" feedback.
                        try {
                            const key = `fs_crm_${tableName}`;
                            const all = JSON.parse(localStorage.getItem(key) || '[]');
                            const filtered = all.filter(r => String(r.id) !== String(id));
                            if (filtered.length !== all.length) localStorage.setItem(key, JSON.stringify(filtered));
                        } catch (_) { /* intentional: stale-row cleanup is best-effort */ }
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
                    } catch (_) { /* intentional: pulling local base fields is best-effort; insert proceeds with updates only */ }
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
                            // Server response wins (parity with the happy path at the
                            // top of update(): { ...updates, ...data }). Spread the
                            // caller's `updates` FIRST so the server-returned `inserted`
                            // row (with trigger-computed / normalized columns) takes
                            // precedence — the previous { ...inserted, ...updates } let
                            // stale client values clobber server-canonical fields.
                            const full = { ...updates, ...inserted };
                            if (idx >= 0) all[idx] = full; else all.push(full);
                            localStorage.setItem(key, JSON.stringify(this._sanitizeForStorage(tableName, all)));
                        } catch (_) { /* intentional: local mirror is best-effort; server insert already succeeded */ }
                        this.invalidateCache(tableName);
                        this.emit('dataChanged', { action: 'update', table: tableName, record: inserted });
                        return inserted;
                    }
                    // Insert failed even after stripping (RLS, FK violation, etc.). Fall
                    // through to the local-save path below — preserves the user's edit
                    // in localStorage and queues it for auto-sync on the next read.
                    lastError = lastInsertErr || lastError;
                    console.warn(`PGRST116 on update to ${tableName} id=${id}; insert fallback failed:`, lastInsertErr?.message || lastInsertErr);
                    break;
                }
                console.warn(`Error on update to ${tableName}: ${e.message} (code: ${e.code}) — saving locally`);
                break;
            }
        }
        // Distinguish a GENUINE offline/network failure (queue locally + report
        // success — the original behavior) from a PERMANENT server rejection (RLS
        // 42501, NOT NULL 23502, type 22*, etc.). A permanent rejection must NOT be
        // silently queued and reported as success — throw so the caller's own
        // failure toast fires instead of showing "saved" and later parking the write.
        if (!this._isGenuineOfflineError(lastError)) {
            throw (lastError instanceof Error ? lastError : new Error(String(lastError?.message || lastError || 'update failed')));
        }
        const key = `fs_crm_${tableName}`;
        let updatedRecord;
        let _mirrorHadRows = false;
        try {
            const all = JSON.parse(localStorage.getItem(key) || '[]');
            _mirrorHadRows = all.length > 0; // only a real full snapshot is safe to keep
            // String-compare ids (the codebase convention) so a numeric record id
            // still matches a string id argument and vice versa, without == coercion edge cases.
            const idx = all.findIndex(r => String(r.id) === String(id));
            updatedRecord = idx >= 0 ? { ...all[idx], ...updates } : { id, ...updates };
            if (idx >= 0) all[idx] = updatedRecord; else all.push(updatedRecord);
            localStorage.setItem(key, JSON.stringify(this._sanitizeForStorage(tableName, all)));
        } catch (_) { /* intentional: storage unavailable ⇒ return the in-memory update result */ updatedRecord = { id, ...updates }; }
        // Queue for auto-sync to Supabase on next successful getAll()
        try {
            const syncQueue = JSON.parse(localStorage.getItem('fs_crm_sync_queue') || '[]');
            // Replace existing queue entry for same id+table, or push new. Guard
            // q.record — legacy/corrupt queue entries without .record exist in the
            // wild (the drain paths already skip them); an unguarded q.record.id
            // would throw here and skip the enqueue, silently losing this edit.
            const qIdx = syncQueue.findIndex(q => q && q.record && q.tableName === tableName && String(q.record.id) === String(id));
            const qEntry = { tableName, record: updatedRecord, timestamp: Date.now() };
            if (qIdx >= 0) syncQueue[qIdx] = qEntry; else syncQueue.push(qEntry);
            localStorage.setItem('fs_crm_sync_queue', JSON.stringify(syncQueue));
        } catch (_) { /* intentional: sync-queue persist is best-effort; offline edit may not auto-sync */ }
        const record = { id, ...updates };
        // Keep the fs_crm_<table> mirror (we just wrote the edited row into it)
        // so an offline edit doesn't blank the list on the next read — but only when
        // the mirror was already a populated snapshot; an empty mirror must be
        // dropped so the next read does a proper full fetch.
        this.invalidateCache(tableName, { keepSnapshot: _mirrorHadRows });
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
            } catch (_) { /* intentional: audit baseline is best-effort; skip old_data on miss */ }
        }
        // Hard delete: must succeed in Supabase first — no silent failures.
        // Use .select('id') so PostgREST returns the deleted rows; an empty array
        // means RLS blocked the delete (RESTRICTIVE policy) with no error object.
        const { data: deleted, error } = await this._writeClient()
            .from(tableName)
            .delete()
            .eq('id', id)
            .select('id');
        if (error) throw error;
        if (!deleted || deleted.length === 0) {
            // 0 rows is ambiguous: (a) RLS blocked the delete, OR (b) the row was
            // never on the server — a record created during an outage that is still
            // sitting in fs_crm_sync_queue (never synced). For case (b), throwing
            // BEFORE the queue purge leaves the queued INSERT in place, so the
            // "deleted" record resurrects on the next drain. Detect a pending,
            // never-pushed queue entry for this id; if found, treat this as a
            // successful local delete (purge + tombstone below) instead of throwing.
            let _pendingLocalOnly = false;
            try {
                const syncQueue = JSON.parse(localStorage.getItem('fs_crm_sync_queue') || '[]');
                _pendingLocalOnly = syncQueue.some(q =>
                    q && q.record && q.tableName === tableName
                    && String(q.record.id) === String(id) && !q.pushed);
            } catch (_) { /* intentional: queue read best-effort; fall through to permission_denied */ }
            if (!_pendingLocalOnly) throw new Error('permission_denied');
            // else: local-only pending record — fall through to purge + tombstone.
        }

        this._writeAudit('delete', tableName, id, _auditOldData, null);

        // Supabase confirmed the delete — now clean up local cache
        try {
            const key = `fs_crm_${tableName}`;
            const all = JSON.parse(localStorage.getItem(key) || '[]');
            localStorage.setItem(key, JSON.stringify(all.filter(r => String(r.id) !== String(id))));
        } catch (_) { /* intentional: local cache cleanup is best-effort; server delete confirmed */ }
        // Remove from sync queue — no point syncing a deleted item. Guard q.record:
        // a legacy/corrupt queue entry without .record would throw here and skip the
        // whole purge, leaving deleted items to re-sync.
        try {
            const syncQueue = JSON.parse(localStorage.getItem('fs_crm_sync_queue') || '[]');
            localStorage.setItem('fs_crm_sync_queue', JSON.stringify(
                syncQueue.filter(q => !(q && q.record && q.tableName === tableName && String(q.record.id) === String(id)))
            ));
        } catch (_) { /* intentional: sync-queue cleanup is best-effort */ }
        // Tombstone so the record never re-surfaces from a stale cache on next getAll
        try {
            const tombstones = JSON.parse(localStorage.getItem('fs_crm_tombstones') || '{}');
            if (!tombstones[tableName]) tombstones[tableName] = [];
            if (!tombstones[tableName].includes(String(id))) tombstones[tableName].push(String(id));
            localStorage.setItem('fs_crm_tombstones', JSON.stringify(tombstones));
        } catch (_) { /* intentional: tombstone persist is best-effort; a stale cache could briefly resurface the row */ }

        this.invalidateCache(tableName);
        this.emit('dataChanged', { action: 'delete', table: tableName, id });
    }

    // A successful SERVER read proves we're online — clear any stale false
    // "offline mode" banner. It is set on a transient fetch error but was only
    // cleared inside getAll/_getAllImpl's cold-fetch success; reads via
    // query/queryAdvanced/queryPaged/RPC never cleared it (and getAll returns
    // from cache once warm), so a transient blip during a cold boot / SW update
    // could leave the banner stuck even while the server is perfectly reachable.
    _clearOfflineNotice() {
        if (window._offlineNotified) {
            try { document.getElementById('offline-banner')?.remove(); } catch (_) { /* intentional: best-effort banner removal */ }
            window._offlineNotified = false;
            // Detach the current offline episode's visibilitychange/pageshow
            // listeners. Recovery via a successful read (this path) used to leave
            // them attached, so they accumulated across episodes and each re-fired a
            // /manifest.json probe on the next offline blip.
            try { if (typeof window._removeOfflineListeners === 'function') window._removeOfflineListeners(); } catch (_) { /* intentional: best-effort listener detach */ }
        }
    }

    // Strip locally-tombstoned (deleted) ids from a result set so the scoped read
    // methods (query/queryAdvanced/queryPaged) never resurface a record that getAll
    // hides. Mirrors getAll/_getAllImpl's tombstone filter so every read path agrees.
    _stripTombstones(tableName, rows) {
        if (!Array.isArray(rows) || rows.length === 0) return rows || [];
        try {
            const raw = (typeof localStorage !== 'undefined') ? localStorage.getItem('fs_crm_tombstones') : null;
            if (!raw) return rows;
            const del = new Set((JSON.parse(raw)[tableName] || []).map(String));
            if (!del.size) return rows;
            return rows.filter(r => !del.has(String(r.id)));
        } catch (_) { /* intentional: corrupt tombstone store ⇒ return rows unfiltered */ return rows; }
    }

    async query(tableName, filters = {}) {
        try {
            // Use the same light-select projection that getAll uses, so wide
            // tables like prospects (27 MB cps_form_data blob) don't force
            // equality-filtered lookups to pull the heavy BLOB on every call.
            // Falls back to `*` if the column list is stale (PostgREST 400).
            const selectClause = this._selectClauseForGetAll(tableName);
            let q = this._readClient().from(tableName).select(selectClause);
            for (const [key, value] of Object.entries(filters)) {
                if (value == null || value === 'null' || value === 'undefined') continue;
                q = q.eq(key, value);
            }
            let { data, error } = await q;
            if (error && selectClause !== '*') {
                // Stale column list — retry with '*' (rare, after schema change)
                let q2 = this._readClient().from(tableName).select('*');
                for (const [key, value] of Object.entries(filters)) {
                    if (value == null || value === 'null' || value === 'undefined') continue;
                    q2 = q2.eq(key, value);
                }
                ({ data, error } = await q2);
            }
            if (error) throw error;
            // PostgREST implicitly caps at 1000 rows. A bare .select().eq() that
            // returns exactly 1000 is almost certainly truncated — callers recompute
            // aggregates from this set (e.g. egg per-group totals) and would persist
            // WRONG numbers. Auto-paginate the full result via queryPaged (same
            // filters) so the caller never silently sees a capped set.
            if (Array.isArray(data) && data.length === 1000) {
                console.warn(`[DataStore] query('${tableName}') hit 1000-row cap — auto-paginating remainder`);
                try {
                    const eqFilters = {};
                    for (const [key, value] of Object.entries(filters)) {
                        if (value == null || value === 'null' || value === 'undefined') continue;
                        eqFilters[key] = value;
                    }
                    const full = await this.queryPaged(tableName, {
                        pageSize: 1000,
                        max: 200000,
                        select: selectClause,
                        orderBy: 'id',
                        filters: eqFilters,
                    });
                    if (full.length > data.length) {
                        this._clearOfflineNotice();
                        return this._stripTombstones(tableName, full);
                    }
                } catch (e2) {
                    console.warn(`[DataStore] query auto-paginate failed for ${tableName}:`, e2?.message);
                }
            }
            this._clearOfflineNotice();
            return this._stripTombstones(tableName, data || []);
        } catch (e) {
            console.warn(`Offline: falling back for ${tableName} query`, e);
            const local = localStorage.getItem(`fs_crm_${tableName}`);
            const all = local ? JSON.parse(local) : [];
            // Strip tombstones so a locally-deleted row never resurfaces from a
            // stale localStorage snapshot (parity with the success path above and
            // getAll/_stripTombstones). Use String() equality (the codebase's
            // id-compare convention) so offline matching mirrors server .eq()
            // strictness instead of loose == coercion (0==false, '1'==1, etc.).
            return this._stripTombstones(
                tableName,
                all.filter(row => Object.entries(filters).every(([k, v]) => String(row[k]) === String(v)))
            );
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
        // Pagination bounds. When the caller asks for MORE than one PostgREST page
        // (>1000), we auto-paginate below — which needs a STABLE sort across pages, so
        // default to 'id' when the caller didn't specify a sort. Single-page reads keep
        // the original behavior (sort only if explicitly requested).
        const limit = options.limit || 50;
        const offset = options.offset || 0;
        const _multiPage = limit > 1000;
        const _sortCol = options.sort || (_multiPage ? 'id' : null);
        const _sortAsc = options.sortDir !== 'desc';

        // Build the (identical) query for a single page. Extracted into a closure so the
        // auto-paginate loop can re-issue it with a moving range.
        const _buildQ = (pageOffset, pageLimit) => {
            let q = this._readClient()
                .from(tableName)
                .select(selectClause, selectOpts);

            // Scoping — restrict to rows the user is allowed to see.
            if (options.scopeFields && options.scopeFields.length > 0) {
                // Strip the OR-syntax delimiters ( ) , from each scope value so an id
                // can't break out of its .in(...) clause and corrupt the OR expression.
                const orParts = options.scopeFields.map(
                    s => `${s.field}.in.(${s.values.map(v => String(v).replace(/[,()]/g, '')).join(',')})`
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

            // Range filters (gte / lte)
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

            // Full-text-style search: token-AND of field-OR (multiple .or() are ANDed).
            if (options.search && options.searchFields && options.searchFields.length > 0) {
                const tokens = options.search.replace(/[%,()*]/g, ' ').trim().split(/\s+/).filter(Boolean);
                for (const tok of tokens) {
                    q = q.or(options.searchFields.map(f => `${f}.ilike.%${tok}%`).join(','));
                }
            }

            if (_sortCol) q = q.order(_sortCol, { ascending: _sortAsc });
            q = q.range(pageOffset, pageOffset + pageLimit - 1);
            return q;
        };

        try {
            // Unauthenticated (boot race / expired token): the server would
            // RLS-filter to 0 rows with HTTP 200 — render from the cached
            // snapshot below instead of showing a falsely-empty view.
            if (!this.hasLiveSession()) throw new Error('no live auth session — using cached fallback');
            const PAGE = 1000;
            const resp = await _buildQ(offset, Math.min(limit, PAGE));
            if (resp.error) {
                // If light-select column list is stale, retry with '*'
                if (selectClause !== '*' && this._isSchemaError(resp.error)) {
                    console.warn(`queryAdvanced light-select failed for ${tableName}, retrying with *`);
                    options.select = '*';
                    return this.queryAdvanced(tableName, options);
                }
                throw resp.error;
            }
            let data = resp.data || [];
            const count = resp.count || 0;
            // Auto-paginate the remainder: when the caller asked for >1000 rows and the
            // first page came back FULL (== the cap), PostgREST truncated silently — page
            // through the rest (stable sort guarantees no dropped/duplicated rows).
            if (_multiPage && data.length === PAGE) {
                let pageOff = offset + PAGE;
                while (data.length < limit && pageOff < offset + limit) {
                    const pr = await _buildQ(pageOff, PAGE);
                    if (pr.error) break;
                    const chunk = pr.data || [];
                    data = data.concat(chunk);
                    if (chunk.length < PAGE) break;
                    pageOff += PAGE;
                    if (pageOff > offset + 200000) break; // safety backstop
                }
            }
            this._clearOfflineNotice();
            return { data: this._stripTombstones(tableName, data), count, limit, offset };
        } catch (e) {
            console.error(`queryAdvanced error on ${tableName}:`, e);
            // Fallback: filter cached/local data client-side with pagination.
            const all = await this.getAll(tableName);
            // Telemetry only (no cap — capping before the filter would return
            // WRONG rows when matches sit beyond the slice). Surfaces the
            // unbounded client-side fallback so a slow/large table is visible
            // instead of silently degrading (the queryAdvanced server path is
            // the place to fix with an index/RPC, not a lossy client cap).
            if (all.length > 500) {
                console.warn(`[DataStore] queryAdvanced fell back to client-side filter for '${tableName}' over ${all.length} rows (server path failed) — view may be slow; consider a server-side index/RPC.`);
            }
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
                // String()-coerce both sides like the multi-field path above —
                // scopeValues are stringified ids but a numeric column (e.g.
                // purchases.customer_id) would otherwise never match (fail-closed
                // = silently empty results for non-admins on the offline path).
                const _sv = new Set(options.scopeValues.map(String));
                filtered = filtered.filter(r => _sv.has(String(r[options.scopeField])));
            }
            if (options.filters) {
                for (const [k, v] of Object.entries(options.filters)) {
                    if (v == null || v === '') continue;
                    filtered = filtered.filter(r => String(r[k]) === String(v));
                }
            }
            // Type-normalized range comparison so the offline fallback matches
            // PostgREST .gte()/.lte() semantics for mixed-type columns: when BOTH
            // operands parse as finite numbers compare numerically; otherwise
            // compare as strings (ISO dates/timestamps sort lexically == chrono).
            // A null/undefined cell never satisfies a range bound (server excludes
            // nulls from gte/lte too). Raw JS >= / <= would coerce inconsistently
            // (lexical on number-vs-string) and diverge from the online path.
            const _cmpGte = (cell, bound) => {
                if (cell == null) return false;
                const nc = Number(cell), nb = Number(bound);
                if (Number.isFinite(nc) && Number.isFinite(nb)) return nc >= nb;
                return String(cell) >= String(bound);
            };
            const _cmpLte = (cell, bound) => {
                if (cell == null) return false;
                const nc = Number(cell), nb = Number(bound);
                if (Number.isFinite(nc) && Number.isFinite(nb)) return nc <= nb;
                return String(cell) <= String(bound);
            };
            if (options.gte) {
                for (const [k, v] of Object.entries(options.gte)) {
                    if (v != null) filtered = filtered.filter(r => _cmpGte(r[k], v));
                }
            }
            if (options.lte) {
                for (const [k, v] of Object.entries(options.lte)) {
                    if (v != null) filtered = filtered.filter(r => _cmpLte(r[k], v));
                }
            }
            if (options.search && options.searchFields) {
                // Mirror the online token-AND of field-OR (see the server path in
                // queryAdvanced) so the offline fallback returns the same rows.
                const tokens = options.search.toLowerCase().split(/\s+/).filter(Boolean);
                filtered = filtered.filter(r =>
                    tokens.every(t =>
                        options.searchFields.some(f => String(r[f] ?? '').toLowerCase().includes(t))
                    )
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

    // ── Server-side prospect page (dormancy + scope + filter + sort + page) ──
    // Single round-trip via the prospects_page RPC
    // (migrations/prospects_page_rpc_2026-06-14.sql, SECURITY DEFINER). Unlike
    // queryAdvanced, the RPC curates dormancy server-side exactly like
    // getActiveProspects (hide >500-day-dormant, KEEP never-contacted) and
    // applies the role-visibility scope in the same statement. Throws on
    // no-session / RPC error so the caller (renderProspectsTable) falls back to
    // the legacy client path. Returns { data, count }.
    //
    // p_visible_agent_ids is a bigint[] of agent IDs (null = unrestricted, for
    // admin/manager). responsible_agent_id is bigint on this schema — pass
    // numbers, not strings/uuids.
    async prospectsPage(opts = {}) {
        if (!this.hasLiveSession()) throw new Error('no live auth session — prospectsPage fallback');
        const { data, error } = await this._readClient().rpc('prospects_page', {
            p_visible_agent_ids: opts.visibleAgentIds ?? null,
            p_search:            opts.search ?? null,
            p_ming_gua:          opts.mingGua ?? null,
            p_agent_id:          opts.agentId ?? null,
            p_include_dormant:   opts.includeDormant ?? false,
            p_dormant_days:      opts.dormantDays ?? 500,
            p_sort:              opts.sort ?? 'score',
            p_sort_dir:          opts.sortDir ?? 'desc',
            p_limit:             opts.limit ?? 50,
            p_offset:            opts.offset ?? 0,
        });
        if (error) throw error;
        // The RPC returns a single row shaped { rows: jsonb[], total: bigint }.
        const row = Array.isArray(data) ? data[0] : data;
        return { data: (row && row.rows) || [], count: Number(row && row.total) || 0 };
    }

    // ── Import duplicate-preview existence check ──────────────────────────
    // Returns only the existing rows whose normalized phone/email/ic matches a
    // key present in the import file — instead of getAll(table) downloading the
    // whole contact table to dedup against. Normalization is done server-side
    // identically to the client (import_existing_matches RPC,
    // migrations/import_existing_matches_2026-06-14.sql). Throws on no-session /
    // RPC error so runDuplicateCheck falls back to the legacy whole-table path.
    // `table` is whitelisted server-side to prospects|customers.
    async importExistingMatches(table, { phones = [], emails = [], ics = [] } = {}) {
        if (!this.hasLiveSession()) throw new Error('no live auth session — importExistingMatches fallback');
        const { data, error } = await this._readClient().rpc('import_existing_matches', {
            p_table:  table,
            p_phones: phones,
            p_emails: emails,
            p_ics:    ics,
        });
        if (error) throw error;
        return data || [];
    }

    // ── Agent leaderboard sales aggregation ───────────────────────────────
    // Per-agent purchase totals for a current + previous period in one grouped
    // server pass (agent_sales_by_period RPC), resolving each purchase's agent
    // via its customer's responsible_agent_id (purchases has no agent_id). Scope
    // is applied server-side via visibleAgentIds (null = unrestricted). Throws on
    // no-session / RPC error so renderAgentLeaderboard falls back to a corrected
    // client computation. Returns [{ agent_id, current_sales, prev_sales }].
    async agentSalesByPeriod({ curFrom, curTo, prevFrom, prevTo, visibleAgentIds = null } = {}) {
        if (!this.hasLiveSession()) throw new Error('no live auth session — agentSalesByPeriod fallback');
        const { data, error } = await this._readClient().rpc('agent_sales_by_period', {
            p_cur_from:  curFrom,
            p_cur_to:    curTo,
            p_prev_from: prevFrom,
            p_prev_to:   prevTo,
            p_agent_ids: visibleAgentIds,
        });
        if (error) throw error;
        return data || [];
    }

    // Bulk delete — runs all deletes in one .in() call instead of one-by-one.
    async deleteMany(tableName, ids) {
        if (!ids || ids.length === 0) return;
        // .select('id') so PostgREST returns the rows ACTUALLY deleted. Ids missing
        // from the result were either RLS-blocked (RESTRICTIVE policy returns 0 rows
        // with NO error) or never on the server (local-only, still in the sync queue).
        // Only tombstone the rows we truly removed — tombstoning an RLS-blocked row
        // hides a still-live server row on this device forever (the cascade-delete
        // "rows vanish locally but persist on server" bug). Mirrors delete()'s guard.
        const { data: deleted, error } = await this._writeClient()
            .from(tableName)
            .delete()
            .in('id', ids)
            .select('id');
        if (error) throw error;
        const deletedSet = new Set((deleted || []).map(r => String(r.id)));
        // Rows not deleted server-side but sitting un-pushed in the sync queue are
        // local-only creates — safe to purge + tombstone locally.
        let pendingLocal = new Set();
        try {
            const syncQueue = JSON.parse(localStorage.getItem('fs_crm_sync_queue') || '[]');
            pendingLocal = new Set(syncQueue
                .filter(q => q && q.record && q.tableName === tableName && !q.pushed)
                .map(q => String(q.record.id)));
        } catch (_) { /* intentional: queue read best-effort */ }
        const handled = ids.map(String).filter(id => deletedSet.has(id) || pendingLocal.has(id));
        const blocked = ids.map(String).filter(id => !deletedSet.has(id) && !pendingLocal.has(id));
        if (handled.length === 0 && blocked.length > 0) {
            // The ENTIRE batch was RLS-blocked (and nothing is local-only) — surface it
            // exactly like delete() does, and tombstone nothing.
            throw new Error('permission_denied');
        }
        if (blocked.length > 0) {
            console.warn(`[DataStore] deleteMany('${tableName}') — ${blocked.length}/${ids.length} row(s) not deleted (RLS-blocked); left intact locally`);
        }
        const idSet = new Set(handled);
        // Clean up local state for the CONFIRMED-deleted IDs only.
        try {
            const key = `fs_crm_${tableName}`;
            const all = JSON.parse(localStorage.getItem(key) || '[]');
            localStorage.setItem(key, JSON.stringify(all.filter(r => !idSet.has(String(r.id)))));
        } catch (_) { /* intentional: local cache cleanup is best-effort; server delete confirmed */ }
        try {
            const syncQueue = JSON.parse(localStorage.getItem('fs_crm_sync_queue') || '[]');
            // Guard q.record — a legacy/corrupt queue entry without .record would
            // throw here and skip the whole purge, leaving deleted items to re-sync.
            localStorage.setItem('fs_crm_sync_queue', JSON.stringify(
                syncQueue.filter(q => !(q && q.record && q.tableName === tableName && idSet.has(String(q.record.id))))
            ));
        } catch (_) { /* intentional: sync-queue cleanup is best-effort */ }
        try {
            const tombstones = JSON.parse(localStorage.getItem('fs_crm_tombstones') || '{}');
            if (!tombstones[tableName]) tombstones[tableName] = [];
            for (const id of handled) {
                if (!tombstones[tableName].includes(String(id))) tombstones[tableName].push(String(id));
            }
            localStorage.setItem('fs_crm_tombstones', JSON.stringify(tombstones));
        } catch (_) { /* intentional: tombstone persist is best-effort; a stale cache could briefly resurface rows */ }
        this.invalidateCache(tableName);
        this.emit('dataChanged', { action: 'deleteMany', table: tableName, ids: handled });
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

        // "Active" excludes won/lost deals: a converted prospect now lives as a
        // customer record and a lost deal is closed — neither belongs in the
        // active prospect set (list counts, re-engagement, dispatchers, birthdays).
        // Blank/NULL status = never-classified → kept. Done client-side to avoid a
        // NULL-status PostgREST pitfall (`status NOT IN (...)` drops NULLs).
        const _activeStatus = (s) => { const v = String(s || '').toLowerCase(); return v !== 'converted' && v !== 'lost'; };

        // Opt-out: caller explicitly wants the full set (admin, reports, etc.)
        if (includeDormant) return this.getAll('prospects', { fresh });

        const cacheKey = `__prospects_active_${dormantDays}`;
        if (!fresh) {
            // Tier 1 — in-memory cache hit (warmest path)
            const cached = this._cacheGet(cacheKey);
            if (cached) return cached;

            // Tier 2 — stale-while-revalidate from localStorage. Same pattern
            // as getAll(): if the previous session persisted a snapshot,
            // serve it instantly so the user sees the list with no network
            // wait, then refresh in the background. Tombstones are looked up
            // against the underlying 'prospects' table (the cacheKey is a
            // derived view, not its own tombstone bucket).
            const stale = this._swrGetLocalDerived(cacheKey, 'prospects');
            if (stale) {
                // Filter the persisted snapshot too — a pre-fix cache may still
                // contain converted/lost rows until the bg refresh rewrites it.
                const staleActive = stale.filter(r => _activeStatus(r.status));
                this._cacheSet(cacheKey, staleActive);
                if (window.__FS_DEBUG_SWR) console.log(`[SWR] ${cacheKey}: served ${staleActive.length} rows instantly from cache`);
                this._refreshActiveProspectsBg(cacheKey, opts).catch(() => {});
                return staleActive;
            }
        }

        const cutoff = new Date(Date.now() - dormantDays * 86400000)
            .toISOString().slice(0, 10); // YYYY-MM-DD
        // Use the lean listing select — only the 16 columns the list view
        // needs. ~75% fewer bytes over the wire vs. the full 60-column select.
        // Falls back to full prospects select, then '*', on stale-column 400.
        const listingSelect = this._lightSelects['prospects_listing'];
        const fullSelect    = this._lightSelects['prospects'] || '*';

        try {
            const dormantFilter = `last_activity_date.gte.${cutoff},last_activity_date.is.null`;
            let { data, error } = await this._timedFetch(
                this._readClient()
                    .from('prospects')
                    .select(listingSelect)
                    .or(dormantFilter)
                    .limit(limit)
            );
            if (error && listingSelect !== fullSelect) {
                ({ data, error } = await this._timedFetch(
                    this._readClient()
                        .from('prospects')
                        .select(fullSelect)
                        .or(dormantFilter)
                        .limit(limit)
                ));
            }
            // Final fallback: bare * so nothing is blocked by a stale column list
            if (error && fullSelect !== '*') {
                ({ data, error } = await this._timedFetch(
                    this._readClient()
                        .from('prospects')
                        .select('*')
                        .or(dormantFilter)
                        .limit(limit)
                ));
            }
            if (error) throw error;
            // Tombstone filter — keep parity with getAll()
            const tombstoneRaw = localStorage.getItem('fs_crm_tombstones');
            const tombstones = tombstoneRaw ? JSON.parse(tombstoneRaw) : {};
            const deletedIds = new Set(tombstones['prospects'] || []);
            const result = (data || []).filter(r => !deletedIds.has(String(r.id)) && _activeStatus(r.status));
            if (result.length === limit) {
                console.warn(`[DataStore] getActiveProspects hit limit ${limit} — raise it or paginate.`);
            }
            this._cacheSet(cacheKey, result);
            // Persist for next session — non-blocking. setTimeout defers the
            // JSON.stringify off the critical path.
            setTimeout(() => {
                try { localStorage.setItem(`fs_crm_${cacheKey}`, JSON.stringify(result)); } catch (_) { /* intentional: derived-snapshot persist is best-effort cache write */ }
            }, 0);
            return result;
        } catch (e) {
            console.warn('getActiveProspects failed, falling back to getAll + client filter', e);
            const all = await this.getAll('prospects');
            return all.filter(p => {
                if (!_activeStatus(p.status)) return false;
                // Keep prospects with no last_activity_date (brand new rows) —
                // the trigger seeds it on insert, but a row created offline
                // might not have it set until sync completes.
                if (!p.last_activity_date) return true;
                return p.last_activity_date >= cutoff;
            });
        }
    }

    // SWR variant of _swrGetLocal for derived-view cache keys (e.g.
    // __prospects_active_500). Same shape as the main helper, but tombstone
    // lookup uses the *underlying* table name rather than the cache key.
    _swrGetLocalDerived(localKey, tombstoneTable) {
        try {
            const raw = localStorage.getItem(`fs_crm_${localKey}`);
            if (!raw) return null;
            const data = JSON.parse(raw);
            if (!Array.isArray(data) || data.length === 0) return null;
            const tombstoneRaw = localStorage.getItem('fs_crm_tombstones');
            const tombstones = tombstoneRaw ? JSON.parse(tombstoneRaw) : {};
            const deletedIds = new Set(tombstones[tombstoneTable] || []);
            return data.filter(r => !deletedIds.has(String(r.id)));
        } catch (_) {
            /* intentional: missing/corrupt derived snapshot ⇒ no stale data, fall through to network */
            return null;
        }
    }

    // Background refresh after serving a stale __prospects_active_* snapshot.
    // Re-calls getActiveProspects with fresh:true (which goes straight to the
    // network path, updates memory + persisted cache), then emits dataChanged
    // if the rows actually moved — same gating pattern as _swrRevalidate so
    // we don't trigger needless re-renders.
    async _refreshActiveProspectsBg(cacheKey, opts) {
        if (!this._swrInFlight) this._swrInFlight = new Set();
        if (this._swrInFlight.has(cacheKey)) return;
        this._swrInFlight.add(cacheKey);
        const prevSnapshot = this._cache.get(cacheKey)?.data || [];
        try {
            const fresh = await this.getActiveProspects({ ...opts, fresh: true });
            if (this._snapshotsDiffer(prevSnapshot, fresh)) {
                if (window.__FS_DEBUG_SWR) console.log(`[SWR] ${cacheKey}: revalidated (${prevSnapshot.length} → ${fresh.length}), refreshing view`);
                this.emit('dataChanged', { action: 'revalidate', table: 'prospects' });
            }
        } catch (_) {
            /* intentional: background refresh is best-effort — user keeps the stale view */
            // Silent — user keeps the stale view
        } finally {
            this._swrInFlight.delete(cacheKey);
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
            select: this._lightSelects['prospects_listing'], // lean, same as listing view
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
        // Light select (skips heavy BLOB columns). Falls back to '*' on the
        // first page if the column list has gone stale (PostgREST 400 with
        // "column X does not exist") — same fallback pattern as
        // getActiveProspects(). This matters for export paths that hit
        // getAllPaged: without it the column-not-found error returned
        // 0 rows silently and the export aborted with "No prospects to
        // export".
        let selectClause = this._selectClauseForGetAll(tableName);
        const all = [];
        let offset = 0;
        let staleClauseRetried = false;
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
                // Stale light-select fallback: retry the same page with
                // `*` once. Only triggers on the very first page so we
                // don't ping-pong on every page if the schema changed
                // mid-fetch.
                if (!staleClauseRetried && offset === 0 && selectClause !== '*') {
                    staleClauseRetried = true;
                    selectClause = '*';
                    console.warn(`[getAllPaged] ${tableName} light select stale, retrying with *:`, error.message);
                    continue;
                }
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
            /* intentional: corrupt tombstone store ⇒ return paged rows unfiltered */
            return all;
        }
    }

    // ── Bounded source for the activities indexed-read fallbacks (MEMO-8) ──
    // When the indexed primary query above throws (network hiccup / stale
    // index / malformed order), the fallback must NOT whole-table-scan via
    // getAll('activities'). Prefer the already-resident local snapshot
    // (_swrGetLocal — no extra network, capped scan); only when no snapshot
    // exists do we fall back to the original getAll('activities') source so no
    // result set is ever lost. The caller still applies the SAME filter / sort
    // / slice(limit), so the materialized output is identical — just bounded.
    async _activitiesFallbackRows() {
        const local = this._swrGetLocal('activities');
        if (Array.isArray(local) && local.length > 0) return local;
        return this.getAll('activities');
    }

    // ── Per-entity activity fetch (indexed) ───────────────────────────────
    // Replaces the `getAll('activities').filter(a => a.prospect_id == id)`
    // pattern that appears ~8 times in script.js (meet-up history, protection
    // timer, latest-activity per prospect detail view, etc.). Each of those
    // call sites downloaded the ENTIRE activities table — at 100K+ rows that
    // was the single biggest N+1 blowup in the codebase.
    //
    // Uses idx_activities_prospect_date for a sub-10 ms lookup regardless of
    // table size. Ordered by activity_date DESC so callers that need the
    // "latest activity" can just read index 0.
    async getActivitiesForProspect(prospectId, opts = {}) {
        const { limit = 500, orderDir = 'desc' } = opts;
        if (!prospectId) return [];
        try {
            const { data, error } = await this._readClient()
                .from('activities')
                .select(this._selectClauseForGetAll('activities'))
                .eq('prospect_id', prospectId)
                .order('activity_date', { ascending: orderDir === 'asc' })
                .limit(limit);
            if (error) throw error;
            // Strip locally-tombstoned activities so a client-deleted row never
            // resurfaces from a stale server snapshot (parity with getAll /
            // query* — class docstring requires every read path to agree).
            return this._stripTombstones('activities', data || []);
        } catch (e) {
            console.warn('getActivitiesForProspect fallback (cache):', e?.message);
            const all = await this._activitiesFallbackRows();
            return all
                .filter(a => String(a.prospect_id) === String(prospectId))
                .sort((a, b) => {
                    const ad = a.activity_date || '';
                    const bd = b.activity_date || '';
                    return orderDir === 'asc' ? ad.localeCompare(bd) : bd.localeCompare(ad);
                })
                .slice(0, limit);
        }
    }

    // Batched "latest activity per prospect" lookup.
    //
    // Replaces N parallel getActivitiesForProspect() calls (one per visible row
    // on the list) with a single `.in('prospect_id', [...])` round-trip. The
    // query is indexed (idx_activities_prospect_date) and ordered server-side;
    // we walk the result once on the client, keeping the first occurrence per
    // prospect_id (which is the most recent because of the DESC order).
    //
    // Returns a Map<prospectIdString, activityRow>. Prospects with no activity
    // simply don't appear as keys.
    async getLatestActivitiesForProspects(prospectIds) {
        const ids = Array.from(new Set((prospectIds || []).filter(Boolean).map(String)));
        const result = new Map();
        if (ids.length === 0) return result;

        // ── SWR cache for per-page activity lookup ────────────────────────
        // Key = sorted IDs so the same set of prospects always maps to the
        // same cache entry regardless of order. Only the 3 fields the list
        // view actually displays are stored (activity_date, activity_type,
        // prospect_id) — keeping the localStorage entry small.
        const cacheKey = `__latact_${ids.slice().sort().join(',')}`;
        const memEntry = this._cache.get(cacheKey);
        if (memEntry && (Date.now() - memEntry.ts) < 120_000) return memEntry.data;

        // Tier 2: stale localStorage snapshot
        try {
            const raw = localStorage.getItem(`fs_crm_${cacheKey}`);
            if (raw) {
                const pairs = JSON.parse(raw);
                if (Array.isArray(pairs) && pairs.length > 0) {
                    const staleMap = new Map(pairs);
                    // Prime memory cache and fire background refresh.
                    // Route through _cacheSet so __latact_ entries obey the same
                    // LRU cap as every other cache key (MEMO-2) — _cacheSet wraps
                    // the value as { data, ts }, identical to the prior shape.
                    this._cacheSet(cacheKey, staleMap);
                    this._refreshLatestActivitiesBg(cacheKey, ids).catch(() => {});
                    if (window.__FS_DEBUG_SWR) console.log(`[SWR] ${cacheKey}: served from localStorage`);
                    return staleMap;
                }
            }
        } catch (_) { /* intentional: corrupt/missing stale snapshot ⇒ fall through to cold network fetch */ }

        // Tier 3: cold network fetch
        return this._fetchAndCacheLatestActivities(cacheKey, ids, result);
    }

    async _fetchAndCacheLatestActivities(cacheKey, ids, result = new Map()) {
        try {
            // Lean select — only the 3 fields the list cell needs.
            const { data, error } = await this._readClient()
                .from('activities')
                .select('prospect_id,activity_date,activity_type')
                .in('prospect_id', ids)
                .order('activity_date', { ascending: false })
                .limit(1000);
            if (error) throw error;
            // Strip locally-tombstoned activities before picking the "latest" per
            // prospect, so a deleted activity can't drive the last-contact column
            // (parity with getAll / query*).
            const _firstRows = this._stripTombstones('activities', data || []);
            for (const row of _firstRows) {
                const key = String(row.prospect_id);
                if (!result.has(key)) result.set(key, row);
            }
            // Completeness guard: a single global activity_date-DESC window is
            // capped at PostgREST's 1000 rows. If busy prospects own the newest
            // 1000 activities, prospects whose latest activity is older never
            // appear — rendering a false "no activity" / blank last-contact. Only
            // when the window saturated (>=1000 rows) AND some ids remain
            // uncovered, run a bounded completion pass: chunk the uncovered ids
            // (small batches so a per-chunk 1000-cap can't truncate) and take the
            // newest row per id from each chunk.
            if (_firstRows.length >= 1000) {
                const uncovered = ids.filter(id => !result.has(String(id)));
                const CHUNK = 50;
                for (let i = 0; i < uncovered.length; i += CHUNK) {
                    const chunk = uncovered.slice(i, i + CHUNK);
                    try {
                        const { data: cData, error: cErr } = await this._readClient()
                            .from('activities')
                            .select('prospect_id,activity_date,activity_type')
                            .in('prospect_id', chunk)
                            .order('activity_date', { ascending: false })
                            .limit(1000);
                        if (cErr) throw cErr;
                        for (const row of this._stripTombstones('activities', cData || [])) {
                            const key = String(row.prospect_id);
                            if (!result.has(key)) result.set(key, row);
                        }
                    } catch (ce) {
                        // Best-effort: a failed completion chunk just leaves those
                        // ids absent (same as before this guard) — don't abort the
                        // whole lookup.
                        console.warn('[DataStore] latest-activity completion chunk failed:', ce?.message);
                    }
                }
            }
            // Route through _cacheSet so __latact_ entries obey the LRU cap
            // (MEMO-2) — _cacheSet wraps as { data, ts }, identical shape.
            this._cacheSet(cacheKey, result);
            setTimeout(() => {
                try {
                    localStorage.setItem(`fs_crm_${cacheKey}`, JSON.stringify([...result.entries()]));
                } catch (_) { /* intentional: per-page activity snapshot persist is best-effort */ }
            }, 0);
            return result;
        } catch (e) {
            console.warn('getLatestActivitiesForProspects fallback (cache):', e?.message);
            // Bounded fallback (MEMO-8): prefer the resident local snapshot
            // (capped scan) over a fresh whole-table getAll; only fall back to
            // the original getAll('activities') source when no snapshot exists.
            const all = await this._activitiesFallbackRows();
            const idSet = new Set(ids);
            const sorted = all
                .filter(a => a.prospect_id != null && idSet.has(String(a.prospect_id)))
                .sort((a, b) => (b.activity_date || '').localeCompare(a.activity_date || ''));
            for (const row of sorted) {
                const key = String(row.prospect_id);
                if (!result.has(key)) result.set(key, row);
            }
            return result;
        }
    }

    async _refreshLatestActivitiesBg(cacheKey, ids) {
        if (!this._swrInFlight) this._swrInFlight = new Set();
        if (this._swrInFlight.has(cacheKey)) return;
        this._swrInFlight.add(cacheKey);
        try {
            const prev = this._cache.get(cacheKey)?.data || new Map();
            const fresh = await this._fetchAndCacheLatestActivities(cacheKey, ids, new Map());
            // Only emit if something changed
            let changed = prev.size !== fresh.size;
            if (!changed) {
                for (const [k, v] of fresh) {
                    const p = prev.get(k);
                    if (!p || p.activity_date !== v.activity_date || p.activity_type !== v.activity_type) {
                        changed = true; break;
                    }
                }
            }
            if (changed) this.emit('dataChanged', { action: 'revalidate', table: 'activities' });
        } finally {
            this._swrInFlight.delete(cacheKey);
        }
    }

    // Mirror for customers — uses idx_activities_customer_date.
    async getActivitiesForCustomer(customerId, opts = {}) {
        const { limit = 500, orderDir = 'desc' } = opts;
        if (!customerId) return [];
        try {
            const { data, error } = await this._readClient()
                .from('activities')
                .select(this._selectClauseForGetAll('activities'))
                .eq('customer_id', customerId)
                .order('activity_date', { ascending: orderDir === 'asc' })
                .limit(limit);
            if (error) throw error;
            // Strip locally-tombstoned activities (parity with getAll / query*).
            return this._stripTombstones('activities', data || []);
        } catch (e) {
            console.warn('getActivitiesForCustomer fallback (cache):', e?.message);
            const all = await this._activitiesFallbackRows();
            return all
                .filter(a => String(a.customer_id) === String(customerId))
                .sort((a, b) => {
                    const ad = a.activity_date || '';
                    const bd = b.activity_date || '';
                    return orderDir === 'asc' ? ad.localeCompare(bd) : bd.localeCompare(ad);
                })
                .slice(0, limit);
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

    // ===== Storage helpers =====
    // Returns a short-lived signed URL for an object in the `attachments`
    // bucket. Use this for new code paths so callers persist the storage
    // *path* (not a permanent public URL) and re-sign at render time.
    // ttlSeconds defaults to 1 hour. Returns null if Supabase isn't ready
    // or the path is empty.
    async getSignedAttachmentUrl(objectPath, ttlSeconds = 3600) {
        if (!objectPath || typeof objectPath !== 'string') return null;
        const sb = window.supabase;
        if (!sb || !sb.storage) return null;
        try {
            const { data, error } = await sb.storage
                .from('attachments')
                .createSignedUrl(objectPath, ttlSeconds);
            if (error) {
                console.warn('[storage] signed URL failed for', objectPath, error.message);
                return null;
            }
            return data?.signedUrl || null;
        } catch (e) {
            console.warn('[storage] signed URL exception for', objectPath, e?.message);
            return null;
        }
    }

    // Batch-sign multiple paths in a single Supabase call. Returns an array
    // matching the input order (null for failures). Much cheaper than N
    // sequential createSignedUrl calls when rendering a photo grid.
    async getSignedAttachmentUrls(objectPaths, ttlSeconds = 3600) {
        if (!Array.isArray(objectPaths) || objectPaths.length === 0) return [];
        const sb = window.supabase;
        if (!sb || !sb.storage) return objectPaths.map(() => null);
        try {
            const { data, error } = await sb.storage
                .from('attachments')
                .createSignedUrls(objectPaths, ttlSeconds);
            if (error) {
                console.warn('[storage] batch signed URL failed', error.message);
                return objectPaths.map(() => null);
            }
            return (data || []).map(r => r?.signedUrl || null);
        } catch (e) {
            console.warn('[storage] batch signed URL exception', e?.message);
            return objectPaths.map(() => null);
        }
    }

    // Accepts either a stored value (a public URL, an object path, or any
    // other URL) and returns a renderable URL:
    //   * external URL (not in attachments bucket) — returned as-is
    //   * public URL pointing to attachments — extracted path → signed URL
    //   * bare path                            — signed URL
    // Caches resolutions for ~50 minutes (signed URLs are valid 60 min).
    // Use this from render code; pair with a DOM auto-resolver for img tags.
    async resolveAttachmentSrc(value, ttlSeconds = 3600) {
        if (!value || typeof value !== 'string') return null;
        // External URL not in our bucket — return as-is.
        if (/^https?:\/\//i.test(value) && !value.includes('/attachments/')) {
            return value;
        }
        const path = this.extractAttachmentPath(value) || value;
        // Cache lookups so a re-render of the same page doesn't re-sign.
        const cache = this._signedUrlCache || (this._signedUrlCache = new Map());
        const cached = cache.get(path);
        if (cached && cached.exp > Date.now()) return cached.url;
        const url = await this.getSignedAttachmentUrl(path, ttlSeconds);
        // Subtract 600 s safety margin so the cached entry expires before the signed URL does.
        // Clamp to 0 so short-lived TTLs (< 600 s) don't produce a negative/past expiry.
        if (url) cache.set(path, { url, exp: Date.now() + (Math.max(0, ttlSeconds - 600)) * 1000 });
        return url;
    }

    // Delete a single object from the `attachments` bucket. Returns true on
    // success. Used by case-study deletion etc. to avoid orphaned files.
    async deleteAttachmentByPath(objectPath) {
        if (!objectPath || typeof objectPath !== 'string') return false;
        const sb = window.supabase;
        if (!sb || !sb.storage) return false;
        try {
            const { error } = await sb.storage.from('attachments').remove([objectPath]);
            if (error) console.warn('[storage] delete failed for', objectPath, error.message);
            return !error;
        } catch (e) {
            console.warn('[storage] delete exception for', objectPath, e?.message);
            return false;
        }
    }

    // Given a public URL produced by `getPublicUrl`, extract the object path
    // inside the bucket. Returns null if the URL doesn't match.
    extractAttachmentPath(publicUrl) {
        if (!publicUrl || typeof publicUrl !== 'string') return null;
        const m = publicUrl.match(/\/storage\/v1\/object\/public\/attachments\/(.+?)(?:\?|$)/);
        return m ? decodeURIComponent(m[1]) : null;
    }

    // ── Journey System methods ────────────────────────────────────────────────

    // Fetch all touchpoints for a single prospect or customer, newest-due first.
    async getJourneyTouchpoints(entityType, entityId) {
        if (!entityId) return [];
        const col = entityType === 'customer' ? 'customer_id' : 'prospect_id';
        try {
            const { data, error } = await window.supabase
                .from('journey_touchpoints')
                .select('*')
                .eq(col, entityId)
                .order('due_date', { ascending: true });
            if (error) throw error;
            return data || [];
        } catch (e) {
            console.warn('[journey] getJourneyTouchpoints', e?.message);
            return [];
        }
    }

    // Touchpoints due today for a specific agent (or all agents if null).
    async getJourneyTouchpointsDueToday(agentId = null) {
        // Local (MYT) date — toISOString() is UTC, so before 08:00 local it yields
        // yesterday and the due-today list comes back empty for morning users.
        const _d = new Date();
        const today = `${_d.getFullYear()}-${String(_d.getMonth()+1).padStart(2,'0')}-${String(_d.getDate()).padStart(2,'0')}`;
        try {
            let q = window.supabase
                .from('journey_touchpoints')
                .select('*, prospects(full_name,phone), customers(full_name,phone)')
                .in('status', ['pending', 'overdue'])
                .lte('due_date', today)
                .order('priority', { ascending: false })
                .order('due_date', { ascending: true });
            // Always scope to the requesting agent when an id is given. Filters on
            // the bigint assigned_to_id column (added 2026-07-03) that matches the
            // CRM's numeric ids — the legacy uuid assigned_to could never match a
            // numeric id, which silently dropped the filter and leaked the whole
            // company's touchpoints (with prospect/customer names + phones).
            if (agentId) q = q.eq('assigned_to_id', agentId);
            const { data, error } = await q;
            if (error) throw error;
            return data || [];
        } catch (e) {
            console.warn('[journey] getJourneyTouchpointsDueToday', e?.message);
            return [];
        }
    }

    // Overdue touchpoints for an agent (status='overdue').
    async getOverdueTouchpointsForAgent(agentId) {
        if (!agentId) return [];
        try {
            const { data, error } = await window.supabase
                .from('journey_touchpoints')
                .select('*')
                .eq('assigned_to_id', agentId)
                .eq('status', 'overdue')
                .order('due_date', { ascending: true });
            if (error) throw error;
            return data || [];
        } catch (e) {
            console.warn('[journey] getOverdueTouchpointsForAgent', e?.message);
            return [];
        }
    }

    // Mark a touchpoint done / skipped / snoozed.
    // opts: { notes?, snooze_days? (for snoozed status), due_date? }
    async updateTouchpointStatus(touchpointId, status, opts = {}) {
        if (!touchpointId) return false;
        const payload = { status, updated_at: new Date().toISOString() };
        if (status === 'done') {
            payload.completed_at = new Date().toISOString();
            // completed_by_id is a bigint column (added 2026-07-03) matching this
            // CRM's numeric user ids; stamp it directly. The legacy uuid completed_by
            // (auth.users) is left null — nothing reads it.
            const _uid = window._currentUser?.id;
            if (_uid != null) payload.completed_by_id = _uid;
        }
        if (status === 'snoozed' && opts.snooze_days) {
            const d = new Date();
            d.setDate(d.getDate() + opts.snooze_days);
            // Local date parts — toISOString() is UTC, so before 08:00 MYT it yields
            // yesterday and an N-day snooze would only push out N-1 days.
            const snoozeDate = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
            payload.snooze_until = snoozeDate;
            payload.status = 'pending';  // re-activate; cron will re-mark overdue if missed
            // CRITICAL: also push due_date out to the snooze date. Nothing reads
            // snooze_until — getJourneyTouchpointsDueToday filters purely on
            // status IN ('pending','overdue') AND due_date <= today. Without moving
            // due_date, a snoozed touchpoint keeps its past/today due_date and
            // reappears in Due Today on the very next render (the snooze was a no-op).
            // Honor an explicit opts.due_date override below if the caller supplies one.
            if (!opts.due_date) payload.due_date = snoozeDate;
        }
        if (opts.notes) payload.notes = opts.notes;
        // Optional reschedule (Wave-C journey fix): write the new due_date when the
        // caller supplies one. Backward compatible — no opts.due_date → unchanged.
        if (opts.due_date) payload.due_date = opts.due_date;
        try {
            // .select('id') so a 0-row update (RLS filtered the row out, or the
            // touchpoint no longer exists) is caught — without it PostgREST resolves
            // error=null on 0 rows and "mark done"/snooze would report success while
            // the touchpoint stays put and reappears on the next render.
            const { data: _upd, error } = await window.supabase
                .from('journey_touchpoints')
                .update(payload)
                .eq('id', touchpointId)
                .select('id');
            if (error) throw error;
            if (!_upd || _upd.length === 0) throw new Error('Touchpoint not updated — it may have been removed or is not permitted.');
            this.invalidateCache('journey_touchpoints');
            return true;
        } catch (e) {
            // Surface the failure instead of only console.warn — a swallowed error
            // made the "mark done" silently no-op with no user feedback.
            console.warn('[journey] updateTouchpointStatus', e?.message);
            try { window.UI?.toast?.error?.('Could not update touchpoint — ' + (e?.message || 'try again')); } catch (_) { /* intentional: toast is best-effort UI feedback */ }
            return false;
        }
    }

    // Get all active journey templates.
    async getJourneyTemplates(track = null) {
        try {
            let q = window.supabase
                .from('journey_templates')
                .select('*')
                .eq('is_active', true)
                .order('sort_order', { ascending: true });
            if (track) q = q.eq('track', track);
            const { data, error } = await q;
            if (error) throw error;
            return data || [];
        } catch (e) {
            console.warn('[journey] getJourneyTemplates', e?.message);
            return [];
        }
    }

    // Spawn touchpoints for an entity from a given stage.
    // opts.startDate    : Date object = when the stage begins (defaults to today)
    // opts.track        : 'active'|'nurture'|'annual'
    // opts.assignedTo   : UUID of the agent to assign to
    // opts.productTrack : 'pr'|'fs'|'cal'|'bed'|'sofa'|'curtain'|'hc'|'all' — filters templates
    // opts.followMode   : 'active'|'warm_hold'|'gentle_nurture' — stored on each touchpoint
    async spawnTouchpointsForStage(entityType, entityId, stageName, opts = {}) {
        const {
            startDate    = new Date(),
            track        = 'active',
            assignedTo   = null,
            productTrack = null,
            followMode   = 'active',
        } = opts;
        try {
            // Fetch templates filtered by stage_name (and optionally product_track)
            let q = window.supabase
                .from('journey_templates')
                .select('*')
                .eq('is_active', true)
                .eq('stage_name', stageName)
                .order('sort_order', { ascending: true });
            if (productTrack && productTrack !== 'all') {
                // Match the specific track, the generic 'all', OR NULL (default
                // templates). SQL `col IN (NULL)` is never true and PostgREST's
                // .in() can't express IS NULL, so the generic/default templates
                // were silently skipped — use an OR with is.null instead.
                q = q.or(`product_track.in.(${productTrack},all),product_track.is.null`);
            }
            const { data: stageTemplates, error: tErr } = await q;
            if (tErr) throw tErr;
            if (!stageTemplates || !stageTemplates.length) return 0;

            const entityCol = entityType === 'customer' ? 'customer_id' : 'prospect_id';
            const rows = stageTemplates.map(t => {
                const dueDate = new Date(startDate);
                dueDate.setDate(dueDate.getDate() + (t.days_offset || 0));
                // Serialize via LOCAL date parts, not toISOString() (UTC): for MYT
                // (UTC+8) any spawn before 08:00 local converts to the previous UTC
                // day, so a days_offset:0 touchpoint would be born already 'overdue'
                // and every cadence date would land one day early.
                const dueDateLocal = `${dueDate.getFullYear()}-${String(dueDate.getMonth()+1).padStart(2,'0')}-${String(dueDate.getDate()).padStart(2,'0')}`;
                return {
                    [entityCol]:         entityId,
                    template_id:         t.id,
                    stage_name:          t.stage_name,
                    track:               t.track || track,
                    touchpoint_type:     t.touchpoint_type,
                    message_template:    t.message_template,
                    title:               t.name,
                    due_date:            dueDateLocal,
                    priority:            t.priority,
                    status:              'pending',
                    assigned_to_id:      assignedTo,
                    escalates_to:        null,
                    escalate_after_days: t.escalate_after_days,
                    product_track:       productTrack || t.product_track || null,
                    follow_mode:         t.follow_mode || followMode,
                };
            });

            const { error } = await window.supabase
                .from('journey_touchpoints')
                .insert(rows);
            if (error) throw error;
            this.invalidateCache('journey_touchpoints');
            return rows.length;
        } catch (e) {
            console.warn('[journey] spawnTouchpointsForStage', e?.message);
            return 0;
        }
    }

    // Get the next scheduled event date for a given event category.
    // Returns YYYY-MM-DD string or null if no upcoming event found.
    async getNextEventDate(eventCategory) {
        if (!eventCategory) return null;
        try {
            // Local date parts — toISOString() is UTC, so before 08:00 MYT it yields
            // yesterday and getNextEventDate could return a past event as "next".
            const _t = new Date();
            const today = `${_t.getFullYear()}-${String(_t.getMonth()+1).padStart(2,'0')}-${String(_t.getDate()).padStart(2,'0')}`;
            const { data, error } = await window.supabase
                .from('events')
                .select('event_date')
                .eq('event_category', eventCategory)
                .gte('event_date', today)
                .order('event_date', { ascending: true })
                .limit(1);
            if (error) throw error;
            return (data && data.length) ? data[0].event_date : null;
        } catch (e) {
            console.warn('[journey] getNextEventDate', e?.message);
            return null;
        }
    }

    // Log a stage transition (immutable).
    async logStageTransition(entityType, entityId, fromStage, toStage, notes = '') {
        // transitioned_by is typed UUID (auth.users) per 20260606_journey_system.sql;
        // a numeric CRM id would throw 22P02 and lose the (immutable) log entry. Only
        // stamp it when the id is a real UUID; otherwise null (column is nullable).
        const _uid = window._currentUser?.id;
        const _transitionedBy = (_uid && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(_uid)))
            ? _uid : null;
        try {
            const { error } = await window.supabase
                .from('journey_stage_log')
                .insert({
                    entity_type:     entityType,
                    entity_id:       entityId,
                    from_stage:      fromStage || null,
                    to_stage:        toStage,
                    transitioned_by: _transitionedBy,
                    notes:           notes || null,
                });
            if (error) throw error;
            this.invalidateCache('journey_stage_log');
            return true;
        } catch (e) {
            console.warn('[journey] logStageTransition', e?.message);
            return false;
        }
    }

    // Append a score snapshot for a prospect.
    async logProspectScore(prospectId, score, delta, triggerEvent = '') {
        if (!prospectId) return false;
        try {
            const { error } = await window.supabase
                .from('prospect_score_log')
                .insert({ prospect_id: prospectId, score, delta, trigger_event: triggerEvent });
            if (error) throw error;
            return true;
        } catch (e) {
            console.warn('[journey] logProspectScore', e?.message);
            return false;
        }
    }

    // Get the full stage transition log for an entity.
    async getJourneyStageLog(entityType, entityId) {
        if (!entityId) return [];
        try {
            const { data, error } = await window.supabase
                .from('journey_stage_log')
                .select('*')
                .eq('entity_type', entityType)
                .eq('entity_id', entityId)
                .order('transitioned_at', { ascending: false });
            if (error) throw error;
            return data || [];
        } catch (e) {
            console.warn('[journey] getJourneyStageLog', e?.message);
            return [];
        }
    }

    // Get conditional rules for evaluating triggers.
    async getConditionalRules() {
        try {
            const { data, error } = await window.supabase
                .from('conditional_rules')
                .select('*')
                .eq('is_active', true);
            if (error) throw error;
            return data || [];
        } catch (e) {
            console.warn('[journey] getConditionalRules', e?.message);
            return [];
        }
    }

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
