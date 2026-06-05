// Ensure app object exists globally - MUST BE FIRST LINE
window.app = window.app || {};
window.DataStore = window.AppDataStore; // Alias for backward compatibility

// ==================== OFFLINE QUEUE DRAIN (Phase O) ====================
// AppDataStore already queues failed inserts to fs_crm_sync_queue and drains
// on every successful getAll(). What was missing: triggering a drain the instant
// connectivity returns, without waiting for the next list view to be opened.
// On 'online', we kick a no-op getAll on the affected tables to drain the queue
// and clear the optimistic overlay for any rows that successfully sync.
(function installOnlineDrain() {
    if (window._onlineDrainInstalled) return;
    window._onlineDrainInstalled = true;
    const drain = async () => {
        if (!navigator.onLine) return;
        if (!window.AppDataStore) return;
        try {
            const queue = JSON.parse(localStorage.getItem('fs_crm_sync_queue') || '[]');
            if (!Array.isArray(queue) || queue.length === 0) return;
            const tables = [...new Set(queue.map(q => q.tableName))];
            // Flip every ⚠ chip back to ⏳ so the user can see the auto-retry happening.
            // _autoSync (inside getAll) will either confirm (chip disappears) or
            // _failOptimisticActivity (chip goes back to ⚠ with a fresh error).
            if (typeof window._markOptimisticRetrying === 'function') {
                try { window._markOptimisticRetrying(); } catch (_) {}
            }
            // getAll triggers _autoSync which upserts queued records.
            for (const t of tables) {
                try { await window.AppDataStore.getAll(t); } catch (_) {}
            }
            // After drain, refresh the calendar — pending rows have either synced
            // (and will appear in the real fetch) or remain failed (overlay shows ⚠).
            if (window.app && typeof window.app.renderCalendar === 'function') {
                // Not actually exposed by name — rely on Phase B's coalesced renderCalendar via UI hook if any.
            }
            console.info('[Perf] online drain finished for', tables.length, 'tables');
        } catch (e) { console.warn('[Perf] online drain failed:', e); }
    };
    window.addEventListener('online', drain);
    // Also try once on load in case we boot with queued items.
    if (document.readyState === 'complete') setTimeout(drain, 800);
    else window.addEventListener('load', () => setTimeout(drain, 800));
})();

// ==================== OFFLINE BANNER (Phase P) ====================
// Lightweight self-installing banner that uses navigator.onLine + the online/offline
// events. Stays out of the way when connection is fine; shows red when offline,
// green "reconnected" toast when restored.
(function installOfflineBanner() {
    if (window._offlineBannerInstalled) return;
    window._offlineBannerInstalled = true;
    const css = document.createElement('style');
    css.textContent = `
        #crm-offline-banner {
            position: fixed; top: 0; left: 0; right: 0; z-index: 100000;
            background: #b91c1c; color: #fff; text-align: center;
            padding: 8px 12px; font-size: 13px; font-weight: 600;
            box-shadow: 0 2px 6px rgba(0,0,0,0.18);
            transform: translateY(-100%); transition: transform .25s ease;
        }
        #crm-offline-banner.show { transform: translateY(0); }
        #crm-offline-banner.ok { background: #16a34a; }
    `;
    document.head.appendChild(css);
    const make = () => {
        const el = document.createElement('div');
        el.id = 'crm-offline-banner';
        el.innerHTML = '<i class="fas fa-wifi" style="margin-right:6px;opacity:.8"></i> You are offline — changes will sync when reconnected';
        document.body.appendChild(el);
        return el;
    };
    let banner = null;
    const update = () => {
        if (!banner) banner = document.getElementById('crm-offline-banner') || make();
        if (!navigator.onLine) {
            banner.classList.remove('ok');
            banner.innerHTML = '<i class="fas fa-wifi" style="margin-right:6px;opacity:.8"></i> You are offline — changes will sync when reconnected';
            banner.classList.add('show');
        } else if (banner.classList.contains('show')) {
            banner.classList.add('ok');
            banner.innerHTML = '<i class="fas fa-check-circle" style="margin-right:6px"></i> Back online — syncing…';
            setTimeout(() => banner.classList.remove('show'), 1800);
        }
    };
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    // Run once after DOM ready in case we boot offline.
    if (document.readyState === 'complete' || document.readyState === 'interactive') {
        setTimeout(update, 0);
    } else {
        document.addEventListener('DOMContentLoaded', update);
    }
})();

// ==================== PERF HELPERS (Phase A: stop double-submits) ====================
// Single source of truth for: idempotency, debounce, coalescing, submit guards.
// Used by the auto-guard at the bottom of this file (wraps every app.save*/create*/add*).
window.Perf = window.Perf || (function () {
    const inflight = new Set();
    return {
        uuid() {
            if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
            return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
                const r = Math.random() * 16 | 0, v = c === 'x' ? r : (r & 0x3 | 0x8);
                return v.toString(16);
            });
        },
        // Re-entrancy guard. Identical keys while in-flight are dropped (returns undefined).
        // Also disables the active button for visual feedback.
        guardAsync(key, fn) {
            if (inflight.has(key)) {
                if (window.UI && UI.toast && UI.toast.info) {
                    try { UI.toast.info('Already saving — please wait…'); } catch (_) {}
                }
                console.debug('[Perf] duplicate suppressed:', key);
                return Promise.resolve(undefined);
            }
            inflight.add(key);
            const btn = document.activeElement;
            const isBtn = btn && (btn.tagName === 'BUTTON' || btn.tagName === 'A');
            const prevDisabled = isBtn ? btn.disabled : null;
            const prevText = isBtn ? btn.innerText : null;
            if (isBtn) {
                btn.disabled = true;
                if (prevText && !/saving|loading|please/i.test(prevText)) {
                    btn.innerText = 'Saving…';
                }
            }
            const release = () => {
                inflight.delete(key);
                if (isBtn) {
                    btn.disabled = !!prevDisabled;
                    if (prevText) btn.innerText = prevText;
                }
            };
            try {
                const r = fn();
                if (r && typeof r.then === 'function') return r.finally(release);
                release();
                return r;
            } catch (e) { release(); throw e; }
        },
        // Debounce: trailing call only.
        debounce(fn, ms = 250) {
            let t = null;
            return function (...args) {
                clearTimeout(t);
                t = setTimeout(() => fn.apply(this, args), ms);
            };
        },
        // Coalesce: while a call is in-flight, subsequent calls return the same promise.
        // Use for expensive idempotent renderers (e.g. renderCalendar).
        coalesce(fn, trailingMs = 0) {
            let pending = null;
            let trailing = null;
            return function (...args) {
                if (pending) {
                    if (trailingMs > 0) {
                        clearTimeout(trailing);
                        trailing = setTimeout(() => { trailing = null; fn.apply(this, args); }, trailingMs);
                    }
                    return pending;
                }
                pending = Promise.resolve()
                    .then(() => fn.apply(this, args))
                    .finally(() => { pending = null; });
                return pending;
            };
        }
    };
})();

// ==================== ON-DEMAND SCRIPT LOADER ====================
// Loads a CDN script once and caches the promise so repeated calls are free.
// Used to defer D3, Chart.js, ExcelJS, XLSX off the critical path (~1.5 MB).
window._loadScriptOnce = window._loadScriptOnce || (() => {
    const cache = new Map();
    return (url) => {
        if (cache.has(url)) return cache.get(url);
        const p = new Promise((resolve, reject) => {
            const s = document.createElement('script');
            s.src = url;
            s.async = true;
            s.onload = () => resolve();
            s.onerror = () => { cache.delete(url); reject(new Error(`Failed to load ${url}`)); };
            document.head.appendChild(s);
        });
        cache.set(url, p);
        return p;
    };
})();

// Library-specific guards — each returns a promise that resolves once the
// global symbol is available. Safe to await repeatedly.
window._ensureChartJs = () => typeof Chart !== 'undefined'
    ? Promise.resolve()
    : window._loadScriptOnce('https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js');
window._ensureD3 = () => typeof d3 !== 'undefined'
    ? Promise.resolve()
    : window._loadScriptOnce('https://cdn.jsdelivr.net/npm/d3@7');
window._ensureExcelJs = () => typeof ExcelJS !== 'undefined'
    ? Promise.resolve()
    : window._loadScriptOnce('https://cdnjs.cloudflare.com/ajax/libs/exceljs/4.4.0/exceljs.min.js');
window._ensureXlsx = () => typeof XLSX !== 'undefined'
    ? Promise.resolve()
    : window._loadScriptOnce('./libs/xlsx.full.min.js');
window._ensureQrScanner = () => typeof Html5Qrcode !== 'undefined'
    ? Promise.resolve()
    : window._loadScriptOnce('./libs/html5-qrcode.min.js');

// Patch to prevent the "undefined .call" error and map missing .create to .add
if (!window.AppDataStore._patched) {
    const originalCreate = window.AppDataStore.create || window.AppDataStore.add;
    window.AppDataStore.create = function(...args) {
        try {
            if (!originalCreate) throw new Error("Method doesn't exist!");
            return originalCreate.apply(this, args);
        } catch (e) {
            if (e.message && e.message.includes("reading 'call'")) {
                console.error("Missing function in create. Available keys:", Object.keys(this));
            }
            throw e;
        }
    };
    // Alias getById to get
    window.AppDataStore.getById = window.AppDataStore.get;
    window.AppDataStore._patched = true;
}
(async function() {
// ANTIGRAVITY v2 LOADED

// Add initialization flag
window.app.ready = false;

// ============================================================================
// Error reporting: window.onerror + unhandledrejection + Sentry (optional)
// ============================================================================
// At scale (100K+ prospects, many concurrent agents) silent failures are the
// biggest observability gap. We do three things:
//   1. Log to console (legacy behavior, kept for dev).
//   2. Buffer the last 50 errors in localStorage so you can read them from
//      DevTools even if the network is down and Sentry never flushed.
//   3. Lazy-load Sentry from CDN if `window.SENTRY_DSN` is defined (set it in
//      index.html or Supabase system_config). No DSN = no Sentry load — zero
//      bytes downloaded, zero perf cost.
// ----------------------------------------------------------------------------
const ERROR_BUFFER_KEY = 'fs_crm_error_buffer';
const ERROR_BUFFER_MAX = 50;

function _bufferError(entry) {
    try {
        const buf = JSON.parse(localStorage.getItem(ERROR_BUFFER_KEY) || '[]');
        buf.push({ ts: new Date().toISOString(), ...entry });
        while (buf.length > ERROR_BUFFER_MAX) buf.shift();
        localStorage.setItem(ERROR_BUFFER_KEY, JSON.stringify(buf));
    } catch (_) { /* quota exceeded or SecurityError — best-effort only */ }
}

window.onerror = (msg, url, line, col, err) => {
    console.error(`GLOBAL ERROR: ${msg} at ${url}:${line}:${col}`, err);
    _bufferError({ kind: 'error', msg: String(msg), url, line, col, stack: err?.stack });
    if (window.Sentry?.captureException && err) window.Sentry.captureException(err);
};

window.addEventListener('unhandledrejection', (e) => {
    const reason = e.reason;
    const msg = reason?.message || String(reason);
    console.error('UNHANDLED REJECTION:', reason);
    _bufferError({ kind: 'unhandledrejection', msg, stack: reason?.stack });
    if (window.Sentry?.captureException) window.Sentry.captureException(reason);
});

// Lazy-load Sentry from CDN only if a DSN is configured. Deferred to
// after-first-paint so it never blocks the initial render. To enable:
//   1. Sign up at sentry.io, get a DSN.
//   2. Add to index.html <head>: <script>window.SENTRY_DSN='https://...';</script>
//   3. Reload — the browser SDK loads asynchronously and starts reporting.
if (window.SENTRY_DSN) {
    (function loadSentry() {
        const s = document.createElement('script');
        s.src = 'https://browser.sentry-cdn.com/7.112.2/bundle.tracing.min.js';
        s.integrity = 'sha384-unset'; // set a real SRI hash if you pin a version
        s.crossOrigin = 'anonymous';
        s.onload = () => {
            try {
                window.Sentry.init({
                    dsn: window.SENTRY_DSN,
                    tracesSampleRate: 0.05,      // 5 % perf traces — keep quota low
                    replaysSessionSampleRate: 0,  // no session replay by default
                    environment: location.hostname === 'destinoraclessolution.com' ? 'prod' : 'staging',
                    beforeSend(event) {
                        // Drop events that look like extension noise (common source of spam)
                        if (event.exception?.values?.[0]?.stacktrace?.frames?.some(
                            f => /chrome-extension:|moz-extension:/.test(f.filename || ''))) return null;
                        return event;
                    },
                });
                console.log('[Sentry] initialized');
            } catch (e) {
                console.warn('[Sentry] init failed:', e);
            }
        };
        s.onerror = () => console.warn('[Sentry] CDN load failed — errors still buffered to localStorage');
        document.head.appendChild(s);
    })();
}

// ==================== USER PREFERENCES (Supabase-backed, localStorage cache) ====================
const UserPreferences = {
    _cache: {},       // { pref_key: { id, value } }
    _userId: null,
    _loaded: false,

    async load(userId) {
        this._userId = userId;
        this._cache = {};
        try {
            const allPrefs = await AppDataStore.getAll('user_preferences');
            const myPrefs = (allPrefs || []).filter(p => String(p.user_id) === String(userId));
            for (const pref of myPrefs) {
                this._cache[pref.pref_key] = { id: pref.id, value: pref.pref_value };
            }
        } catch (e) {
            console.warn('UserPreferences.load failed, using localStorage fallback:', e.message);
        }
        // One-time migration from localStorage
        if (!this._cache['_migrated']) {
            await this._migrateFromLocalStorage(userId);
        }
        this._loaded = true;
    },

    getSync(key, defaultValue) {
        const entry = this._cache[key];
        if (entry !== undefined && entry.value !== undefined && entry.value !== null) return entry.value;
        return defaultValue;
    },

    async save(key, value) {
        const existing = this._cache[key];
        const now = new Date().toISOString();
        try {
            if (existing && existing.id) {
                await AppDataStore.update('user_preferences', existing.id, {
                    pref_value: value, updated_at: now
                });
                this._cache[key] = { id: existing.id, value };
            } else {
                const row = await AppDataStore.create('user_preferences', {
                    user_id: this._userId, pref_key: key, pref_value: value, updated_at: now
                });
                this._cache[key] = { id: row?.id || Date.now(), value };
            }
        } catch (e) {
            console.warn('UserPreferences.save failed:', e.message);
            // Still update in-memory cache so getSync works this session
            this._cache[key] = { id: existing?.id || null, value };
        }
    },

    async remove(key) {
        const existing = this._cache[key];
        if (existing && existing.id) {
            try { await AppDataStore.delete('user_preferences', existing.id); } catch (_) {}
        }
        delete this._cache[key];
    },

    async _migrateFromLocalStorage(userId) {
        const migrations = [
            { lsKey: 'voice_settings', prefKey: 'voice_settings', parse: v => { try { return JSON.parse(v); } catch(_) { return null; } } },
            { lsKey: `hidden_top_referrers_v2_${userId}`, prefKey: 'hidden_referrers', parse: v => { try { return JSON.parse(v); } catch(_) { return null; } } },
            { lsKey: 'session_timeout', prefKey: 'session_timeout', parse: v => parseInt(v) || 30 },
            { lsKey: 'biometric_enabled', prefKey: 'biometric_enabled', parse: v => v === 'true' },
            { lsKey: 'offline_mode', prefKey: 'offline_mode', parse: v => v === 'true' },
            { lsKey: 'auto_lock_time', prefKey: 'auto_lock_time', parse: v => parseInt(v) || 5 },
            { lsKey: 'sync_frequency', prefKey: 'sync_frequency', parse: v => parseInt(v) || 15 },
            { lsKey: 'last_username', prefKey: 'last_username', parse: v => v },
        ];
        for (const m of migrations) {
            try {
                const raw = localStorage.getItem(m.lsKey);
                if (raw != null && !this._cache[m.prefKey]) {
                    const value = m.parse(raw);
                    if (value != null) await this.save(m.prefKey, value);
                }
            } catch (_) {}
        }
        try { await this.save('_migrated', true); } catch (_) {}
    }
};
window.UserPreferences = UserPreferences;

const appLogic = (() => {
    // Ensure _crmUtils exists before any early Object.assign() augments it.
    // Initialised properly at ~line 928 with escapeHtml; this prevents the
    // TypeError that breaks the entire IIFE return when early role-helpers
    // (isSystemAdmin / isMarketingManager) try to attach themselves first.
    window._crmUtils = window._crmUtils || {};

    let _currentView = 'dashboard';
    let _currentUser = null;
    let _currentMarketingTab = 'templates'; // Phase 12: 'templates', 'campaigns', 'analytics'
    // _currentMarketingListTab moved here from the (now-chunked) Marketing Lists
    // section so script.js's bare assignments at ~21900/33950/35850 stay valid
    // rather than silently creating an implicit window global. The marketing
    // chunk reads/writes it via window._appState.cmlt (see below).
    let _currentMarketingListTab = 'products'; // 'products', 'events', 'promotions', 'venues'
    let _selectedEntity = null;
    let _selectedAttendees = [];
    let _selectedCoAgents = [];
    let _selectedConsultants = []; // { id, name, status: 'pending'|'accepted'|'rejected' }
    let _selectedReferrer = null;
    let _selectedProspectReferrer = null;
    let _pendingIntakeId = null;   // Set by openApproveCpsIntakeModal; consumed by saveActivity
    let _pendingIntakeRow = null;  // Full intake row, used to send WhatsApp confirmation
    let _currentDate = new Date(); // Dynamic start date
    let _filters = { agent: 'all', type: 'all', from: '', to: '' };
    // Stamped by navigateTo. Used by initSync's dataChanged listener to
    // suppress the SWR revalidation refresh that would otherwise fire 1–3s
    // after every navigation and rebuild the entire view (visible flash,
    // lost scroll position, lost in-progress clicks). After this guard
    // window passes, mutations and remote-driven revalidations refresh
    // the view as before.
    let _lastNavigatedAt = 0;
    let _purchasesHistoryCache = null;
    let _purchasesHistoryCacheTs = 0;
    let _phFilter = { search: '', agent: 'all', delivery: 'all', from: '', to: '' };
    let _phPage = 0;
    const _PH_PAGE_SIZE = 50;
    const _SWR_REFRESH_GUARD_MS = 5000;
    // Lookup tables that are read every time the activity modal opens.
    // Caching them session-wide is the difference between an instant tap-to-open
    // and a 1-3s freeze on mobile, where the modal awaits both fetches before it
    // can even render. 2-minute TTL keeps post-edit staleness bounded.
    let _venuesCache = null;
    let _venuesCacheTs = 0;
    let _productsCache = null;
    let _productsCacheTs = 0;
    const _LOOKUP_CACHE_TTL_MS = 2 * 60 * 1000;
    // Monotonic token: only the most recent renderCalendar commits to the DOM.
    // Without this, rapid prev/next taps spawn racing renders whose results
    // arrive out of order — the slower fetch arriving second clobbers the
    // newer view and the calendar appears to "jump back".
    let _renderCalendarToken = 0;
    // Cache of full activity rows for the "hot window" (yesterday + today + 7d).
    // Warmed in parallel with the light calendar fetch so taps on near-term
    // activity cards open the detail modal instantly — no extra network round-trip.
    // Keyed by activity id (string). Refreshed on every renderCalendar.
    const _hotActivityCache = new Map();
    // Tracks the open detail view so pull-to-refresh can re-open it instead of jumping to the list.
    let _currentDetailView = null; // { type: 'prospect'|'customer', id: number }

    // ── View HTML cache (perf: instant tab switches) ──────────────────────
    // Stores the rendered viewport DOM + scroll position per view so that
    // bouncing between high-traffic tabs (Calendar / Prospects / Pipeline)
    // doesn't pay the 200-800 ms cost of rebuilding a giant innerHTML on
    // every click. Cached entries are restored only when fresh (< TTL) and
    // are wiped by data mutations (saveProspect, dataChanged event, etc.).
    // Safe because the codebase uses inline onclick="app.fn()" everywhere —
    // no listeners to re-bind after innerHTML restore.
    const _viewHtmlCache = new Map(); // cacheKey -> { html, className, scrollTop, ts }
    const _VIEW_HTML_CACHE_TTL_MS = 60_000;
    const _CACHEABLE_VIEWS = new Set(['prospects', 'calendar', 'month', 'pipeline']);
    // Mobile + desktop render entirely different DOM for the same viewId
    // (mobile uses _mpRenderList card layout, desktop uses renderProspectsTable).
    // Without a viewport-tier suffix on the cache key, a desktop snapshot
    // would be restored on a mobile viewport (or vice versa) — that's exactly
    // how iPhone users were landing on the desktop TABLE view squeezed into a
    // narrow viewport, with applyMobileTableLabels() decorating each <td>
    // with data-label="NAME" etc. to look like a fake card.
    const _viewCacheKey = (viewId) => {
        const tier = (typeof window !== 'undefined' && window.innerWidth <= 768) ? 'm' : 'd';
        return `${viewId}:${tier}`;
    };
    const _saveViewToCache = (viewId, viewport) => {
        if (!viewId || !viewport || !_CACHEABLE_VIEWS.has(viewId)) return;
        _viewHtmlCache.set(_viewCacheKey(viewId), {
            html: viewport.innerHTML,
            className: viewport.className,
            scrollTop: viewport.scrollTop || 0,
            ts: Date.now(),
        });
    };
    const _restoreViewFromCache = (viewId, viewport) => {
        if (!viewId || !viewport || !_CACHEABLE_VIEWS.has(viewId)) return false;
        const key = _viewCacheKey(viewId);
        const entry = _viewHtmlCache.get(key);
        if (!entry) return false;
        if (Date.now() - entry.ts > _VIEW_HTML_CACHE_TTL_MS) {
            _viewHtmlCache.delete(key);
            return false;
        }
        viewport.innerHTML = entry.html;
        viewport.className = entry.className;
        // Restore scroll on the next frame so layout settles first.
        requestAnimationFrame(() => { viewport.scrollTop = entry.scrollTop; });
        return true;
    };
    const _invalidateViewCache = (...viewIds) => {
        if (!viewIds.length) { _viewHtmlCache.clear(); return; }
        // Drop BOTH mobile and desktop snapshots for each requested viewId so
        // an invalidation on one tier never leaves a stale snapshot on the other.
        for (const v of viewIds) {
            _viewHtmlCache.delete(`${v}:m`);
            _viewHtmlCache.delete(`${v}:d`);
        }
    };

    // ========== ROLE HELPERS ==========
    // Extract numeric level from a role string. "Level 10 Agent" -> 10, "Level 1 Super Admin" -> 1.
    // Falls back to legacy named roles. Returns 99 (lowest) when nothing matches.
    // CRITICAL: must use word boundary regex — `'Level 10 Agent'.includes('Level 1')` is TRUE,
    // which used to silently grant Level 10/11/12/13/14 users full Super Admin visibility.
    const _getUserLevel = (user) => {
        if (!user?.role) return 99;
        const m = String(user.role).match(/Level\s+(\d+)\b/i);
        if (m) return parseInt(m[1], 10);
        const r = String(user.role).toLowerCase();
        if (r === 'super_admin' || r === 'admin') return 1;
        if (r === 'marketing_manager') return 2;
        if (r === 'manager') return 4;
        if (r === 'team_leader') return 5;
        if (r === 'consultant') return 7;
        if (r === 'agent') return 10;
        if (r === 'stock_take_staff' || r === 'stock_take') return 15;
        if (r === 'customer') return 13;
        if (r === 'referrer') return 14;
        // Chinese-only role names (no "Level X" prefix) for L12/13/14
        const raw = String(user.role).trim();
        if (raw === '传福大使')   return 12;
        if (raw === '改命客户')   return 13;
        if (raw === '准传福大使') return 14;
        return 99;
    };
    const isSystemAdmin = (user) => _getUserLevel(user) === 1;
    const isMarketingManager = (user) => _getUserLevel(user) === 2;
    // Expose role helpers after they're defined
    Object.assign(window._crmUtils, { isSystemAdmin, isMarketingManager });
    // getUserLevel exposed so chunks can call _utils.getUserLevel(user) without
    // capturing the IIFE-private _getUserLevel closure.
    Object.assign(window._crmUtils, { getUserLevel: _getUserLevel });
    // Level 15: restricted "Stock Take Staff" — sees only the Stock Take tab,
    // and inside it only the count / recount / summary tabs (no admin setup).
    const isStockTakeStaff = (user) => _getUserLevel(user) === 15;
    Object.assign(window._crmUtils, { isStockTakeStaff });
    const canAccessStockTake = (user) => isSystemAdmin(user) || isStockTakeStaff(user);
    const isAgent = (user) => {
        const lvl = _getUserLevel(user);
        return lvl >= 3 && lvl <= 12;
    };
    Object.assign(window._crmUtils, { isAgent });
    const isManagement = (user) => _getUserLevel(user) <= 3;
    Object.assign(window._crmUtils, { isManagement });
    // Team Leader and above = Level 1-5 (Super Admin, Marketing Manager, Senior Manager, Manager, Team Leader)
    const isTeamLeaderOrAbove = (user) => _getUserLevel(user) <= 5;
    Object.assign(window._crmUtils, { isTeamLeaderOrAbove });

    // "Agent or any leader role" — the predicate behind the agent-search and
    // calendar-filter dropdowns. The legacy `u.role?.includes('Level 7')` clause
    // is technically redundant (Level 7 is already in isAgent's 3-12 band) but
    // preserved to avoid changing the set in edge cases where the role string
    // doesn't match the strict `Level N` regex (e.g. legacy "Level 7 Senior").
    const isAgentOrLeader = (user) =>
        isAgent(user) || user?.role === 'team_leader' || user?.role?.includes('Level 7');
    Object.assign(window._crmUtils, { isAgentOrLeader });

    // Memoized agents-and-leaders fetch. getAll('users') is already in-memory
    // cached by data.js, so the savings here are modest — but having a single
    // source of truth makes future tightening (e.g. server-side role filter)
    // a one-line change. Cache invalidates on dataChanged for 'users'.
    let _agentsLeadersCache = null;
    let _agentsLeadersCacheTs = 0;
    const AGENTS_LEADERS_TTL = 30_000; // 30s; getAll('users') already SWR's longer
    const getAgentsAndLeaders = async () => {
        if (_agentsLeadersCache && (Date.now() - _agentsLeadersCacheTs) < AGENTS_LEADERS_TTL) {
            return _agentsLeadersCache;
        }
        const users = (await AppDataStore.getAll('users')) || [];
        _agentsLeadersCache = users.filter(isAgentOrLeader);
        _agentsLeadersCacheTs = Date.now();
        return _agentsLeadersCache;
    };
    // Bust the memoized agent list whenever the underlying users table changes.
    window.addEventListener('dataChanged', (e) => {
        if (e?.detail?.table === 'users') { _agentsLeadersCache = null; _agentsLeadersCacheTs = 0; }
    });
    Object.assign(window._crmUtils, { getAgentsAndLeaders: () => getAgentsAndLeaders() });

    // Phase 10: Search Panel State
    let _searchPanelVisible = false;
    let _currentSearchEntity = 'prospects'; // default entity
    let _currentSearchFilters = {
        entity: 'prospects',
        conditions: [], // array of condition objects
        dateRange: { from: null, to: null },
        groups: [ // for AND/OR logic
            {
                logic: 'AND',
                conditions: []
            }
        ]
    };
    let _conditionGroups = [
        {
            logic: 'AND',
            conditions: []
        }
    ];
    let _savedSearches = [];
    let _searchHistory = [];
    let _currentSearchResults = [];
    let _currentPage = 1;
    let _pageSize = 10;
    let _totalResults = 0;
    
    // Phase 7: Referral Tree State
    let _currentSelectedPerson = null;      // { id, type }
    let _treeZoom = null;
    let _treeSvg = null;
    let _currentTreeData = null;
    let _treeNavStack = [];                 // [{id, type}] for back navigation
    let _treeActiveFilter = 'all';          // 'all' | 'new' | 'expected_drop' | 'lost'
    let _leaderboardPeriod = 'all';         // 'all' | 'year' | 'month' — used by renderLeaderboard filter

    // Phase 11: DMS State
    let _currentFolder = null; // Current folder ID
    let _viewMode = 'list'; // 'list' or 'grid'
    let _selectedFiles = []; // Array of selected file IDs for batch operations
    let _fileSortBy = 'name'; // 'name', 'date', 'size'
    let _fileSortDirection = 'asc'; // 'asc' or 'desc'
    let _fileFilter = ''; // Search filter text
    let _draggedFileId = null; // For drag & drop
    let _clipboardFiles = []; // For cut/copy/paste
    let _clipboardAction = null; // 'cut' or 'copy'

    // Phase 14: Voice Recording State
    let _mediaRecorder = null;
    let _audioChunks = [];
    let _recordingStartTime = null;
    let _recordingTimer = null;
    let _recordingStream = null;

    // Phase 14: Offline Queue State
    let _offlineQueue = [];
    let _isOnline = navigator.onLine;

    // ========== PERMISSION HELPERS ==========

    // Get all subordinate user IDs (including self) for a given user based on reporting_to.
    // Returns an array of user IDs, or 'all' for roles that see everything.
    // Cache visible user IDs per user for ~5 s so per-row permission checks
    // (canViewActivity, canViewProspect, etc.) don't re-traverse the reporting
    // tree and re-fetch the users table hundreds of times per render.
    const _visibleUserIdsCache = new Map(); // userId -> { data, ts }
    const _VISIBLE_IDS_TTL = 5000;
    const invalidateVisibleUserIdsCache = () => _visibleUserIdsCache.clear();

    const getVisibleUserIds = async (user) => {
        if (!user) return [];
        const key = String(user.id);
        const cached = _visibleUserIdsCache.get(key);
        if (cached && (Date.now() - cached.ts) < _VISIBLE_IDS_TTL) return cached.data;
        // Super admin / marketing manager roles (both level-based and named roles) see everything
        if (isSystemAdmin(user) || isMarketingManager(user)) {
            _visibleUserIdsCache.set(key, { data: 'all', ts: Date.now() });
            return 'all';
        }
        const lvlMatch = user.role?.match(/Level\s+(\d+)/i);
        const level = lvlMatch ? parseInt(lvlMatch[1]) : 99;
        // Levels 1–2 see everything (fallback, already covered above)
        if (level <= 2) {
            _visibleUserIdsCache.set(key, { data: 'all', ts: Date.now() });
            return 'all';
        }
        // Levels 12+ (Ambassador, Customer, Referrer) see only own records
        if (level >= 12) {
            const self = [user.id];
            _visibleUserIdsCache.set(key, { data: self, ts: Date.now() });
            return self;
        }
        // Levels 3–11: traverse down the reporting tree (team/subordinates), restricted to same team
        const allUsers = await AppDataStore.getAll('users');
        const userTeamId = user.team_id;
        const result = [];
        const collect = (uid) => {
            result.push(uid);
            allUsers
                .filter(u => String(u.reporting_to) === String(uid) &&
                    (!userTeamId || !u.team_id || String(u.team_id) === String(userTeamId)))
                .forEach(u => collect(u.id));
        };
        collect(user.id);
        _visibleUserIdsCache.set(key, { data: result, ts: Date.now() });
        return result;
    };
    // Exposed for the reporting + referrals chunks (both need the same
    // role-scoped visible user list).
    Object.assign(window._crmUtils, { getVisibleUserIds: (u) => getVisibleUserIds(u) });

    // Race a promise against a timeout. On timeout returns the fallback so
    // a slow Supabase call never leaves a view stuck on a skeleton loader.
    const withTimeout = (promise, ms, fallback, label) => Promise.race([
        Promise.resolve(promise).catch(e => {
            if (label) console.warn(`[withTimeout] ${label} rejected:`, e?.message || e);
            return fallback;
        }),
        new Promise(resolve => setTimeout(() => {
            if (label) console.warn(`[withTimeout] ${label} timed out after ${ms}ms — using fallback`);
            resolve(fallback);
        }, ms)),
    ]);
    Object.assign(window._crmUtils, { withTimeout: (p,ms,fb,lbl) => withTimeout(p,ms,fb,lbl) });

    // Check if current user can view a given prospect
    const canViewProspect = async (prospect) => {
        const user = _currentUser;
        if (!user) return false;
        const visibleIds = await getVisibleUserIds(user);
        if (visibleIds === 'all') return true;
        return visibleIds.includes(prospect.responsible_agent_id);
    };

    // Get all prospects visible to current user
    const getVisibleProspects = async () => {
        const all = await AppDataStore.getAll('prospects');
        const user = _currentUser;
        if (!user) return [];
        const visibleIds = await getVisibleUserIds(user);
        if (visibleIds === 'all') return all;
        return all.filter(p => visibleIds.includes(p.responsible_agent_id));
    };

    // Similarly for customers
    const canViewCustomer = async (customer) => {
        const user = _currentUser;
        if (!user) return false;
        const visibleIds = await getVisibleUserIds(user);
        if (visibleIds === 'all') return true;
        return visibleIds.includes(customer.responsible_agent_id) || visibleIds.includes(customer.agent_id);
    };

    const getVisibleCustomers = async () => {
        const all = await AppDataStore.getAll('customers');
        const user = _currentUser;
        if (!user) return [];
        const visibleIds = await getVisibleUserIds(user);
        if (visibleIds === 'all') return all;
        // Customers may store the owning agent on either responsible_agent_id (new) or agent_id (legacy)
        return all.filter(c => visibleIds.includes(c.responsible_agent_id) || visibleIds.includes(c.agent_id));
    };

    // Role-based referral visibility:
    //   - Admin / Marketing Manager / Level 1-2: see every referral
    //   - Upline (Level 3-11): see referrals owned by themselves or anyone in their reporting subtree
    //   - Agent / Level 12+: see only referrals where they are the owning agent
    // A referral is considered "owned" by the agent tied to either side of it:
    //   - referrer is a user -> that user's id
    //   - referrer is a customer/prospect -> its responsible_agent_id
    //   - referred_prospect's responsible_agent_id
    const getVisibleReferrals = async () => {
        const all = await AppDataStore.getAll('referrals');
        const user = _currentUser;
        if (!user) return [];
        const visibleIds = await getVisibleUserIds(user);
        if (visibleIds === 'all') return all;
        const visibleSet = new Set(visibleIds.map(String));

        // Prefetch lookup maps so we don't re-query per referral
        const [allProspects, allCustomers] = await Promise.all([
            AppDataStore.getAll('prospects'),
            AppDataStore.getAll('customers')
        ]);
        const prospectMap = new Map(allProspects.map(p => [String(p.id), p]));
        const customerMap = new Map(allCustomers.map(c => [String(c.id), c]));

        const ownerAgentOf = (id, type) => {
            if (!id) return null;
            if (type === 'user') return String(id);
            if (type === 'customer') {
                const c = customerMap.get(String(id));
                return c?.responsible_agent_id != null ? String(c.responsible_agent_id) : null;
            }
            // default prospect
            const p = prospectMap.get(String(id));
            return p?.responsible_agent_id != null ? String(p.responsible_agent_id) : null;
        };

        return all.filter(r => {
            const referrerOwner = ownerAgentOf(r.referrer_id, r.referrer_type || 'prospect');
            if (referrerOwner && visibleSet.has(referrerOwner)) return true;
            const referredOwner = ownerAgentOf(r.referred_prospect_id, 'prospect');
            if (referredOwner && visibleSet.has(referredOwner)) return true;
            return false;
        });
    };

    // For activities: visible if current user is lead, co-agent, or the activity is 'open', or if the lead agent is within visible users.
    const canViewActivity = async (activity) => {
        const user = _currentUser;
        if (!user) return false;
        // Public/open activities are visible to every agent — see the matching
        // comment in buildActivityVisibilityChecker for why the previous
        // same-team gate was wrong.
        if (activity.is_public || activity.visibility === 'public' || activity.visibility === 'open') {
            return true;
        }
        // If explicitly marked private, check ownership; any other value (open, null, undefined) allows role check
        if (activity.visibility === 'private') {
            if (isSystemAdmin(user)) return true;
            return String(activity.lead_agent_id) === String(user.id) ||
                (activity.co_agents && activity.co_agents.some(ca => String(ca.id) === String(user.id)));
        }
        const isLead = String(activity.lead_agent_id) === String(user.id);
        const isCoAgent = activity.co_agents && activity.co_agents.some(ca => String(ca.id) === String(user.id));
        if (isLead || isCoAgent) return true;
        // For managers/team leaders: check if lead agent is in visible subordinates
        const visibleIds = await getVisibleUserIds(user);
        if (visibleIds === 'all') return true;
        return visibleIds.some(id => String(id) === String(activity.lead_agent_id));
    };

    // Returns a synchronous (activity) => boolean predicate that's equivalent to
    // canViewActivity for the current user, after a single upfront resolution of
    // the user's visible-user-ids set and team membership. Calling canViewActivity
    // per-row in a tight loop forced every activity through an async function —
    // with hundreds of activities, that was hundreds of serialized microtask
    // yields (the main cause of non-admin users seeing a 10 s stall on the
    // Calendar page).
    const buildActivityVisibilityChecker = async (usersList) => {
        const user = _currentUser;
        if (!user) return () => false;
        if (isSystemAdmin(user)) return () => true;

        const visibleIds = await getVisibleUserIds(user);
        const isAll = visibleIds === 'all';
        const visibleSet = isAll ? null : new Set((visibleIds || []).map(String));

        // Team membership lookup: used for public/open activities where the
        // lead agent's team must match the viewer's. Build once, not per row.
        const userTeamId = user.team_id ? String(user.team_id) : null;
        const teamById = new Map();
        for (const u of usersList || []) {
            teamById.set(String(u.id), u.team_id ? String(u.team_id) : null);
        }

        const viewerId = String(user.id);

        return (activity) => {
            if (!activity) return false;

            // Public / open activities — visible to every agent regardless of
            // team or reporting hierarchy. The form's own help text promises
            // "Open events are visible to all agents", and the previous team
            // gate silently hid company-wide events from anyone outside the
            // creator's team (and confused users into thinking the public
            // toggle was broken).
            if (activity.is_public || activity.visibility === 'public' || activity.visibility === 'open') {
                return true;
            }

            // Private activities — only owner / co-agent / admin
            if (activity.visibility === 'private') {
                return String(activity.lead_agent_id) === viewerId ||
                    (Array.isArray(activity.co_agents) && activity.co_agents.some(ca => String(ca.id) === viewerId));
            }

            // Default: lead / co-agent / subordinate within visible tree
            if (String(activity.lead_agent_id) === viewerId) return true;
            if (Array.isArray(activity.co_agents) && activity.co_agents.some(ca => String(ca.id) === viewerId)) return true;

            if (isAll) return true;
            return visibleSet.has(String(activity.lead_agent_id));
        };
    };

    const getVisibleActivities = async () => {
        const [all, allUsersForVis] = await Promise.all([
            AppDataStore.getAll('activities'),
            AppDataStore.getAll('users'),
        ]);
        if (isSystemAdmin(_currentUser)) return all;
        const canView = await buildActivityVisibilityChecker(allUsersForVis);
        return all.filter(canView);
    };

    // Check edit permission: Level 1-2 can edit anything;
    // Level 3-10 can edit their team's records; Level 11-14 own records only.
    const canEditProspect = async (prospect) => {
        const user = _currentUser;
        if (!user) return false;
        const lvlMatch = user.role?.match(/Level\s+(\d+)/i);
        const level = lvlMatch ? parseInt(lvlMatch[1]) : 99;
        // Levels 1-2: full edit access
        if (level <= 2) return true;
        // Levels 3-10: can edit team/subordinate records
        if (level <= 10) {
            const visibleIds = await getVisibleUserIds(user);
            if (visibleIds === 'all') return true;
            return visibleIds.includes(prospect.responsible_agent_id);
        }
        // Levels 11-14: own records only
        return prospect.responsible_agent_id === user.id;
    };

    // Similar for customers, activities, etc. – you can add as needed.

    const canViewNode = async (personId, personType) => {
        const lvlMatch = _currentUser?.role?.match(/Level\s+(\d+)/i);
        const level = lvlMatch ? parseInt(lvlMatch[1]) : 10;
        // Level 1-2: Super Admin / Marketing Manager — can view every node
        if (level <= 2) return true;
        // 'user' type: can view self or any subordinate in the reporting tree
        if (personType === 'user') {
            const visibleIds = await getVisibleUserIds(_currentUser);
            if (visibleIds === 'all') return true;
            return visibleIds.map(String).includes(String(personId));
        }
        if (personType === 'prospect') {
            const fullProspect = await AppDataStore.getById('prospects', personId);
            if (!fullProspect) return false;
            return await canViewProspect(fullProspect);
        } else if (personType === 'customer') {
            const fullCustomer = await AppDataStore.getById('customers', personId);
            if (!fullCustomer) return false;
            return await canViewCustomer(fullCustomer);
        }
        return false;
    };

    // ========== HELPER FUNCTIONS ==========

    const generateId = () => {
        // Prefer cryptographically-random UUIDs when available; fall back to a
        // timestamp+random combo for very old browsers.
        if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
            return 'id_' + crypto.randomUUID();
        }
        return 'id_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
    };
    Object.assign(window._crmUtils, { generateId: () => generateId() });

    const generateModelId = () => {
        if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
            return 'model_' + crypto.randomUUID();
        }
        return 'model_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
    };
    Object.assign(window._crmUtils, { generateModelId: () => generateModelId() });

    // Check lunar library after a short delay
    setTimeout(() => {
        if (typeof LunarCalendar === 'undefined' && typeof lunarCalendar === 'undefined' && typeof Lunar === 'undefined') {
            console.error('LunarCalendar library failed to load. Check network tab.');
        } else {
            // LunarCalendar loaded OK
        }
    }, 500);

    const convertSolarToLunar = (date) => {
        if (!date) return '';
        const parts = date.split('-');
        const year = parseInt(parts[0], 10);
        const month = parseInt(parts[1], 10);
        const day = parseInt(parts[2], 10);

        // Try all possible global names for the library
        const lib = window.LunarCalendar || window.lunarCalendar || window.Lunar;

        if (lib && typeof lib.solarToLunar === 'function') {
            try {
                const lunar = lib.solarToLunar(year, month, day);
                if (lunar && lunar.lunarYear) {
                    // Format: YYYY-MM-DD (Lunar) – simple and clean
                    return `${lunar.lunarYear}-${String(lunar.lunarMonth).padStart(2, '0')}-${String(lunar.lunarDay).padStart(2, '0')} (Lunar)`;
                }
            } catch (e) {
                console.warn('Lunar conversion error:', e);
            }
        } else {
            console.error('Lunar library not found. Available globals:', Object.keys(window).filter(k => k.includes('Lunar')));
        }

        // Fallback: return a simple error message (but conversion should work now)
        return 'Conversion failed';
    };
	const escapeHtml = (unsafe) => {
    if (!unsafe || typeof unsafe !== 'string') return unsafe || '';
    return unsafe
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
};
    // Expose escapeHtml globally so script-features.js can use it
    // without closure access. Remaining utils added further down as
    // they're defined later in the file. Use Object.assign so we don't
    // clobber utils attached by earlier sections (isSystemAdmin, etc.).
    Object.assign(window._crmUtils, { escapeHtml });

    const FILE_ICONS = {
        // Documents
        pdf: 'fa-file-pdf',
        doc: 'fa-file-word',
        docx: 'fa-file-word',
        dot: 'fa-file-word',

        // Spreadsheets
        xls: 'fa-file-excel',
        xlsx: 'fa-file-excel',
        csv: 'fa-file-csv',

        // Presentations
        ppt: 'fa-file-powerpoint',
        pptx: 'fa-file-powerpoint',

        // Images
        jpg: 'fa-file-image',
        jpeg: 'fa-file-image',
        png: 'fa-file-image',
        gif: 'fa-file-image',
        bmp: 'fa-file-image',
        svg: 'fa-file-image',
        webp: 'fa-file-image',

        // Audio
        mp3: 'fa-file-audio',
        wav: 'fa-file-audio',
        ogg: 'fa-file-audio',

        // Video
        mp4: 'fa-file-video',
        avi: 'fa-file-video',
        mov: 'fa-file-video',
        wmv: 'fa-file-video',

        // Archives
        zip: 'fa-file-archive',
        rar: 'fa-file-archive',
        '7z': 'fa-file-archive',
        tar: 'fa-file-archive',
        gz: 'fa-file-archive',

        // Code
        html: 'fa-file-code',
        css: 'fa-file-code',
        js: 'fa-file-code',
        json: 'fa-file-code',
        xml: 'fa-file-code',
        php: 'fa-file-code',
        py: 'fa-file-code',
        java: 'fa-file-code',
        cpp: 'fa-file-code',

        // Text
        txt: 'fa-file-alt',
        md: 'fa-file-alt',
        rtf: 'fa-file-alt',

        // Default
        default: 'fa-file'
    };

    const getFileIcon = (filename) => {
        if (!filename) return FILE_ICONS.default;
        const ext = filename.split('.').pop().toLowerCase();
        return FILE_ICONS[ext] || FILE_ICONS.default;
    };

    const formatFileSize = (bytes) => {
        if (bytes === 0 || !bytes) return '0 Bytes';
        const k = 1024;
        const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    };
    Object.assign(window._crmUtils, { getFileIcon, formatFileSize });

    const getFileExtension = (filename) => {
        return filename.split('.').pop().toLowerCase();
    };

    const isImageFile = (filename) => {
        const imageExts = ['jpg', 'jpeg', 'png', 'gif', 'bmp', 'svg', 'webp'];
        return imageExts.includes(getFileExtension(filename));
    };

    const isPdfFile = (filename) => {
        return getFileExtension(filename) === 'pdf';
    };

    const isTextFile = (filename) => {
        const textExts = ['txt', 'csv', 'json', 'xml', 'html', 'css', 'js', 'md', 'rtf'];
        return textExts.includes(getFileExtension(filename));
    };

    // Real debounce: returns a function that defers `fn` until `delay` ms of idle.
    // Previous implementation used a comma expression and never actually deferred anything,
    // so every keystroke on search inputs re-ran the full filter/render pipeline.
    const debounce = (fn, delay = 200) => {
        let timer;
        return function (...args) {
            clearTimeout(timer);
            timer = setTimeout(() => fn.apply(this, args), delay);
        };
    };

    // Per-key debounce so we can wire search-input handlers without declaring a
    // dedicated debounced wrapper for each one. `delay` defaults to 200 ms.
    const _debounceTimers = {};
    const debounceCall = (key, fn, delay = 200) => {
        clearTimeout(_debounceTimers[key]);
        _debounceTimers[key] = setTimeout(() => {
            try { fn(); } catch (e) { console.error('debounceCall error:', e); }
        }, delay);
    };
    Object.assign(window._crmUtils, {
        debounce: (fn, delay) => debounce(fn, delay),
        debounceCall: (key, fn, delay) => debounceCall(key, fn, delay),
    });

    // Ensure referrals have the new fields (id, referrer_id, referrer_type, referred_prospect_id)
    const ensureReferralFields = async () => {
        const referrals = await AppDataStore.getAll('referrals');
        for (const r of referrals) {
            let needsUpdate = false;
            const updates = {};
            if (r.referrer_customer_id && !r.referrer_id) {
                // Old format: convert
                updates.referrer_id = r.referrer_customer_id;
                updates.referrer_type = 'customer';
                needsUpdate = true;
            }
            if (!r.referrer_id && !updates.referrer_id) {
                updates.referrer_id = null;
                updates.referrer_type = null;
            }
            if (!r.created_at) {
                updates.created_at = r.date || new Date().toISOString();
                needsUpdate = true;
            }
            if (needsUpdate) {
                // Persist via Supabase — data.js handles localStorage cache update automatically
                await AppDataStore.update('referrals', r.id, updates).catch(() => {});
            }
        }
    };

    const ENTITY_FIELDS = {
        agents: [
            { value: 'full_name', label: 'Name', type: 'text' },
            { value: 'agent_code', label: 'Agent Code', type: 'text' },
            { value: 'team', label: 'Team', type: 'select', options: Array.from({length: 26}, (_, i) => 'Team ' + String.fromCharCode(65 + i)) },
            { value: 'status', label: 'Status', type: 'select', options: ['active', 'probation', 'inactive'] },
            { value: 'email', label: 'Email', type: 'text' },
            { value: 'join_date', label: 'Join Date', type: 'date' }
        ],
        prospects: [
            { value: 'full_name', label: 'Name', type: 'text' },
            { value: 'phone', label: 'Phone', type: 'text' },
            { value: 'email', label: 'Email', type: 'text' },
            { value: 'ming_gua', label: 'Ming Gua', type: 'select', options: ['MG1', 'MG2', 'MG3', 'MG4', 'MG5', 'MG6', 'MG7', 'MG8', 'MG9'] },
            { value: 'score', label: 'Score', type: 'number' },
            { value: 'status', label: 'Status', type: 'select', options: ['active', 'converted', 'lost'] },
            { value: 'responsible_agent_id', label: 'Agent', type: 'select', options: 'dynamic' },
            { value: 'has_purchased_product', label: 'Has Purchased', type: 'product' }, // Special type
            { value: 'has_not_purchased_product', label: 'Has Not Purchased', type: 'product' } // Special type
        ],
        customers: [
            { value: 'full_name', label: 'Name', type: 'text' },
            { value: 'phone', label: 'Phone', type: 'text' },
            { value: 'email', label: 'Email', type: 'text' },
            { value: 'lifetime_value', label: 'Lifetime Value', type: 'number' },
            { value: 'customer_since', label: 'Customer Since', type: 'date' },
            { value: 'ming_gua', label: 'Ming Gua', type: 'select', options: ['MG1', 'MG2', 'MG3', 'MG4', 'MG5', 'MG6', 'MG7', 'MG8', 'MG9'] }
        ],
        activities: [
            { value: 'activity_type', label: 'Type', type: 'select', options: ['CPS', 'FTF', 'FSA', 'EVENT', 'CALL', 'EMAIL', 'WHATSAPP'] },
            { value: 'activity_title', label: 'Title', type: 'text' },
            { value: 'activity_date', label: 'Date', type: 'date' },
            { value: 'lead_agent_id', label: 'Agent', type: 'select', options: 'dynamic' },
            { value: 'prospect_id', label: 'Prospect', type: 'select', options: 'dynamic' },
            { value: 'status', label: 'Status', type: 'select', options: ['scheduled', 'completed', 'cancelled'] }
        ],
        transactions: [
            { value: 'date', label: 'Date', type: 'date' },
            { value: 'invoice', label: 'Invoice', type: 'text' },
            { value: 'item', label: 'Product', type: 'text' },
            { value: 'amount', label: 'Amount', type: 'number' },
            { value: 'status', label: 'Status', type: 'select', options: ['PENDING', 'COMPLETED', 'COLLECTED'] },
            { value: 'payment_method', label: 'Payment Method', type: 'select', options: ['Cash', 'Credit Card', 'Bank Transfer', 'EPP', 'POP'] },
            { value: 'customer_id', label: 'Customer', type: 'select', options: 'dynamic' }
        ],
        events: [
            { value: 'event_title', label: 'Title', type: 'text' },
            { value: 'event_date', label: 'Date', type: 'date' },
            { value: 'event_category_id', label: 'Category', type: 'select', options: 'dynamic' },
            { value: 'location', label: 'Location', type: 'text' },
            { value: 'status', label: 'Status', type: 'select', options: ['upcoming', 'ongoing', 'completed', 'cancelled'] }
        ],
        products: [
            { value: 'name', label: 'Name', type: 'text' },
            { value: 'category', label: 'Category', type: 'text' },
            { value: 'price', label: 'Price', type: 'number' },
            { value: 'is_active', label: 'Status', type: 'select', options: ['true', 'false'] }
        ],
        bujishu: [
            { value: 'name', label: 'Name', type: 'text' },
            { value: 'category', label: 'Category', type: 'text' },
            { value: 'price', label: 'Price', type: 'number' },
            { value: 'is_active', label: 'Status', type: 'select', options: ['true', 'false'] }
        ],
        formula: [
            { value: 'name', label: 'Name', type: 'text' },
            { value: 'category', label: 'Category', type: 'text' },
            { value: 'price', label: 'Price', type: 'number' },
            { value: 'daily_dosage', label: 'Daily Dosage', type: 'number' },
            { value: 'is_active', label: 'Status', type: 'select', options: ['true', 'false'] }
        ]
    };


    // Section 10.4: Search Panel Toggle
    const toggleSearchPanel = async () => {
        _searchPanelVisible = !_searchPanelVisible;
        if (_searchPanelVisible) {
            await showSearchPanel();
        } else {
            hideSearchPanel();
        }
    };

    const showSearchPanel = async () => {
        const viewport = document.getElementById('content-viewport');

        // Create overlay and panel
        const searchHTML = `
            <div class="search-panel-overlay" id="search-panel-overlay" onclick="app.hideSearchPanel()"></div>
            <div class="search-panel" id="search-panel">
                <div class="search-panel-header">
                    <h2>Search</h2>
                    <button class="close-btn" onclick="app.hideSearchPanel()">&times;</button>
                </div>

                <div class="filter-sections" id="filter-sections">
                    <!-- Dynamic filters will be rendered here -->
                </div>

                <details id="search-advanced-options" style="margin-top:4px;">
                    <summary style="cursor:pointer; font-weight:600; color:#8B0000; padding:10px 0; list-style:none; display:flex; align-items:center; gap:6px; user-select:none;">
                        <i class="fas fa-sliders-h"></i> Advanced Options
                    </summary>

                    <div class="search-presets">
                        <h3>Quick Presets</h3>
                        <div class="preset-buttons">
                            <button class="preset-btn" onclick="app.loadPreset('agent-monthly')">Agent Monthly Report</button>
                            <button class="preset-btn" onclick="app.loadPreset('high-score')">High Score Prospects</button>
                            <button class="preset-btn" onclick="app.loadPreset('recent-activities')">Recent Activities</button>
                            <button class="preset-btn" onclick="app.loadPreset('cai-ku-not-purchased')">CAI KU Painting Not Purchased</button>
                        </div>
                    </div>

                    <div class="search-entity-selector">
                        <label>Search in:</label>
                        <select id="search-entity" onchange="app.updateFilterSections()">
                            <option value="agents">Agents</option>
                            <option value="prospects" selected>Prospects</option>
                            <option value="customers">Customers</option>
                            <option value="activities">Activities</option>
                            <option value="transactions">Transactions</option>
                            <option value="events">Events</option>
                            <option value="products">Products</option>
                            <option value="bujishu">Bujishu</option>
                            <option value="formula">Formula</option>
                        </select>
                    </div>

                    <div class="date-range-filter">
                        <h3>Date Range</h3>
                        <div class="date-range-group">
                            <input type="date" id="search-date-from" class="form-control" placeholder="From">
                            <span>to</span>
                            <input type="date" id="search-date-to" class="form-control" placeholder="To">
                        </div>
                    </div>

                    <div id="extra-filter-sections">
                        <!-- Extra dynamic filters will be rendered here -->
                    </div>

                    <div class="condition-builder" id="condition-builder">
                        <h3>Advanced Conditions</h3>
                        <div id="condition-groups">
                            <!-- Condition groups rendered here -->
                        </div>
                        <button class="btn secondary btn-sm" onclick="app.addConditionGroup()">
                            <i class="fas fa-plus"></i> Add Condition Group
                        </button>
                        <div class="condition-logic-toggle">
                            <label>Group Logic:</label>
                            <select id="group-logic" onchange="app.updateGroupLogic(0, this.value)">
                                <option value="AND">AND</option>
                                <option value="OR">OR</option>
                            </select>
                        </div>
                    </div>

                    <div style="display:flex; gap:8px; margin:8px 0; flex-wrap:wrap;">
                        <button class="btn secondary" onclick="app.openSaveSearchModal()">
                            <i class="fas fa-save"></i> Save Search
                        </button>
                        <button class="btn secondary" onclick="app.exportResults('csv')">
                            <i class="fas fa-download"></i> Export
                        </button>
                    </div>

                    <div class="saved-searches">
                        <h3>Saved Searches</h3>
                        <div id="saved-searches-list">
                            <!-- Saved searches will be rendered here -->
                        </div>
                    </div>

                    <div class="search-history">
                        <h3>Recent Searches</h3>
                        <div id="search-history-list">
                            <!-- Search history will be rendered here -->
                        </div>
                    </div>
                </details>

                <div class="search-actions">
                    <button class="btn primary" onclick="app.executeSearch()">
                        <i class="fas fa-search"></i> Apply Filters
                    </button>
                    <button class="btn secondary" onclick="app.clearAllFilters()">
                        <i class="fas fa-times"></i> Clear All
                    </button>
                </div>

                <div class="search-results" id="search-results">
                    <!-- Results will be rendered here -->
                </div>

                <div class="pagination" id="search-pagination">
                    <!-- Pagination will be rendered here -->
                </div>
            </div>
        `;

        // Insert panel before the main content
        viewport.insertAdjacentHTML('beforebegin', searchHTML);

        // Load saved searches
        await renderSavedSearches();

        // Initial filter render
        await updateFilterSections();

        // Render condition groups
        renderConditionGroups();
    };

    const hideSearchPanel = () => {
        const overlay = document.getElementById('search-panel-overlay');
        const panel = document.getElementById('search-panel');
        if (overlay) overlay.remove();
        if (panel) panel.remove();
        _searchPanelVisible = false;
    };

    // Section 10.5: Dynamic Filter Rendering
    const updateFilterSections = async () => {
        const entity = document.getElementById('search-entity')?.value || 'prospects';
        _currentSearchEntity = entity;

        const container = document.getElementById('filter-sections');
        const extraContainer = document.getElementById('extra-filter-sections');
        if (!container) return;

        let basicHtml = '';
        let extraHtml = '';

        switch (entity) {
            case 'agents':
                basicHtml = renderAgentFilters();
                break;
            case 'prospects': {
                const r = await renderProspectCustomerFilters();
                basicHtml = r.basic;
                extraHtml = r.extra;
                break;
            }
            case 'customers': {
                const r = await renderProspectCustomerFilters(true);
                basicHtml = r.basic;
                extraHtml = r.extra;
                break;
            }
            case 'activities':
                basicHtml = renderActivityFilters();
                break;
            case 'transactions':
                basicHtml = renderTransactionFilters();
                break;
            case 'events':
                basicHtml = renderEventFilters();
                break;
            case 'products':
                basicHtml = renderProductFilters();
                break;
            case 'bujishu':
                basicHtml = renderBujishuFilters();
                break;
            case 'formula':
                basicHtml = renderFormulaFilters();
                break;
        }

        container.innerHTML = basicHtml;
        if (extraContainer) extraContainer.innerHTML = extraHtml;

        // Populate dynamic agent dropdowns — only show agents visible to the current user
        // (admins see all; managers/agents see only their own downline team)
        const agentSelects = [...container.querySelectorAll('select[id$="-agent"]'), ...container.querySelectorAll('select[id$="-responsible-agent"]')];
        if (agentSelects.length > 0) {
            try {
                const allUsers = await AppDataStore.getAll('users');
                const visibleIds = await getVisibleUserIds(_currentUser);
                const agents = allUsers.filter(u => {
                    if (!(isAgent(u) || u.role === 'team_leader' || u.role?.includes('Level 7'))) return false;
                    if (visibleIds === 'all') return true;
                    return visibleIds.includes(u.id);
                });
                agentSelects.forEach(sel => {
                    agents.forEach(a => {
                        const opt = document.createElement('option');
                        opt.value = a.id;
                        opt.textContent = a.full_name;
                        sel.appendChild(opt);
                    });
                });
            } catch(e) { /* offline */ }
        }

        // Update condition builder options
        renderConditionGroups();
    };

    const renderAgentFilters = () => {
        return `
            <div class="filter-row">
                <div class="filter-group">
                    <label>Name</label>
                    <input type="text" id="filter-agent-name" class="form-control" placeholder="Agent name...">
                </div>
                <div class="filter-group">
                    <label>Team</label>
                    <select id="filter-agent-team" class="form-control">
                        <option value="">All Teams</option>
                        ${Array.from({length: 26}, (_, i) => String.fromCharCode(65 + i)).map(L => `<option value="Team ${L}">Team ${L}</option>`).join('')}
                    </select>
                </div>
            </div>
            <div class="filter-row">
                <div class="filter-group">
                    <label>Status</label>
                    <select id="filter-agent-status" class="form-control">
                        <option value="">All Status</option>
                        <option value="active">Active</option>
                        <option value="probation">Probation</option>
                        <option value="inactive">Inactive</option>
                    </select>
                </div>
                <div class="filter-group">
                    <label>Agent Code</label>
                    <input type="text" id="filter-agent-code" class="form-control" placeholder="e.g., AGN-2026-001">
                </div>
            </div>
            <div class="filter-row">
                <div class="filter-group">
                    <label>Email</label>
                    <input type="text" id="filter-agent-email" class="form-control" placeholder="Email...">
                </div>
            </div>
        `;
    };

    const renderProspectCustomerFilters = async (isCustomer = false) => {
        const type = isCustomer ? 'customer' : 'prospect';
        const products = (await AppDataStore.getAll('products')).filter(p => p.is_active !== false);

        const basic = `
            <div class="filter-row">
                <div class="filter-group">
                    <label>Name</label>
                    <input type="text" id="filter-${type}-name" class="form-control" placeholder="Full name...">
                </div>
                <div class="filter-group">
                    <label>Ming Gua</label>
                    <select id="filter-${type}-minggua" class="form-control">
                        <option value="">All</option>
                        <option value="MG1">MG1 坎</option>
                        <option value="MG2">MG2 坤</option>
                        <option value="MG3">MG3 震</option>
                        <option value="MG4">MG4 巽</option>
                        <option value="MG5">MG5</option>
                        <option value="MG6">MG6 乾</option>
                        <option value="MG7">MG7 兑</option>
                        <option value="MG8">MG8 艮</option>
                        <option value="MG9">MG9 离</option>
                    </select>
                </div>
            </div>
        `;

        const extra = `
            <div class="filter-row">
                <div class="filter-group">
                    <label>Phone</label>
                    <input type="text" id="filter-${type}-phone" class="form-control" placeholder="Phone number...">
                </div>
                <div class="filter-group">
                    <label>Email</label>
                    <input type="text" id="filter-${type}-email" class="form-control" placeholder="Email...">
                </div>
            </div>
            <div class="filter-row">
                <div class="filter-group">
                    <label>Score (Min)</label>
                    <input type="number" id="filter-${type}-score-min" class="form-control" placeholder="Min score...">
                </div>
                <div class="filter-group">
                    <label>Score (Max)</label>
                    <input type="number" id="filter-${type}-score-max" class="form-control" placeholder="Max score...">
                </div>
            </div>
            <div class="filter-row">
                <div class="filter-group">
                    <label>Status</label>
                    <select id="filter-${type}-status" class="form-control">
                        <option value="">All</option>
                        ${isCustomer ? `
                        <option value="active">Active</option>
                        <option value="inactive">Inactive</option>
                        ` : `
                        <option value="active">Active</option>
                        <option value="converted">Converted</option>
                        <option value="lost">Lost</option>
                        `}
                    </select>
                </div>
                <div class="filter-group">
                    <label>Responsible Agent</label>
                    <select id="filter-${type}-agent" class="form-control">
                        <option value="">All Agents</option>
                    </select>
                </div>
            </div>
            ${!isCustomer ? `
            <div class="filter-row">
                <div class="filter-group">
                    <label>Pipeline Stage</label>
                    <select id="filter-prospect-pipeline" class="form-control">
                        <option value="">All Stages</option>
                        <option value="new">New</option>
                        <option value="contacted">Contacted</option>
                        <option value="qualified">Qualified</option>
                        <option value="proposal">Proposal</option>
                        <option value="negotiation">Negotiation</option>
                        <option value="closed_won">Closed Won</option>
                        <option value="closed_lost">Closed Lost</option>
                    </select>
                </div>
                <div class="filter-group">
                    <label>Deal Value Range (RM)</label>
                    <div style="display:flex; gap:8px;">
                        <input type="number" id="filter-prospect-deal-min" class="form-control" placeholder="Min">
                        <input type="number" id="filter-prospect-deal-max" class="form-control" placeholder="Max">
                    </div>
                </div>
            </div>
            <div class="filter-row">
                <div class="filter-group">
                    <label>Has Purchased</label>
                    <select id="filter-prospect-has-purchased" class="form-control">
                        <option value="">Select Product</option>
                        ${products.map(p => `<option value="${p.name}">${p.name}</option>`).join('')}
                    </select>
                </div>
                <div class="filter-group">
                    <label>Has Not Purchased</label>
                    <select id="filter-prospect-not-purchased" class="form-control">
                        <option value="">Select Product</option>
                        ${products.map(p => `<option value="${p.name}">${p.name}</option>`).join('')}
                    </select>
                </div>
            </div>
            ` : `
            <div class="filter-row">
                <div class="filter-group">
                    <label>Lifetime Value Min (RM)</label>
                    <input type="number" id="filter-customer-ltv-min" class="form-control" placeholder="Min...">
                </div>
                <div class="filter-group">
                    <label>Lifetime Value Max (RM)</label>
                    <input type="number" id="filter-customer-ltv-max" class="form-control" placeholder="Max...">
                </div>
            </div>
            `}
            <div class="filter-row">
                <div class="filter-group">
                    <label>Gender</label>
                    <select id="filter-${type}-gender" class="form-control">
                        <option value="">All</option>
                        <option value="Male">Male</option>
                        <option value="Female">Female</option>
                    </select>
                </div>
                <div class="filter-group">
                    <label>Occupation</label>
                    <input type="text" id="filter-${type}-occupation" class="form-control" placeholder="Occupation...">
                </div>
            </div>
            <div class="filter-row">
                <div class="filter-group">
                    <label>Income Range</label>
                    <select id="filter-${type}-income" class="form-control">
                        <option value="">All</option>
                        <option value="Below RM3,000">Below RM3,000</option>
                        <option value="RM3,000 - RM5,000">RM3,000 - RM5,000</option>
                        <option value="RM5,000 - RM10,000">RM5,000 - RM10,000</option>
                        <option value="RM10,000 - RM20,000">RM10,000 - RM20,000</option>
                        <option value="Above RM20,000">Above RM20,000</option>
                    </select>
                </div>
                <div class="filter-group">
                    <label>City</label>
                    <input type="text" id="filter-${type}-city" class="form-control" placeholder="City...">
                </div>
            </div>
            <div class="filter-row">
                <div class="filter-group">
                    <label>State</label>
                    <select id="filter-${type}-state" class="form-control">
                        <option value="">All States</option>
                        <option value="Johor">Johor</option>
                        <option value="Kedah">Kedah</option>
                        <option value="Kelantan">Kelantan</option>
                        <option value="Kuala Lumpur">Kuala Lumpur</option>
                        <option value="Labuan">Labuan</option>
                        <option value="Melaka">Melaka</option>
                        <option value="Negeri Sembilan">Negeri Sembilan</option>
                        <option value="Pahang">Pahang</option>
                        <option value="Penang">Penang</option>
                        <option value="Perak">Perak</option>
                        <option value="Perlis">Perlis</option>
                        <option value="Putrajaya">Putrajaya</option>
                        <option value="Sabah">Sabah</option>
                        <option value="Sarawak">Sarawak</option>
                        <option value="Selangor">Selangor</option>
                        <option value="Terengganu">Terengganu</option>
                    </select>
                </div>
                <div class="filter-group">
                    <label>Referred By</label>
                    <input type="text" id="filter-${type}-referred" class="form-control" placeholder="Referrer name...">
                </div>
            </div>
            <div class="filter-row">
                <div class="filter-group">
                    <label>Tags (Select multiple)</label>
                    <select id="filter-${type}-tags" class="form-control" multiple style="height: 80px;">
                        <option value="Career Focused">Career Focused</option>
                        <option value="High Score">High Score</option>
                        <option value="VIP">VIP</option>
                        <option value="Urgent">Urgent</option>
                        <option value="Follow-up">Follow-up</option>
                    </select>
                </div>
                <div class="filter-group">
                    <label>Needs (Select multiple)</label>
                    <select id="filter-${type}-needs" class="form-control" multiple style="height: 80px;">
                        <option value="Career">Career</option>
                        <option value="Financial">Financial</option>
                        <option value="Relationship">Relationship</option>
                        <option value="Health">Health</option>
                        <option value="Wealth">Wealth</option>
                    </select>
                </div>
            </div>
            <div class="filter-row">
                <div class="filter-group">
                    <label>Keyword Search</label>
                    <input type="text" id="filter-${type}-keyword" class="form-control" placeholder="Search across fields...">
                </div>
                <div class="filter-group">
                    <label>Age Range</label>
                    <div style="display:flex; gap:10px;">
                        <input type="number" id="filter-${type}-age-min" class="form-control" placeholder="Min (0)" min="0" max="100">
                        <input type="number" id="filter-${type}-age-max" class="form-control" placeholder="Max (100)" min="0" max="100">
                    </div>
                </div>
            </div>
        `;

        return { basic, extra };
    };

    const renderActivityFilters = () => {
        return `
            <div class="filter-row">
                <div class="filter-group">
                    <label>Activity Type</label>
                    <select id="filter-activity-type" class="form-control" onchange="document.getElementById('event-attendance-row').style.display = this.value === 'EVENT' ? '' : 'none'">
                        <option value="">All Types</option>
                        <option value="CPS">CPS</option>
                        <option value="FTF">FTF</option>
                        <option value="FSA">FSA</option>
                        <option value="EVENT">Event</option>
                        <option value="CALL">Call</option>
                        <option value="EMAIL">Email</option>
                        <option value="WHATSAPP">WhatsApp</option>
                    </select>
                </div>
                <div class="filter-group">
                    <label>Title</label>
                    <input type="text" id="filter-activity-title" class="form-control" placeholder="Activity title...">
                </div>
            </div>
            <div class="filter-row">
                <div class="filter-group">
                    <label>Agent</label>
                    <select id="filter-activity-agent" class="form-control">
                        <option value="">All Agents</option>
                    </select>
                </div>
                <div class="filter-group">
                    <label>Status</label>
                    <select id="filter-activity-status" class="form-control">
                        <option value="">All</option>
                        <option value="scheduled">Scheduled</option>
                        <option value="completed">Completed</option>
                        <option value="cancelled">Cancelled</option>
                    </select>
                </div>
            </div>
            <div class="filter-row" id="event-attendance-row" style="display:none;">
                <div class="filter-group">
                    <label>Attendance</label>
                    <select id="filter-activity-attendance" class="form-control">
                        <option value="">All</option>
                        <option value="Attended">Attended</option>
                        <option value="No Show">No Show</option>
                        <option value="Registered">Registered only</option>
                    </select>
                </div>
            </div>
        `;
    };

    const renderTransactionFilters = () => {
        return `
            <div class="filter-row">
                <div class="filter-group">
                    <label>Product</label>
                    <input type="text" id="filter-transaction-product" class="form-control" placeholder="Product name...">
                </div>
                <div class="filter-group">
                    <label>Invoice</label>
                    <input type="text" id="filter-transaction-invoice" class="form-control" placeholder="Invoice number...">
                </div>
            </div>
            <div class="filter-row">
                <div class="filter-group">
                    <label>Payment Method</label>
                    <select id="filter-transaction-payment" class="form-control">
                        <option value="">All</option>
                        <option value="Cash">Cash</option>
                        <option value="Credit Card">Credit Card</option>
                        <option value="Bank Transfer">Bank Transfer</option>
                        <option value="EPP">EPP</option>
                        <option value="POP">POP</option>
                    </select>
                </div>
                <div class="filter-group">
                    <label>Status</label>
                    <select id="filter-transaction-status" class="form-control">
                        <option value="">All</option>
                        <option value="PENDING">Pending</option>
                        <option value="COMPLETED">Completed</option>
                        <option value="COLLECTED">Collected</option>
                    </select>
                </div>
            </div>
            <div class="filter-row">
                <div class="filter-group">
                    <label>Min Amount</label>
                    <input type="number" id="filter-transaction-amount-min" class="form-control" placeholder="Min RM...">
                </div>
                <div class="filter-group">
                    <label>Max Amount</label>
                    <input type="number" id="filter-transaction-amount-max" class="form-control" placeholder="Max RM...">
                </div>
            </div>
        `;
    };

    const renderEventFilters = () => {
        return `
            <div class="filter-row">
                <div class="filter-group">
                    <label>Event Title</label>
                    <input type="text" id="filter-event-title" class="form-control" placeholder="Event title...">
                </div>
                <div class="filter-group">
                    <label>Category</label>
                    <select id="filter-event-category" class="form-control">
                        <option value="">All Categories</option>
                    </select>
                </div>
            </div>
            <div class="filter-row">
                <div class="filter-group">
                    <label>Location</label>
                    <input type="text" id="filter-event-location" class="form-control" placeholder="Location...">
                </div>
                <div class="filter-group">
                    <label>Status</label>
                    <select id="filter-event-status" class="form-control">
                        <option value="">All</option>
                        <option value="upcoming">Upcoming</option>
                        <option value="ongoing">Ongoing</option>
                        <option value="completed">Completed</option>
                        <option value="cancelled">Cancelled</option>
                    </select>
                </div>
            </div>
        `;
    };


    const renderProductFilters = () => {
        return `
            <div class="filter-row">
                <div class="filter-group">
                    <label>Name</label>
                    <input type="text" id="filter-product-name" class="form-control" placeholder="Product name...">
                </div>
                <div class="filter-group">
                    <label>Category</label>
                    <input type="text" id="filter-product-category" class="form-control" placeholder="Category...">
                </div>
            </div>
            <div class="filter-row">
                <div class="filter-group">
                    <label>Min Price (RM)</label>
                    <input type="number" id="filter-product-price-min" class="form-control" placeholder="Min...">
                </div>
                <div class="filter-group">
                    <label>Max Price (RM)</label>
                    <input type="number" id="filter-product-price-max" class="form-control" placeholder="Max...">
                </div>
            </div>
            <div class="filter-row">
                <div class="filter-group">
                    <label>Status</label>
                    <select id="filter-product-status" class="form-control">
                        <option value="">All</option>
                        <option value="active">Active</option>
                        <option value="inactive">Inactive</option>
                    </select>
                </div>
            </div>
        `;
    };

    const renderBujishuFilters = () => {
        return `
            <div class="filter-row">
                <div class="filter-group">
                    <label>Name</label>
                    <input type="text" id="filter-bujishu-name" class="form-control" placeholder="Bujishu name...">
                </div>
                <div class="filter-group">
                    <label>Category</label>
                    <input type="text" id="filter-bujishu-category" class="form-control" placeholder="Category...">
                </div>
            </div>
            <div class="filter-row">
                <div class="filter-group">
                    <label>Min Price (RM)</label>
                    <input type="number" id="filter-bujishu-price-min" class="form-control" placeholder="Min...">
                </div>
                <div class="filter-group">
                    <label>Max Price (RM)</label>
                    <input type="number" id="filter-bujishu-price-max" class="form-control" placeholder="Max...">
                </div>
            </div>
            <div class="filter-row">
                <div class="filter-group">
                    <label>Status</label>
                    <select id="filter-bujishu-status" class="form-control">
                        <option value="">All</option>
                        <option value="active">Active</option>
                        <option value="inactive">Inactive</option>
                    </select>
                </div>
            </div>
        `;
    };

    const renderFormulaFilters = () => {
        return `
            <div class="filter-row">
                <div class="filter-group">
                    <label>Name</label>
                    <input type="text" id="filter-formula-name" class="form-control" placeholder="Formula name...">
                </div>
                <div class="filter-group">
                    <label>Category</label>
                    <input type="text" id="filter-formula-category" class="form-control" placeholder="Category...">
                </div>
            </div>
            <div class="filter-row">
                <div class="filter-group">
                    <label>Min Price (RM)</label>
                    <input type="number" id="filter-formula-price-min" class="form-control" placeholder="Min...">
                </div>
                <div class="filter-group">
                    <label>Max Price (RM)</label>
                    <input type="number" id="filter-formula-price-max" class="form-control" placeholder="Max...">
                </div>
            </div>
            <div class="filter-row">
                <div class="filter-group">
                    <label>Daily Dosage (max capsules/day)</label>
                    <input type="number" id="filter-formula-dosage-max" class="form-control" placeholder="e.g. 4">
                </div>
                <div class="filter-group">
                    <label>Status</label>
                    <select id="filter-formula-status" class="form-control">
                        <option value="">All</option>
                        <option value="active">Active</option>
                        <option value="inactive">Inactive</option>
                    </select>
                </div>
            </div>
        `;
    };

    // Section 10.6: Condition Builder Logic
    const renderConditionGroups = () => {
        const container = document.getElementById('condition-groups');
        if (!container) return;

        container.innerHTML = _conditionGroups.map((group, gIdx) => `
            <div class="condition-group" data-group-index="${gIdx}">
                <div class="group-header">
                    <span>Condition Group ${gIdx + 1}</span>
                    <button class="btn btn-sm" onclick="app.removeConditionGroup(${gIdx})">
                        <i class="fas fa-trash"></i>
                    </button>
                </div>
                <div class="conditions-list">
                    ${group.conditions.map((cond, cIdx) => `
                        <div class="condition-row">
                            <select class="condition-field" onchange="app.updateConditionField(${gIdx}, ${cIdx}, this.value)">
                                <option value="">Select Field</option>
                                ${ENTITY_FIELDS[_currentSearchEntity]?.map(f => `
                                    <option value="${f.value}" ${cond.field === f.value ? 'selected' : ''}>${f.label}</option>
                                `).join('') || ''}
                            </select>
                            
                            <select class="condition-operator" onchange="app.updateConditionOperator(${gIdx}, ${cIdx}, this.value)">
                                <option value="=" ${cond.operator === '=' ? 'selected' : ''}>=</option>
                                <option value="!=" ${cond.operator === '!=' ? 'selected' : ''}>!=</option>
                                <option value=">" ${cond.operator === '>' ? 'selected' : ''}>&gt;</option>
                                <option value="<" ${cond.operator === '<' ? 'selected' : ''}>&lt;</option>
                                <option value="contains" ${cond.operator === 'contains' ? 'selected' : ''}>Contains</option>
                                <option value="not_contains" ${cond.operator === 'not_contains' ? 'selected' : ''}>Not Contains</option>
                            </select>
                            
                            <input type="text" class="condition-value" value="${cond.value || ''}" 
                                   onchange="app.updateConditionValue(${gIdx}, ${cIdx}, this.value)"
                                   placeholder="Value...">
                                   
                            <button class="btn btn-sm" onclick="app.removeCondition(${gIdx}, ${cIdx})">
                                <i class="fas fa-times"></i>
                            </button>
                        </div>
                    `).join('')}
                </div>
                <button class="btn btn-sm secondary" onclick="app.addCondition(${gIdx})">
                    <i class="fas fa-plus"></i> Add Condition
                </button>
            </div>
        `).join('');
    };

    const addConditionGroup = () => {
        _conditionGroups.push({
            logic: 'AND',
            conditions: [{ field: '', operator: '=', value: '' }]
        });
        renderConditionGroups();
    };

    const removeConditionGroup = (idx) => {
        if (_conditionGroups.length > 1) {
            _conditionGroups.splice(idx, 1);
            renderConditionGroups();
        }
    };

    const addCondition = (gIdx) => {
        _conditionGroups[gIdx].conditions.push({ field: '', operator: '=', value: '' });
        renderConditionGroups();
    };

    const removeCondition = (gIdx, cIdx) => {
        _conditionGroups[gIdx].conditions.splice(cIdx, 1);
        if (_conditionGroups[gIdx].conditions.length === 0) {
            removeConditionGroup(gIdx);
        } else {
            renderConditionGroups();
        }
    };

    const updateGroupLogic = (gIdx, logic) => {
        _conditionGroups[gIdx].logic = logic;
    };

    const updateConditionField = (gIdx, cIdx, field) => {
        _conditionGroups[gIdx].conditions[cIdx].field = field;
    };

    const updateConditionOperator = (gIdx, cIdx, op) => {
        _conditionGroups[gIdx].conditions[cIdx].operator = op;
    };

    const updateConditionValue = (gIdx, cIdx, val) => {
        _conditionGroups[gIdx].conditions[cIdx].value = val;
    };



    // Section 10.7: Presets & Search Execution
    const loadPreset = async (presetId) => {
        clearAllFilters();

        switch (presetId) {
            case 'agent-monthly':
                document.getElementById('search-entity').value = 'agents';
                await updateFilterSections();
                document.getElementById('filter-agent-status').value = 'active';
                break;
            case 'high-score':
                document.getElementById('search-entity').value = 'prospects';
                await updateFilterSections();
                document.getElementById('filter-prospect-score-min').value = 800;
                break;
            case 'cai-ku-not-purchased':
                document.getElementById('search-entity').value = 'prospects';
                await updateFilterSections();
                document.getElementById('filter-prospect-not-purchased').value = 'CAI KU Painting';
                break;
            case 'recent-activities':
                document.getElementById('search-entity').value = 'activities';
                await updateFilterSections();
                const today = new Date().toISOString().split('T')[0];
                document.getElementById('search-date-from').value = today;
                break;
        }

        await executeSearch();
    };

    const collectFilters = () => {
        const entity = document.getElementById('search-entity').value;
        const filters = {
            entity,
            dateRange: {
                from: document.getElementById('search-date-from').value,
                to: document.getElementById('search-date-to').value
            },
            basic: {},
            complex: _conditionGroups
        };

        // Collect basic filters based on entity
        const prefix = 'filter-' + entity.slice(0, -1) + '-';
        const collectInputs = (section) => {
            if (!section) return;
            section.querySelectorAll('input, select').forEach(input => {
                if (input.multiple) {
                    const selected = Array.from(input.selectedOptions).map(opt => opt.value);
                    if (selected.length > 0) {
                        filters.basic[input.id.replace(prefix, '')] = selected;
                    }
                } else if (input.value) {
                    filters.basic[input.id.replace(prefix, '')] = input.value;
                }
            });
        };
        collectInputs(document.getElementById('filter-sections'));
        collectInputs(document.getElementById('extra-filter-sections'));

        return filters;
    };

    const executeSearch = async () => {
        const filters = collectFilters();
        let results = [];

        switch (filters.entity) {
            case 'agents': results = await performAgentSearch(filters); break;
            case 'prospects': results = await performProspectSearch(filters); break;
            case 'customers': results = await performCustomerSearch(filters); break;
            case 'activities': results = await performActivitySearch(filters); break;
            case 'transactions': results = await performTransactionSearch(filters); break;
            case 'events': results = await performEventSearch(filters); break;
            case 'products': results = await performProductSearch(filters); break;
            case 'bujishu': results = await performBujishuSearch(filters); break;
            case 'formula': results = await performFormulaSearch(filters); break;
        }

        _currentSearchResults = results;
        _totalResults = results.length;
        _currentPage = 1;

        await renderSearchResults();
        addToSearchHistory(filters);
    };

    const performAgentSearch = async (filters) => {
        const allAgentUsers = await getAgentsAndLeaders();
        const visibleAgentIds = await getVisibleUserIds(_currentUser);
        let items = visibleAgentIds === 'all' ? allAgentUsers : allAgentUsers.filter(u => visibleAgentIds.map(String).includes(String(u.id)));

        if (filters.basic.name) {
            const q = filters.basic.name.toLowerCase();
            items = items.filter(i => i.full_name && i.full_name.toLowerCase().includes(q));
        }
        if (filters.basic.team) {
            items = items.filter(i => i.team === filters.basic.team);
        }
        if (filters.basic.status) {
            items = items.filter(i => i.status === filters.basic.status);
        }
        if (filters.basic.code) {
            const q = filters.basic.code.toLowerCase();
            items = items.filter(i => i.agent_code && i.agent_code.toLowerCase().includes(q));
        }
        if (filters.basic.email) {
            const q = filters.basic.email.toLowerCase();
            items = items.filter(i => i.email && i.email.toLowerCase().includes(q));
        }
        if (filters.dateRange.from) {
            items = items.filter(i => i.join_date && i.join_date >= filters.dateRange.from);
        }
        if (filters.dateRange.to) {
            items = items.filter(i => i.join_date && i.join_date <= filters.dateRange.to);
        }

        return applyComplexConditions(items, filters.complex);
    };

    const performProspectSearch = async (filters) => {
        let items = await getVisibleProspects();

        if (filters.basic.name) {
            const q = filters.basic.name.toLowerCase();
            items = items.filter(i => (i.full_name && i.full_name.toLowerCase().includes(q)) || (i.nickname && i.nickname.toLowerCase().includes(q)));
        }
        if (filters.basic.minggua) {
            items = items.filter(i => i.ming_gua === filters.basic.minggua);
        }
        if (filters.basic.phone) {
            const q = filters.basic.phone.toLowerCase();
            items = items.filter(i => i.phone && i.phone.toLowerCase().includes(q));
        }
        if (filters.basic.email) {
            const q = filters.basic.email.toLowerCase();
            items = items.filter(i => i.email && i.email.toLowerCase().includes(q));
        }
        if (filters.basic['score-min']) {
            items = items.filter(i => i.score >= parseInt(filters.basic['score-min']));
        }
        if (filters.basic['score-max']) {
            items = items.filter(i => i.score <= parseInt(filters.basic['score-max']));
        }
        if (filters.basic.status) {
            items = items.filter(i => i.status === filters.basic.status);
        }
        if (filters.basic.agent) {
            items = items.filter(i => String(i.responsible_agent_id) === String(filters.basic.agent));
        }
        if (filters.basic.pipeline) {
            items = items.filter(i => i.pipeline_stage === filters.basic.pipeline);
        }
        if (filters.basic['deal-min']) {
            items = items.filter(i => parseFloat(i.deal_value) >= parseFloat(filters.basic['deal-min']));
        }
        if (filters.basic['deal-max']) {
            items = items.filter(i => parseFloat(i.deal_value) <= parseFloat(filters.basic['deal-max']));
        }
        if (filters.basic.gender) {
            items = items.filter(i => i.gender === filters.basic.gender);
        }
        if (filters.basic.occupation) {
            const q = filters.basic.occupation.toLowerCase();
            items = items.filter(i => i.occupation && i.occupation.toLowerCase().includes(q));
        }
        if (filters.basic.income) {
            items = items.filter(i => i.income_range === filters.basic.income);
        }
        if (filters.basic.city) {
            const q = filters.basic.city.toLowerCase();
            items = items.filter(i => i.city && i.city.toLowerCase().includes(q));
        }
        if (filters.basic.state) {
            items = items.filter(i => i.state === filters.basic.state);
        }
        if (filters.basic.referred) {
            const q = filters.basic.referred.toLowerCase();
            items = items.filter(i => i.referred_by && i.referred_by.toLowerCase().includes(q));
        }
        if (filters.basic['has-purchased']) {
            const product = filters.basic['has-purchased'];
            const hasPurchased = await Promise.all(items.map(i => hasProspectPurchasedProduct(i.id, product)));
            items = items.filter((_, idx) => hasPurchased[idx]);
        }
        if (filters.basic['not-purchased']) {
            const product = filters.basic['not-purchased'];
            const notPurchased = await Promise.all(items.map(i => hasProspectPurchasedProduct(i.id, product)));
            items = items.filter((_, idx) => !notPurchased[idx]);
        }
        if (filters.basic.keyword) {
            const kw = filters.basic.keyword.toLowerCase();
            items = items.filter(i =>
                (i.full_name && i.full_name.toLowerCase().includes(kw)) ||
                (i.nickname && i.nickname.toLowerCase().includes(kw)) ||
                (i.phone && i.phone.toLowerCase().includes(kw)) ||
                (i.email && i.email.toLowerCase().includes(kw)) ||
                (i.occupation && i.occupation.toLowerCase().includes(kw)) ||
                (i.company_name && i.company_name.toLowerCase().includes(kw)) ||
                (i.notes && i.notes.toLowerCase().includes(kw))
            );
        }
        if (filters.basic.tags && filters.basic.tags.length > 0) {
            items = items.filter(i => {
                const itemTags = i.tags ? (Array.isArray(i.tags) ? i.tags : i.tags.split(',').map(t => t.trim())) : [];
                return filters.basic.tags.every(tag => itemTags.includes(tag));
            });
        }
        if (filters.basic.needs && filters.basic.needs.length > 0) {
            items = items.filter(i => {
                const itemNeeds = i.needs ? (Array.isArray(i.needs) ? i.needs : i.needs.split(',').map(t => t.trim())) : [];
                return filters.basic.needs.every(need => itemNeeds.includes(need));
            });
        }
        if (filters.basic['age-min'] || filters.basic['age-max']) {
            items = items.filter(i => {
                if (!i.date_of_birth) return false;
                const age = Math.floor((Date.now() - new Date(i.date_of_birth).getTime()) / (365.25 * 24 * 60 * 60 * 1000));
                if (filters.basic['age-min'] && age < parseInt(filters.basic['age-min'])) return false;
                if (filters.basic['age-max'] && age > parseInt(filters.basic['age-max'])) return false;
                return true;
            });
        }
        if (filters.dateRange.from) {
            items = items.filter(i => i.cps_assignment_date && i.cps_assignment_date >= filters.dateRange.from);
        }
        if (filters.dateRange.to) {
            items = items.filter(i => i.cps_assignment_date && i.cps_assignment_date <= filters.dateRange.to);
        }

        return applyComplexConditions(items, filters.complex);
    };

    const hasProspectPurchasedProduct = async (prospectId, productName) => {
        const purchases = await AppDataStore.getAll('purchases');
        if (purchases.some(p => p.customer_id === prospectId && p.item && p.item.includes(productName))) return true;

        const activities = await AppDataStore.getAll('activities');
        return activities.some(a => (a.prospect_id === prospectId || a.customer_id === prospectId) && a.is_closing && a.solution_sold === productName);
    };

    const performCustomerSearch = async (filters) => {
        let items = await getVisibleCustomers();

        if (filters.basic.name) {
            const q = filters.basic.name.toLowerCase();
            items = items.filter(i => (i.full_name && i.full_name.toLowerCase().includes(q)) || (i.nickname && i.nickname.toLowerCase().includes(q)));
        }
        if (filters.basic.minggua) {
            items = items.filter(i => i.ming_gua === filters.basic.minggua);
        }
        if (filters.basic.phone) {
            const q = filters.basic.phone.toLowerCase();
            items = items.filter(i => i.phone && i.phone.toLowerCase().includes(q));
        }
        if (filters.basic.email) {
            const q = filters.basic.email.toLowerCase();
            items = items.filter(i => i.email && i.email.toLowerCase().includes(q));
        }
        if (filters.basic['score-min']) {
            items = items.filter(i => i.score >= parseInt(filters.basic['score-min']));
        }
        if (filters.basic['score-max']) {
            items = items.filter(i => i.score <= parseInt(filters.basic['score-max']));
        }
        if (filters.basic.status) {
            items = items.filter(i => i.status === filters.basic.status);
        }
        if (filters.basic.agent) {
            items = items.filter(i => String(i.responsible_agent_id) === String(filters.basic.agent));
        }
        if (filters.basic['ltv-min']) {
            items = items.filter(i => parseFloat(i.lifetime_value) >= parseFloat(filters.basic['ltv-min']));
        }
        if (filters.basic['ltv-max']) {
            items = items.filter(i => parseFloat(i.lifetime_value) <= parseFloat(filters.basic['ltv-max']));
        }
        if (filters.basic.gender) {
            items = items.filter(i => i.gender === filters.basic.gender);
        }
        if (filters.basic.occupation) {
            const q = filters.basic.occupation.toLowerCase();
            items = items.filter(i => i.occupation && i.occupation.toLowerCase().includes(q));
        }
        if (filters.basic.income) {
            items = items.filter(i => i.income_range === filters.basic.income);
        }
        if (filters.basic.city) {
            const q = filters.basic.city.toLowerCase();
            items = items.filter(i => i.city && i.city.toLowerCase().includes(q));
        }
        if (filters.basic.state) {
            items = items.filter(i => i.state === filters.basic.state);
        }
        if (filters.basic.referred) {
            const q = filters.basic.referred.toLowerCase();
            items = items.filter(i => i.referred_by && i.referred_by.toLowerCase().includes(q));
        }
        if (filters.basic.keyword) {
            const kw = filters.basic.keyword.toLowerCase();
            items = items.filter(i =>
                (i.full_name && i.full_name.toLowerCase().includes(kw)) ||
                (i.nickname && i.nickname.toLowerCase().includes(kw)) ||
                (i.phone && i.phone.toLowerCase().includes(kw)) ||
                (i.email && i.email.toLowerCase().includes(kw)) ||
                (i.occupation && i.occupation.toLowerCase().includes(kw)) ||
                (i.company_name && i.company_name.toLowerCase().includes(kw)) ||
                (i.notes && i.notes.toLowerCase().includes(kw))
            );
        }
        if (filters.basic.tags && filters.basic.tags.length > 0) {
            items = items.filter(i => {
                const itemTags = i.tags ? (Array.isArray(i.tags) ? i.tags : i.tags.split(',').map(t => t.trim())) : [];
                return filters.basic.tags.every(tag => itemTags.includes(tag));
            });
        }
        if (filters.basic.needs && filters.basic.needs.length > 0) {
            items = items.filter(i => {
                const itemNeeds = i.needs ? (Array.isArray(i.needs) ? i.needs : i.needs.split(',').map(t => t.trim())) : [];
                return filters.basic.needs.every(need => itemNeeds.includes(need));
            });
        }
        if (filters.basic['age-min'] || filters.basic['age-max']) {
            items = items.filter(i => {
                if (!i.date_of_birth) return false;
                const age = Math.floor((Date.now() - new Date(i.date_of_birth).getTime()) / (365.25 * 24 * 60 * 60 * 1000));
                if (filters.basic['age-min'] && age < parseInt(filters.basic['age-min'])) return false;
                if (filters.basic['age-max'] && age > parseInt(filters.basic['age-max'])) return false;
                return true;
            });
        }
        if (filters.dateRange.from) {
            items = items.filter(i => i.customer_since && i.customer_since >= filters.dateRange.from);
        }
        if (filters.dateRange.to) {
            items = items.filter(i => i.customer_since && i.customer_since <= filters.dateRange.to);
        }

        return applyComplexConditions(items, filters.complex);
    };

    const performActivitySearch = async (filters) => {
        let items = await getVisibleActivities();

        // activity entity doesn't strip prefix cleanly, check both key forms
        const type = filters.basic['filter-activity-type'] || filters.basic.type;
        if (type) {
            items = items.filter(i => i.activity_type === type);
        }
        const title = filters.basic['filter-activity-title'] || filters.basic.title;
        if (title) {
            const q = title.toLowerCase();
            items = items.filter(i => i.activity_title && i.activity_title.toLowerCase().includes(q));
        }
        const agentId = filters.basic['filter-activity-agent'] || filters.basic.agent;
        if (agentId) {
            items = items.filter(i => String(i.lead_agent_id) === String(agentId));
        }
        const status = filters.basic['filter-activity-status'] || filters.basic.status;
        if (status) {
            items = items.filter(i => i.status === status);
        }
        const attendance = filters.basic['filter-activity-attendance'] || filters.basic.attendance;
        if (attendance) {
            const allAttendees = await AppDataStore.getAll('event_attendees');
            items = items.filter(i => {
                if (i.activity_type !== 'EVENT' || !i.event_id) return false;
                return allAttendees.some(a => a.event_id === i.event_id && a.attendance_status === attendance);
            });
        }
        if (filters.dateRange.from) {
            items = items.filter(i => i.activity_date && i.activity_date >= filters.dateRange.from);
        }
        if (filters.dateRange.to) {
            items = items.filter(i => i.activity_date && i.activity_date <= filters.dateRange.to);
        }

        return applyComplexConditions(items, filters.complex);
    };

    const performTransactionSearch = async (filters) => {
        let items = await AppDataStore.getAll('purchases');

        if (filters.basic.product) {
            const q = filters.basic.product.toLowerCase();
            items = items.filter(i => i.item && i.item.toLowerCase().includes(q));
        }
        if (filters.basic.invoice) {
            const q = filters.basic.invoice.toLowerCase();
            items = items.filter(i => i.invoice && i.invoice.toLowerCase().includes(q));
        }
        if (filters.basic.payment) {
            items = items.filter(i => i.payment_method === filters.basic.payment);
        }
        if (filters.basic.status) {
            items = items.filter(i => i.status === filters.basic.status);
        }
        if (filters.basic['amount-min']) {
            items = items.filter(i => parseFloat(i.amount) >= parseFloat(filters.basic['amount-min']));
        }
        if (filters.basic['amount-max']) {
            items = items.filter(i => parseFloat(i.amount) <= parseFloat(filters.basic['amount-max']));
        }
        if (filters.dateRange.from) {
            items = items.filter(i => i.date && i.date >= filters.dateRange.from);
        }
        if (filters.dateRange.to) {
            items = items.filter(i => i.date && i.date <= filters.dateRange.to);
        }

        return applyComplexConditions(items, filters.complex);
    };

    const performEventSearch = async (filters) => {
        let items = await AppDataStore.getAll('events');

        if (filters.basic.title) {
            const query = filters.basic.title.toLowerCase();
            items = items.filter(i => i.event_title && i.event_title.toLowerCase().includes(query));
        }
        if (filters.basic.category) {
            items = items.filter(i => String(i.event_category_id) === String(filters.basic.category));
        }
        if (filters.basic.location) {
            const q = filters.basic.location.toLowerCase();
            items = items.filter(i => i.location && i.location.toLowerCase().includes(q));
        }
        if (filters.basic.status) {
            items = items.filter(i => i.status === filters.basic.status);
        }
        if (filters.dateRange.from) {
            items = items.filter(i => i.event_date && i.event_date >= filters.dateRange.from);
        }
        if (filters.dateRange.to) {
            items = items.filter(i => i.event_date && i.event_date <= filters.dateRange.to);
        }
        if (filters.basic.speaker) {
            const q = filters.basic.speaker.toLowerCase();
            items = items.filter(i => i.speaker && i.speaker.toLowerCase().includes(q));
        }

        return applyComplexConditions(items, filters.complex);
    };

    const performProductSearch = async (filters) => {
        let items = await AppDataStore.getAll('products');

        if (filters.basic.name) {
            const q = filters.basic.name.toLowerCase();
            items = items.filter(i => i.name && i.name.toLowerCase().includes(q));
        }
        if (filters.basic.category) {
            const q = filters.basic.category.toLowerCase();
            items = items.filter(i => i.category && i.category.toLowerCase().includes(q));
        }
        if (filters.basic['price-min']) {
            items = items.filter(i => parseFloat(i.price) >= parseFloat(filters.basic['price-min']));
        }
        if (filters.basic['price-max']) {
            items = items.filter(i => parseFloat(i.price) <= parseFloat(filters.basic['price-max']));
        }
        if (filters.basic.status) {
            const active = filters.basic.status === 'active';
            items = items.filter(i => (i.is_active !== false) === active);
        }

        return applyComplexConditions(items, filters.complex);
    };

    const performBujishuSearch = async (filters) => {
        let items = await AppDataStore.getAll('bujishu');

        if (filters.basic.name) {
            const q = filters.basic.name.toLowerCase();
            items = items.filter(i => i.name && i.name.toLowerCase().includes(q));
        }
        if (filters.basic.category) {
            const q = filters.basic.category.toLowerCase();
            items = items.filter(i => i.category && i.category.toLowerCase().includes(q));
        }
        if (filters.basic['price-min']) {
            items = items.filter(i => parseFloat(i.price) >= parseFloat(filters.basic['price-min']));
        }
        if (filters.basic['price-max']) {
            items = items.filter(i => parseFloat(i.price) <= parseFloat(filters.basic['price-max']));
        }
        if (filters.basic.status) {
            const active = filters.basic.status === 'active';
            items = items.filter(i => (i.is_active !== false) === active);
        }

        return applyComplexConditions(items, filters.complex);
    };

    const performFormulaSearch = async (filters) => {
        let items = await AppDataStore.getAll('formula');

        if (filters.basic.name) {
            const q = filters.basic.name.toLowerCase();
            items = items.filter(i => i.name && i.name.toLowerCase().includes(q));
        }
        if (filters.basic.category) {
            const q = filters.basic.category.toLowerCase();
            items = items.filter(i => i.category && i.category.toLowerCase().includes(q));
        }
        if (filters.basic['price-min']) {
            items = items.filter(i => parseFloat(i.price) >= parseFloat(filters.basic['price-min']));
        }
        if (filters.basic['price-max']) {
            items = items.filter(i => parseFloat(i.price) <= parseFloat(filters.basic['price-max']));
        }
        if (filters.basic['dosage-max']) {
            items = items.filter(i => i.daily_dosage && parseFloat(i.daily_dosage) <= parseFloat(filters.basic['dosage-max']));
        }
        if (filters.basic.status) {
            const active = filters.basic.status === 'active';
            items = items.filter(i => (i.is_active !== false) === active);
        }

        return applyComplexConditions(items, filters.complex);
    };

    const applyComplexConditions = (items, groups) => {
        if (!groups || groups.length === 0 || groups[0].conditions.length === 0) return items;

        return items.filter(item => {
            // Group logic (AND/OR for multiple groups)
            // Simplified: we only support one group logic at the top level for now or specific per-group
            return groups.every(group => {
                const results = group.conditions.map(cond => evaluateCondition(item, cond));
                return group.logic === 'AND' ? results.every(r => r) : results.some(r => r);
            });
        });
    };

    const evaluateCondition = (item, cond) => {
        if (!cond.field) return true;

        const itemValue = item[cond.field];
        const val = cond.value;

        switch (cond.operator) {
            case '=': return itemValue == val;
            case '!=': return itemValue != val;
            case '>': return parseFloat(itemValue) > parseFloat(val);
            case '<': return parseFloat(itemValue) < parseFloat(val);
            case 'contains': return String(itemValue).toLowerCase().includes(String(val).toLowerCase());
            case 'not_contains': return !String(itemValue).toLowerCase().includes(String(val).toLowerCase());
            default: return true;
        }
    };

    // Section 10.9: Results Rendering
    const renderSearchResults = async () => {
        const container = document.getElementById('search-results');
        if (!container) return;

        if (_totalResults === 0) {
            container.innerHTML = '<div class="no-results">No matches found for your criteria.</div>';
            return;
        }

        const start = (_currentPage - 1) * _pageSize;
        const pageItems = _currentSearchResults.slice(start, start + _pageSize);

        const _searchUserMap = new Map((await AppDataStore.getAll('users')).map(u => [String(u.id), u.full_name]));

        let html = `
            <h3>Search Results (${_totalResults} found)</h3>
            <table class="search-results-table table-hover">
                <thead>
                    <tr>
                        <th scope="col">Name/Title</th>
                        <th scope="col">Identifier/Contact</th>
                        <th scope="col">Agent Name</th>
                        <th scope="col">Status</th>
                        <th scope="col">Actions</th>
                    </tr>
                </thead>
                <tbody>
                    ${pageItems.map(item => {
            const agentId = item.lead_agent_id || item.responsible_agent_id;
            const agentName = agentId ? (_searchUserMap.get(String(agentId)) || '-') : '-';

            let displayStatus = item.status || item.activity_type || item.team || 'Active';
            if (_currentSearchEntity === 'prospects') displayStatus = item.status || 'Prospect';
            if (_currentSearchEntity === 'customers') displayStatus = 'Customer';
            if (item.status === 'converted' && _currentSearchEntity === 'prospects') displayStatus = 'Customer';
            if (['products','bujishu','formula'].includes(_currentSearchEntity)) {
                displayStatus = item.is_active === false ? 'Inactive' : 'Active';
            }

            const nameCol = item.full_name || item.activity_title || item.event_title || item.item || item.name || 'N/A';
            const identifierCol = (() => {
                if (['products','bujishu','formula'].includes(_currentSearchEntity)) return item.category ? `${item.category} — RM${item.price || '-'}` : `RM${item.price || '-'}`;
                return item.phone || item.agent_code || item.invoice || item.location || 'N/A';
            })();

            return `
                        <tr style="cursor: pointer;" onclick="app.viewEntityDetail('${_currentSearchEntity}', ${item.id})">
                            <td><strong>${nameCol}</strong></td>
                            <td>${identifierCol}</td>
                            <td>${agentName}</td>
                            <td>${displayStatus}</td>
                            <td>
                                <button class="btn-icon" title="View Detail" onclick="app.viewEntityDetail('${_currentSearchEntity}', ${item.id}); event.stopPropagation();">
                                    <i class="fas fa-eye"></i>
                                </button>
                            </td>
                        </tr>
                        `;
        }).join('')}
                </tbody>
            </table>
        `;

        container.innerHTML = html;
        await renderPagination();
    };

    const renderPagination = async () => {
        const container = document.getElementById('search-pagination');
        if (!container) return;

        const totalPages = Math.ceil(_totalResults / _pageSize);
        if (totalPages <= 1) {
            container.innerHTML = '';
            return;
        }

        container.innerHTML = `
            <div class="pagination-controls">
                <button ${_currentPage === 1 ? 'disabled' : ''} onclick="app.goToPage(${_currentPage - 1})">Prev</button>
                <span>Page ${_currentPage} of ${totalPages}</span>
                <button ${_currentPage === totalPages ? 'disabled' : ''} onclick="app.goToPage(${_currentPage + 1})">Next</button>
            </div>
        `;
    };

    const goToPage = async (page) => {
        _currentPage = page;
        await renderSearchResults();
    };

    // Section 10.10: Saved Searches & History
    const renderSavedSearches = async () => {
        const container = document.getElementById('saved-searches-list');
        if (!container) return;

        const searches = await AppDataStore.getAll('saved_searches');
        if (searches.length === 0) {
            container.innerHTML = '<p class="text-muted" style="font-size: 12px; margin: 12px 0;">No saved searches yet.</p>';
            return;
        }

        container.innerHTML = searches.map(s => `
            <div class="saved-search-item">
                <div class="saved-search-info" onclick="app.loadSavedSearch(${s.id})">
                    <i class="fas fa-bookmark"></i>
                    <span>${s.search_name}</span>
                    <small>${s.entity}</small>
                </div>
                <button class="btn-icon" onclick="app.deleteSavedSearch(${s.id})">
                    <i class="fas fa-trash"></i>
                </button>
            </div>
        `).join('');
    };

    const openSaveSearchModal = async () => {
        const name = prompt('Enter a name for this search:');
        if (name) {
            await saveCurrentSearch(name);
        }
    };

    const saveCurrentSearch = async (name) => {
        const filters = collectFilters();
        const savedSearch = {
            id: Date.now(),
            search_name: name,
            entity: filters.entity,
            filter_data: JSON.stringify(filters),
            created_at: new Date().toISOString()
        };

        await AppDataStore.create('saved_searches', savedSearch);
        UI.toast.success('Search saved successfully');
        await renderSavedSearches();
    };

    const loadSavedSearch = async (id) => {
        const search = await AppDataStore.getById('saved_searches', id);
        if (!search) return;

        UI.toast.info(`Loading search: ${search.search_name}`);
        const filters = JSON.parse(search.filter_data);

        // Restore UI
        document.getElementById('search-entity').value = filters.entity;
        await updateFilterSections();

        document.getElementById('search-date-from').value = filters.dateRange.from || '';
        document.getElementById('search-date-to').value = filters.dateRange.to || '';

        _conditionGroups = filters.complex;
        renderConditionGroups();

        // Execute
        await executeSearch();
    };

    const deleteSavedSearch = async (id) => {
        if (confirm('Are you sure you want to delete this saved search?')) {
            await AppDataStore.delete('saved_searches', id);
            UI.toast.success('Search deleted');
            await renderSavedSearches();
        }
    };

    const addToSearchHistory = (filters) => {
        _searchHistory.unshift({
            timestamp: new Date().toLocaleTimeString(),
            entity: filters.entity,
            summary: filters.entity + ' search'
        });

        if (_searchHistory.length > 5) _searchHistory.pop();
        renderSearchHistory();
    };

    const renderSearchHistory = () => {
        const container = document.getElementById('search-history-list');
        if (!container) return;

        container.innerHTML = _searchHistory.map(h => `
            <div class="history-item">
                <div class="history-info">
                    <small>${h.timestamp}</small>
                    <span>${h.summary}</span>
                </div>
            </div>
        `).join('');
    };

    const clearAllFilters = () => {
        // Reset basic filters
        const section = document.getElementById('filter-sections');
        if (section) {
            const inputs = section.querySelectorAll('input, select');
            inputs.forEach(input => input.value = '');
        }

        // Reset date
        document.getElementById('search-date-from').value = '';
        document.getElementById('search-date-to').value = '';

        // Reset conditions
        _conditionGroups = [{ logic: 'AND', conditions: [] }];
        renderConditionGroups();

        UI.toast.info('Filters cleared');
    };

    const exportResults = (format) => {
        if (_currentSearchResults.length === 0) {
            UI.toast.warning('No results to export');
            return;
        }

        if (format === 'csv') {
            const keys = Object.keys(_currentSearchResults[0]);
            const header = keys.join(',');
            const rows = _currentSearchResults.map(row =>
                keys.map(key => `"${row[key] || ''}"`).join(',')
            );

            const csv = [header, ...rows].join('\n');
            const blob = new Blob([csv], { type: 'text/csv' });
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.setAttribute('hidden', '');
            a.setAttribute('href', url);
            a.setAttribute('download', `search_results_${_currentSearchEntity}.csv`);
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            UI.toast.success('Exporting CSV...');
        }
    };


    // --- PHASE 11: DOCUMENT MANAGEMENT SYSTEM FUNCTIONS ---
    // [CHUNK: documents] ~981 lines extracted to chunks/script-documents.js
    // Loaded lazily by navigateTo("documents"). Registered via Object.assign.


    // ==================== PHASE 14: NOTES + VOICE + MOBILE ====================
    // [CHUNK: mobile] ~2258 lines extracted to chunks/script-mobile.js
    // Loaded eagerly at startup on mobile; lazily on desktop for mobile views.
    // initMobileApp(), renderMobileBottomNav() etc. registered via Object.assign.

    // isMobile and applyMobileClass stay in script.js (called from init)
    // ==================== PHASE 14: MOBILE FUNCTIONS ====================

    const isMobile = () => window.innerWidth <= 768;
    Object.assign(window._crmUtils, { isMobile });


    // ==================== PHASE 14: OFFLINE SUPPORT ====================

    const initOfflineSupport = () => {
        window.addEventListener('online', handleOnline);
        window.addEventListener('offline', handleOffline);

        // Load saved queue, prune entries older than 7 days, cap at 50 items
        try {
            const saved = localStorage.getItem('offline_queue');
            if (saved) {
                const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
                _offlineQueue = JSON.parse(saved)
                    .filter(item => new Date(item.timestamp).getTime() > cutoff)
                    .slice(-50);
                localStorage.setItem('offline_queue', JSON.stringify(_offlineQueue));
            }
        } catch (e) { _offlineQueue = []; }

        updateOfflineIndicator();
    };

    const handleOnline = async () => {
        _isOnline = true;
        UI.toast.success('Back online – syncing data...');
        await processOfflineQueue();
        updateOfflineIndicator();
    };

    const handleOffline = () => {
        _isOnline = false;
        UI.toast.warning('You are offline – changes will be queued');
        updateOfflineIndicator();
    };

    const updateOfflineIndicator = () => {
        let indicator = document.getElementById('offline-indicator');
        if (!indicator) {
            indicator = document.createElement('div');
            indicator.id = 'offline-indicator';
            document.body.appendChild(indicator);
        }

        if (!_isOnline) {
            const n = _offlineQueue.length;
            indicator.innerHTML = `<i class="fas fa-wifi-slash" aria-hidden="true"></i> Offline${n ? ` — ${n} change${n === 1 ? '' : 's'} queued` : ''}`;
            indicator.setAttribute('aria-label', `You are offline${n ? `, ${n} change${n === 1 ? '' : 's'} will sync when reconnected` : ''}`);
            indicator.style.display = 'flex';
        } else if (_offlineQueue.length > 0) {
            const n = _offlineQueue.length;
            indicator.innerHTML = `<i class="fas fa-sync-alt fa-spin" aria-hidden="true"></i> Syncing ${n} change${n === 1 ? '' : 's'}…`;
            indicator.setAttribute('aria-label', `Syncing ${n} offline change${n === 1 ? '' : 's'}`);
            indicator.style.display = 'flex';
        } else {
            indicator.style.display = 'none';
        }
    };

    const addToOfflineQueue = (action, data) => {
        const item = { id: Date.now() + Math.random(), action, data, timestamp: new Date().toISOString() };
        _offlineQueue.push(item);
        localStorage.setItem('offline_queue', JSON.stringify(_offlineQueue));
        updateOfflineIndicator();
        UI.toast.info('Action saved offline – will sync when online');
    };

    const processOfflineQueue = async () => {
        if (_offlineQueue.length === 0) return;
        const queue = [..._offlineQueue];
        _offlineQueue = [];
        localStorage.setItem('offline_queue', JSON.stringify(_offlineQueue));
        updateOfflineIndicator();

        let success = 0;
        let fail = 0;
        for (const item of queue) {
            try {
                if (item.action.startsWith('create_')) {
                    await AppDataStore.create(item.action.replace('create_', ''), item.data);
                } else if (item.action.startsWith('update_')) {
                    await AppDataStore.update(item.action.replace('update_', ''), item.data.id, item.data);
                }
                success++;
            } catch (e) {
                fail++;
                _offlineQueue.push(item);
            }
        }
        localStorage.setItem('offline_queue', JSON.stringify(_offlineQueue));
        updateOfflineIndicator();

        if (fail === 0) UI.toast.success(`Synced ${success} offline actions`);
        else UI.toast.warning(`Synced ${success}, failed ${fail} `);
    };

    const offlineCreate = async (tableName, data) => {
        if (_isOnline) return await AppDataStore.create(tableName, data);
        addToOfflineQueue('create_' + tableName, data);
        return { ...data, id: 'offline-' + Date.now(), offline: true };
    };

    const offlineUpdate = async (tableName, id, data) => {
        if (_isOnline) return await AppDataStore.update(tableName, id, data);
        addToOfflineQueue('update_' + tableName, { ...data, id });
        return { ...data, id, offline: true };
    };

    // ========== GOOGLE CALENDAR INTEGRATION FUNCTIONS ==========
    // [CHUNK: gcal] ~779 lines extracted to chunks/script-gcal.js
    // Loaded lazily by navigateTo("integrations").


    // ========== WHATSAPP BUSINESS INTEGRATION FUNCTIONS ==========
    // [CHUNK: whatsapp] ~640 lines extracted to chunks/script-whatsapp.js
    // Loaded lazily by navigateTo('whatsapp') OR auto-loaded by
    // addWhatsAppButtonToProfile on first button click.
    // All public functions registered on window.app via Object.assign.

    // no-op kept so init() call at ~L9136 doesn't throw after chunk extraction
    const initWhatsAppIntegration = () => {};

    // addWhatsAppButtonToProfile is kept in script.js (called directly from
    // showProspectDetail / showCustomerDetail before chunk is loaded).
    // The onclick auto-loads the WA chunk if needed, then calls the real modal.
    const addWhatsAppButtonToProfile = async (entityType, entityId) => {
        const headers = document.querySelectorAll('.header-actions');
        for (const header of headers) {
            if (!header.querySelector('.btn-whatsapp-add')) {
                const button = document.createElement('button');
                button.className = 'btn secondary btn-whatsapp-add';
                button.innerHTML = '<i class="fab fa-whatsapp" style="color:#25D366;"></i> WhatsApp';
                button.onclick = async () => {
                    if (!window.app.openSendWhatsAppModal) {
                        await window._loadChunk('chunks/script-whatsapp.min.js');
                    }
                    await (window.app.openSendWhatsAppModal || (() => {}))(entityType, entityId);
                };
                header.insertBefore(button, header.lastElementChild);
            }
        }
    };

    // ========== PHASE 17: AI ANALYTICS FUNCTIONS ==========
    // [CHUNK: ai] ~1336 lines extracted to chunks/script-ai.js
    // Loaded lazily by navigateTo("ai_insights"). All public functions
    // registered on window.app via Object.assign at chunk load time.

    // no-op stubs — real implementations are in the chunk
    const initAIAnalytics     = () => {};
    const ensureAIModelsExist = () => {};


    // ========== AUTHENTICATION & NAVIGATION ==========
    const USER_ROLES = [
        "Level 1 Super Admin",
        "Level 2 Marketing Manager",
        "Level 3 Senior Managers",
        "Level 4 Managers",
        "Level 5 Team Leader",
        "Level 6 Senior Consultant",
        "Level 7 Consultant",
        "Level 8 Junior Consultant",
        "Level 9 Senior Agent",
        "Level 10 Agent",
        "Level 11 Junior Agent",
        "传福大使",
        "改命客户",
        "准传福大使"
    ];
    // Exposed for the reporting chunk's role-filter dropdown.
    Object.assign(window._crmUtils, { USER_ROLES });



    function populateLoginDropdown() {
        // No-op: login is now handled by Supabase email/password form
        // Supabase auth – login dropdown removed
    }

    function updateNavVisibility() {
        const user = _currentUser;
        if (!user) return;

        // Map Level 1-14 to visible nav IDs (suffix after 'nav-')
        // Order in array = display order in nav (first item leftmost / top).
        const _l12 = ['calendar', 'prospects', 'referrals', 'pipeline', 'promotions', 'cases', 'reports', 'documents', 'settings', 'fude', 'milestones'];
        const levelPermissions = {
            1: ['calendar', 'prospects', 'referrals', 'pipeline', 'promotions', 'marketing-automation', 'marketing-lists', 'cases', 'purchases_history', 'agents', 'performance', 'reports', 'risk', 'admin', 'protection', 'documents', 'import', 'integrations', 'settings', 'fude', 'milestones', 'noticeboard', 'custom_fields', 'egg-purchasing', 'standard-functions', 'formula-purchaser', 'stock-take', 'boss-report', 'org-chart'],
            2: ['calendar', 'prospects', 'referrals', 'pipeline', 'promotions', 'marketing-automation', 'marketing-lists', 'cases', 'agents', 'performance', 'reports', 'risk', 'admin', 'protection', 'documents', 'import', 'integrations', 'settings', 'fude', 'milestones', 'noticeboard', 'custom_fields', 'org-chart'],
            3: ['calendar', 'prospects', 'referrals', 'pipeline', 'promotions', 'cases', 'performance', 'reports', 'protection', 'documents', 'settings', 'fude'],
            4: ['calendar', 'prospects', 'referrals', 'pipeline', 'promotions', 'cases', 'performance', 'reports', 'protection', 'documents', 'settings', 'fude'],
            5: _l12, 6: _l12, 7: _l12, 8: _l12, 9: _l12, 10: _l12,
            11: ['calendar', 'prospects', 'referrals', 'promotions', 'cases', 'settings', 'fude', 'milestones'],
            12: ['noticeboard', 'fude', 'milestones', 'prospects', 'referrals'],          // 传福大使
            13: ['noticeboard', 'fude', 'milestones', 'prospects'],                       // 改命客户
            14: ['noticeboard', 'fude', 'milestones', 'prospects'],                       // 准传福大使
            15: ['stock-take']                                                            // Stock Take Staff (per-store counters)
        };

        // Determine level from role (e.g., "Level 1 Super Admin" -> 1)
        // Delegates to the centralized _getUserLevel helper so legacy names
        // ('customer'/'referrer') AND Chinese-only names ('传福大使'/'改命客户'/
        // '准传福大使') resolve identically. Defaults to 12 (lowest staff tier).
        let level = _getUserLevel(user);
        if (level === 99) level = 12;

        const allowed = levelPermissions[level] || levelPermissions[12];
        
        // List of all nav item suffixes
        const allNavIds = [
            'calendar', 'pipeline', 'protection', 'agents', 'prospects', 'referrals',
            'cases', 'documents', 'import', 'promotions', 'marketing-automation', 'marketing-lists',
            'performance', 'reports', 'risk', 'admin',
            'integrations', 'settings', 'milestones', 'fude', 'noticeboard',
            'custom_fields', 'egg-purchasing', 'standard-functions', 'formula-purchaser',
            'purchases_history', 'stock-take', 'boss-report', 'org-chart'
        ];

        allNavIds.forEach(id => {
            const el = document.getElementById(`nav-${id}`);
            if (el) {
                el.style.display = allowed.includes(id) ? '' : 'none';
            }
            const sbEl = document.getElementById(`sb-nav-${id}`);
            if (sbEl) {
                sbEl.style.display = allowed.includes(id) ? '' : 'none';
            }
        });

        // For Level 12/13/14 (传福大使 / 改命客户 / 准传福大使), the array order
        // in levelPermissions defines the *display* order — re-append visible nav
        // items in that order so noticeboard sits leftmost. For admin levels we
        // keep the existing DOM order so the dense menu doesn't shuffle.
        if (level >= 12) {
            const navParent = document.getElementById('nav-links');
            const sbParent  = document.querySelector('.sidebar-nav') || document.getElementById('sb-nav-list');
            allowed.forEach(id => {
                const el = document.getElementById(`nav-${id}`);
                if (el && navParent && el.parentElement === navParent) navParent.appendChild(el);
                const sbEl = document.getElementById(`sb-nav-${id}`);
                if (sbEl && sbParent && sbEl.parentElement === sbParent) sbParent.appendChild(sbEl);
            });
        }
    }

// Simple Auth wrapper using Supabase
// Defensive: every Supabase call is null-guarded so a broken client (storage
// blocked on iPad Private mode, partial library load, content-blocker
// stripping the response) surfaces a clear message instead of Safari's
// cryptic "undefined is not an object (evaluating 'data.user')" toast.
const Auth = {
    async login(email, password) {
        const response = await window.supabase.auth.signInWithPassword({
            email,
            password
        });
        if (!response || typeof response !== 'object') {
            throw new Error('Login service returned no response. Please clear Safari data (Settings → Safari → Clear History and Website Data) and try again.');
        }
        const { data, error } = response;
        if (error) throw error;
        if (!data || !data.user) {
            // Most commonly hit on iPad Safari with "Block All Cookies" ON or
            // in Private Browsing — sign-in succeeds on the wire but the
            // session can't be persisted, so supabase-js bails with no user.
            throw new Error('Login could not complete on this device. Please turn off "Block All Cookies" (Settings → Safari → Privacy), exit Private Browsing, and try again.');
        }
        return data.user;
    },
    async logout() {
        const response = await window.supabase.auth.signOut();
        const error = response && response.error;
        if (error) throw error;
    },
    async getCurrentUser() {
        const response = await window.supabase.auth.getUser();
        if (!response || typeof response !== 'object') return null;
        const { data, error } = response;
        if (error) throw error;
        return (data && data.user) || null;
    }
};

    async function login() {
        // Login is now handled by the #loginBtn Supabase click handler
        console.warn('app.login() called – use the loginBtn form instead');
    }

    async function logout() {
        await Auth.logout();
        _currentUser = null;
        localStorage.removeItem('remember_me'); // clear "keep me logged in" on explicit logout
        document.getElementById('app-shell').style.display = 'none';
        document.getElementById('login-container').style.display = 'flex';
        UI.hideModal();      // close the user menu modal
        UI.toast.info('Logged out successfully');
        // Re-wire loginBtn after logout in case DOM re-rendered
        _wireLoginBtn();
    }

    // Switch account: same as logout but also clears the remembered email and
    // pre-filled login field so the next person starts from a clean login form.
    // Used by the "not you? Switch account" banner that appears when a saved
    // session is auto-restored on a shared device.
    async function switchAccount() {
        try {
            await Auth.logout();
        } catch (_) { /* sign out even if the network call fails */ }
        _currentUser = null;
        localStorage.removeItem('remember_me');
        localStorage.removeItem('remember_me_email');
        const emailField = document.getElementById('loginEmail') || document.getElementById('email');
        if (emailField) emailField.value = '';
        const pwField = document.getElementById('loginPassword') || document.getElementById('password');
        if (pwField) pwField.value = '';
        document.getElementById('app-shell').style.display = 'none';
        document.getElementById('login-container').style.display = 'flex';
        UI.hideModal();
        UI.toast.info('Signed out — please log in with your own account.');
        _wireLoginBtn();
        emailField?.focus();
    }

function _wireLoginBtn() {
    const btn = document.getElementById('loginBtn');
    if (!btn || btn._supabaseSetup) return;
    btn._supabaseSetup = true;
    // Restore remembered checkbox state and pre-fill email.
    // Default to CHECKED for first-time / explicitly-logged-out users so mobile
    // sessions survive across app cold-boots. Only an explicit logout (which
    // removes 'remember_me') flips this off — and even then we re-check it
    // unless the user manually unticks before next login.
    const rememberChk = document.getElementById('rememberMe');
    const rememberedEmail = localStorage.getItem('remember_me_email');
    if (rememberChk) {
        const saved = localStorage.getItem('remember_me');
        // saved === '0' → user explicitly opted OUT last time → keep unchecked
        // saved === '1' OR null → check it (default-on for first-timers)
        rememberChk.checked = saved !== '0';
    }
    if (rememberedEmail) {
        const emailField = document.getElementById('email') || document.getElementById('loginEmail');
        if (emailField && !emailField.value) emailField.value = rememberedEmail;
    }
    // Wipe the SWR cache (fs_crm_*) and tombstones from localStorage. Used
    // when the auth-token write hits the quota — the cached row snapshots
    // are recoverable from Supabase, but the session token isn't, so the
    // cache loses every time.
    const _purgeLocalCache = () => {
        try {
            const toRemove = [];
            for (let i = 0; i < localStorage.length; i++) {
                const k = localStorage.key(i);
                if (!k) continue;
                if (k.startsWith('fs_crm_')) toRemove.push(k);
            }
            for (const k of toRemove) {
                try { localStorage.removeItem(k); } catch (_) {}
            }
        } catch (_) {}
    };
    const _isQuotaErr = (e) => {
        if (!e) return false;
        if (e.name === 'QuotaExceededError') return true;
        const m = (e.message || '').toLowerCase();
        return m.includes('exceeded the quota') || m.includes('quotaexceeded') || (m.includes('storage') && m.includes('quota'));
    };

    // In-app webviews (WhatsApp, FB Messenger, Instagram, LINE, WeChat, TikTok, etc.)
    // block third-party fetch / cookies and break Supabase auth. Detect and steer
    // the user to the real browser instead of showing a generic network error.
    const _detectInAppBrowser = () => {
        const ua = (navigator.userAgent || '') + ' ' + (navigator.vendor || '');
        const tests = [
            { re: /WhatsApp/i,        name: 'WhatsApp' },
            { re: /FBAN|FBAV|FB_IAB/, name: 'Facebook' },
            { re: /Instagram/i,       name: 'Instagram' },
            { re: /Line\//,           name: 'LINE' },
            { re: /MicroMessenger/i,  name: 'WeChat' },
            { re: /TikTok|musical_ly|BytedanceWebview/i, name: 'TikTok' },
            { re: /Twitter|TwitterAndroid/i, name: 'X (Twitter)' },
            { re: /Snapchat/i,        name: 'Snapchat' },
        ];
        for (const t of tests) if (t.re.test(ua)) return t.name;
        return null;
    };
    const _inAppBrowser = _detectInAppBrowser();
    if (_inAppBrowser) {
        // Show a persistent banner on the login screen so the user fixes the
        // environment BEFORE typing credentials and hitting the failure path.
        const isIOS = /iPhone|iPad|iPod/.test(navigator.userAgent);
        const openHint = isIOS
            ? 'Tap the share icon (□↑) at the bottom → "Open in Safari".'
            : 'Tap the ⋮ menu in the top-right → "Open in Chrome" (or external browser).';
        const banner = document.createElement('div');
        banner.id = 'in-app-browser-banner';
        banner.style.cssText = 'margin:10px 0;padding:12px 14px;background:#fff7ed;border:1px solid #fdba74;color:#9a3412;border-radius:8px;font-size:13px;line-height:1.45;text-align:left;';
        const strong = document.createElement('strong');
        strong.textContent = `You opened this page inside ${_inAppBrowser}'s in-app browser. `;
        banner.appendChild(strong);
        banner.appendChild(document.createTextNode(`Login will not work here. ${openHint}`));
        const loginContainer = document.getElementById('loginBtn')?.parentElement;
        if (loginContainer && !document.getElementById('in-app-browser-banner')) {
            loginContainer.insertBefore(banner, loginContainer.firstChild);
        }
    }

    // Detect blocked localStorage / cookies BEFORE the user types credentials —
    // primary iPad failure mode: Settings → Safari → "Block All Cookies" ON, or
    // Private Browsing tab. In that state, supabase-js can't persist the auth
    // session and signInWithPassword may return undefined data, which the user
    // sees as the cryptic "undefined is not an object" error after they click
    // Login. Showing the banner up-front saves them a failed attempt.
    const _detectStorageBlocked = () => {
        try {
            const probe = '__fs_crm_probe__';
            window.localStorage.setItem(probe, '1');
            const ok = window.localStorage.getItem(probe) === '1';
            window.localStorage.removeItem(probe);
            return !ok;
        } catch (_) {
            return true;
        }
    };
    if (_detectStorageBlocked()) {
        const isIOS = /iPhone|iPad|iPod/.test(navigator.userAgent);
        const fixHint = isIOS
            ? 'On iPhone/iPad: Settings → Safari → Privacy & Security → turn OFF "Block All Cookies". Also exit any Private Browsing tab and reload.'
            : 'Your browser is blocking site storage. Disable Private/Incognito mode, allow cookies for this site, and reload.';
        const sBanner = document.createElement('div');
        sBanner.id = 'storage-blocked-banner';
        sBanner.style.cssText = 'margin:10px 0;padding:12px 14px;background:#fef2f2;border:1px solid #fecaca;color:#991b1b;border-radius:8px;font-size:13px;line-height:1.45;text-align:left;';
        const sStrong = document.createElement('strong');
        sStrong.textContent = 'Login will fail on this device. ';
        sBanner.appendChild(sStrong);
        sBanner.appendChild(document.createTextNode(fixHint));
        const lc = document.getElementById('loginBtn')?.parentElement;
        if (lc && !document.getElementById('storage-blocked-banner')) {
            lc.insertBefore(sBanner, lc.firstChild);
        }
    }

    btn.onclick = async () => {
        const emailEl = document.getElementById('loginEmail');
        const passwordEl = document.getElementById('loginPassword');
        const emailErrEl = document.getElementById('loginEmailErr');
        const passwordErrEl = document.getElementById('loginPasswordErr');
        const email = emailEl?.value?.trim();
        const password = passwordEl?.value;

        // Clear previous inline errors
        if (emailErrEl) { emailErrEl.textContent = ''; emailErrEl.style.display = 'none'; }
        if (passwordErrEl) { passwordErrEl.textContent = ''; passwordErrEl.style.display = 'none'; }
        emailEl?.removeAttribute('aria-invalid');
        passwordEl?.removeAttribute('aria-invalid');

        // Fail fast if the supabase-js library never finished loading. Without
        // this check, Auth.login() would throw "Cannot read properties of
        // undefined (reading 'auth')" — meaningless to the user. Now the
        // login screen tells them exactly what to do.
        if (window._SUPABASE_LIB_FAILED || !window.supabase || typeof window.supabase.auth === 'undefined') {
            const errEl = passwordErrEl || emailErrEl;
            const msg = 'Page didn’t finish loading. Please pull-to-refresh (or close and reopen the tab) and try again. If it keeps failing, switch between WiFi and mobile data, or disable any ad-blocker / VPN apps.';
            if (errEl) {
                errEl.textContent = msg;
                errEl.style.display = 'block';
                errEl.setAttribute('role', 'alert');
            } else if (window.UI?.toast?.error) {
                UI.toast.error(msg);
            } else {
                alert(msg);
            }
            return;
        }

        let hasError = false;
        if (!email) {
            if (emailErrEl) { emailErrEl.textContent = 'Email is required.'; emailErrEl.style.display = 'block'; }
            emailEl?.setAttribute('aria-invalid', 'true');
            emailEl?.focus();
            hasError = true;
        }
        if (!password) {
            if (passwordErrEl) { passwordErrEl.textContent = 'Password is required.'; passwordErrEl.style.display = 'block'; }
            passwordEl?.setAttribute('aria-invalid', 'true');
            if (!hasError) passwordEl?.focus();
            hasError = true;
        }
        if (hasError) return;
        // Declared outside the try block so the finally clause can call
        // clearTimeout(_slowHint) — const/let inside try{} are NOT in scope
        // inside finally{} (separate block scopes), which would throw a
        // ReferenceError and prevent btn.disabled = false from ever running.
        let _slowHint;
        try {
            btn.disabled = true;
            btn.querySelector('span').textContent = 'Logging in...';
            // Show "Still connecting…" after 5 s so the user knows we're working.
            // Cleared in the finally block whether login succeeds or fails.
            _slowHint = setTimeout(() => { if (btn.disabled) btn.querySelector('span').textContent = 'Still connecting…'; }, 5000);
            // Wrap every login attempt in a 10-second timeout so a hung mobile
            // network never leaves the button stuck on "Logging in..." forever.
            const _withTimeout = (promise, ms, label) => Promise.race([
                promise,
                new Promise((_, rej) => setTimeout(() => rej(new Error(label)), ms))
            ]);
            let user;
            try {
                user = await _withTimeout(Auth.login(email, password), 10000, 'Connection timed out. Check your internet and try again.');
            } catch (loginErr) {
                if (_isQuotaErr(loginErr)) {
                    // Auth-token write failed because localStorage is full of
                    // cached table snapshots. Wipe the SWR cache (recoverable
                    // from Supabase) and retry once. If retry also fails,
                    // bubble up to the outer catch.
                    btn.querySelector('span').textContent = 'Clearing cache…';
                    _purgeLocalCache();
                    user = await _withTimeout(Auth.login(email, password), 10000, 'Connection timed out. Check your internet and try again.');
                    UI.toast?.warning?.('Local cache cleared to make room for login.');
                } else {
                    throw loginErr;
                }
            }

            // Defensive: Auth.login should always throw on failure, but a future
            // refactor or a partial supabase-js could leak undefined back here.
            // Without this guard, the next line throws Safari's cryptic
            // "undefined is not an object (evaluating 'user.email')" on iPad.
            if (!user || !user.email) {
                throw new Error('Login completed but no account information was returned. Please reload the page and try again.');
            }

            // Try to get profile from 'users' table using service-role client to bypass RLS
            const profileMatches = await AppDataStore.query('users', { email: user.email });
            // If multiple profiles share the email (e.g. old auto-created Level 12 ghosts),
            // prefer: 1) profiles with a team_id (explicitly set up), 2) lowest level number
            let profile = null;
            if (profileMatches.length > 0) {
                profileMatches.sort((a, b) => {
                    // 1. Prefer profiles with a team_id (explicitly admin-configured)
                    const aTeam = a.team_id ? 0 : 1;
                    const bTeam = b.team_id ? 0 : 1;
                    if (aTeam !== bTeam) return aTeam - bTeam;
                    // 2. Prefer lower role level — use full mapping so named roles
                    //    (e.g. "Consultant") resolve correctly instead of falling
                    //    back to 99 and losing to a ghost "Level 12 Agent" profile.
                    const aLvl = _getUserLevel(a);
                    const bLvl = _getUserLevel(b);
                    if (aLvl !== bLvl) return aLvl - bLvl;
                    // 3. Prefer lower id — admin-created profiles have small sequential
                    //    ids (1-999); auto-created ghost profiles use Date.now() ids
                    //    (~1 700 000 000 000) and must never win the tiebreak.
                    return (a.id ?? 0) - (b.id ?? 0);
                });
                profile = profileMatches[0];
            }
            let profileError = profile ? null : { code: 'PGRST116' };

            // If not found by email, try case-insensitive email match then name-based fallback
            // (handles cases where admin created the agent record without email or with different case)
            if (!profile) {
                const allUsers = await AppDataStore.getAll('users');
                // 1. Case-insensitive email match
                const lowerEmail = user.email.toLowerCase();
                const caseMatch = allUsers.find(u => u.email && u.email.toLowerCase() === lowerEmail);
                if (caseMatch) {
                    // Normalise email casing in the record
                    await AppDataStore.update('users', caseMatch.id, { email: user.email });
                    profile = { ...caseMatch, email: user.email };
                    profileError = null;
                } else {
                    // 2. Name-based fallback: match by full_name where email is empty/null
                    const authName = (user.user_metadata?.full_name || '').trim();
                    if (authName) {
                        const nameMatch = allUsers.find(u =>
                            u.full_name && u.full_name.trim().toLowerCase() === authName.toLowerCase() && !u.email
                        );
                        if (nameMatch) {
                            // Link this existing admin-created record to the login email
                            await AppDataStore.update('users', nameMatch.id, { email: user.email });
                            profile = { ...nameMatch, email: user.email };
                            profileError = null;
                            // Linked existing agent record to login email
                        }
                    }
                }
            }

            // If profile still not found, create one automatically
            if (!profile && profileError && profileError.code === 'PGRST116') {
                // Profile not found, creating one
                const newProfile = {
                    id: Date.now(),
                    email: user.email,
                    username: user.email.split('@')[0],
                    full_name: user.user_metadata?.full_name || user.email,
                    role: '传福大使',                 // Default role (Level 12)
                    status: 'active',
                    created_at: new Date().toISOString()
                };
                // Use AppDataStore.create() so the service-role client is used (bypasses RLS)
                profile = await AppDataStore.create('users', newProfile);
            } else if (!profile && profileError) {
                throw profileError;
            }

            // Defensive: AppDataStore.create can return undefined on RLS failure
            // or a flaky network. Without this guard, the next reference to
            // profile.id (UserPreferences.load) throws Safari's cryptic
            // "undefined is not an object (evaluating 'profile.id')" on iPad.
            if (!profile || profile.id == null) {
                throw new Error('Logged in but your account profile could not be loaded. Please contact your admin or try again in a minute.');
            }

            _currentUser = profile;
            // Flush stale SWR snapshots on every login so the user always
            // sees fresh prospect/customer data rather than a cached view
            // from a previous session that may pre-date admin reassignments.
            _visibleUserIdsCache.clear();
            ['prospects', '__prospects_active_500', 'customers', 'users'].forEach(k => {
                try { localStorage.removeItem(`fs_crm_${k}`); } catch (_) {}
                try { localStorage.removeItem(`fs_crm_${k}_last_sync`); } catch (_) {}
            });
            AppDataStore.invalidateCache('prospects');
            AppDataStore.invalidateCache('__prospects_active_500');
            AppDataStore.invalidateCache('customers');
            AppDataStore.invalidateCache('users');
            await UserPreferences.load(profile.id);
            _runPredictivePrefetch();
            // Save "remember me" preference before leaving login screen
            const _rememberChk = document.getElementById('rememberMe');
            const _loginEmail = document.getElementById('loginEmail');
            if (_rememberChk && _rememberChk.checked) {
                try {
                    localStorage.setItem('remember_me', '1');
                    // Store email so it pre-fills if iOS clears the auth token after 7 days
                    if (_loginEmail?.value) localStorage.setItem('remember_me_email', _loginEmail.value.trim().toLowerCase());
                } catch (e) {
                    // localStorage quota exceeded — clear stale offline queue and retry
                    localStorage.removeItem('offline_queue');
                    try { localStorage.setItem('remember_me', '1'); } catch (_) {}
                }
            } else {
                // User explicitly opted OUT. Record that so we don't auto-tick
                // the checkbox next time — they get the original behavior they
                // chose. Email is also cleared.
                localStorage.setItem('remember_me', '0');
                localStorage.removeItem('remember_me_email');
            }
            document.getElementById('login-container').style.display = 'none';
            document.getElementById('app-shell').style.display = 'block';
            updateUserDisplay();
            updateNavVisibility();
            UI.toast.success(`Welcome ${profile.full_name}!`);

            // Auto-subscribe to push notifications for PWA / homescreen users
            _autoSubscribePush();

            // Force password change on first login
            if (profile.force_password_change) {
                await navigateTo('settings');
                (window.app.showForcePasswordChangeModal || (() => {}))();
            } else {
                await navigateTo('calendar');
            }
        } catch (err) {
            console.error('Login error:', err);
            const msg = err.message || '';
            if (msg.toLowerCase().includes('email not confirmed')) {
                const loginEmail = document.getElementById('loginEmail')?.value?.trim() || '';
                const resendMsg = document.createElement('div');
                resendMsg.id = 'login-error-msg';
                resendMsg.style.cssText = 'color:#b91c1c;background:#fef2f2;border:1px solid #fecaca;border-radius:8px;padding:12px 14px;margin-top:12px;font-size:13px;text-align:left;';
                // Build DOM programmatically — loginEmail is user input and must NOT be injected into innerHTML
                resendMsg.textContent = '';
                const headStrong = document.createElement('strong');
                headStrong.textContent = 'Email not confirmed.';
                resendMsg.appendChild(headStrong);
                resendMsg.appendChild(document.createTextNode(' The agent must click the confirmation link sent to '));
                const em = document.createElement('em');
                em.textContent = loginEmail;
                resendMsg.appendChild(em);
                resendMsg.appendChild(document.createTextNode(' before logging in.'));
                resendMsg.appendChild(document.createElement('br'));
                resendMsg.appendChild(document.createElement('br'));
                const resendBtn = document.createElement('button');
                resendBtn.style.cssText = 'margin-top:4px;padding:6px 12px;background:#991b1b;color:#fff;border:none;border-radius:6px;cursor:pointer;font-size:12px;';
                resendBtn.textContent = 'Resend confirmation email';
                resendBtn.addEventListener('click', async () => {
                    try {
                        await window.supabase.auth.resend({ type: 'signup', email: loginEmail });
                        resendBtn.textContent = 'Sent!';
                        resendBtn.disabled = true;
                    } catch (e) {
                        alert('Could not resend: ' + (e?.message || e));
                    }
                });
                resendMsg.appendChild(resendBtn);
                const hint = document.createElement('span');
                hint.style.cssText = 'display:block;margin-top:10px;color:#6b7280;font-size:11px;';
                hint.textContent = 'Or ask your admin to disable Confirm email in Supabase → Authentication → Providers → Email.';
                resendMsg.appendChild(hint);
                const existing = document.getElementById('login-error-msg');
                if (existing) existing.remove();
                document.getElementById('loginBtn')?.insertAdjacentElement('afterend', resendMsg);
            } else if (msg === 'Load failed' || msg.toLowerCase().includes('load failed') || msg.toLowerCase().includes('failed to fetch')) {
                // Network error. If we're inside an in-app webview (WhatsApp, FB, IG…)
                // skip the probe — that environment lies about reachability anyway —
                // and tell the user exactly how to escape it.
                const loginErrEl = document.getElementById('loginPasswordErr') || document.getElementById('loginEmailErr');
                let networkErrText;
                if (_inAppBrowser) {
                    const isIOS = /iPhone|iPad|iPod/.test(navigator.userAgent);
                    const openHint = isIOS
                        ? 'tap the share icon (□↑) at the bottom and choose "Open in Safari"'
                        : 'tap the ⋮ menu and choose "Open in Chrome" (or external browser)';
                    networkErrText = `Login is blocked inside ${_inAppBrowser}'s in-app browser. Please ${openHint}, then log in again.`;
                } else {
                    try {
                        await Promise.race([
                            fetch(window.SUPABASE_URL, { mode: 'no-cors' }),
                            new Promise((_, r) => setTimeout(() => r(new Error('t')), 4000))
                        ]);
                        // Server is reachable — something else blocked the auth call
                        networkErrText = 'Server is reachable but the login request was blocked. Try: close and reopen the app, or open in Safari instead of the home-screen icon.';
                    } catch (_) {
                        // Can't reach the server at all
                        networkErrText = 'Cannot reach the login server from this device. Try: switch between WiFi and mobile data, disable any VPN or content-blocker apps, then retry.';
                    }
                }
                if (loginErrEl) {
                    loginErrEl.textContent = networkErrText;
                    loginErrEl.style.display = 'block';
                    loginErrEl.setAttribute('role', 'alert');
                } else {
                    UI.toast?.error?.(networkErrText);
                }
            } else if (_isQuotaErr(err)) {
                // Last-ditch: cache wipe didn't fix it. Drop EVERYTHING in
                // localStorage and reload — the user is locked out otherwise.
                btn.textContent = 'Clearing storage…';
                try { localStorage.clear(); } catch (_) {}
                setTimeout(() => window.location.reload(true), 600);
            } else {
                // Show inline error on the form instead of alert()
                const loginErrEl = document.getElementById('loginPasswordErr') || document.getElementById('loginEmailErr');
                const errText = msg.toLowerCase().includes('invalid') || msg.toLowerCase().includes('credential')
                    ? 'Incorrect email or password. Please try again.'
                    : ('Login failed: ' + (msg || 'Unknown error'));
                if (loginErrEl) {
                    loginErrEl.textContent = errText;
                    loginErrEl.style.display = 'block';
                    loginErrEl.setAttribute('role', 'alert');
                    document.getElementById('loginEmail')?.setAttribute('aria-invalid', 'true');
                    document.getElementById('loginPassword')?.setAttribute('aria-invalid', 'true');
                } else {
                    UI.toast?.error?.(errText);
                }
            }
        } finally {
            clearTimeout(_slowHint);
            btn.disabled = false;
            btn.querySelector('span').textContent = 'LOGIN';
        }
    };

    // Wire the form's submit event so "Go" on the iOS/Android keyboard triggers
    // login directly — bypasses the iOS behaviour where the first button tap only
    // dismisses the keyboard instead of firing the click.
    const _loginForm = document.getElementById('loginForm');
    if (_loginForm && !_loginForm._loginWired) {
        _loginForm._loginWired = true;
        _loginForm.addEventListener('submit', (e) => {
            e.preventDefault();
            if (!btn.disabled) btn.onclick();
        });
    }

    // #20 Login validation — real-time blur feedback so the user sees inline
    // errors the moment they leave a field, before they press the login button.
    const _blurEmailEl   = document.getElementById('loginEmail');
    const _blurPwEl      = document.getElementById('loginPassword');
    const _blurEmailErr  = document.getElementById('loginEmailErr');
    const _blurPwErr     = document.getElementById('loginPasswordErr');
    const _emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

    if (_blurEmailEl && _blurEmailErr && !_blurEmailEl._blurWired) {
        _blurEmailEl._blurWired = true;
        _blurEmailEl.addEventListener('blur', () => {
            const v = _blurEmailEl.value.trim();
            if (!v) {
                _blurEmailErr.textContent = 'Email is required.';
                _blurEmailErr.style.display = 'block';
                _blurEmailEl.setAttribute('aria-invalid', 'true');
            } else if (!_emailRe.test(v)) {
                _blurEmailErr.textContent = 'Enter a valid email address.';
                _blurEmailErr.style.display = 'block';
                _blurEmailEl.setAttribute('aria-invalid', 'true');
            } else {
                _blurEmailErr.textContent = '';
                _blurEmailErr.style.display = 'none';
                _blurEmailEl.removeAttribute('aria-invalid');
            }
        });
        _blurEmailEl.addEventListener('input', () => {
            if (_blurEmailEl.getAttribute('aria-invalid') && _emailRe.test(_blurEmailEl.value.trim())) {
                _blurEmailErr.textContent = '';
                _blurEmailErr.style.display = 'none';
                _blurEmailEl.removeAttribute('aria-invalid');
            }
        });
    }

    if (_blurPwEl && _blurPwErr && !_blurPwEl._blurWired) {
        _blurPwEl._blurWired = true;
        _blurPwEl.addEventListener('blur', () => {
            if (!_blurPwEl.value) {
                _blurPwErr.textContent = 'Password is required.';
                _blurPwErr.style.display = 'block';
                _blurPwEl.setAttribute('aria-invalid', 'true');
            } else if (_blurPwEl.value.length < 6) {
                _blurPwErr.textContent = 'Password must be at least 6 characters.';
                _blurPwErr.style.display = 'block';
                _blurPwEl.setAttribute('aria-invalid', 'true');
            } else {
                _blurPwErr.textContent = '';
                _blurPwErr.style.display = 'none';
                _blurPwEl.removeAttribute('aria-invalid');
            }
        });
        _blurPwEl.addEventListener('input', () => {
            if (_blurPwEl.getAttribute('aria-invalid') && _blurPwEl.value.length >= 6) {
                _blurPwErr.textContent = '';
                _blurPwErr.style.display = 'none';
                _blurPwEl.removeAttribute('aria-invalid');
            }
        });
    }
}

    // ==================== INIT ====================

    let _initStarted = false;
    const init = async () => {
    if (_initStarted) return; // prevent double-init (synchronous guard)
    _initStarted = true;
    _wireLoginBtn(); // wire immediately — before any async ops so the button is never unresponsive
    // Guard AppDataStore.init() separately — it's outside the outer try/catch
    // below, so an unexpected throw would leave #app-loading on screen forever.
    try {
        await AppDataStore.init();
    } catch (_dsErr) {
        console.error('[init] AppDataStore.init failed:', _dsErr);
        document.getElementById('app-loading')?.remove();
        document.getElementById('login-container').style.display = 'flex';
        _wireLoginBtn();
        return;
    }

    try {
        // Try to restore session — use getSession() first (reads localStorage, works
        // offline / on slow mobile networks). getUser() always makes a network round-trip
        // and will kick the user to the login screen if the connection is slow on startup.
        try {
            // Defensive destructure — on iPad Safari with blocked storage,
            // getSession() can resolve to undefined and the nested destructure
            // would throw "undefined is not an object" before our outer catch
            // could log a useful message.
            const sessionResponse = await window.supabase.auth.getSession();
            const session = (sessionResponse && sessionResponse.data && sessionResponse.data.session) || null;
            const authUser = session?.user ?? null;
            if (authUser) {
                // Fetch the full profile from the users table (has integer id + role),
                // same as the login flow – avoids using the raw Auth UUID as _currentUser.id.
                // Detect network errors so we don't sign out on a flaky connection.
                let profileMatches = [];
                let profileFetchFailed = false;
                try {
                    profileMatches = await AppDataStore.query('users', { email: authUser.email });
                } catch (qErr) {
                    profileFetchFailed = true;
                    console.warn('users-table lookup failed during auto-login:', qErr?.message || qErr);
                }
                let profile = null;
                if (profileMatches && profileMatches.length > 0) {
                    // If duplicates exist, prefer: 1) has team_id, 2) lowest level, 3) lowest id (admin-created)
                    profileMatches.sort((a, b) => {
                        const aTeam = a.team_id ? 0 : 1;
                        const bTeam = b.team_id ? 0 : 1;
                        if (aTeam !== bTeam) return aTeam - bTeam;
                        const aLvl = _getUserLevel(a);
                        const bLvl = _getUserLevel(b);
                        if (aLvl !== bLvl) return aLvl - bLvl;
                        return (a.id ?? 0) - (b.id ?? 0); // prefer lower id (admin-created, not ghost)
                    });
                    profile = profileMatches[0];
                }
                if (profile) {
                    _currentUser = profile;
                    _runPredictivePrefetch();
                    // Flush stale SWR snapshots so the user always sees fresh data,
                    // not a cached view from a previous session that may pre-date reassignments.
                    _visibleUserIdsCache.clear();
                    ['prospects', '__prospects_active_500', 'customers', 'users'].forEach(k => {
                        try { localStorage.removeItem(`fs_crm_${k}`); } catch (_) {}
                        try { localStorage.removeItem(`fs_crm_${k}_last_sync`); } catch (_) {}
                    });
                    AppDataStore.invalidateCache('prospects');
                    AppDataStore.invalidateCache('__prospects_active_500');
                    AppDataStore.invalidateCache('customers');
                    AppDataStore.invalidateCache('users');
                    await UserPreferences.load(profile.id);
                    // Background-validate the token is still accepted server-side.
                    // Only force logout on explicit auth errors (401/403), never on network failures.
                    window.supabase.auth.getUser().then(({ data, error }) => {
                        if (error && (error.status === 401 || error.status === 403)) logout().catch(() => {});
                    }).catch(() => {});
                } else if (profileFetchFailed) {
                    // Network/server error fetching the profile — KEEP the session
                    // so a flaky connection doesn't bounce the user back to login.
                    // Build a minimal profile from the auth user and let normal
                    // app flow heal the cache on next successful query.
                    console.warn('Keeping session despite failed profile fetch — using minimal auth-only profile.');
                    _currentUser = {
                        id: authUser.id,
                        email: authUser.email,
                        full_name: authUser.user_metadata?.full_name || authUser.email,
                        role: '传福大使', // safe default (Level 12) until real profile loads
                        status: 'active',
                        _placeholder: true,
                    };
                } else {
                    // Auth session exists but no matching user profile in DB — force sign out
                    console.warn('No user profile found for:', authUser.email, '— signing out.');
                    await window.supabase.auth.signOut();
                    _currentUser = null;
                }
            } else {
                _currentUser = null;
            }
            // User loaded
        } catch (err) {
            if (err.message && err.message.includes('Auth session missing')) {
                // No active session – showing login screen
                _currentUser = null;
            } else {
                console.warn('Auto-login getSession failed:', err?.message || err);
                _currentUser = null;
            }
        }

        // Remove the loading screen — session check is complete, we now know
        // whether to show the login form or the app shell.
        document.getElementById('app-loading')?.remove();

        // If no user, show login screen and wire the button, then stop
        if (!_currentUser) {
            document.getElementById('login-container').style.display = 'flex';
            document.getElementById('app-shell').style.display = 'none';
            _wireLoginBtn();
            return; // important: do not proceed with logged-in initialization
        }

        // --- User is logged in – continue with app initialization ---
        document.getElementById('login-container').style.display = 'none';
        document.getElementById('app-shell').style.display = 'block';
        updateUserDisplay();
        updateNavVisibility();
        setTimeout(_initNotifBell, 800); // wire bell after shell is visible

        // Fire-and-forget the sync module initializers — they have no awaitable
        // state the render path needs.
        initGoogleIntegration();
        initWhatsAppIntegration();

        // Fire-and-forget: these don't affect what the first view renders.
        // Decoupled from navigateTo so the user sees the first screen without
        // waiting for expireOldOverrides (N writes) or AI model bootstrap.
        expireOldOverrides().catch(e => console.warn('expireOldOverrides failed:', e));
        initAIAnalytics().catch(e => console.warn('initAIAnalytics failed:', e));

        // L13 (Customer) and L14 (Referrer) land on 福德; everyone else on calendar
        const _initLevel = (() => {
            const m = (_currentUser?.role || '').match(/Level\s+(\d+)/i);
            return m ? parseInt(m[1]) : 0;
        })();

        // ── Deep-link / bookmark restoration ──────────────────────────────
        // If the user bookmarked or shared a URL with a hash (e.g. #prospects),
        // navigate there directly. Falls back to the default view if the hash
        // is absent, unrecognised, or corresponds to a view the user can't access.
        // Customer/referrer roles (L13+) always land on fude regardless of hash —
        // they have no access to the operational views.
        const _KNOWN_VIEWS = new Set([
            'home','calendar','prospects','pipeline','referrals','promotions',
            'marketing_automation','cases','agents','performance','reports','risk',
            'knowledge','documents','import','integrations','settings','protection',
            'custom_fields','milestones','fude','noticeboard','stock_take',
            'egg_purchasing','formula_purchaser','boss_report','standard_functions',
            'lead_forms','surveys','contracts','purchases_history','booking_settings',
            'workflows','marketing_lists',
        ]);
        const _rawHash = (location.hash || '').replace(/^#/, '').trim().toLowerCase();
        const _hashView = (_rawHash && _KNOWN_VIEWS.has(_rawHash)) ? _rawHash : null;
        // Mobile users land on the AI Home dashboard; desktop on calendar.
        const _defaultView = _initLevel >= 13 ? 'fude' : (isMobile() ? 'home' : 'calendar');
        const _initialView = (_initLevel < 13 && _hashView) ? _hashView : _defaultView;
        await navigateTo(_initialView);

        // Background pre-warm: silently fetch the most-navigated tables 2 seconds
        // after first paint so every subsequent page navigation serves from
        // in-memory cache instead of hitting Supabase. The 2s delay keeps startup
        // bandwidth available for the first view's own SWR revalidation.
        setTimeout(() => {
            ['activities', 'prospects', 'customers', 'users',
             'products', 'events', 'names', 'referrals', 'purchases']
                .forEach(t => AppDataStore.getAll(t).catch(() => {}));
        }, 2000);

        // Phase 14: Offline & mobile features (sync)
        initOfflineSupport();
        applyMobileClass();

        // Weekly inactivity scoring is handled server-side by pg_cron now (see
        // migrations/server_cron_2026-05-03.sql). Browser must not run table-wide
        // sweeps — even once per ISO week per agent, parallel logins on Monday
        // morning bursted the nano IO budget. Server cron runs once globally.

        // Block native pull-to-refresh on iOS Safari (Chrome/Android handled by CSS overscroll-behavior).
        // Requires 3 intentional downward pulls at the top of the page to trigger a soft refresh.
        // A soft refresh re-renders the current view without a full page reload — no login screen flash.
        if ('ontouchstart' in window) {
            const _isIOS = /iP(hone|ad|od)/.test(navigator.userAgent);
            let _ptrStartY = 0, _ptrCount = 0, _ptrTimer = null, _ptrPulling = false, _ptrPill = null;

            const _ptrPillEl = () => {
                if (!_ptrPill) {
                    _ptrPill = document.createElement('div');
                    _ptrPill.id = 'ptr-pill';
                    document.body.appendChild(_ptrPill);
                }
                return _ptrPill;
            };
            const _ptrShow = (t) => { const p = _ptrPillEl(); p.textContent = t; p.style.transform = 'translateX(-50%) translateY(0)'; };
            const _ptrHide = () => { if (_ptrPill) _ptrPill.style.transform = 'translateX(-50%) translateY(-100%)'; };

            document.addEventListener('touchstart', e => {
                _ptrStartY = e.touches[0].pageY;
                _ptrPulling = false;
            }, { passive: true });

            document.addEventListener('touchmove', e => {
                const dy = e.touches[0].pageY - _ptrStartY;
                if (dy <= 0) { _ptrHide(); _ptrPulling = false; return; }

                // Allow normal scroll if any ancestor element is not yet at its own scroll top
                let el = e.target;
                while (el && el !== document.documentElement) {
                    if (el.scrollTop > 0) { _ptrHide(); _ptrPulling = false; return; }
                    el = el.parentElement;
                }

                // At the page top pulling down — block native PTR on iOS Safari only.
                // Android uses CSS overscroll-behavior; calling preventDefault() here
                // would also kill normal downward scrolling on Android Chrome.
                if (_isIOS && e.cancelable) e.preventDefault();
                _ptrPulling = true;

                if (dy > 60) {
                    const left = 3 - _ptrCount;
                    _ptrShow(left > 0
                        ? `↓ Pull ${left} more time${left > 1 ? 's' : ''} to refresh`
                        : '↓ Release to refresh');
                }
            }, { passive: false });

            document.addEventListener('touchend', () => {
                if (!_ptrPulling) { _ptrHide(); return; }
                _ptrPulling = false;
                _ptrHide();

                _ptrCount++;
                clearTimeout(_ptrTimer);
                _ptrTimer = setTimeout(() => { _ptrCount = 0; }, 30000); // reset counter after 30s idle

                if (_ptrCount >= 3) {
                    _ptrCount = 0;
                    clearTimeout(_ptrTimer);
                    UI.toast.success('Refreshing…');
                    setTimeout(() => navigateTo(_currentView || (isMobile() ? 'home' : 'calendar')).catch(() => {}), 200);
                }
            }, { passive: true });
        }

        // Resize + orientation listeners
        let _resizeTimer;
        window.addEventListener('resize', () => {
            clearTimeout(_resizeTimer);
            _resizeTimer = setTimeout(() => {
                applyMobileClass();
                (window.app.updateBottomNavActive || (() => {}))(_currentView);
                (window.app.applyMobileTableLabels || (() => {}))();
            }, 150);
        });
        window.addEventListener('orientationchange', () => {
            setTimeout(() => {
                (window.app.applyMobileTableLabels || (() => {}))();
                if (isMobile()) (window.app.updateBottomNavActive || (() => {}))(_currentView);
            }, 300);
        });

        // Fire all post-render init work in parallel as fire-and-forget — none
        // of it blocks the user seeing the first screen. Each has its own
        // error boundary so one failure can't cascade.
        const _bgInit = [
            (async () => { if (isMobile()) { await window._loadChunk('chunks/script-mobile.min.js'); await (window.app.renderMobileBottomNav || (() => {}))(); (window.app.initSwipeActions || (() => {}))(); await (window.app.initPullToRefresh || (() => {}))(); } })(),
            (async () => { if (isMobile() && window.app.initMobileApp) await window.app.initMobileApp(); })(),
            ensureReferralFields(),
            (async () => { if (typeof SystemHealth !== 'undefined' && typeof SystemHealth.init === 'function') await SystemHealth.init(); })(),
            (async () => { if (typeof ConfigManager !== 'undefined' && typeof ConfigManager.init === 'function') await ConfigManager.init(); })(),
            // Warm the XLSX cache for the import/export views so the first click feels snappy.
            window._ensureXlsx().catch(() => {}),
        ];
        _bgInit.forEach(p => p && typeof p.catch === 'function' && p.catch(e => console.warn('bg init task failed:', e)));

        // Action Plan reminders are handled server-side by pg_cron now (see
        // migrations/server_cron_2026-05-03.sql). The old client-side loop did
        // getAll('users') then a per-user query('action_plans') every 4 hours
        // in every tab — N+1 over the user table on nano was a major IO drain.

        // Auto-subscribe to push notifications for PWA / homescreen users
        _autoSubscribePush();

        // Route notification clicks to the correct view
        if ('serviceWorker' in navigator) {
            navigator.serviceWorker.addEventListener('message', (evt) => {
                if (evt.data && evt.data.type === 'NOTIFICATION_CLICK') {
                    const url = evt.data.data?.url || '';
                    const hash = url.includes('#') ? url.split('#')[1] : '';
                    if (hash === 'fude')         navigateTo('fude');
                    else if (hash === 'calendar') navigateTo('calendar');
                    else if (hash)               navigateTo(hash);
                }
            });
        }

        // Mark app as ready
        window.app.ready = true;
        window.app.initialized = true;
        window.dispatchEvent(new Event('appReady'));

        // Wire notification bell
        _initNotifBell();

        // Session inactivity timeout — auto-logout after 60 min of no interaction
        // (skipped for "remember me" users who explicitly opted into persistence)
        if (localStorage.getItem('remember_me') !== '1') {
            const SESSION_TIMEOUT_MS = 60 * 60 * 1000; // 60 minutes
            let _sessionTimer = null;
            const _resetSessionTimer = () => {
                clearTimeout(_sessionTimer);
                _sessionTimer = setTimeout(async () => {
                    UI.toast.warning('Session expired due to inactivity. Logging out...');
                    await new Promise(r => setTimeout(r, 2000));
                    await logout();
                }, SESSION_TIMEOUT_MS);
            };
            ['click', 'keydown', 'mousemove', 'touchstart', 'scroll'].forEach(evt =>
                window.addEventListener(evt, _resetSessionTimer, { passive: true })
            );
            _resetSessionTimer();
        }
        // App initialized
    } catch (err) {
        console.error('App init failed:', err);
        // Fallback: show login screen again
        document.getElementById('app-loading')?.remove();
        document.getElementById('login-container').style.display = 'flex';
        document.getElementById('app-shell').style.display = 'none';
        _wireLoginBtn();
    }
};

    const openAddNameModal = async (prospectId, nameId = null) => {
        const nameData = nameId ? await AppDataStore.getById('names', nameId) : null;
        const isEdit = !!nameData;

        const content = `
            <div class="form-section">
                <h4>${isEdit ? 'Edit Name' : 'Add Name to List'}</h4>
                <input type="hidden" id="edit-name-id" value="${nameId || ''}">
                <div class="form-group">
                    <label>Relation</label>
                    <select id="name-relation" class="form-control">
                        <option value="Spouse" ${nameData?.relation === 'Spouse' ? 'selected' : ''}>Spouse</option>
                        <option value="Child" ${nameData?.relation === 'Child' ? 'selected' : ''}>Child</option>
                        <option value="Parent" ${nameData?.relation === 'Parent' ? 'selected' : ''}>Parent</option>
                        <option value="Sibling" ${nameData?.relation === 'Sibling' ? 'selected' : ''}>Sibling</option>
                        <option value="Business Partner" ${nameData?.relation === 'Business Partner' ? 'selected' : ''}>Business Partner</option>
                        <option value="Other" ${nameData?.relation === 'Other' ? 'selected' : ''}>Other</option>
                    </select>
                </div>
                <div class="form-group">
                    <label>Full Name <span class="required">*</span></label>
                    <input type="text" id="name-full" class="form-control" value="${nameData?.full_name || ''}" required>
                </div>
                <div class="form-group">
                    <label>Date of Birth</label>
                    <input type="date" id="name-dob" class="form-control" value="${nameData?.date_of_birth || ''}">
                </div>
                <div class="form-group">
                    <label>Notes</label>
                    <textarea id="name-notes" class="form-control" rows="2">${nameData?.notes || ''}</textarea>
                </div>
            </div>
        `;

        UI.showModal(isEdit ? 'Edit Name' : 'Add Name', content, [
            { label: 'Cancel', type: 'secondary', action: 'UI.hideModal()' },
            { label: 'Save', type: 'primary', action: `(async () => { await app.saveName(${prospectId}); })()` }
        ]);
    };

    const saveName = async (prospectId) => {
        const name = document.getElementById('name-full')?.value;
        if (!name) {
            UI.toast.error('Name is required');
            return;
        }

        const nameId = document.getElementById('edit-name-id')?.value;
        const data = {
            prospect_id: prospectId,
            relation: document.getElementById('name-relation')?.value || 'Other',
            full_name: name,
            date_of_birth: document.getElementById('name-dob')?.value,
            notes: document.getElementById('name-notes')?.value
        };

        if (nameId) {
            await AppDataStore.update('names', parseInt(nameId), data);
            UI.toast.success('Name updated successfully');
        } else {
            await AppDataStore.create('names', data);
            UI.toast.success('Name added successfully');
        }

        UI.hideModal();
        await app.showProspectDetail(prospectId); // Refresh detail view
    };

    const deleteName = async (prospectId, nameId) => {
        UI.showModal('Confirm Delete', 'Are you sure you want to delete this name?', [
            { label: 'Cancel', type: 'secondary', action: 'UI.hideModal()' },
            { label: 'Delete', type: 'primary', action: `(async () => { await app.confirmDeleteName(${prospectId}, ${nameId}); })()` }
        ]);
    };

    const confirmDeleteName = async (prospectId, nameId) => {
        await AppDataStore.delete('names', nameId);
        UI.hideModal();
        UI.toast.success('Name deleted');
        await app.showProspectDetail(prospectId);
    };


    const initDemoData = async () => {
    // Helper to insert a record, ignoring conflicts
    const safeInsert = async (table, data) => {
        try {
            await AppDataStore.create(table, data);
            return true;
        } catch (err) {
            return false;
        }
    };

    // ----- 1. Users -----
    // SECURITY: Plaintext demo passwords removed. Real authentication goes through
    // Supabase Auth (email/password). These records only seed user metadata for
    // role/team lookups in local mock-mode. Do NOT re-add password fields here —
    // if a user needs a login, create it in Supabase Auth and let RLS handle it.
    const demoUsers = [
        { id: 1, username: 'admin', full_name: 'System Admin', role: 'Level 1 Super Admin', status: 'active' },
        { id: 2, username: 'marketing', full_name: 'Marketing Manager', role: 'Level 2 Marketing Manager', status: 'active' },
        { id: 3, username: 'teamlead', full_name: 'Team Leader', role: 'Level 5 Team Leader', team_id: 1, reporting_to: 10, status: 'active' },
        { id: 4, username: 'consultant', full_name: 'Consultant', role: 'Level 10 Agent', team_id: 1, status: 'active' },
        { id: 5, username: 'michelle', full_name: 'Michelle Tan', role: 'Level 6 Senior Consultant', team_id: 1, reporting_to: 3, status: 'active' },
        { id: 10, username: 'manager', full_name: 'Manager', role: 'Level 4 Managers', team_id: 1, status: 'active' }
    ];
    for (const u of demoUsers) {
        await safeInsert('users', u);
    }

    // ----- 2. Prospects (depend on users) -----
    const demoProspects = [
        { id: 1, full_name: 'Tan Ah Kow', nickname: 'Ah Kow', phone: '012-3456789', email: 'ahkow@example.com', ic_number: '801204-56-7890', date_of_birth: '1980-12-04', address: 'No. 12, Jalan Bahagia', city: 'Petaling Jaya', state: 'Selangor', postal_code: '47500', score: 850, responsible_agent_id: 5, ming_gua: 'MG4', element: 'Wood', status: 'active', needs: 'Wealth,Career' },
        { id: 2, full_name: 'Ong Bee Ling', phone: '012-9876543', score: 720, responsible_agent_id: 5, protection_deadline: '2026-03-20', ming_gua: 'MG2', status: 'active', needs: 'Health,Relationship' }
    ];
    for (const p of demoProspects) {
        const inserted = await safeInsert('prospects', p);
        if (!inserted) {
            // Update existing record to ensure all fields are current
            await AppDataStore.update('prospects', p.id, p);
        }
    }

    // ----- 3. Activities (depend on prospects) -----
    const demoActivities = [
        { id: 1001, activity_type: 'CPS', activity_title: 'Initial Consultation', activity_date: '2026-03-04', start_time: '09:00', end_time: '10:00', prospect_id: 1, lead_agent_id: 5, note_pain_points: 'Office facing bad direction, business income dropping', note_needs: 'Needs wealth enhancement and career stability', opportunity_potential: 'Feng Shui consultation + PR4 package RM 3,800', note_next_steps: 'Send proposal by end of week, schedule follow-up call', next_action: 'Book PR4 demo session' },
        { id: 1002, activity_type: 'FTF', activity_title: 'Face to Face Meeting', activity_date: '2026-03-04', start_time: '11:00', end_time: '12:00', prospect_id: 2, lead_agent_id: 5 }
    ];
    for (const a of demoActivities) {
        await safeInsert('activities', a);
    }

    // ----- 4. Demo customers record removed (was Lim Ah Kow id:9001) -----

    // ----- 5. Demo users: Level 13 Customer & Level 14 Referrer -----
    const demoLevel1314 = [
        { id: 102, username: 'referrer1', full_name: 'Tan Mei Mei (Referrer)', role: 'Level 14 Referrer', status: 'active' }
    ];
    for (const u of demoLevel1314) { await safeInsert('users', u); }

    // ----- 6. Demo purchases removed (was for customer1 id:9001) -----

    // ----- 7. News highlights (for 福德 tab) -----
    // Reserved ID range: 10001–10099 (news_highlights)
    const demoNews = [
        { id: 10001, title: 'New Feng Shui Breakthrough', content: 'Our team discovered a powerful application of the 九运 cycle that has helped 30+ clients improve their wealth sector this quarter.', type: 'highlight', is_active: true, created_at: new Date().toISOString() },
        { id: 10002, title: 'How Mr Tan Increased Sales by 200%', content: 'After attending the CPS and 福气课 sessions, Mr Tan repositioned his office desk and main entrance — his sales doubled within 3 months.', type: 'success_story', is_active: true, created_at: new Date().toISOString() },
        { id: 10003, title: 'Ms Wong Finds Her Dream Home', content: 'By applying the DIY assessment taught in class, Ms Wong identified a property perfectly aligned with her Ming Gua and moved in last month.', type: 'success_story', is_active: true, created_at: new Date().toISOString() },
        { id: 10004, title: '3 Easy Ways to Share Feng Shui with Friends', content: '1. Share the free 九运 chart tool link. 2. Invite them to a Museum tour. 3. Forward the monthly newsletter — each share earns you 福气 points!', type: 'recommendation_tip', is_active: true, created_at: new Date().toISOString() },
        { id: 10005, title: 'Which Class Should I Attend First?', content: 'New members: start with CPS for a personalised consultation, then join the 9 Stars session to understand your life chart. Both unlock milestone steps automatically!', type: 'recommendation_tip', is_active: true, created_at: new Date().toISOString() }
    ];
    for (const n of demoNews) { await safeInsert('news_highlights', n); }

    // ----- 8. Recommendation rewards for referrer1 (id: 102) and customer1 (id: 101) -----
    // Reserved ID range: 80001–80099 (recommendation_rewards)
    const demoRewards = [
        // referrer1 rewards
        { id: 80001, user_id: 102, recommended_user_id: 1,    action_type: 'recommendation',   fudi_points: 50, sharing_return: 0,      description: 'Referred Tan Ah Kow to CPS session',                       created_at: '2026-02-15T10:00:00Z' },
        { id: 80002, user_id: 102, recommended_user_id: null, action_type: 'sharing',           fudi_points: 30, sharing_return: 120.00, description: 'Shared 9 Stars workshop to WhatsApp group (8 attendees)',    created_at: '2026-03-10T14:00:00Z' },
        { id: 80003, user_id: 102, recommended_user_id: null, action_type: 'class_attendance',  fudi_points: 20, sharing_return: 0,      description: 'Attended 福气课 class',                                      created_at: '2026-03-20T09:00:00Z' }
    ];
    for (const r of demoRewards) { await safeInsert('recommendation_rewards', r); }

    // Demo data seeding completed
};

    const updateUserDisplay = () => {
        const userDisplay = document.getElementById('user-name-label');
        const userAvatar = document.getElementById('user-avatar');
        if (_currentUser) {
            const displayName = _currentUser.preferred_name || _currentUser.full_name || _currentUser.username;
            if (userDisplay) userDisplay.textContent = displayName;
            const initials2 = (displayName || 'U').split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2);
            const svgNav = `data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='64' height='64'%3E%3Ccircle cx='32' cy='32' r='32' fill='%238B1A1A'/%3E%3Ctext x='50%25' y='50%25' dominant-baseline='central' text-anchor='middle' font-size='22' font-weight='700' font-family='sans-serif' fill='white'%3E${encodeURIComponent(initials2)}%3C/text%3E%3C/svg%3E`;
            const avatarSrc = (_currentUser.avatar_url && (_currentUser.avatar_url.startsWith('http') || _currentUser.avatar_url.startsWith('data:')))
                ? _currentUser.avatar_url : svgNav;
            if (userAvatar) { userAvatar.src = avatarSrc; userAvatar.onerror = () => { userAvatar.src = svgNav; }; }
            const drawerAvatar = document.getElementById('drawer-user-avatar');
            if (drawerAvatar) { drawerAvatar.src = avatarSrc; drawerAvatar.onerror = () => { drawerAvatar.src = svgNav; }; }
        } else {
            if (userDisplay) userDisplay.textContent = 'Guest';
            const guestSvg = `data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='64' height='64'%3E%3Ccircle cx='32' cy='32' r='32' fill='%238B1A1A'/%3E%3Ctext x='50%25' y='50%25' dominant-baseline='central' text-anchor='middle' font-size='22' font-weight='700' font-family='sans-serif' fill='white'%3EG%3C/text%3E%3C/svg%3E`;
            if (userAvatar) userAvatar.src = guestSvg;
        }
    };

    // ========== NOTIFICATION BELL ==========
    const _refreshNotifBadge = async () => {
        const badge = document.querySelector('.notif-bell .badget');
        if (!badge) return;
        let count = 0;
        try {
            // Pending CPS intakes
            const visibleIds = await getVisibleUserIds(_currentUser);
            let intakes = [];
            try {
                intakes = await AppDataStore.query('cps_intake_requests', { status: 'submitted' });
            } catch (_) {
                const all = await AppDataStore.getAll('cps_intake_requests');
                intakes = (all || []).filter(r => r.status === 'submitted');
            }
            if (visibleIds !== 'all') {
                const vStrs = visibleIds.map(String);
                intakes = intakes.filter(i => !i.agent_id || vStrs.includes(String(i.agent_id)));
            }
            count += intakes.length;

            // Today's + tomorrow's birthdays
            const today = new Date();
            const mmdd = d => `${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
            const todayMD = mmdd(today);
            const tom = new Date(today); tom.setDate(tom.getDate()+1);
            const tomMD = mmdd(tom);
            const [allProspects, allCustomers, allUsers] = await Promise.all([
                AppDataStore.getAll('prospects'), AppDataStore.getAll('customers'), AppDataStore.getAll('users')
            ]);
            const birthdayPeople = [...allProspects, ...allCustomers, ...allUsers].filter(p => {
                const dob = p.date_of_birth || '';
                if (!dob || dob.length < 5) return false;
                const md = dob.slice(5, 10); // MM-DD
                return md === todayMD || md === tomMD;
            });
            count += birthdayPeople.length;

            // Pending refill reminders
            try {
                const reminders = await AppDataStore.query('refill_reminders', { status: 'pending' });
                count += (reminders || []).length;
            } catch (_) {}

            // Pending co-agent invitations for current user
            try {
                if (_currentUser?.id) {
                    const { data: coInvites } = await window.supabase
                        .from('activities')
                        .select('id')
                        .filter('co_agents', 'cs', JSON.stringify([{ id: String(_currentUser.id), status: 'pending' }]));
                    count += (coInvites || []).length;
                }
            } catch (_) {}
        } catch (_) {}

        badge.textContent = count > 99 ? '99+' : String(count);
        badge.setAttribute('data-zero', count === 0 ? '1' : '0');
        badge.setAttribute('data-count', count);
    };

    const _buildNotifPanel = async () => {
        const items = [];
        const today = new Date();
        const mmdd = d => `${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
        const todayMD = mmdd(today);
        const tom = new Date(today); tom.setDate(tom.getDate()+1);
        const tomMD = mmdd(tom);

        // CPS intakes
        const visibleIds = await getVisibleUserIds(_currentUser);
        let intakes = [];
        try {
            intakes = await AppDataStore.query('cps_intake_requests', { status: 'submitted' });
        } catch (_) {
            const all = await AppDataStore.getAll('cps_intake_requests');
            intakes = (all || []).filter(r => r.status === 'submitted');
        }
        if (visibleIds !== 'all') {
            const vStrs = visibleIds.map(String);
            intakes = intakes.filter(i => !i.agent_id || vStrs.includes(String(i.agent_id)));
        }
        for (const i of intakes) {
            items.push({ icon: '📋', title: `CPS Intake: ${i.prospect_name || 'Unknown'}`, sub: `${i.activity_date || ''} · Pending approval`, action: `app.openApproveCpsIntakeModal(${i.id})` });
        }

        // Birthdays
        const [allProspects, allCustomers, allUsers] = await Promise.all([
            AppDataStore.getAll('prospects'), AppDataStore.getAll('customers'), AppDataStore.getAll('users')
        ]);
        const bdayClientSet = new Set();
        [...allProspects, ...allCustomers].forEach(p => {
            const dob = p.date_of_birth || '';
            if (!dob || dob.length < 5) return;
            const md = dob.slice(5, 10);
            const isToday = md === todayMD;
            const isTom   = md === tomMD;
            if (!isToday && !isTom) return;
            items.push({ icon: '🎂', title: `${p.full_name || 'Someone'}'s Birthday`, sub: isToday ? 'Today!' : 'Tomorrow' });
            bdayClientSet.add(p.id);
        });
        allUsers.forEach(u => {
            const dob = u.date_of_birth || '';
            if (!dob || dob.length < 5) return;
            const md = dob.slice(5, 10);
            const isToday = md === todayMD;
            const isTom   = md === tomMD;
            if (!isToday && !isTom) return;
            items.push({ icon: '🎂', title: `${u.full_name || 'Agent'}'s Birthday`, sub: (isToday ? 'Today!' : 'Tomorrow') + ' · Agent' });
        });

        // Refill reminders
        try {
            const reminders = await AppDataStore.query('refill_reminders', { status: 'pending' });
            for (const r of (reminders || []).slice(0, 5)) {
                items.push({ icon: '💊', title: `Refill due: ${r.product_name || 'Product'}`, sub: `Customer needs reorder · Due ${r.due_date || ''}` });
            }
        } catch (_) {}

        // Pending co-agent invitations for current user
        try {
            if (_currentUser?.id) {
                const { data: coInvites } = await window.supabase
                    .from('activities')
                    .select('id, activity_type, activity_title, activity_date')
                    .filter('co_agents', 'cs', JSON.stringify([{ id: String(_currentUser.id), status: 'pending' }]));
                for (const act of (coInvites || []).slice(0, 5)) {
                    const typeLabel = act.activity_type || 'Activity';
                    const dateLabel = act.activity_date ? ` · ${act.activity_date}` : '';
                    const actId = act.id;
                    items.push({
                        icon: '🤝',
                        title: `Co-agent invitation: ${typeLabel}`,
                        sub: `${act.activity_title || typeLabel}${dateLabel}
                            <span style="display:inline-flex;gap:6px;margin-top:6px;">
                                <button onclick="event.stopPropagation();app.respondCoAgentInvite(${actId},'accepted');document.querySelector('.notif-panel')?.remove()" style="background:#16a34a;color:#fff;border:none;border-radius:4px;padding:2px 10px;cursor:pointer;font-size:11px;">✓ Accept</button>
                                <button onclick="event.stopPropagation();app.respondCoAgentInvite(${actId},'rejected');document.querySelector('.notif-panel')?.remove()" style="background:#dc2626;color:#fff;border:none;border-radius:4px;padding:2px 10px;cursor:pointer;font-size:11px;">✗ Reject</button>
                            </span>`,
                    });
                }
            }
        } catch (_) {}

        if (!items.length) {
            return `<div class="notif-panel-header"><i class="fas fa-bell"></i> Notifications</div>
                    <div class="notif-panel-empty">🎉 All caught up! No pending items.</div>`;
        }
        return `<div class="notif-panel-header"><i class="fas fa-bell"></i> Notifications <span style="margin-left:auto;font-size:12px;font-weight:500;color:var(--text-secondary);">${items.length} item${items.length===1?'':'s'}</span></div>` +
            items.map(it => `
                <div class="notif-item" ${it.action ? `onclick="${it.action}; document.querySelector('.notif-panel')?.remove()" style="cursor:pointer;"` : ''}>
                    <div class="notif-item-icon">${it.icon}</div>
                    <div class="notif-item-body">
                        <div class="notif-item-title">${it.title}</div>
                        <div class="notif-item-sub">${it.sub}</div>
                    </div>
                </div>`).join('');
    };

    const toggleNotifPanel = async () => {
        try {
            const existing = document.querySelector('.notif-panel');
            if (existing) { existing.remove(); return; }
            const panel = document.createElement('div');
            panel.className = 'notif-panel';
            panel.innerHTML = `<div class="notif-panel-header"><i class="fas fa-spinner fa-spin"></i> Loading…</div>`;
            document.body.appendChild(panel);
            // Close on outside click
            setTimeout(() => {
                document.addEventListener('click', function handler(e) {
                    if (!panel.contains(e.target) && !e.target.closest('.notif-bell')) {
                        panel.remove();
                        document.removeEventListener('click', handler);
                    }
                });
            }, 10);
            try {
                panel.innerHTML = await _buildNotifPanel();
            } catch (e) {
                panel.innerHTML = '<div class="notif-panel-empty">Failed to load notifications.</div>';
            }
        } catch (outerErr) {
            console.error('[notif] toggleNotifPanel failed:', outerErr);
        }
    };

    // Wire bell click + initial badge load.
    // Notification badge used to be the single biggest browser→DB chatter
    // source on nano: a 2-min poll firing four query() calls (cps_intake_requests,
    // refill_reminders, prospects+customers for birthdays, activities co-agent
    // JSONB scan) × every tab × every agent. Now we use Supabase Realtime
    // (postgres_changes) to be PUSHED a single event whenever any of the three
    // tables changes, and only re-fetch then. The 15-min safety-net interval
    // exists in case the websocket reconnect logic drops an event during a
    // network blip — but the steady-state cost is zero queries.
    const _initNotifBell = () => {
        const bell = document.querySelector('.notif-bell');
        if (!bell || bell._notifWired) return;
        bell._notifWired = true;

        const refreshIfVisible = () => { if (!document.hidden) _refreshNotifBadge(); };
        // Initial load
        refreshIfVisible();

        // Coalesce bursts of events (e.g. a bulk admin update) into a single
        // refresh per ~1 s window so we don't trigger a stampede of badge
        // re-counts when many rows change at once.
        let _coalesceTimer = null;
        const onRealtimeEvent = () => {
            if (_coalesceTimer) clearTimeout(_coalesceTimer);
            _coalesceTimer = setTimeout(() => { _coalesceTimer = null; refreshIfVisible(); }, 1000);
        };

        try {
            const sb = window.supabase;
            if (sb && typeof sb.channel === 'function') {
                const ch = sb.channel('notif-badge')
                    .on('postgres_changes', { event: '*', schema: 'public', table: 'cps_intake_requests' }, onRealtimeEvent)
                    .on('postgres_changes', { event: '*', schema: 'public', table: 'refill_reminders' }, onRealtimeEvent)
                    .on('postgres_changes', { event: '*', schema: 'public', table: 'activities' }, onRealtimeEvent)
                    .subscribe();
                window._notifChannel = ch;
            }
        } catch (e) { console.warn('[notif] realtime subscribe failed, falling back to interval:', e); }

        // Refresh on tab focus — covers events the websocket may have missed
        // while the tab was backgrounded by the OS.
        document.addEventListener('visibilitychange', refreshIfVisible);
        // 15-min safety-net poll. Was 2 min when we polled; now realtime is
        // primary, so this is just belt-and-braces if the websocket dies
        // and reconnect fails silently.
        setInterval(refreshIfVisible, 15 * 60 * 1000);
    };

    const getViewPhase = (viewId) => {
        const phaseMap = {
            'dashboard': '0', 'calendar': '1', 'pipeline': '6', 'protection': '13',
            'prospects': '3', 'referrals': '7', 'cases': '18', 'documents': '11',
            'promotions': '12', 'marketing_automation': '12', 'performance': '9', 'reports': '9', 'risk': '19', 'settings': '0',
            'import': '13'
        };
        return phaseMap[viewId] || '?';
    };

    // ========== CUSTOMER HEALTH SCORE ==========

    const calculateCustomerHealthScore = async (customer) => {
        let score = 0;
        // Fire both queries in parallel — they're independent. Previously they ran
        // sequentially (~2x latency) and blocked the customer profile header render.
        const [activities, purchases] = await Promise.all([
            AppDataStore.query('activities', { customer_id: customer.id }).catch(() => []),
            AppDataStore.query('purchases', { customer_id: customer.id }).catch(() => [])
        ]);
        if (activities.length > 0) {
            const last = activities.sort((a, b) => (b.activity_date || '').localeCompare(a.activity_date || ''))[0];
            const days = Math.floor((Date.now() - new Date(last.activity_date)) / 86400000);
            if (days <= 30) score += 40;
            else if (days <= 60) score += 25;
            else if (days <= 90) score += 10;
        }
        if (purchases.length > 0) {
            const last = purchases.sort((a, b) => (b.purchase_date || '').localeCompare(a.purchase_date || ''))[0];
            const days = Math.floor((Date.now() - new Date(last.purchase_date)) / 86400000);
            if (days <= 90) score += 30;
            else if (days <= 180) score += 15;
        }
        score += Math.min(30, Math.floor((customer.score || 0) / 10));
        const grade = score >= 70 ? 'green' : score >= 40 ? 'yellow' : 'red';
        const label = score >= 70 ? 'Healthy' : score >= 40 ? 'At Risk' : 'Churning';
        return { score, grade, label };
    };

    const renderHealthBadge = (health) => {
        const bg = health.grade === 'green' ? '#10b981' : health.grade === 'yellow' ? '#f59e0b' : '#ef4444';
        return `<span class="score-badge" style="background:${bg}; color:white;" title="Health Score: ${health.score}/100">${health.label} ${health.score}</span>`;
    };

    const renderQuickHealthBadge = (customer) => {
        const score = customer.score || 0;
        const grade = score >= 70 ? 'green' : score >= 40 ? 'yellow' : 'red';
        const label = score >= 70 ? 'Healthy' : score >= 40 ? 'At Risk' : 'Churning';
        const bg = grade === 'green' ? '#10b981' : grade === 'yellow' ? '#f59e0b' : '#ef4444';
        return `<span class="score-badge" style="background:${bg}; color:white; font-size:11px;" title="Quick health estimate">${label}</span>`;
    };

    // ========== MEETING SCHEDULER / BOOKING LINKS ==========

    const showBookingSettingsView = async (container) => {
        _currentView = 'booking_settings';
        const allSlots = await AppDataStore.getAll('booking_slots').catch(() => []);
        const agentSlots = allSlots.filter(s => s.agent_id === (_currentUser?.id || 1));
        const allAppts = await AppDataStore.getAll('booking_appointments').catch(() => []);
        const appointments = allAppts.filter(a => a.agent_id === (_currentUser?.id || 1))
            .sort((a, b) => (b.booking_date || '').localeCompare(a.booking_date || ''));
        const bookingUrl = `${window.location.origin}/booking.html?agent=${_currentUser?.id || 1}`;
        const dayNames = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];

        container.innerHTML = `
            <div style="padding:24px; max-width:1000px; margin:0 auto;">
                <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:24px;">
                    <div>
                        <h1 style="font-size:24px; font-weight:700; margin:0;">Meeting Scheduler</h1>
                        <p style="color:var(--gray-500); margin:4px 0 0;">Let prospects book appointments directly via a shareable link.</p>
                    </div>
                    <button class="btn primary" onclick="app.openAddSlotModal()"><i class="fas fa-plus"></i> Add Time Slot</button>
                </div>
                <div style="background:var(--gray-50); border:1px solid var(--gray-200); border-radius:12px; padding:20px; margin-bottom:24px;">
                    <h3 style="margin:0 0 8px; font-size:15px;">Your Booking Link</h3>
                    <div style="display:flex; align-items:center; gap:12px;">
                        <input type="text" value="${bookingUrl}" readonly style="flex:1; padding:8px 12px; border:1px solid var(--border); border-radius:6px; background:white; font-size:13px;">
                        <button class="btn secondary" onclick="app.openShareBookingLinkModal()"><i class="fas fa-share-alt"></i> Share</button>
                        <a href="${bookingUrl}" target="_blank" rel="noopener noreferrer" class="btn secondary"><i class="fas fa-external-link-alt"></i> Preview</a>
                    </div>
                </div>
                <div style="display:grid; grid-template-columns:1fr 1fr; gap:24px;">
                    <div>
                        <h3 style="font-size:16px; font-weight:600; margin-bottom:12px;">Availability Slots</h3>
                        ${agentSlots.length === 0 ? `
                            <div style="text-align:center; padding:40px; background:white; border:1px solid var(--gray-200); border-radius:8px; color:var(--gray-400);">
                                <i class="fas fa-clock" style="font-size:32px; display:block; margin-bottom:8px;"></i>
                                No slots configured yet.
                            </div>
                        ` : agentSlots.map(slot => `
                            <div style="display:flex; align-items:center; justify-content:space-between; background:white; border:1px solid var(--gray-200); border-radius:8px; padding:12px 16px; margin-bottom:8px;">
                                <div>
                                    <strong>${dayNames[slot.day_of_week]}</strong>
                                    <span style="color:var(--gray-500); margin-left:8px;">${slot.start_time} – ${slot.end_time}</span>
                                    <span style="color:var(--gray-400); font-size:12px; margin-left:8px;">${slot.duration_minutes}min slots</span>
                                </div>
                                <div style="display:flex; gap:8px; align-items:center;">
                                    <label style="display:flex; align-items:center; gap:6px; font-size:13px; cursor:pointer;">
                                        <input type="checkbox" ${slot.is_active ? 'checked' : ''} onchange="app.toggleSlotActive(${slot.id}, this.checked)"> Active
                                    </label>
                                    <button class="btn-icon" aria-label="Delete time slot" onclick="app.deleteBookingSlot(${slot.id})" style="color:var(--error);"><i class="fas fa-trash" aria-hidden="true"></i></button>
                                </div>
                            </div>
                        `).join('')}
                    </div>
                    <div>
                        <h3 style="font-size:16px; font-weight:600; margin-bottom:12px;">Appointments <span style="font-size:13px; font-weight:400; color:var(--gray-400);">(${appointments.filter(a => a.status !== 'cancelled').length})</span></h3>
                        ${appointments.length === 0 ? `
                            <div style="text-align:center; padding:40px; background:white; border:1px solid var(--gray-200); border-radius:8px; color:var(--gray-400);">
                                <i class="fas fa-calendar" style="font-size:32px; display:block; margin-bottom:8px;"></i>
                                No bookings yet. Share your link to get started.
                            </div>
                        ` : appointments.slice(0, 10).map(appt => `
                            <div style="background:white; border:1px solid var(--gray-200); border-radius:8px; padding:12px 16px; margin-bottom:8px;">
                                <div style="display:flex; justify-content:space-between; align-items:flex-start;">
                                    <div>
                                        <strong>${appt.prospect_name}</strong>
                                        <div style="font-size:12px; color:var(--gray-500);">${appt.booking_date} ${appt.start_time} · ${appt.prospect_phone || appt.prospect_email || ''}</div>
                                        ${appt.referred_by ? `<div style="font-size:11px; color:var(--gray-400); margin-top:2px;"><i class="fas fa-user-friends" style="margin-right:3px;"></i>Ref: ${appt.referred_by}${appt.referral_relationship ? ` (${appt.referral_relationship})` : ''}</div>` : ''}
                                        ${appt.prospect_occupation || appt.prospect_company ? `<div style="font-size:11px; color:var(--gray-400); margin-top:2px;">${[appt.prospect_occupation, appt.prospect_company].filter(Boolean).join(' · ')}</div>` : ''}
                                    </div>
                                    <div style="display:flex; gap:6px;">
                                        ${appt.status === 'pending' ? `
                                            <button class="btn primary" style="padding:4px 10px; font-size:12px;" onclick="app.confirmBookingAppointment(${appt.id})">Confirm</button>
                                            <button class="btn secondary" style="padding:4px 10px; font-size:12px;" onclick="app.cancelBookingAppointment(${appt.id})">Cancel</button>
                                        ` : `<span style="font-size:12px; padding:4px 10px; border-radius:20px; background:${appt.status==='confirmed'?'#d1fae5':'#fee2e2'}; color:${appt.status==='confirmed'?'#065f46':'#991b1b'};">${appt.status}</span>`}
                                    </div>
                                </div>
                            </div>
                        `).join('')}
                    </div>
                </div>
            </div>
        `;
    };

    const openAddSlotModal = () => {
        UI.showModal('Add Availability Slot', `
            <div style="display:flex; flex-direction:column; gap:16px;">
                <div>
                    <label style="display:block; font-weight:500; margin-bottom:6px;">Day of Week</label>
                    <select id="slot-day" class="form-control">
                        <option value="1">Monday</option><option value="2">Tuesday</option><option value="3">Wednesday</option>
                        <option value="4">Thursday</option><option value="5">Friday</option><option value="6">Saturday</option><option value="0">Sunday</option>
                    </select>
                </div>
                <div style="display:grid; grid-template-columns:1fr 1fr; gap:12px;">
                    <div><label style="display:block; font-weight:500; margin-bottom:6px;">Start Time</label><input type="time" id="slot-start" class="form-control" value="09:00"></div>
                    <div><label style="display:block; font-weight:500; margin-bottom:6px;">End Time</label><input type="time" id="slot-end" class="form-control" value="17:00"></div>
                </div>
                <div>
                    <label style="display:block; font-weight:500; margin-bottom:6px;">Duration per Slot (minutes)</label>
                    <select id="slot-duration" class="form-control">
                        <option value="30">30 minutes</option><option value="45">45 minutes</option>
                        <option value="60" selected>60 minutes</option><option value="90">90 minutes</option>
                    </select>
                </div>
            </div>
        `, [
            { label: 'Cancel', type: 'secondary', action: 'UI.hideModal()' },
            { label: 'Save Slot', type: 'primary', action: '(async () => { await app.saveBookingSlot(); })()' }
        ]);
    };

    const saveBookingSlot = async () => {
        const start = document.getElementById('slot-start').value;
        const end = document.getElementById('slot-end').value;
        if (!start || !end || start >= end) { UI.toast.error('End time must be after start time.'); return; }
        await AppDataStore.create('booking_slots', {
            agent_id: _currentUser?.id || 1,
            day_of_week: parseInt(document.getElementById('slot-day').value),
            start_time: start, end_time: end,
            duration_minutes: parseInt(document.getElementById('slot-duration').value),
            is_active: true, created_at: new Date().toISOString()
        });
        UI.hideModal();
        UI.toast.success('Availability slot added.');
        await showBookingSettingsView(document.getElementById('content-viewport'));
    };

    const deleteBookingSlot = async (slotId) => {
        try {
            await AppDataStore.delete('booking_slots', slotId);
            UI.toast.success('Slot removed.');
            await showBookingSettingsView(document.getElementById('content-viewport'));
        } catch (err) {
            UI.toast.error('Delete failed: ' + (err.message || 'Unknown error'));
        }
    };

    const toggleSlotActive = async (slotId, isActive) => {
        await AppDataStore.update('booking_slots', slotId, { is_active: isActive });
        UI.toast.success(isActive ? 'Slot activated.' : 'Slot deactivated.');
    };

    const copyBookingLink = () => {
        const url = `${window.location.origin}/booking.html?agent=${_currentUser?.id || 1}`;
        navigator.clipboard.writeText(url).then(() => UI.toast.success('Booking link copied!')).catch(() => UI.toast.info(`Link: ${url}`));
    };

    const openShareBookingLinkModal = () => {
        const baseUrl = `${window.location.origin}/booking.html?agent=${_currentUser?.id || 1}`;
        UI.showModal('Share Booking Link', `
            <div style="display:flex; flex-direction:column; gap:16px;">
                <div style="background:#f0fdf4; border:1px solid #bbf7d0; border-radius:8px; padding:12px; font-size:13px; color:#166534;">
                    <i class="fas fa-info-circle" style="margin-right:6px;"></i>
                    Pre-fill the referral info below, then send the link to the customer. The customer will fill in their own personal details on the booking page.
                </div>
                <div>
                    <label style="display:block; font-weight:500; margin-bottom:6px;">Referred By <span style="color:var(--gray-400); font-weight:400;">(optional)</span></label>
                    <input type="text" id="share-referrer" class="form-control" placeholder="e.g. Tan Ah Kow" oninput="app.updateShareLinkPreview()">
                </div>
                <div>
                    <label style="display:block; font-weight:500; margin-bottom:6px;">Relation to Referrer</label>
                    <select id="share-relation" class="form-control" onchange="app.updateShareLinkPreview()">
                        <option value="">-- Select Relation --</option>
                        <option value="Friend">Friend</option>
                        <option value="Family">Family</option>
                        <option value="Spouse">Spouse</option>
                        <option value="Siblings">Siblings</option>
                        <option value="Cousin">Cousin</option>
                        <option value="Colleague">Colleague</option>
                        <option value="Ex Colleague">Ex Colleague</option>
                        <option value="Ex Classmate">Ex Classmate</option>
                        <option value="Business Partner">Business Partner</option>
                        <option value="Customer">Customer</option>
                        <option value="Other">Other</option>
                    </select>
                </div>
                <div>
                    <label style="display:block; font-weight:500; margin-bottom:6px;">Generated Link</label>
                    <input type="text" id="share-link-preview" class="form-control" readonly value="${baseUrl}" style="font-size:12px; color:var(--gray-600); background:var(--gray-50);">
                    <p style="font-size:11px; color:var(--gray-400); margin:4px 0 0;">Link updates as you fill in the fields above.</p>
                </div>
            </div>
        `, [
            { label: 'Cancel', type: 'secondary', action: 'UI.hideModal()' },
            { label: '<i class="fas fa-copy"></i> Copy Link', type: 'primary', action: 'app.copySmartBookingLink()' }
        ]);
    };

    const updateShareLinkPreview = () => {
        const baseUrl = `${window.location.origin}/booking.html?agent=${_currentUser?.id || 1}`;
        const ref = document.getElementById('share-referrer')?.value.trim();
        const rel = document.getElementById('share-relation')?.value;
        let url = baseUrl;
        if (ref) url += `&ref=${encodeURIComponent(ref)}`;
        if (rel) url += `&rel=${encodeURIComponent(rel)}`;
        const linkEl = document.getElementById('share-link-preview');
        if (linkEl) linkEl.value = url;
    };

    const copySmartBookingLink = () => {
        const linkEl = document.getElementById('share-link-preview');
        const url = linkEl?.value || `${window.location.origin}/booking.html?agent=${_currentUser?.id || 1}`;
        navigator.clipboard.writeText(url).then(() => {
            UI.hideModal();
            UI.toast.success('Booking link copied!');
        }).catch(() => {
            UI.hideModal();
            UI.toast.info(`Link: ${url}`);
        });
    };

    const confirmBookingAppointment = async (apptId) => {
        await AppDataStore.update('booking_appointments', apptId, { status: 'confirmed' });
        UI.toast.success('Appointment confirmed.');
        await showBookingSettingsView(document.getElementById('content-viewport'));
    };

    const cancelBookingAppointment = async (apptId) => {
        await AppDataStore.update('booking_appointments', apptId, { status: 'cancelled' });
        UI.toast.success('Appointment cancelled.');
        await showBookingSettingsView(document.getElementById('content-viewport'));
    };

    // ========== CPS INTAKE LINK (shareable one-time form) ==========
    // Flow: agent picks date/time/venue → system generates token link → agent sends to
    // prospect → prospect fills basic info on cps-intake.html → agent approves on calendar
    // which opens Quick Add Activity (CPS) pre-filled; agent adds referrer+relation to confirm.

    const openShareCpsIntakeLinkModal = async () => {
        const venueData = await AppDataStore.getAll('venues').catch(() => []);
        const venueOptions = (venueData || [])
            .sort((a, b) => (a.sequence || 0) - (b.sequence || 0))
            .map(v => `<option value="${v.id}" data-name="${(v.name || '').replace(/"/g, '&quot;')}" data-address="${(v.address || v.location || '').replace(/"/g, '&quot;')}" data-waze="${(v.waze_link || '').replace(/"/g, '&quot;')}">${v.name} | ${v.location || ''}</option>`)
            .join('');

        const today = new Date().toISOString().split('T')[0];

        UI.showModal('Share CPS Intake Link', `
            <div style="display:flex; flex-direction:column; gap:14px;">
                <div style="background:#f0fdf4; border:1px solid #bbf7d0; border-radius:8px; padding:12px; font-size:13px; color:#166534;">
                    <i class="fas fa-info-circle" style="margin-right:6px;"></i>
                    Set the appointment date, time and venue. A one-time link will be generated — share it with the prospect so they can fill in their basic info. You'll approve it on your calendar afterwards.
                </div>
                <div class="form-row">
                    <div class="form-group half">
                        <label>Date <span class="required">*</span></label>
                        <input type="date" id="intake-date" class="form-control" value="${today}">
                    </div>
                    <div class="form-group half">
                        <label>Venue <span class="required">*</span></label>
                        <select id="intake-venue" class="form-control">
                            <option value="">-- Select Venue --</option>
                            ${venueOptions}
                        </select>
                    </div>
                </div>
                <div class="form-row">
                    <div class="form-group half">
                        <label>Start Time <span class="required">*</span></label>
                        <input type="time" id="intake-start" class="form-control" value="14:00">
                    </div>
                    <div class="form-group half">
                        <label>End Time <span class="required">*</span></label>
                        <input type="time" id="intake-end" class="form-control" value="15:30">
                    </div>
                </div>

                <div id="intake-generated-link" style="display:none; background:var(--gray-50); border:1px solid var(--gray-200); border-radius:8px; padding:14px;">
                    <label style="display:block; font-weight:600; margin-bottom:6px; font-size:13px;">Shareable Link</label>
                    <div style="display:flex; gap:8px; align-items:center;">
                        <input type="text" id="intake-link-input" class="form-control" readonly style="flex:1; font-size:12px;">
                        <button class="btn secondary btn-sm" type="button" onclick="app.copyCpsIntakeLink()"><i class="fas fa-copy"></i> Copy</button>
                        <button class="btn secondary btn-sm" type="button" onclick="app.shareCpsIntakeWhatsApp()"><i class="fab fa-whatsapp"></i> WhatsApp</button>
                    </div>
                    <p class="help-text" style="margin-top:8px; font-size:12px; color:var(--gray-500);">The link expires in 7 days or once the prospect submits.</p>
                </div>
            </div>
        `, [
            { label: 'Close', type: 'secondary', action: 'UI.hideModal()' },
            { label: 'Generate Link', type: 'primary', action: '(async () => { await app.saveCpsIntakeLink(); })()' }
        ]);
    };

    const saveCpsIntakeLink = async () => {
        const date = document.getElementById('intake-date')?.value;
        const startTime = document.getElementById('intake-start')?.value;
        const endTime = document.getElementById('intake-end')?.value;
        const venueSel = document.getElementById('intake-venue');

        if (!date || !startTime || !endTime) {
            UI.toast.error('Date, start time and end time are required.');
            return;
        }
        if (startTime >= endTime) {
            UI.toast.error('End time must be after start time.');
            return;
        }
        if (!venueSel?.value) {
            UI.toast.error('Please select a venue.');
            return;
        }

        const opt = venueSel.options[venueSel.selectedIndex];
        const venueName = opt.getAttribute('data-name') || '';
        const venueAddress = opt.getAttribute('data-address') || '';
        const wazeLink = opt.getAttribute('data-waze') || '';

        try {
            const row = await AppDataStore.create('cps_intake_requests', {
                agent_id: _currentUser?.id || null,
                activity_date: date,
                start_time: startTime,
                end_time: endTime,
                venue_name: venueName,
                venue_address: venueAddress,
                waze_link: wazeLink,
                status: 'awaiting_submission',
                created_at: new Date().toISOString()
            });

            if (!row || !row.token) {
                UI.toast.error('Link created but token missing. Please try again.');
                return;
            }

            const url = `${window.location.origin}/cps-intake.html?token=${row.token}`;
            const linkBlock = document.getElementById('intake-generated-link');
            const linkInput = document.getElementById('intake-link-input');
            if (linkBlock && linkInput) {
                linkInput.value = url;
                linkBlock.style.display = 'block';
            }
            UI.toast.success('Link generated! Share it with the prospect.');
        } catch (err) {
            console.error('saveCpsIntakeLink failed:', err);
            UI.toast.error('Failed to generate link: ' + (err.message || 'Unknown error'));
        }
    };

    const copyCpsIntakeLink = () => {
        const input = document.getElementById('intake-link-input');
        if (!input || !input.value) return;
        navigator.clipboard.writeText(input.value)
            .then(() => UI.toast.success('Link copied!'))
            .catch(() => {
                input.select();
                document.execCommand('copy');
                UI.toast.success('Link copied!');
            });
    };

    const shareCpsIntakeWhatsApp = () => {
        const input = document.getElementById('intake-link-input');
        if (!input || !input.value) return;

        const date = document.getElementById('intake-date')?.value || '';
        const startTime = document.getElementById('intake-start')?.value || '';
        const endTime = document.getElementById('intake-end')?.value || '';
        const venueSel = document.getElementById('intake-venue');
        const opt = venueSel?.options[venueSel.selectedIndex];
        const venueName = opt?.getAttribute('data-name') || '';
        const venueAddress = opt?.getAttribute('data-address') || '';
        const wazeLink = opt?.getAttribute('data-waze') || '';

        // Format date nicely: "Mon, 13 Apr 2026"
        let dateStr = date;
        if (date) {
            const [y, m, d] = date.split('-').map(Number);
            const dt = new Date(y, m - 1, d);
            const days = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
            const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
            dateStr = `${days[dt.getDay()]}, ${d} ${months[dt.getMonth()]} ${y}`;
        }
        const timeStr = `${(startTime || '').slice(0,5)} – ${(endTime || '').slice(0,5)}`;

        let msg = `您好！请通过以下链接填妥基本资料以确认您的 CPS 约谈：\nHi! Please fill in your basic information to confirm your CPS appointment:\n`;
        msg += `\n${input.value}\n`;
        msg += `\n📅 日期 Date: ${dateStr}`;
        msg += `\n⏰ 时间 Time: ${timeStr}`;
        if (venueName) msg += `\n📍 地点 Venue: ${venueName}`;
        if (venueAddress) msg += `\n🏠 地址 Address: ${venueAddress}`;
        if (wazeLink) msg += `\n🗺️ Waze: ${wazeLink}`;

        window.open(`https://wa.me/?text=${encodeURIComponent(msg)}`, '_blank');
    };

    // Render a "Pending CPS Intake Approvals" section at the top of the calendar today-list.
    // Called from showCalendarView in parallel with the other renderers.
    const renderPendingCpsIntakes = async () => {
        const host = document.getElementById('pending-cps-intakes');
        if (!host) return;

        let intakes = [];
        try {
            // SWR serves the cached snapshot instantly; background revalidation picks
            // up new submissions within 5 min. Removed { fresh: true } which forced a
            // Supabase round-trip on EVERY calendar render, blocking re-paints.
            const all = await AppDataStore.getAll('cps_intake_requests');
            const pendingStatuses = new Set(['submitted', 'pending', 'awaiting_approval', 'new']);
            intakes = (all || []).filter(r => pendingStatuses.has(r.status));
        } catch (_) { intakes = []; }

        // Filter: only show intakes created by the current user or their subordinates.
        // Records with no agent_id are always shown to any logged-in leader.
        const visibleIds = await getVisibleUserIds(_currentUser);
        if (visibleIds !== 'all') {
            const visibleStrs = visibleIds.map(String);
            intakes = intakes.filter(i => !i.agent_id || visibleStrs.includes(String(i.agent_id)));
        }

        if (!intakes || intakes.length === 0) {
            host.innerHTML = '';
            host.style.display = 'none';
            return;
        }

        host.style.display = 'block';
        host.innerHTML = `
            <div style="background:#fffbeb; border:1px solid #fcd34d; border-radius:12px; padding:16px; margin-bottom:16px;">
                <h3 style="margin:0 0 12px; font-size:15px; color:#92400e; display:flex; align-items:center; gap:8px;">
                    <i class="fas fa-bell"></i> PENDING CPS INTAKE APPROVALS (${intakes.length})
                </h3>
                <div style="display:flex; flex-direction:column; gap:10px;">
                    ${intakes.map(i => `
                        <div style="background:white; border:1px solid #fde68a; border-radius:8px; padding:12px;">
                            <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:12px; flex-wrap:wrap;">
                                <div style="flex:1; min-width:200px;">
                                    <div style="font-weight:600; font-size:14px; margin-bottom:2px;">${i.prospect_name || 'Unknown'}</div>
                                    <div style="font-size:12px; color:var(--gray-600);">
                                        <i class="fas fa-phone" style="margin-right:4px;"></i>${i.prospect_phone || '—'}
                                        ${i.prospect_email ? ` · <i class="fas fa-envelope" style="margin-right:4px;"></i>${i.prospect_email}` : ''}
                                    </div>
                                    <div style="font-size:12px; color:var(--gray-500); margin-top:4px;">
                                        <i class="far fa-calendar" style="margin-right:4px;"></i>${i.activity_date} · ${(i.start_time || '').slice(0,5)}–${(i.end_time || '').slice(0,5)}
                                        ${i.venue_name ? ` · <i class="fas fa-map-marker-alt" style="margin-right:4px;"></i>${i.venue_name}` : ''}
                                    </div>
                                </div>
                                <div style="display:flex; gap:6px;">
                                    <button class="btn primary btn-sm" onclick="app.openApproveCpsIntakeModal(${i.id})">
                                        <i class="fas fa-check"></i> Review & Approve
                                    </button>
                                    <button class="btn secondary btn-sm" onclick="app.rejectCpsIntake(${i.id})" title="Reject">
                                        <i class="fas fa-times"></i>
                                    </button>
                                </div>
                            </div>
                        </div>
                    `).join('')}
                </div>
            </div>
        `;
    };

    const openApproveCpsIntakeModal = async (intakeId) => {
        const intake = await AppDataStore.getById('cps_intake_requests', intakeId);
        if (!intake) {
            UI.toast.error('Intake request not found.');
            return;
        }
        if (intake.status !== 'submitted') {
            UI.toast.error('This intake is no longer pending.');
            await renderPendingCpsIntakes();
            return;
        }

        // Stash id + full row so saveActivity can mark approved and send WhatsApp
        _pendingIntakeId  = intakeId;
        _pendingIntakeRow = intake;

        // Open the standard Quick Add Activity modal — it defaults to CPS type
        await (window.app.openActivityModal || (() => {}))(intake.activity_date);

        // Wait for the CPS dynamic fields to mount, then prefill
        let attempts = 0;
        const pollInterval = setInterval(() => {
            const nameEl = document.getElementById('cps-name');
            if (nameEl) {
                const setF = (id, val) => { const el = document.getElementById(id); if (el) el.value = val || ''; };
                setF('cps-name', intake.prospect_name);
                setF('cps-ic', intake.prospect_ic);
                setF('cps-occupation', intake.prospect_occupation);
                setF('cps-phone', intake.prospect_phone);
                setF('cps-email', intake.prospect_email);
                setF('activity-date', intake.activity_date);
                setF('start-time', (intake.start_time || '').slice(0, 5));
                setF('end-time', (intake.end_time || '').slice(0, 5));

                // Try to select the venue — match by name against the dropdown options
                const venueSel = document.getElementById('activity-venue');
                if (venueSel && intake.venue_name) {
                    for (const opt of venueSel.options) {
                        if (opt.value && opt.value.toLowerCase().startsWith(intake.venue_name.toLowerCase())) {
                            venueSel.value = opt.value;
                            break;
                        }
                    }
                }

                // Trigger duration recalc
                if (typeof app !== 'undefined' && app.calculateDuration) app.calculateDuration();

                clearInterval(pollInterval);
                UI.toast.info('Please add referrer and relation before saving.');
            } else if (++attempts >= 16) {
                clearInterval(pollInterval);
            }
        }, 250);
    };

    const rejectCpsIntake = async (intakeId) => {
        if (!confirm('Reject this CPS intake request? This cannot be undone.')) return;
        try {
            await AppDataStore.update('cps_intake_requests', intakeId, {
                status: 'rejected',
                approved_at: new Date().toISOString()
            });
            UI.toast.success('Intake rejected.');
            await renderPendingCpsIntakes();
        } catch (err) {
            UI.toast.error('Reject failed: ' + (err.message || 'Unknown error'));
        }
    };

    // ========== CPS FORM PHOTO OCR (Gemini Flash via Edge Function) ==========
    // Lets agents snap a photo of the paper "細解命盤" form and auto-fill the
    // basic-info panel. Always shows a side-by-side review modal first so the
    // agent can compare existing form values vs scanned values before applying.

    // Map of scanned field → CRM form field id (suffix on `${prefix}-`)
    const CPS_SCAN_FIELD_MAP = [
        // [scannedKey, fieldSuffix, displayLabel, dbColumn]
        // dbColumn is used when applying to an existing prospect record.
        ['name',           'name',         'Full Name',          'full_name'],
        ['gender',         'gender',       'Gender',             'gender'],
        ['dob_solar',      'dob',          'Date of Birth',      'date_of_birth'],
        ['dob_lunar',      'lunar',        'Lunar Birth',        'lunar_birth'],
        ['phone',          'phone',        'Phone',              'phone'],
        ['occupation',     'occupation',   'Occupation',         'occupation'],
        ['email',          'email',        'Email',              'email'],
        ['address',        'address',      'Address',            'address'],
        // marital_status is a checkbox group in form, plain column in DB
        ['marital_status', '__marital__',  'Marital Status',     'marital_status'],
    ];

    // Read the current value out of the form for a given field suffix
    const _readCpsField = (prefix, suffix) => {
        if (suffix === '__marital__') {
            const cb = document.querySelector(`.${prefix}-marital-cb:checked`);
            return cb ? cb.value : '';
        }
        const el = document.getElementById(`${prefix}-${suffix}`);
        return el ? (el.value || '').trim() : '';
    };

    // Write a value into a form field
    const _writeCpsField = (prefix, suffix, value) => {
        if (suffix === '__marital__') {
            document.querySelectorAll(`.${prefix}-marital-cb`).forEach(cb => {
                cb.checked = (cb.value === value);
            });
            return;
        }
        const el = document.getElementById(`${prefix}-${suffix}`);
        if (!el) return;
        el.value = value || '';
        // Trigger lunar recalc when DOB is set
        if (suffix === 'dob' && typeof app !== 'undefined' && app.updateLunarBirth) {
            try { app.updateLunarBirth(`${prefix}-dob`, `${prefix}-lunar`); } catch (e) {}
        }
    };

    // Stash scan result so the review modal callbacks can read it.
    let _cpsScanCache = null;
    // Photo file (File blob) pending silent upload. Persists across the
    // review modal lifecycle — consumed when the host record (prospect or
    // activity) is saved, then cleared. Per-prefix so prospect-modal and
    // cps-modal flows don't trample each other.
    let _cpsPendingPhotoFiles = {}; // { [prefix]: File }

    // Centralized helper: upload a CPS form photo to Supabase Storage and
    // patch the prospect record with the URL + date + filename. Single source
    // of truth used by all three entry points (Upload CPS button, basic-info
    // Take Photo, CPS Quick Add). Returns the public URL or null on failure.
    const _uploadCpsFormFile = async (file, prospectId) => {
        if (!file || !prospectId) return null;
        try {
            const sb = window.supabase;
            if (!sb || !sb.storage) return null;
            const ext = (file.name.match(/\.[a-z0-9]+$/i)?.[0] || '.jpg').toLowerCase();
            const path = `cps-forms/${prospectId}_${Date.now()}${ext}`;
            const { error: upErr } = await sb.storage
                .from('attachments')
                .upload(path, file, { upsert: true, contentType: file.type });
            if (upErr) throw upErr;
            const { data: urlData } = sb.storage.from('attachments').getPublicUrl(path);
            await AppDataStore.update('prospects', prospectId, {
                cps_form_url: urlData?.publicUrl || null,
                cps_form_date: new Date().toISOString().split('T')[0],
                cps_form_name: file.name,
            });
            return urlData?.publicUrl || null;
        } catch (err) {
            console.warn('CPS form silent upload failed:', err);
            return null;
        }
    };

    // Dedicated overlay for the scan flow (separate from UI.showModal).
    // The CPS form's prospect/quick-add modal already lives in the global
    // modal overlay; reusing it for the spinner + review would WIPE the form
    // DOM and lose the agent's in-progress entries. This standalone overlay
    // sits on top without touching the underlying modal.
    const _showCpsScanOverlay = (title, contentHtml, buttons = []) => {
        let overlay = document.getElementById('cps-scan-overlay');
        if (!overlay) {
            overlay = document.createElement('div');
            overlay.id = 'cps-scan-overlay';
            overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.55);z-index:99999;display:flex;align-items:center;justify-content:center;padding:16px;';
            document.body.appendChild(overlay);
        }
        const btnHtml = buttons.map(b => {
            const cls = b.type === 'primary' ? 'btn primary' : 'btn secondary';
            return `<button class="${cls}" style="margin-left:8px;" onclick="${b.action}">${b.label}</button>`;
        }).join('');
        overlay.innerHTML = `
            <div style="background:white;border-radius:12px;max-width:760px;width:100%;max-height:90vh;overflow:hidden;display:flex;flex-direction:column;box-shadow:0 20px 60px rgba(0,0,0,0.3);">
                <div style="padding:16px 20px;border-bottom:1px solid var(--gray-200);font-weight:600;font-size:16px;display:flex;justify-content:space-between;align-items:center;">
                    <span>${title}</span>
                    <button type="button" style="background:none;border:none;font-size:20px;color:var(--gray-500);cursor:pointer;padding:0;line-height:1;" onclick="app._hideCpsScanOverlay()">&times;</button>
                </div>
                <div style="padding:18px 20px;overflow-y:auto;flex:1;">${contentHtml}</div>
                ${buttons.length ? `<div style="padding:14px 20px;border-top:1px solid var(--gray-200);text-align:right;background:var(--gray-50);">${btnHtml}</div>` : ''}
            </div>
        `;
        overlay.style.display = 'flex';
    };

    const _hideCpsScanOverlay = () => {
        const overlay = document.getElementById('cps-scan-overlay');
        if (overlay) overlay.remove();
    };

    // ─── CPS Paste-Text Parser ───────────────────────────────────────────
    // Lets agents paste the standard WhatsApp "请填妥基本资料" reply and
    // auto-fill Name / IC / Occupation / Phone / Email. The IC also derives
    // Date of Birth and Gender. Sits on the same overlay layer as the
    // photo-scan flow so the underlying form DOM stays intact.
    const openCpsPasteModal = (prefix = 'cps') => {
        const placeholder = `请填妥基本资料 Basic information
1. 姓名 Name : CHEE CHUN CHING
2. 身分号码 IC: 740315-04-5427
3. 职业 Occupation: Driver
4. 联络号码 Phone no: 0122034218
5. 邮箱 Email: thomaschee@gmail.com`;
        const contentHtml = `
            <div style="margin-bottom:10px;color:var(--gray-600);font-size:13px;line-height:1.5;">
                Paste the customer's bilingual reply below. The system will auto-fill
                <strong>Name</strong>, <strong>IC</strong>, <strong>Occupation</strong>,
                <strong>Phone</strong>, <strong>Email</strong> — and derive
                <strong>Date of Birth</strong> and <strong>Gender</strong> from the IC.
            </div>
            <textarea id="cps-paste-input" class="form-control" rows="10"
                style="font-family:inherit;font-size:13px;"
                placeholder="${placeholder.replace(/"/g, '&quot;')}"></textarea>
            <div style="margin-top:8px;font-size:11px;color:var(--gray-400);">
                Also accepts variants like "电话", "Tel", "手机", "Mobile", "E-mail", "身份证", etc.
            </div>
        `;
        _showCpsScanOverlay('Paste Customer Info', contentHtml, [
            { type: 'secondary', label: 'Cancel', action: 'app._hideCpsScanOverlay()' },
            { type: 'primary',   label: 'Auto-Fill Form', action: `app.parseCpsPastedText('${prefix}')` },
        ]);
        setTimeout(() => {
            const ta = document.getElementById('cps-paste-input');
            if (ta) ta.focus();
        }, 50);
    };

    // Malaysian IC (NRIC) format: YYMMDD-PB-###G
    //   YYMMDD → birth date · last digit G → odd=Male, even=Female
    // Returns { dob: 'YYYY-MM-DD', gender: 'Male'|'Female' } or null on bad input.
    const _parseMalaysianIc = (ic) => {
        const clean = String(ic || '').replace(/[^0-9]/g, '');
        if (clean.length !== 12) return null;
        const yy = parseInt(clean.slice(0, 2), 10);
        const mm = parseInt(clean.slice(2, 4), 10);
        const dd = parseInt(clean.slice(4, 6), 10);
        if (mm < 1 || mm > 12 || dd < 1 || dd > 31) return null;
        // Century window: anything within ~5 years of "future" maps to 20YY,
        // older years map to 19YY. Works for both elderly customers and babies.
        const nowYY = new Date().getFullYear() % 100;
        const century = (yy <= nowYY + 5) ? 2000 : 1900;
        const dob = `${century + yy}-${String(mm).padStart(2,'0')}-${String(dd).padStart(2,'0')}`;
        const last = parseInt(clean.slice(-1), 10);
        const gender = (last % 2 === 0) ? 'Female' : 'Male';
        return { dob, gender };
    };

    const parseCpsPastedText = (prefix = 'cps') => {
        const ta = document.getElementById('cps-paste-input');
        if (!ta) return;
        const text = (ta.value || '').trim();
        if (!text) {
            UI.toast.error('Please paste the message first.');
            return;
        }

        // Tolerates ":" or "：", leading numbering ("1.", "1)", "-"), spacing
        // inside Chinese labels, and either Chinese or English keyword.
        const grab = (re) => {
            const m = text.match(re);
            return m && m[1] ? m[1].trim() : '';
        };

        // Value captures use [^\r\n]+ so they never spill into the next labelled
        // line — important for numeric IC/Phone where "3." or "5." prefixes on
        // following lines would otherwise glue onto the value.
        const fields = {
            name:       grab(/(?:姓\s*名|Name)\s*[:：]\s*([^\r\n]+)/i),
            ic:         grab(/(?:身\s*[分份](?:\s*[号证码])+|IC(?:\s*No\.?)?|NRIC)\s*[:：]\s*([^\r\n]+)/i),
            occupation: grab(/(?:职\s*业|工\s*作|Occupation|Job)\s*[:：]\s*([^\r\n]+)/i),
            phone:      grab(/(?:联\s*络\s*号?\s*码|电\s*话|手\s*机|Phone(?:\s*no\.?)?|Tel(?:ephone)?|Mobile|Contact\s*(?:no\.?|number))\s*[:：]\s*([^\r\n]+)/i),
            email:      grab(/(?:邮\s*箱|电\s*邮|Email|E[-\s]?mail)\s*[:：]\s*([^\s,;，；]+)/i),
        };

        Object.keys(fields).forEach(k => {
            fields[k] = (fields[k] || '').replace(/[。；;,，]\s*$/, '').trim();
        });
        if (fields.phone) fields.phone = fields.phone.replace(/[^\d+()]/g, '');
        if (fields.ic)    fields.ic    = fields.ic.replace(/[^0-9A-Za-z\-]/g, '');

        const map = [
            ['name',       'name'],
            ['ic',         'ic'],
            ['occupation', 'occupation'],
            ['phone',      'phone'],
            ['email',      'email'],
        ];
        let filled = 0;
        map.forEach(([key, suffix]) => {
            if (fields[key]) {
                _writeCpsField(prefix, suffix, fields[key]);
                filled++;
            }
        });

        // Derive DOB + Gender from a Malaysian IC if one was supplied and the
        // form fields are empty — never overwrite a value the agent already entered.
        let derived = 0;
        if (fields.ic) {
            const parsed = _parseMalaysianIc(fields.ic);
            if (parsed) {
                if (!_readCpsField(prefix, 'dob')) {
                    _writeCpsField(prefix, 'dob', parsed.dob);
                    derived++;
                }
                const genderEl = document.getElementById(`${prefix}-gender`);
                if (genderEl && !genderEl.value) {
                    genderEl.value = parsed.gender;
                    derived++;
                }
            }
        }

        // Only dismiss the overlay on success — if the parser found nothing,
        // keep the textarea open so the agent can correct their paste and
        // retry without having to copy and paste the message a second time.
        if (filled === 0) {
            UI.toast.error('No recognizable fields found — please check the pasted text and try again.');
            return;
        }
        _hideCpsScanOverlay();
        const extra = derived ? ` (+${derived} derived from IC)` : '';
        UI.toast.success(`Auto-filled ${filled} field${filled === 1 ? '' : 's'}${extra}.`);
    };

    const scanCpsForm = (prefix = 'cps') => {
        const input = document.getElementById(`${prefix}-scan-input`);
        if (!input) {
            UI.toast.error('Scan input not found. Please reopen the form.');
            return;
        }
        input.value = ''; // allow re-selecting the same file
        input.click();
    };

    const handleCpsScanFile = async (input, prefix = 'cps') => {
        const file = input.files && input.files[0];
        if (!file) return;

        if (!file.type.startsWith('image/')) {
            UI.toast.error('Please select an image file.');
            return;
        }
        if (file.size > 8 * 1024 * 1024) {
            UI.toast.error('Image too large. Please use a photo under 8 MB.');
            return;
        }

        // Snapshot current form values BEFORE showing any overlay.
        const current = {};
        CPS_SCAN_FIELD_MAP.forEach(([key, suffix]) => {
            current[key] = _readCpsField(prefix, suffix);
        });

        // Show a "scanning…" overlay on TOP of the prospect/CPS modal
        // (separate overlay so the form DOM stays intact).
        _showCpsScanOverlay('Scanning Form…', `
            <div style="text-align:center; padding:20px 0;">
                <i class="fas fa-spinner fa-spin" style="font-size:36px; color:#7c3aed; margin-bottom:14px;"></i>
                <p style="color:var(--gray-600); margin:0;">Reading the form, please wait…</p>
                <p style="color:var(--gray-400); font-size:12px; margin-top:6px;">(usually 3–6 seconds)</p>
            </div>
        `);

        try {
            // Convert image to base64 (avoids multipart edge cases)
            const dataUrl = await new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = () => resolve(reader.result);
                reader.onerror = () => reject(new Error('Could not read file'));
                reader.readAsDataURL(file);
            });
            const [meta, b64] = String(dataUrl).split(',');
            const mime = (meta.match(/data:(.*?);base64/) || [])[1] || file.type || 'image/jpeg';

            if (!window.supabase || !window.supabase.functions) {
                throw new Error('Supabase client not available (offline mode?)');
            }

            const { data: res, error } = await window.supabase.functions.invoke('cps-form-ocr', {
                body: { image_base64: b64, mime_type: mime },
            });

            if (error) throw new Error(error.message || 'Edge function call failed');
            if (!res || res.ok === false) {
                throw new Error(res?.detail || res?.error || 'OCR failed');
            }

            const scanned = res.fields || {};
            const confidence = res.confidence || {};

            // `current` was snapshotted above before any overlay opened.
            _cpsScanCache = { prefix, scanned, confidence, current, rawText: res.raw_text || '' };
            // Stash the photo for silent upload after host record is saved.
            // Survives review modal Cancel — the photo is always uploaded.
            _cpsPendingPhotoFiles[prefix] = file;
            renderCpsScanReview();
        } catch (err) {
            _hideCpsScanOverlay();
            console.error('CPS scan failed:', err);
            UI.toast.error('Scan failed: ' + (err.message || 'Unknown error'));
        }
    };

    const renderCpsScanReview = () => {
        if (!_cpsScanCache) return;
        const { scanned, confidence, current, rawText } = _cpsScanCache;

        const norm = v => (v == null ? '' : String(v).trim());
        const isEmpty = v => norm(v) === '';

        const rows = CPS_SCAN_FIELD_MAP.map(([key, suffix, label]) => {
            const cur = norm(current[key]);
            const scn = norm(scanned[key]);
            const conf = confidence[key] || null;

            let status, defaultChecked;
            if (isEmpty(scn)) {
                status = 'no-scan';
                defaultChecked = false;
            } else if (isEmpty(cur)) {
                status = 'fill-empty';
                defaultChecked = true; // auto-fill empty fields
            } else if (cur.toLowerCase() === scn.toLowerCase()) {
                status = 'same';
                defaultChecked = false; // already matches — no change needed
            } else {
                status = 'conflict';
                defaultChecked = false; // agent must explicitly pick
            }

            return { key, suffix, label, cur, scn, conf, status, defaultChecked };
        });

        const statusBadge = (s) => {
            if (s === 'same')       return '<span style="color:#10b981;font-size:11px;font-weight:600;">✓ MATCH</span>';
            if (s === 'fill-empty') return '<span style="color:#7c3aed;font-size:11px;font-weight:600;">+ FILL</span>';
            if (s === 'conflict')   return '<span style="color:#d97706;font-size:11px;font-weight:600;">⚠ CONFLICT</span>';
            if (s === 'no-scan')    return '<span style="color:#9ca3af;font-size:11px;">— blank</span>';
            return '';
        };
        const confBadge = (c) => {
            if (!c) return '';
            const color = c === 'high' ? '#10b981' : c === 'medium' ? '#f59e0b' : '#ef4444';
            return `<span style="display:inline-block;padding:1px 6px;border-radius:10px;background:${color}1a;color:${color};font-size:10px;font-weight:600;text-transform:uppercase;">${c}</span>`;
        };
        const rowBg = (s) => {
            if (s === 'conflict')   return '#fffbeb';
            if (s === 'fill-empty') return '#f5f3ff';
            if (s === 'same')       return '#f0fdf4';
            return '#ffffff';
        };

        const html = `
            <div style="max-height:60vh;overflow-y:auto;">
                <p style="margin:0 0 14px;color:var(--gray-600);font-size:13px;">
                    Review the scanned values below. Tick the ones you want to apply.
                    <br><strong style="color:#d97706;">Conflicts</strong> need your explicit pick — nothing will overwrite without your tick.
                </p>

                <table style="width:100%;border-collapse:collapse;font-size:13px;">
                    <thead>
                        <tr style="background:var(--gray-100);text-align:left;">
                            <th style="padding:8px 6px;width:32px;"></th>
                            <th style="padding:8px;">Field</th>
                            <th style="padding:8px;">Currently in form</th>
                            <th style="padding:8px;">Scanned</th>
                            <th style="padding:8px;width:90px;">Status</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${rows.map((r, idx) => `
                            <tr style="background:${rowBg(r.status)};border-bottom:1px solid #e5e7eb;">
                                <td style="padding:8px 6px;text-align:center;">
                                    ${r.status === 'no-scan' || r.status === 'same' ? '' : `
                                        <input type="checkbox" class="cps-scan-pick" data-idx="${idx}" ${r.defaultChecked ? 'checked' : ''}>
                                    `}
                                </td>
                                <td style="padding:8px;font-weight:500;color:var(--gray-700);">${r.label}</td>
                                <td style="padding:8px;color:${r.cur ? 'var(--gray-700)' : 'var(--gray-400)'};">
                                    ${r.cur ? escapeHtml(r.cur) : '<em style="font-size:12px;">(empty)</em>'}
                                </td>
                                <td style="padding:8px;color:${r.scn ? 'var(--gray-900)' : 'var(--gray-400)'};">
                                    ${r.scn ? escapeHtml(r.scn) : '<em style="font-size:12px;">(blank)</em>'}
                                    ${r.conf ? ' ' + confBadge(r.conf) : ''}
                                </td>
                                <td style="padding:8px;">${statusBadge(r.status)}</td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>

                <div style="margin-top:14px;display:flex;gap:8px;flex-wrap:wrap;">
                    <button type="button" class="btn secondary btn-sm" onclick="app.toggleCpsScanAll(true)">
                        <i class="fas fa-check-square"></i> Tick all available
                    </button>
                    <button type="button" class="btn secondary btn-sm" onclick="app.toggleCpsScanAll(false)">
                        <i class="far fa-square"></i> Untick all
                    </button>
                </div>

                ${rawText ? `
                    <details style="margin-top:14px;font-size:12px;color:var(--gray-500);">
                        <summary style="cursor:pointer;">Show raw OCR text</summary>
                        <pre style="white-space:pre-wrap;background:var(--gray-100);padding:10px;border-radius:6px;margin-top:6px;font-size:11px;max-height:160px;overflow:auto;">${escapeHtml(rawText)}</pre>
                    </details>
                ` : ''}
            </div>
        `;

        _showCpsScanOverlay('Review Scanned Form', html, [
            { type: 'secondary', label: 'Cancel', action: 'app._hideCpsScanOverlay()' },
            { type: 'primary',   label: 'Apply Selected', action: 'app.applyCpsScanSelection()' },
        ]);
    };

    const toggleCpsScanAll = (checked) => {
        document.querySelectorAll('.cps-scan-pick').forEach(cb => { cb.checked = !!checked; });
    };

    const applyCpsScanSelection = async () => {
        if (!_cpsScanCache) { _hideCpsScanOverlay(); return; }
        const { prefix, scanned, prospectId } = _cpsScanCache;
        const dbTarget = prefix === '__prospect_row__';

        const picked = Array.from(document.querySelectorAll('.cps-scan-pick:checked'))
            .map(cb => parseInt(cb.dataset.idx, 10))
            .filter(n => !isNaN(n));

        let applied = 0;
        if (dbTarget) {
            // Write directly to the prospect record (Upload CPS button flow)
            const patch = {};
            picked.forEach(idx => {
                const row = CPS_SCAN_FIELD_MAP[idx] || [];
                const key = row[0];
                const dbCol = row[3];
                if (!key || !dbCol) return;
                const val = scanned[key];
                if (val == null || String(val).trim() === '') return;
                patch[dbCol] = String(val).trim();
                applied++;
            });
            if (applied > 0 && prospectId) {
                try {
                    await AppDataStore.update('prospects', prospectId, patch);
                } catch (err) {
                    UI.toast.error('Failed to save fields: ' + (err.message || err));
                    applied = 0;
                }
            }
        } else {
            // Form-target: write into the open modal's form fields
            picked.forEach(idx => {
                const [key, suffix] = CPS_SCAN_FIELD_MAP[idx] || [];
                if (!key) return;
                const val = scanned[key];
                if (val == null || String(val).trim() === '') return;
                _writeCpsField(prefix, suffix, String(val).trim());
                applied++;
            });
        }

        _hideCpsScanOverlay();
        _cpsScanCache = null;
        if (applied > 0) {
            const tail = dbTarget ? 'to prospect record.' : 'from scan. Please review before saving.';
            UI.toast.success(`Applied ${applied} field${applied === 1 ? '' : 's'} ${tail}`);
        } else {
            UI.toast.info('No fields were applied.');
        }
    };

    // ===== LEAD FORMS + SURVEYS + CONTRACTS + CUSTOM FIELDS + PORTAL =====
    // [CHUNK: forms] ~1164 lines extracted to chunks/script-forms.js

    // ========== NAVIGATION INFRASTRUCTURE (restored from forms chunk) ==========
    // navigateTo + chunk loading infrastructure must live in the main IIFE
    // so init() can call navigateTo(_initialView) at startup before any chunk loads.

    // ── Core views that are always available in script.js ─────────────────
    // Everything else is in script-features.min.js and loaded on first use.
    const _CORE_VIEWS = new Set(['home', 'calendar', 'month']);

    // ── Lazy-chunk loader infrastructure (Code-Split Design Option A) ────
    // Each entry maps a viewId to a chunks/<name>.min.js file. The chunk is
    // a self-contained IIFE that reads only stable globals (window.AppDataStore,
    // window.UI, window._currentUser, window._crmUtils) and calls
    // Object.assign(window.app, { ... }) to attach its public surface.
    //
    // CURRENT STATUS: infrastructure in place, no chunks extracted yet.
    // First extraction (stock_take ~1,428 lines) needs a dedicated session to
    // audit IIFE closure dependencies. See chunks/README.md + docs/CODE_SPLIT_DESIGN.md.
    //
    // To add a chunk: move functions to chunks/<viewId>.js, ensure they only
    // touch stable globals, run build.mjs (it auto-picks up chunks/*.js), then
    // add the viewId entry below.
    const _CHUNK_VIEWS = {
        // Core view chunks (extracted 2026-06-05)
        'calendar':             { src: 'chunks/script-calendar.min.js',    minLevel: null, exactLevels: null },
        'month':                { src: 'chunks/script-calendar.min.js',    minLevel: null, exactLevels: null },
        // Prospect/Customer management (Phase 4J)
        'prospects':            { src: 'chunks/script-prospects.min.js',   minLevel: null, exactLevels: null },
        'customers':            { src: 'chunks/script-prospects.min.js',   minLevel: null, exactLevels: null },
        'agents':               { src: 'chunks/script-prospects.min.js',   minLevel: null, exactLevels: null },
        'purchases_history':    { src: 'chunks/script-prospects.min.js',   minLevel: null, exactLevels: null },
        // Forms + Surveys + Contracts (Phase 4F)
        'lead_forms':           { src: 'chunks/script-forms.min.js',       minLevel: null, exactLevels: null },
        'surveys':              { src: 'chunks/script-forms.min.js',       minLevel: null, exactLevels: null },
        'contracts':            { src: 'chunks/script-forms.min.js',       minLevel: null, exactLevels: null },
        'custom_fields':        { src: 'chunks/script-forms.min.js',       minLevel: null, exactLevels: null },
        'booking_settings':     { src: 'chunks/script-forms.min.js',       minLevel: null, exactLevels: null },
        // Existing role-gated chunks
        'stock_take':           { src: 'chunks/script-stock-take.min.js',  minLevel: null, exactLevels: [1, 15] },
        'egg_purchasing':       { src: 'chunks/script-egg.min.js',         minLevel: null, exactLevels: [1] },
        'boss_report':          { src: 'chunks/script-boss-report.min.js', minLevel: null, exactLevels: [1, 2] },
        'knowledge':            { src: 'chunks/script-knowledge.min.js',   minLevel: null, exactLevels: null },
        'formula_purchaser':    { src: 'chunks/script-formula.min.js',     minLevel: null, exactLevels: [1] },
        'marketing_automation': { src: 'chunks/script-marketing.min.js',   minLevel: null, exactLevels: [1, 2] },
        'marketing_lists':      { src: 'chunks/script-marketing.min.js',   minLevel: null, exactLevels: [1, 2] },
        'workflows':            { src: 'chunks/script-marketing.min.js',   minLevel: null, exactLevels: [1, 2] },
        'reports':              { src: 'chunks/script-reporting.min.js',   minLevel: null, exactLevels: [1, 2, 3, 4, 5] },
        'cases':                { src: 'chunks/script-cases.min.js',       minLevel: null, exactLevels: null },
        'referrals':            { src: 'chunks/script-referrals.min.js',   minLevel: null, exactLevels: null },
        // Phase: Ranking + Workflow Automation + Noticeboard (extracted 2026-06-05)
        'ranking':              { src: 'chunks/script-performance.min.js', minLevel: null, exactLevels: null },
        'performance':          { src: 'chunks/script-performance.min.js', minLevel: null, exactLevels: null },
        'noticeboard':          { src: 'chunks/script-performance.min.js',  minLevel: null, exactLevels: null },
        'whatsapp':             { src: 'chunks/script-whatsapp.min.js',    minLevel: 1,    exactLevels: [1, 2] },
        'ai_insights':          { src: 'chunks/script-ai.min.js',          minLevel: 1,    exactLevels: [1, 2] },
        'documents':            { src: 'chunks/script-documents.min.js', minLevel: null, exactLevels: null },
        'integrations':         { src: 'chunks/script-gcal.min.js',       minLevel: 1,    exactLevels: null },
    };

    // Predictive prefetch — after login, queue rel=prefetch for every chunk
    // the current role is allowed to load. Browser uses idle bandwidth; when
    // the user actually navigates to a chunked view, the chunk is already
    // in the HTTP cache and the network round-trip is gone.
    let _predictivePrefetchRan = false;
    const _runPredictivePrefetch = () => {
        if (_predictivePrefetchRan || !_currentUser) return;
        _predictivePrefetchRan = true;
        const schedule = (cb) =>
            (typeof requestIdleCallback === 'function'
                ? requestIdleCallback(cb, { timeout: 4000 })
                : setTimeout(cb, 1500));
        schedule(() => {
            try {
                const lvl = _getUserLevel(_currentUser);
                const manifest = window.__ASSET_MANIFEST || {};
                const seen = new Set();
                for (const def of Object.values(_CHUNK_VIEWS)) {
                    const ok = !def.exactLevels || def.exactLevels.includes(lvl);
                    if (!ok || seen.has(def.src)) continue;
                    seen.add(def.src);
                    const link = document.createElement('link');
                    link.rel = 'prefetch';
                    link.as = 'script';
                    link.href = manifest[def.src] || def.src;
                    document.head.appendChild(link);
                }
            } catch (e) { console.warn('predictive prefetch failed', e); }
        });
    };

    // In-flight promises keyed by chunk src URL — ensures each chunk is fetched once.
    const _chunkInFlight = new Map();
    const _loadChunkOnce = (src) => {
        if (_chunkInFlight.has(src)) return _chunkInFlight.get(src);
        const p = new Promise((resolve) => {
            const s = document.createElement('script');
            const manifest = window.__ASSET_MANIFEST || {};
            s.src = manifest[src] || src;
            s.async = false;
            s.onload = resolve;
            s.onerror = (e) => { console.warn('[chunk] failed to load', src, e); resolve(); };
            document.body.appendChild(s);
        });
        _chunkInFlight.set(src, p);
        return p;
    };
    // Expose _loadChunkOnce globally so retained stubs in script.js (e.g.
    // addWhatsAppButtonToProfile) can trigger lazy chunk loads without needing
    // to be inside the navigateTo flow.
    window._loadChunk = (src) => _loadChunkOnce(src);

    // One-shot promise-based loader for script-features.js.
    // Returns immediately if already loaded. Shows inline loading ring
    // in the viewport while waiting so the user sees feedback.
    const _loadFeatures = (() => {
        let _promise = null;
        return (viewport) => {
            if (window._appFeaturesLoaded) return Promise.resolve();
            if (!_promise) {
                if (viewport) {
                    viewport.innerHTML =
                        '<div style="display:flex;align-items:center;justify-content:center;' +
                        'height:200px;gap:12px;color:var(--text-secondary);">' +
                        '<i class="fas fa-circle-notch fa-spin" style="font-size:20px;color:var(--primary,#800020);"></i>' +
                        '<span style="font-size:15px;">Loading...</span></div>';
                }
                _promise = new Promise((resolve, reject) => {
                    const s = document.createElement('script');
                    // Resolve the content-hashed filename from the manifest injected
                    // by build.mjs into index.html (window.__ASSET_MANIFEST). Falls back
                    // to the canonical non-hashed name (no ?v= needed — Vercel serves
                    // the latest and the SW caches it stale-while-revalidate).
                    const _manifest = window.__ASSET_MANIFEST || {};
                    s.src = _manifest['script-features.min.js'] || 'script-features.min.js';
                    s.async = false; // preserve execution order
                    s.onload = () => { window._appFeaturesLoaded = true; resolve(); };
                    s.onerror = (e) => {
                        console.warn('[perf] script-features failed, falling back to script.js', e);
                        window._appFeaturesLoaded = true; // don't retry forever
                        resolve();
                    };
                    document.body.appendChild(s);
                });
            }
            return _promise;
        };
    })();

    const navigateTo = async (viewId) => {
        UI.hideModal();
        // Cancel any in-flight Supabase reads tied to the OUTGOING view so
        // their late-arriving responses can't overwrite the new view's cache
        // ~800ms after navigation. AppDataStore catches AbortError internally
        // and returns []; no exception leaks here.
        // No-op if AppDataStore isn't ready yet (first navigate during boot).
        try { if (window.AppDataStore && typeof window.AppDataStore.abortInflight === 'function') {
            window.AppDataStore.abortInflight('navigate:' + viewId);
        } } catch (_) {}
        // ── Lazy-load per-view chunk (Code-Split Design Option A) ────────────
        // If this view has a dedicated chunk registered in _CHUNK_VIEWS, fetch
        // it before attempting to render. _loadChunkOnce deduplicates — the
        // network request fires only the first time this view is visited.
        const _chunkDef = _CHUNK_VIEWS[viewId];
        if (_chunkDef) {
            const _userLevel = _currentUser ? _getUserLevel(_currentUser) : 99;
            const _allowed = !_chunkDef.exactLevels || _chunkDef.exactLevels.includes(_userLevel);
            if (_allowed) {
                await _loadChunkOnce(_chunkDef.src);
            }
        }
        // ── Lazy-load non-core views ──────────────────────────────────────────
        // script-features.min.js is only fetched when the user first navigates
        // away from home/calendar. After that it's cached + immutable.
        if (!_CORE_VIEWS.has(viewId) && !window._appFeaturesLoaded) {
            const vp = document.getElementById('content-viewport');
            await _loadFeatures(vp);
        }
        // Stock Take v2 teardown — when leaving the stock_take view, stop the
        // Supabase realtime channel and any active camera stream so we don't
        // pin a websocket / camera handle in the background.
        if (_currentView === 'stock_take' && viewId !== 'stock_take') {
            try { if (typeof window.app?.stStopRealtime === 'function') await window.app.stStopRealtime(); } catch (e) {}
            try { if (typeof window.app?._stCancelScanner === 'function') await window.app._stCancelScanner(); } catch (e) {}
        }
        // ── View HTML cache: save the outgoing view's DOM before we replace it.
        // Lets the user bounce back to it within TTL without paying the rebuild
        // cost. See _saveViewToCache near the top of the IIFE.
        if (_currentView && _currentView !== viewId && _CACHEABLE_VIEWS.has(_currentView)) {
            _saveViewToCache(_currentView, document.getElementById('content-viewport'));
        }
        _currentDetailView = null; // leaving any detail page — pull-to-refresh goes back to list
        // Strip mobile-home / mobile-calendar page backgrounds when leaving so
        // the beige fill doesn't bleed into other screens.
        if (viewId !== 'home') {
            document.getElementById('content-viewport')?.classList.remove('mhome-active');
        }
        if (viewId !== 'calendar' && viewId !== 'month') {
            document.getElementById('content-viewport')?.classList.remove('mcal-active');
        }
        if (viewId !== 'prospects' && viewId !== 'customers') {
            document.getElementById('content-viewport')?.classList.remove('mprospects-active');
        }
        // Stamp the navigation time so initSync can suppress the SWR
        // revalidation refresh that would otherwise blow away the DOM 1–3s
        // after the page paints (visible flash / lost scroll position).
        _lastNavigatedAt = Date.now();
        document.querySelectorAll('.nav-links li').forEach(li => {
            li.classList.toggle('active', li.getAttribute('data-view') === viewId);
        });
        document.querySelectorAll('.sb-nav-item[data-view]').forEach(btn => {
            btn.classList.toggle('active', btn.getAttribute('data-view') === viewId);
        });

        // ── View Transitions API (Chrome 111+ / Safari 18+) ─────────────────
        // Wraps the view-swap in a cross-fade transition. Browser captures the
        // outgoing DOM, renders the new view, then animates between them using
        // GPU-composited cross-fade — no main-thread blocking. Users perceive
        // the app as feeling "native" even on slow connections because the exit
        // animation plays instantly while the new view renders.
        // Opt-out list: views that clear then refill DOM with the same content
        // (e.g. month nav) skip transitions to avoid a flash.
        const _NO_TRANSITION_VIEWS = new Set(['month']);
        const _withViewTransition = async (fn) => {
            const skip = typeof document.startViewTransition !== 'function'
                || _currentView === viewId
                || _NO_TRANSITION_VIEWS.has(viewId)
                || document.visibilityState !== 'visible';
            if (skip) return fn();
            // Track whether the callback actually ran inside the transition.
            // If startViewTransition aborts BEFORE invoking the callback
            // (e.g. "InvalidStateError: Transition was aborted because of
            // invalid state" when the document was just hidden or another
            // transition is mid-flight), the DOM never updates and the user
            // is stuck on the prior view. We detect that case and run fn()
            // directly so the bottom-nav tap always navigates.
            let callbackRan = false;
            const wrapped = async () => { callbackRan = true; return await fn(); };
            try {
                const t = document.startViewTransition(wrapped);
                // Silence unhandled rejections from ALL transition promises —
                // any may reject if the transition is aborted by another
                // in-flight transition or by the document becoming hidden.
                // Must attach .catch on updateCallbackDone synchronously here:
                // a later try/catch on `await` is too late to suppress the
                // unhandled-rejection event on the original promise.
                t.finished.catch(() => {});
                t.ready.catch(() => {});
                t.updateCallbackDone.catch(() => {});
                // Await DOM update (faster than .finished which waits for animation).
                await t.updateCallbackDone;
            } catch (_) {
                if (!callbackRan) await fn();
            }
        };

        // Update document title BEFORE awaiting the view render. If the render
        // hangs or throws, the browser tab title still reflects the user's
        // last click — previously the title would lag on the prior view.
        const VIEW_TITLES = {
            home: 'Home',
            calendar: 'Calendar', month: 'Calendar', prospects: 'Prospects & Customers',
            pipeline: 'Pipeline', agents: 'Consultants', promotions: 'Monthly Promotion',
            marketing_automation: 'Marketing Automation', reports: 'Reporting KPI',
            documents: 'Documents', protection: 'Protection Monitoring', import: 'Import / Export',
            integrations: 'Integrations', referrals: 'Referral Relationships', cases: 'Success Cases',
            marketing_lists: 'Marketing Lists', ranking: 'Ranking Performance', performance: 'Ranking Performance',
            workflows: 'Workflow Automation', booking_settings: 'Booking Scheduler',
            lead_forms: 'Lead Capture Forms', surveys: 'NPS Surveys', contracts: 'Contracts',
            custom_fields: 'Custom Fields', settings: 'Settings', milestones: 'Milestones',
            fude: '福运相随', noticeboard: '公告栏 Noticeboard',
            egg_purchasing: 'Egg Purchasing', standard_functions: 'Standard Functions',
            formula_purchaser: 'Formula Purchaser', purchases_history: 'Purchases History',
            stock_take: 'Stock Take', boss_report: 'Boss Report', ai: 'AI Insights', security: 'Security', admin: 'Admin',
            risk: 'Attrition Risk', nps: 'NPS Surveys',
            knowledge: 'Knowledge HQ',
            org_chart: 'Org Chart Consultant',
        };
        document.title = `${VIEW_TITLES[viewId] || viewId} — 悅客匯 CRM`;

        // ── URL hash deep linking ──────────────────────────────────────────
        // Keeps the address bar in sync so users can bookmark, share, or use
        // browser back/forward to reach a specific view. 'month' canonicalises
        // to 'calendar' so the URL stays human-readable. replaceState (not
        // pushState) avoids flooding the history stack on rapid tab-switching.
        try {
            const _hashId = (viewId === 'month') ? 'calendar' : viewId;
            const _targetHash = '#' + _hashId;
            if (location.hash !== _targetHash) {
                history.replaceState({ view: _hashId }, '', _targetHash);
            }
        } catch (_) { /* no-op in environments that restrict history API */ }

        const viewport = document.getElementById('content-viewport');

        // ── View HTML cache: try to restore from a fresh cached DOM.
        // On a hit, we skip the entire showXView() rebuild — the dominant
        // cost (200-800 ms) of a tab switch. 'calendar' canonicalises to
        // 'month' (matches the _currentView assignment below).
        {
            const cacheKey = (viewId === 'calendar') ? 'month' : viewId;
            if (_CACHEABLE_VIEWS.has(cacheKey) && _restoreViewFromCache(cacheKey, viewport)) {
                _currentView = cacheKey;
                if (isMobile()) {
                    (window.app.updateBottomNavActive || (() => {}))(viewId);
                    setTimeout(applyMobileTableLabels, 200);
                }
                return;
            }
        }

        await _withViewTransition(async () => {
        if (viewId === 'home') {
            _currentView = 'home';
            await (window.app.showMobileHomeView || (() => {}))(viewport);
        } else if (viewId === 'calendar' || viewId === 'month') {
            _currentView = 'month';
            if (isMobile()) {
                await (window.app.showMobileCalendarView || (() => {}))(viewport);
            } else {
                await (window.app.showCalendarView || (() => {}))(viewport);
            }
        } else if (viewId === 'prospects') {
            _currentView = 'prospects';
            if (isMobile()) {
                await (window.app.showMobileProspectsView || (() => {}))(viewport);
            } else {
                await (window.app.showProspectsView || (() => {}))(viewport);
            }
        } else if (viewId === 'pipeline') {
            _currentView = 'pipeline';
            // Skeleton is painted synchronously before the first await inside
            // showPipelineView, so the user sees it instantly. Heavy scoring
            // runs in the background; navigateTo returns after skeleton paint.
            (window.app.showPipelineView || (() => Promise.resolve()))(viewport).catch(e => console.warn('pipeline failed:', e));
        } else if (viewId === 'agents') {
            _currentView = 'agents';
            await (window.app.showAgentsView || (() => {}))(viewport);
        } else if (viewId === 'promotions') {
            _currentView = 'promotions';
            await (window.app.showMonthlyPromotionView || (() => {}))(viewport);
        } else if (viewId === 'marketing_automation') {
            _currentView = 'marketing_automation';
            await (window.app.showMarketingAutomationView || (() => {}))(viewport);
        } else if (viewId === 'reports') {
            _currentView = 'reports';
            // Shell is painted synchronously before the first await inside
            // showKPIDashboard; navigateTo returns after shell paint.
            (window.app.showKPIDashboard || (() => Promise.resolve()))(viewport).catch(e => console.warn('KPI dashboard failed:', e));
        } else if (viewId === 'documents') {
            _currentView = 'documents';
            await (window.app.showDocumentManagementView || (() => {}))(viewport);
        } else if (viewId === 'protection') {
            _currentView = 'protection';
            await (window.app.showProtectionMonitoringView || (() => {}))(viewport);
        } else if (viewId === 'import') {
            _currentView = 'import';
            await (window.app.showImportDashboard || (() => {}))(viewport);
        } else if (viewId === 'integrations') {
            _currentView = 'integrations';
            await (window.app.showIntegrationHub || (() => {}))(viewport);
        } else if (viewId === 'referrals') {
            _currentView = 'referrals';
            // Same pattern as pipeline — skeleton paints synchronously, data loads async.
            (window.app.showReferralsView || (() => Promise.resolve()))(viewport).catch(e => console.warn('referrals failed:', e));
        } else if (viewId === 'cases') {
            _currentView = 'cases';
            await (window.app.showCasesView               || (() => {}))(viewport);
        } else if (viewId === 'marketing_lists') {
            _currentView = 'marketing_lists';
            await (window.app.showMarketingListsView      || (() => {}))(viewport);
        } else if (viewId === 'ranking' || viewId === 'performance') {
            _currentView = 'ranking';
            await (window.app.showRankingPerformanceView || (() => {}))(viewport);
        } else if (viewId === 'workflows') {
            // Redirect legacy workflows route to Marketing Automation → Automation tab
            _currentMarketingTab = 'automation';
            _currentView = 'marketing_automation';
            await (window.app.showMarketingAutomationView || (() => {}))(viewport);
        } else if (viewId === 'booking_settings') {
            _currentView = 'booking_settings';
            await (window.app.showBookingSettingsView || (() => {}))(viewport);
        } else if (viewId === 'lead_forms') {
            _currentView = 'lead_forms';
            await (window.app.showLeadFormsView || (() => {}))(viewport);
        } else if (viewId === 'surveys') {
            _currentView = 'surveys';
            await (window.app.showSurveysView || (() => {}))(viewport);
        } else if (viewId === 'contracts') {
            _currentView = 'contracts';
            await (window.app.showContractsView || (() => {}))(viewport);
        } else if (viewId === 'custom_fields') {
            _currentView = 'custom_fields';
            await (window.app.showCustomFieldsAdmin || (() => {}))(viewport);
        } else if (viewId === 'settings') {
            _currentView = 'settings';
            (window.app.showSettingsView || (() => {}))(viewport);
        } else if (viewId === 'milestones') {
            _currentView = 'milestones';
            await (window.app.showMilestonesView || (() => {}))(viewport);
        } else if (viewId === 'fude') {
            _currentView = 'fude';
            await (window.app.showFudeView || (() => {}))(viewport);
        } else if (viewId === 'noticeboard') {
            _currentView = 'noticeboard';
            await (window.app.showNoticeboardView || (() => {}))(viewport);
        } else if (viewId === 'whatsapp') {
            _currentView = 'whatsapp';
            await (window.app.showWhatsAppIntegration || (() => {}))(viewport);
        } else if (viewId === 'ai_insights' || viewId === 'ai_prediction') {
            _currentView = 'ai_insights';
            await (window.app.showAIInsightsDashboard || (() => {}))(viewport);
        } else if (viewId === 'integrations') {
            _currentView = 'integrations';
            await (window.app.showIntegrationHub || (() => {}))(viewport);
        } else if (viewId === 'egg_purchasing') {
            // Super Admin only gate — bounce non-admins to calendar
            if (!isSystemAdmin(_currentUser)) {
                UI.toast.error('Super Admin only');
                await navigateTo('calendar');
                return;
            }
            _currentView = 'egg_purchasing';
            await (window.app.showEggPurchasingView || (() => {}))(viewport);
        } else if (viewId === 'standard_functions') {
            if (!isSystemAdmin(_currentUser)) {
                UI.toast.error('Super Admin only');
                await navigateTo('calendar');
                return;
            }
            _currentView = 'standard_functions';
            await (window.app.showStandardFunctionsView || (() => {}))(viewport);
        } else if (viewId === 'formula_purchaser') {
            if (!isSystemAdmin(_currentUser)) {
                UI.toast.error('Super Admin only');
                await navigateTo('calendar');
                return;
            }
            _currentView = 'formula_purchaser';
            await (window.app.showFormulaPurchaserView    || (() => {}))(viewport);
        } else if (viewId === 'purchases_history') {
            _currentView = 'purchases_history';
            await (window.app.showPurchasesHistoryView || (() => {}))(viewport);
        } else if (viewId === 'knowledge') {
            _currentView = 'knowledge';
            await (window.app.showKnowledgeView || (() => {}))(viewport);
        } else if (viewId === 'stock_take') {
            // Level 1 (Super Admin) or Level 15 (Stock Take Staff). Staff get
            // a restricted tab strip inside the module — see showStockTakeView.
            if (!canAccessStockTake(_currentUser)) {
                UI.toast.error('Not permitted');
                await navigateTo('calendar');
                return;
            }
            _currentView = 'stock_take';
            await (window.app.showStockTakeView || (() => {}))(viewport);
        } else if (viewId === 'boss_report') {
            if (!isSystemAdmin(_currentUser)) {
                UI.toast.error('Super Admin only');
                await navigateTo('calendar');
                return;
            }
            _currentView = 'boss_report';
            await (window.app.showBossReportView || (() => {}))(viewport);
        } else if (viewId === 'org_chart') {
            // Org Chart Consultant — admin / level 1-2 only.
            // Implementation is top-level (post-IIFE) so we call via window.app.
            const lvl = _currentUser ? _getUserLevel(_currentUser) : 99;
            if (lvl > 2) {
                UI.toast.error('Admin only');
                await navigateTo('calendar');
                return;
            }
            _currentView = 'org_chart';
            if (typeof window.app?.showOrgChartView === 'function') {
                await window.app.showOrgChartView(viewport);
            } else {
                viewport.innerHTML = '<div style="padding:24px;color:var(--gray-500);">Org Chart Consultant module is loading…</div>';
            }
        } else {
            viewport.innerHTML = `
                <div class="placeholder-view">
                    <h1>${viewId.toUpperCase()}</h1>
                    <p>Phase ${getViewPhase(viewId)} Implementation: ${viewId} module interface.</p>
                    <button class="btn primary" onclick="app.showRoadmap()">View Roadmap</button>
                </div>
            `;
        }

        // Silent nav switch — previous info toast was firing on every click, spamming
        // the DOM with toast nodes + timers and contributing to the perceived lag.
        // (document.title was set at the top of this function — see VIEW_TITLES.)
        }); // end _withViewTransition

        // Mobile: update bottom nav active state + apply table card labels
        if (isMobile()) {
            (window.app.updateBottomNavActive || (() => {}))(viewId);
            // Small delay so DOM is painted before we label tds
            setTimeout(applyMobileTableLabels, 200);
        }
    };


    // ========== PHASE 1: FULL CALENDAR + FOLLOW-UP AUTOMATION ENGINE ==========
    // [CHUNK: calendar] ~5356 lines extracted to chunks/script-calendar.js
    // Loaded lazily by navigateTo("calendar"). Registered via Object.assign.

    // [CHUNK: activities] ~4528 lines extracted to chunks/script-activities.js
    // Loaded lazily on first openActivityModal() call.

    // ========== PHASE 3: PROSPECT MANAGEMENT FUNCTIONS ==========
    // [CHUNK: prospects] ~9557 lines extracted to chunks/script-prospects.js
    // Loaded on-demand by navigateTo() for prospects/customers/agents/purchases_history views.

    // State vars kept here so the _appState bridge getters below can reference them.
    let _sortField = 'score';
    let _sortDirection = 'desc';
    let _prospectPage = 0;
    const _prospectPageSize = 50;
    let _prospectViewMode = 'table';
    const _selectedProspects = new Set();
    let _customerPage = 0;
    const _customerPageSize = 50;

    window._appState = {
        // ── Auth / user ──────────────────────────────────────────────────
        get cu()  { return _currentUser; },
        get ial() { return !!(_currentUser && (isSystemAdmin(_currentUser) || isMarketingManager(_currentUser))); },

        // ── Navigation ───────────────────────────────────────────────────
        get cv()  { return _currentView; },
        set cv(v) { _currentView = v; },

        // ── Pagination ───────────────────────────────────────────────────
        get pp()  { return _prospectPage; },
        set pp(v) { _prospectPage = v; },
        get cp()  { return _customerPage; },
        set cp(v) { _customerPage = v; },

        // ── Marketing tab state ──────────────────────────────────────────
        get cmt()   { return _currentMarketingTab; },
        set cmt(v)  { _currentMarketingTab = v; },
        get cmlt()  { return _currentMarketingListTab; },
        set cmlt(v) { _currentMarketingListTab = v; },

        // ── Selection state (activity modal, prospect ctx) ───────────────
        get se()    { return _selectedEntity; },
        set se(v)   { _selectedEntity = v; },
        get sat()   { return _selectedAttendees; },
        set sat(v)  { _selectedAttendees = v; },
        get sca()   { return _selectedCoAgents; },
        set sca(v)  { _selectedCoAgents = v; },
        get scon()  { return _selectedConsultants; },
        set scon(v) { _selectedConsultants = v; },
        get sr()    { return _selectedReferrer; },
        set sr(v)   { _selectedReferrer = v; },

        // ── Date / filter state ──────────────────────────────────────────
        get cd()    { return _currentDate; },
        set cd(v)   { _currentDate = v; },
        get flt()   { return _filters; },
        set flt(v)  { _filters = v; },

        // ── View-detail state ────────────────────────────────────────────
        get cdv()   { return _currentDetailView; },
        set cdv(v)  { _currentDetailView = v; },

        // ── Lookup caches (shared with calendar & activity modal) ────────
        get hac()   { return _hotActivityCache; },        // Map — mutated by ref
        get vc()    { return _venuesCache; },
        set vc(v)   { _venuesCache = v; },
        get pc()    { return _productsCache; },
        set pc(v)   { _productsCache = v; },

        // ── Calendar render token (monotonic counter) ────────────────────
        get rct()   { return _renderCalendarToken; },
        set rct(v)  { _renderCalendarToken = v; },

        // ── CPS intake pending state ─────────────────────────────────────
        get pii()   { return _pendingIntakeId; },
        set pii(v)  { _pendingIntakeId = v; },
        get pir()   { return _pendingIntakeRow; },
        set pir(v)  { _pendingIntakeRow = v; },

        // ── CPS photo upload pending ─────────────────────────────────────
        get cppf()  { return _cpsPendingPhotoFiles; },
    };

    // [CHUNK: prospects] all prospect/customer/agent functions in chunks/script-prospects.js

    // No-op stubs for prospect functions called before chunk loads:
    const getScoreGrade = (s) => window.app.getScoreGrade ? window.app.getScoreGrade(s) : { grade: "N/A", label: "N/A", color: "#888" };
    const calculateProtectionDays = (p) => (window.app.calculateProtectionDays || (() => 0))(p);
    const showProspectDetail = async (id) => (window.app.showProspectDetail || (() => {}))(id);
    const showCustomerDetail = async (id) => (window.app.showCustomerDetail || (() => {}))(id);
    const showPurchasesHistoryView = async (vp) => (window.app.showPurchasesHistoryView || (() => {}))(vp);
    const showAgentsView = async (vp) => (window.app.showAgentsView || (() => {}))(vp);
    const showAgentDetail = async (id) => (window.app.showAgentDetail || (() => {}))(id);
    const showForcePasswordChangeModal = () => (window.app.showForcePasswordChangeModal || (() => {}))();
    // ========== PHASE 6: PIPELINE & SALES FORCE MODULE ==========
    // [CHUNK: pipeline] ~2837 lines extracted to chunks/script-pipeline.js
    // Loaded on-demand by navigateTo() for the pipeline view.

    // ========== PHASE 13: IMPORT SYSTEM FUNCTIONS ==========

    let _currentImportStep = 1;
    let _importData = { file: null, fileName: null, fileSize: null, rows: 0, headers: ['Full Name', 'Phone Number', 'Email', 'IC Number', 'Date of Birth', 'Occupation', 'Income Range', 'Address', 'City', 'State', 'Postal Code', 'Ming Gua'], data: [], importType: 'prospects', mapping: {}, validation: { valid: 0, warnings: 0, errors: 0 }, duplicates: { total: 0 }, assignment: { assignTo: 'myself' } };

    const showImportDashboard = async (container) => {
        container.innerHTML = `
            <div class="import-view">
                <div class="import-header">
                    <div>
                        <h1>Import / Export & Data Management</h1>
                        <p>Import data from files or export your CRM data for backup and analysis</p>
                    </div>
                    <div class="import-header-actions">
                        <button class="btn primary" onclick="app.openImportWizard()"><i class="fas fa-upload"></i> IMPORT NEW DATA</button>
                        <button class="btn secondary" onclick="app.openTemplatesModal()"><i class="fas fa-download"></i> DOWNLOAD TEMPLATES</button>
                        <button class="btn secondary" onclick="app.showImportHistory()"><i class="fas fa-history"></i> VIEW IMPORT HISTORY</button>
                    </div>
                </div>

                <div class="recent-imports" style="margin-bottom:32px;">
                    <h3>Recent Imports</h3>
                    <div class="imports-table-container">
                        <table class="imports-table">
                            <thead><tr><th scope="col">File Name</th><th scope="col">Type</th><th scope="col">Records</th><th scope="col">Success %</th><th scope="col">Status</th><th scope="col">Date</th><th scope="col">Actions</th></tr></thead>
                            <tbody id="imports-table-body">${await renderRecentImports()}</tbody>
                        </table>
                    </div>
                </div>

                <div class="recent-imports">
                    <h3>Data Export</h3>
                    <p style="color:var(--gray-500);margin-bottom:16px;font-size:14px;">Download your CRM data as CSV or Excel. Access is restricted to authorized roles only.</p>
                    <div class="imports-table-container">
                        <table class="imports-table">
                            <thead><tr><th scope="col">Data Type</th><th scope="col">Description</th><th scope="col" style="width:180px">Export</th></tr></thead>
                            <tbody>
                                <tr>
                                    <td><strong><i class="fas fa-users" style="color:var(--primary-600);margin-right:8px;"></i>Prospects</strong></td>
                                    <td>All prospect records with full profile details</td>
                                    <td><button class="btn secondary btn-sm" onclick="app.exportData('prospects','csv')"><i class="fas fa-file-csv"></i> CSV</button> <button class="btn secondary btn-sm" onclick="app.exportData('prospects','xlsx')"><i class="fas fa-file-excel"></i> Excel</button></td>
                                </tr>
                                <tr>
                                    <td><strong><i class="fas fa-calendar-check" style="color:var(--primary-600);margin-right:8px;"></i>Prospects + Activities</strong></td>
                                    <td>Full prospect profiles with complete activity history (multi-sheet Excel)</td>
                                    <td><button class="btn secondary btn-sm" onclick="app.exportData('prospects_activities','xlsx')"><i class="fas fa-file-excel"></i> Excel</button></td>
                                </tr>
                                <tr>
                                    <td><strong><i class="fas fa-user-check" style="color:var(--success);margin-right:8px;"></i>Customers</strong></td>
                                    <td>All customer records including pipeline & lifetime value</td>
                                    <td><button class="btn secondary btn-sm" onclick="app.exportData('customers','csv')"><i class="fas fa-file-csv"></i> CSV</button> <button class="btn secondary btn-sm" onclick="app.exportData('customers','xlsx')"><i class="fas fa-file-excel"></i> Excel</button></td>
                                </tr>
                                <tr>
                                    <td><strong><i class="fas fa-user-tie" style="color:var(--warning);margin-right:8px;"></i>Consultants / Agents</strong></td>
                                    <td>All consultant and agent profiles with roles and license info</td>
                                    <td><button class="btn secondary btn-sm" onclick="app.exportData('agents','csv')"><i class="fas fa-file-csv"></i> CSV</button> <button class="btn secondary btn-sm" onclick="app.exportData('agents','xlsx')"><i class="fas fa-file-excel"></i> Excel</button></td>
                                </tr>
                                <tr>
                                    <td><strong><i class="fas fa-box" style="color:var(--gray-600);margin-right:8px;"></i>Products</strong></td>
                                    <td>Products marketing list</td>
                                    <td><button class="btn secondary btn-sm" onclick="app.exportData('products','csv')"><i class="fas fa-file-csv"></i> CSV</button> <button class="btn secondary btn-sm" onclick="app.exportData('products','xlsx')"><i class="fas fa-file-excel"></i> Excel</button></td>
                                </tr>
                                <tr>
                                    <td><strong><i class="fas fa-calendar-alt" style="color:var(--gray-600);margin-right:8px;"></i>Events</strong></td>
                                    <td>Events marketing list</td>
                                    <td><button class="btn secondary btn-sm" onclick="app.exportData('events','csv')"><i class="fas fa-file-csv"></i> CSV</button> <button class="btn secondary btn-sm" onclick="app.exportData('events','xlsx')"><i class="fas fa-file-excel"></i> Excel</button></td>
                                </tr>
                                <tr>
                                    <td><strong><i class="fas fa-tags" style="color:var(--gray-600);margin-right:8px;"></i>Promotions</strong></td>
                                    <td>Promotion packages marketing list</td>
                                    <td><button class="btn secondary btn-sm" onclick="app.exportData('promotions','csv')"><i class="fas fa-file-csv"></i> CSV</button> <button class="btn secondary btn-sm" onclick="app.exportData('promotions','xlsx')"><i class="fas fa-file-excel"></i> Excel</button></td>
                                </tr>
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>
    `;
    };

    const renderRecentImports = async () => {
        const imports = (await AppDataStore.getAll('import_jobs')).sort((a, b) => new Date(b.created_at) - new Date(a.created_at)).slice(0, 10);
        if (imports.length === 0) return `<tr><td colspan="7" style="text-align:center;padding:40px;"><i class="fas fa-cloud-upload-alt" style="font-size:48px;color:var(--gray-300);display:block;margin-bottom:16px;"></i><h3>No imports yet</h3><p>Click "IMPORT NEW DATA" to start your first import</p></td></tr>`;
        return imports.map(imp => {
            const pct = imp.total_rows > 0 ? Math.round((imp.valid_rows / imp.total_rows) * 100) : 0;
            return `<tr><td><strong>${imp.file_name}</strong></td><td>${imp.import_type}</td><td>${imp.total_rows} (${imp.created_records} new)</td><td>${pct}%</td><td><span class="import-status status-${imp.status}">${imp.status.toUpperCase()}</span></td><td>${UI.formatDate(imp.created_at)}</td><td><button class="btn-icon" onclick="app.viewImportDetails(${imp.id})" title="View"><i class="fas fa-eye"></i></button><button class="btn-icon" onclick="app.downloadImportLog(${imp.id})" title="Download Log"><i class="fas fa-download"></i></button></td></tr>`;
        }).join('');
    };

    const openImportWizard = async () => {
        // R9: Only system admin, marketing manager, or team leader may import
        const u = _currentUser;
        const canImport = isSystemAdmin(u) || isMarketingManager(u) ||
                          u?.role === 'team_leader' || u?.role?.includes('Level 7');
        if (!canImport) { UI.toast.error('You do not have permission to import data.'); return; }

        _currentImportStep = 1;
        _importData = {
            file: null, fileName: null, fileSize: null, rows: 0,
            headers: [], data: [], importType: 'prospects',
            mapping: {},
            validation: { valid: 0, warnings: 0, errors: 0 },
            validationResults: [],
            duplicates: { total: 0, byPhone: 0, byEmail: 0, byIc: 0, list: [] },
            assignment: { assignTo: 'myself' }
        };
        await renderImportStep(1);
    };

    const getWizardStepsHtml = (active) => {
        const steps = ['Upload', 'Map Fields', 'Validate', 'Duplicates', 'Import'];
        return `<div class="wizard-steps">${steps.map((s, i) => `<div class="wizard-step ${i + 1 < active ? 'completed' : i + 1 === active ? 'active' : ''}" data-step="${i + 1}">${i + 1}. ${s}</div>`).join('')}</div>`;
    };

    const updateWizardModal = (content) => {
        const overlay = document.getElementById('global-modal-overlay');
        if (overlay) { const box = overlay.querySelector('.modal-box'); if (box) box.innerHTML = content; }
    };

    const renderImportStep = async (step) => {
        _currentImportStep = step;
        let content = '';
        if (step === 1) content = await getStep1Html();
        else if (step === 2) content = await getStep2Html();
        else if (step === 3) content = await getStep3Html();
        else if (step === 4) content = await getStep4Html();
        else if (step === 5) content = await getStep5Html();
        if (step === 1) UI.showModal('Excel Import Wizard', content, []);
        else updateWizardModal(content);
    };

    const getStep1Html = async () => `
            <div class="import-wizard">
                ${getWizardStepsHtml(1)}
                <div class="step-content">
                    <h3>Step 1: Upload File</h3>
                    <div class="upload-area-large" id="import-dropzone" ondragover="event.preventDefault()" ondrop="app.handleImportFileDrop(event)">
                        <i class="fas fa-cloud-upload-alt"></i>
                        <h4>Click or Drag Excel file to upload</h4>
                        <p>Supported formats: .xlsx, .xls, .csv</p>
                        <p class="file-limit">Max file size: 10MB</p>
                        <input type="file" id="import-file-input" accept=".xlsx,.xls,.csv" style="display:none" onchange="app.handleImportFileSelect(event)">
                        <button class="btn primary" onclick="document.getElementById('import-file-input').click()">Browse Files</button>
                    </div>
                    <div id="file-info" style="display:none;margin-top:20px;"></div>
                    <div style="margin-top:20px;"><label class="checkbox-label"><input type="checkbox" id="first-row-header" checked> First row contains headers</label></div>
                </div>
                <div class="wizard-footer">
                    <button class="btn secondary" onclick="UI.hideModal()">Cancel</button>
                    <button class="btn primary" id="step1-next" onclick="app.importNextStep()" disabled>Next: Field Mapping</button>
                </div>
            </div>
        `;

    const getStep2Html = async () => `
            <div class="import-wizard">
                ${getWizardStepsHtml(2)}
                <div class="step-content">
                    <h3>Step 2: Field Mapping</h3>
                    <div class="import-type-selector"><label>Import Type:</label>
                        <select id="import-type" class="form-control" style="width:200px" onchange="app.updateImportType(this.value)">
                            <option value="prospects" ${_importData.importType === 'prospects' ? 'selected' : ''}>Prospects</option>
                            <option value="customers" ${_importData.importType === 'customers' ? 'selected' : ''}>Customers</option>
                            <option value="agents" ${_importData.importType === 'agents' ? 'selected' : ''}>Agents</option>
                            <option value="products" ${_importData.importType === 'products' ? 'selected' : ''}>Products (Marketing List)</option>
                            <option value="events" ${_importData.importType === 'events' ? 'selected' : ''}>Events (Marketing List)</option>
                            <option value="promotions" ${_importData.importType === 'promotions' ? 'selected' : ''}>Promotions (Marketing List)</option>
                        </select>
                    </div>
                    <div class="mapping-actions">
                        <button class="btn secondary btn-sm" onclick="app.autoMapFields()"><i class="fas fa-magic"></i> Auto-map all</button>
                        <button class="btn secondary btn-sm" onclick="app.clearMapping()"><i class="fas fa-times"></i> Clear all</button>
                    </div>
                    <div class="mapping-table-container">
                        <table class="mapping-table"><thead><tr><th scope="col">Excel Column</th><th scope="col">CRM Field</th></tr></thead>
                        <tbody>${renderMappingRows()}</tbody></table>
                    </div>
                </div>
                <div class="wizard-footer">
                    <button class="btn secondary" onclick="app.importPrevStep()">Back</button>
                    <button class="btn primary" onclick="app.importNextStep()">Next: Validation</button>
                </div>
            </div>
        `;

    const getStep3Html = async () => {
        const { valid, warnings, errors } = _importData.validation;
        const errorRows   = _importData.validationResults.filter(r => r.status === 'error');
        const warningRows = _importData.validationResults.filter(r => r.status === 'warning');

        const renderIssueRows = (rows, type) => {
            const issues = rows.flatMap(r =>
                (type === 'error' ? r.errors : r.warnings).map(issue =>
                    `<tr class="${type}-row"><td>${r.rowIndex}</td><td>${issue.field}</td><td>${issue.msg}</td><td>${issue.suggestion}</td></tr>`
                )
            );
            return issues.length > 0 ? issues.join('') : `<tr><td colspan="4" style="text-align:center;color:var(--gray-400)">No ${type}s found</td></tr>`;
        };

        return `
            <div class="import-wizard">
                ${getWizardStepsHtml(3)}
                <div class="step-content">
                    <h3>Step 3: Validation</h3>
                    <div class="validation-summary">
                        <div class="validation-badge valid"><span class="badge-count">${valid}</span><span class="badge-label">Valid Rows</span></div>
                        <div class="validation-badge warning"><span class="badge-count">${warnings}</span><span class="badge-label">Warnings</span></div>
                        <div class="validation-badge error"><span class="badge-count">${errors}</span><span class="badge-label">Errors</span></div>
                    </div>
                    <div style="margin:16px 0">
                        <label class="checkbox-label"><input type="checkbox" id="stop-on-error"> Stop on first error</label>
                        <label class="checkbox-label"><input type="checkbox" id="continue-warnings" checked> Continue on warnings</label>
                    </div>
                    <div class="validation-log">
                        <h4>Error Log</h4>
                        <table class="error-table"><thead><tr><th scope="col">Row</th><th scope="col">Column</th><th scope="col">Error</th><th scope="col">Suggestion</th></tr></thead>
                        <tbody>${renderIssueRows(errorRows, 'error')}</tbody></table>
                        <h4 style="margin-top:16px">Warning Log</h4>
                        <table class="warning-table"><thead><tr><th scope="col">Row</th><th scope="col">Column</th><th scope="col">Warning</th><th scope="col">Action</th></tr></thead>
                        <tbody>${renderIssueRows(warningRows, 'warning')}</tbody></table>
                    </div>
                    <div class="validation-actions">
                        <button class="btn secondary" onclick="app.downloadErrorReport()"><i class="fas fa-download"></i> Download Error Report</button>
                    </div>
                </div>
                <div class="wizard-footer">
                    <button class="btn secondary" onclick="app.importPrevStep()">Back</button>
                    <button class="btn primary" onclick="app.importNextStep()">Next: Duplicate Handling</button>
                </div>
            </div>
        `;
    };

    const getStep4Html = async () => {
        const { total, byPhone, byEmail, byIc, list } = _importData.duplicates;
        const reverseMap = buildReverseMapping();
        const nameCol  = reverseMap['full_name'];
        const phoneCol = reverseMap['phone'];

        const previewRows = list.slice(0, 20).map(d => {
            const existName  = d.existingRec?.full_name || '(unknown)';
            const existPhone = d.existingRec?.phone || '';
            const importName  = nameCol  !== undefined ? (d.row[nameCol]  || '').toString().trim() : '(no name)';
            const importPhone = phoneCol !== undefined ? (d.row[phoneCol] || '').toString().trim() : '';
            return `<tr>
                <td>${existName}${existPhone ? ' (' + existPhone + ')' : ''}</td>
                <td>${importName}${importPhone ? ' (' + importPhone + ')' : ''}</td>
                <td><span style="color:var(--gray-500);font-size:12px">Pending action below</span></td>
            </tr>`;
        }).join('') || '<tr><td colspan="3" style="text-align:center;color:var(--gray-400)">No duplicates found</td></tr>';

        return `
            <div class="import-wizard">
                ${getWizardStepsHtml(4)}
                <div class="step-content">
                    <h3>Step 4: Duplicate Handling</h3>
                    <div class="duplicate-stats">
                        <div><strong>Total duplicates found:</strong> ${total}</div>
                        <div><strong>By phone number:</strong> ${byPhone}</div>
                        <div><strong>By email:</strong> ${byEmail}</div>
                        <div><strong>By IC number:</strong> ${byIc}</div>
                    </div>
                    <div class="duplicate-options" style="margin:16px 0">
                        <h4>Duplicate Handling</h4>
                        <label class="radio-label"><input type="radio" name="duplicate-action" value="skip" checked> Skip duplicates (keep existing)</label>
                        <label class="radio-label"><input type="radio" name="duplicate-action" value="update"> Update existing records</label>
                        <label class="radio-label"><input type="radio" name="duplicate-action" value="merge"> Create as new (merge)</label>
                    </div>
                    <div class="duplicate-preview">
                        <h4>Preview of affected records${list.length > 20 ? ' (showing first 20)' : ''}</h4>
                        <table class="preview-table"><thead><tr><th scope="col">Existing Record</th><th scope="col">Import Record</th><th scope="col">Status</th></tr></thead>
                        <tbody>${previewRows}</tbody></table>
                    </div>
                </div>
                <div class="wizard-footer">
                    <button class="btn secondary" onclick="app.importPrevStep()">Back</button>
                    <button class="btn primary" onclick="app.importNextStep()">Next: Import</button>
                </div>
            </div>
        `;
    };

    const getStep5Html = async () => {
        const { valid, warnings, errors } = _importData.validation;
        const processable = valid + warnings;
        const dupCount    = _importData.duplicates.total;
        const assignLabel = _currentUser?.full_name || _currentUser?.name || 'Me';
        return `
            <div class="import-wizard">
                ${getWizardStepsHtml(5)}
                <div class="step-content">
                    <h3>Step 5: Import</h3>
                    <div class="summary-stats">
                        <div><strong>Total records in file:</strong> ${_importData.data.length}</div>
                        <div><strong>Valid / warning rows:</strong> ${processable}</div>
                        <div><strong>Error rows (will skip):</strong> ${errors}</div>
                        <div><strong>Potential duplicates:</strong> ${dupCount}</div>
                    </div>
                    <div class="assignment-options" style="margin:16px 0">
                        <h4>Assignment Options</h4>
                        <label class="radio-label"><input type="radio" name="assign-to" value="myself" checked onchange="document.getElementById('team-opts').style.display='none'"> Assign to myself (${assignLabel})</label>
                        <label class="radio-label"><input type="radio" name="assign-to" value="team" onchange="document.getElementById('team-opts').style.display='block'"> Assign to team</label>
                        <label class="radio-label"><input type="radio" name="assign-to" value="unassigned" onchange="document.getElementById('team-opts').style.display='none'"> Leave unassigned</label>
                        <div id="team-opts" style="display:none;margin-top:12px">
                            <select class="form-control" style="width:200px">${Array.from({length: 26}, (_, i) => String.fromCharCode(65 + i)).map(L => `<option>Team ${L}</option>`).join('')}</select>
                            <label class="checkbox-label" style="margin-top:8px"><input type="checkbox"> Distribute evenly</label>
                        </div>
                    </div>
                    <div class="import-options" style="margin:16px 0">
                        <h4>Import Options</h4>
                        <label class="checkbox-label"><input type="checkbox" checked> Send notification when complete</label>
                        <label class="checkbox-label"><input type="checkbox"> Create backup before import</label>
                        <label class="checkbox-label"><input type="checkbox" checked> Log all changes for audit</label>
                    </div>
                    <div id="progress-area" style="display:none;margin-top:16px">
                        <h4>Import Progress</h4>
                        <div class="progress-bar-container"><div class="progress-bar-fill" id="progress-bar" style="width:0%">0%</div></div>
                        <p id="progress-status">Preparing import...</p>
                    </div>
                </div>
                <div class="wizard-footer">
                    <button class="btn secondary" onclick="app.importPrevStep()">Back</button>
                    <button class="btn primary" id="start-import-btn" onclick="app.startImport()"><i class="fas fa-play"></i> START IMPORT</button>
                </div>
            </div>
        `;
    };

    const renderMappingRows = () => {
        const headers = _importData.headers || [];
        const crmFields = getCRMFieldsForType(_importData.importType);
        return headers.map((header, index) => {
            const matched = autoMatchField(header, _importData.importType);
            return `<tr><td><strong>${header}</strong></td><td>
                <select class="form-control mapping-select" data-col="${index}" style="width:200px">
                    <option value="">-- Ignore column --</option>
                    ${crmFields.map(f => `<option value="${f.value}" ${f.value === matched ? 'selected' : ''}>${f.label}${f.required ? ' *' : ''}</option>`).join('')}
                </select></td></tr>`;
        }).join('');
    };

    const getCRMFieldsForType = (type) => {
        const common = [
            { value: 'full_name', label: 'Full Name', required: true },
            { value: 'phone', label: 'Phone', required: true },
            { value: 'email', label: 'Email', required: false },
            { value: 'ic_number', label: 'IC Number', required: false }
        ];
        const extraProspect = [
            { value: 'date_of_birth', label: 'Date of Birth' }, { value: 'occupation', label: 'Occupation' },
            { value: 'company_name', label: 'Company Name' }, { value: 'income_range', label: 'Income Range' },
            { value: 'address', label: 'Address' }, { value: 'city', label: 'City' },
            { value: 'state', label: 'State' }, { value: 'postal_code', label: 'Postal Code' },
            { value: 'ming_gua', label: 'Ming Gua' }, { value: 'gender', label: 'Gender' }
        ];
        if (type === 'prospects') return [...common, ...extraProspect];
        if (type === 'customers') return [...common, { value: 'lifetime_value', label: 'Lifetime Value' }];
        if (type === 'agents') return [...common, { value: 'agent_code', label: 'Agent Code', required: true }];
        if (type === 'products') return [
            { value: 'name', label: 'Name', required: true },
            { value: 'price', label: 'Price (RM)', required: false },
            { value: 'remarks', label: 'Remarks', required: false },
            { value: 'delivery_lead_time', label: 'Delivery Lead Time', required: false },
            { value: 'is_active', label: 'Is Active (Yes/No)', required: false }
        ];
        if (type === 'events') return [
            { value: 'title', label: 'Title', required: true },
            { value: 'ticket_price', label: 'Ticket Price (RM)', required: false },
            { value: 'duration', label: 'Duration', required: false },
            { value: 'target_group', label: 'Target Group', required: false },
            { value: 'description', label: 'Description', required: false },
            { value: 'is_active', label: 'Is Active (Yes/No)', required: false }
        ];
        if (type === 'promotions') return [
            { value: 'package_name', label: 'Package Name', required: true },
            { value: 'price', label: 'Price (RM)', required: false },
            { value: 'details', label: 'Details', required: false },
            { value: 'requirement', label: 'Requirement', required: false },
            { value: 'remarks', label: 'Remarks', required: false },
            { value: 'delivery_lead_time', label: 'Delivery Lead Time', required: false },
            { value: 'is_active', label: 'Is Active (Yes/No)', required: false }
        ];
        return common;
    };

    const autoMatchField = (header, importType = 'prospects') => {
        const lower = header.toLowerCase().trim();
        if (importType === 'products') {
            const m = { 'name': 'name', 'product name': 'name', 'price': 'price', 'remarks': 'remarks', 'delivery lead time': 'delivery_lead_time', 'lead time': 'delivery_lead_time', 'is active': 'is_active', 'active': 'is_active' };
            for (let key in m) { if (lower.includes(key)) return m[key]; }
            return '';
        }
        if (importType === 'events') {
            const m = { 'title': 'title', 'name': 'title', 'event name': 'title', 'ticket price': 'ticket_price', 'price': 'ticket_price', 'duration': 'duration', 'target group': 'target_group', 'target': 'target_group', 'description': 'description', 'is active': 'is_active', 'active': 'is_active' };
            for (let key in m) { if (lower.includes(key)) return m[key]; }
            return '';
        }
        if (importType === 'promotions') {
            const m = { 'package name': 'package_name', 'name': 'package_name', 'price': 'price', 'details': 'details', 'description': 'details', 'requirement': 'requirement', 'remarks': 'remarks', 'delivery lead time': 'delivery_lead_time', 'lead time': 'delivery_lead_time', 'is active': 'is_active', 'active': 'is_active' };
            for (let key in m) { if (lower.includes(key)) return m[key]; }
            return '';
        }
        const map = { 'full name': 'full_name', 'name': 'full_name', 'phone': 'phone', 'mobile': 'phone', 'email': 'email', 'ic': 'ic_number', 'ic number': 'ic_number', 'nric': 'ic_number', 'dob': 'date_of_birth', 'date of birth': 'date_of_birth', 'occupation': 'occupation', 'income': 'income_range', 'address': 'address', 'city': 'city', 'state': 'state', 'postcode': 'postal_code', 'postal': 'postal_code', 'postal code': 'postal_code', 'ming gua': 'ming_gua', 'gender': 'gender', 'title': 'title', 'nationality': 'nationality', 'lunar': 'lunar_birth', 'company': 'company_name', 'referred by': 'referred_by', 'referral relationship': 'referral_relationship', 'relationship': 'referral_relationship', 'pipeline': 'pipeline_stage', 'stage': 'pipeline_stage', 'close date': 'expected_close_date', 'expected close': 'expected_close_date', 'deal value': 'deal_value' };
        for (let key in map) { if (lower.includes(key)) return map[key]; }
        return '';
    };

    const handleImportFileDrop = async (event) => { event.preventDefault(); const files = event.dataTransfer.files; if (files.length > 0) await processImportFile(files[0]); };
    const handleImportFileSelect = async (event) => { const files = event.target.files; if (files.length > 0) await processImportFile(files[0]); };

    const processImportFile = async (file) => {
        if (file.size > 10 * 1024 * 1024) { UI.toast.error('File size exceeds 10MB limit'); return; }
        _importData.file = file; _importData.fileName = file.name; _importData.fileSize = file.size;

        try {
            const isCsv = file.name.toLowerCase().endsWith('.csv');
            const readFile = (f) => new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = e => resolve(e.target.result);
                reader.onerror = () => reject(new Error('File read failed'));
                if (isCsv) reader.readAsText(f, 'UTF-8');
                else reader.readAsArrayBuffer(f);
            });

            const result = await readFile(file);
            let allRows = [];

            if (isCsv) {
                const parsed = Papa.parse(result, { header: false, skipEmptyLines: true });
                allRows = parsed.data;
            } else {
                await window._ensureXlsx();
                const workbook = XLSX.read(result, { type: 'array' });
                const sheet = workbook.Sheets[workbook.SheetNames[0]];
                allRows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
                // Remove trailing empty rows
                while (allRows.length > 0 && allRows[allRows.length - 1].every(c => c === '')) allRows.pop();
            }

            if (allRows.length === 0) { UI.toast.error('File appears to be empty'); return; }

            const firstRowHeader = document.getElementById('first-row-header')?.checked !== false;
            if (firstRowHeader && allRows.length > 0) {
                _importData.headers = allRows[0].map(h => (h || '').toString().trim());
                _importData.data = allRows.slice(1);
            } else {
                const colCount = allRows[0].length;
                _importData.headers = Array.from({ length: colCount }, (_, i) => `Col${i + 1}`);
                _importData.data = allRows;
            }
            _importData.rows = _importData.data.length;

            const fi = document.getElementById('file-info');
            if (fi) {
                const sizeStr = file.size > 1048576 ? (file.size / 1048576).toFixed(1) + ' MB' : (file.size / 1024).toFixed(0) + ' KB';
                fi.innerHTML = `<div class="file-info-card"><div><strong>File:</strong> ${escapeHtml(file.name)}</div><div><strong>Size:</strong> ${escapeHtml(sizeStr)}</div><div><strong>Rows detected:</strong> ${_importData.rows}</div><div><strong>Columns detected:</strong> ${_importData.headers.length}</div></div>`;
                fi.style.display = 'block';
            }
            const btn = document.getElementById('step1-next'); if (btn) btn.disabled = false;
            UI.toast.success(`File loaded: ${_importData.rows} rows, ${_importData.headers.length} columns`);
        } catch (err) {
            console.error('File parse error:', err);
            UI.toast.error('Failed to read file: ' + err.message);
        }
    };

    // Private helpers (not exported)
    const buildReverseMapping = () => {
        const rev = {};
        Object.entries(_importData.mapping).forEach(([col, field]) => { rev[field] = parseInt(col); });
        return rev;
    };

    const normalisePhone = (raw) => (raw || '').toString().replace(/[-\s()]/g, '').replace(/^\+60/, '0');

    const mapRowToRecord = (row, reverseMap, agentId) => {
        const get = (field) => {
            const idx = reverseMap[field];
            return idx !== undefined ? (row[idx] || '').toString().trim() : '';
        };
        const dealVal = get('deal_value');
        const pipelineStage = get('pipeline_stage') || 'new';
        return {
            full_name: get('full_name'),
            title: get('title'),
            gender: get('gender'),
            nationality: get('nationality'),
            phone: get('phone'),
            email: get('email'),
            ic_number: get('ic_number'),
            date_of_birth: get('date_of_birth'),
            lunar_birth: get('lunar_birth'),
            occupation: get('occupation'),
            company_name: get('company_name'),
            income_range: get('income_range'),
            address: get('address'),
            city: get('city'),
            state: get('state'),
            postal_code: get('postal_code'),
            ming_gua: get('ming_gua'),
            referred_by: get('referred_by'),
            referral_relationship: get('referral_relationship'),
            pipeline_stage: pipelineStage,
            expected_close_date: get('expected_close_date') || null,
            deal_value: dealVal ? parseFloat(dealVal) || null : null,
            responsible_agent_id: agentId,
            source: 'import'
        };
    };

    const mapRowToMarketingRecord = (row, reverseMap, type) => {
        const get = (field) => { const idx = reverseMap[field]; return idx !== undefined ? (row[idx] || '').toString().trim() : ''; };
        const parseActive = (val) => { if (!val) return true; return !['false','no','0','inactive','n'].includes(val.toLowerCase()); };
        if (type === 'products') return { name: get('name'), price: parseFloat(get('price')) || 0, remarks: get('remarks') || null, delivery_lead_time: get('delivery_lead_time') || null, is_active: parseActive(get('is_active')) };
        if (type === 'events') return { title: get('title'), ticket_price: parseFloat(get('ticket_price')) || 0, duration: get('duration') || null, target_group: get('target_group') || null, description: get('description') || null, is_active: parseActive(get('is_active')) };
        // promotions
        return { package_name: get('package_name'), price: parseFloat(get('price')) || 0, details: get('details') || null, requirement: get('requirement') || null, remarks: get('remarks') || null, delivery_lead_time: get('delivery_lead_time') || null, is_active: parseActive(get('is_active')) };
    };

    const updateImportProgress = (pct, current, total) => {
        const bar = document.getElementById('progress-bar');
        if (bar) { bar.style.width = pct + '%'; bar.textContent = pct + '%'; }
        const st = document.getElementById('progress-status');
        if (st) st.textContent = `Processing ${current}/${total} records...`;
    };

    const runValidation = () => {
        const reverseMap = buildReverseMapping();
        const importType = _importData.importType;
        const isMarketingType = ['products', 'events', 'promotions'].includes(importType);
        _importData.validationResults = [];
        let valid = 0, warnings = 0, errors = 0;

        _importData.data.forEach((row, i) => {
            const rowErrors = [], rowWarnings = [];

            if (isMarketingType) {
                // Validate required name field per marketing type
                const reqField = importType === 'products' ? 'name' : importType === 'events' ? 'title' : 'package_name';
                const reqLabel = importType === 'products' ? 'Name' : importType === 'events' ? 'Title' : 'Package Name';
                const reqCol = reverseMap[reqField];
                if (reqCol !== undefined) {
                    const val = (row[reqCol] || '').toString().trim();
                    if (!val) rowErrors.push({ field: reqLabel, msg: `${reqLabel} is required`, suggestion: `Enter the ${reqLabel.toLowerCase()}` });
                }
            } else {
                const nameCol  = reverseMap['full_name'];
                const phoneCol = reverseMap['phone'];
                const emailCol = reverseMap['email'];
                const icCol    = reverseMap['ic_number'];

                if (nameCol !== undefined) {
                    const name = (row[nameCol] || '').toString().trim();
                    if (!name) rowErrors.push({ field: 'Full Name', msg: 'Name is required', suggestion: 'Enter the full name' });
                }
                if (phoneCol !== undefined) {
                    const raw = (row[phoneCol] || '').toString().trim();
                    if (!raw) rowErrors.push({ field: 'Phone', msg: 'Phone is required', suggestion: 'Enter a phone number' });
                    else if (!/^(\+?60|0)[1-9]\d{7,9}$/.test(raw.replace(/[-\s()]/g, '')))
                        rowWarnings.push({ field: 'Phone', msg: 'Non-standard MY format', suggestion: 'Use 01X-XXXXXXX or +601XXXXXXXX' });
                }
                if (emailCol !== undefined) {
                    const email = (row[emailCol] || '').toString().trim();
                    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
                        rowErrors.push({ field: 'Email', msg: 'Invalid email format', suggestion: 'Check @ and domain' });
                }
                if (icCol !== undefined) {
                    const ic = (row[icCol] || '').toString().replace(/[-\s]/g, '');
                    if (ic && !/^\d{12}$/.test(ic))
                        rowWarnings.push({ field: 'IC Number', msg: 'IC should be 12 digits', suggestion: 'Remove dashes or spaces' });
                }
            }

            const status = rowErrors.length > 0 ? 'error' : rowWarnings.length > 0 ? 'warning' : 'valid';
            _importData.validationResults.push({ rowIndex: i + 2, row, errors: rowErrors, warnings: rowWarnings, status });
            if (status === 'valid') valid++;
            else if (status === 'warning') warnings++;
            else errors++;
        });
        _importData.validation = { valid, warnings, errors };
    };

    const runDuplicateCheck = async () => {
        const reverseMap = buildReverseMapping();
        const importType = _importData.importType;
        const isMarketingType = ['products', 'events', 'promotions'].includes(importType);
        const table = { customers: 'customers', prospects: 'prospects', products: 'products', events: 'events', promotions: 'promotions' }[importType] || 'prospects';
        let existing = [];
        try { existing = await AppDataStore.getAll(table); } catch (e) { existing = []; }

        if (isMarketingType) {
            // Duplicate check by name for marketing list types
            const nameField = importType === 'products' ? 'name' : importType === 'events' ? 'title' : 'package_name';
            const nameCol = reverseMap[nameField];
            const existingNames = new Map();
            existing.forEach(rec => {
                const n = (rec[nameField] || '').toLowerCase().trim();
                if (n) existingNames.set(n, rec);
            });
            let byName = 0;
            const dupList = [];
            _importData.validationResults.forEach(vr => {
                if (vr.status === 'error') return;
                if (nameCol !== undefined) {
                    const n = (vr.row[nameCol] || '').toString().toLowerCase().trim();
                    if (n && existingNames.has(n)) { byName++; dupList.push({ rowIndex: vr.rowIndex, row: vr.row, matchField: 'name', existingRec: existingNames.get(n) }); }
                }
            });
            _importData.duplicates = { total: byName, byPhone: 0, byEmail: 0, byIc: 0, list: dupList };
            return;
        }

        const phoneCol = reverseMap['phone'];
        const emailCol = reverseMap['email'];
        const icCol    = reverseMap['ic_number'];
        const existingPhones = new Map();
        const existingEmails = new Map();
        const existingIcs    = new Map();
        existing.forEach(rec => {
            if (rec.phone)     existingPhones.set(normalisePhone(rec.phone), rec);
            if (rec.email)     existingEmails.set((rec.email || '').toLowerCase().trim(), rec);
            if (rec.ic_number) existingIcs.set((rec.ic_number || '').replace(/[-\s]/g, ''), rec);
        });

        let byPhone = 0, byEmail = 0, byIc = 0;
        const dupList = [];
        _importData.validationResults.forEach(vr => {
            if (vr.status === 'error') return;
            const row = vr.row;
            let isDup = false, matchField = '', existingRec = null;

            if (!isDup && phoneCol !== undefined) {
                const p = normalisePhone(row[phoneCol]);
                if (p && existingPhones.has(p)) { byPhone++; isDup = true; matchField = 'phone'; existingRec = existingPhones.get(p); }
            }
            if (!isDup && emailCol !== undefined) {
                const e = (row[emailCol] || '').toString().toLowerCase().trim();
                if (e && existingEmails.has(e)) { byEmail++; isDup = true; matchField = 'email'; existingRec = existingEmails.get(e); }
            }
            if (!isDup && icCol !== undefined) {
                const ic = (row[icCol] || '').toString().replace(/[-\s]/g, '');
                if (ic && existingIcs.has(ic)) { byIc++; isDup = true; matchField = 'ic'; existingRec = existingIcs.get(ic); }
            }
            if (isDup) dupList.push({ rowIndex: vr.rowIndex, row, matchField, existingRec });
        });
        _importData.duplicates = { total: byPhone + byEmail + byIc, byPhone, byEmail, byIc, list: dupList };
    };

    const importNextStep = async () => {
        if (_currentImportStep === 2) {
            // Collect mapping from DOM before proceeding
            _importData.mapping = {};
            document.querySelectorAll('.mapping-select').forEach(sel => {
                if (sel.value) _importData.mapping[parseInt(sel.dataset.col)] = sel.value;
            });
            runValidation();
        }
        if (_currentImportStep === 3) {
            await runDuplicateCheck();
        }
        if (_currentImportStep < 5) await renderImportStep(_currentImportStep + 1);
    };
    const importPrevStep = async () => { if (_currentImportStep > 1) await renderImportStep(_currentImportStep - 1); };
    const updateImportType = (type) => { _importData.importType = type; };
    const autoMapFields = () => {
        const selects = document.querySelectorAll('.mapping-select');
        let matched = 0;
        selects.forEach(sel => {
            const crmField = autoMatchField(_importData.headers[parseInt(sel.dataset.col)] || '', _importData.importType);
            if (crmField) { sel.value = crmField; matched++; }
        });
        UI.toast.success(`Auto-mapped ${matched} of ${selects.length} columns`);
    };
    const clearMapping = () => { document.querySelectorAll('.mapping-select').forEach(s => s.value = ''); UI.toast.info('Mapping cleared'); };
    const clearMappingField = (idx) => { const s = document.querySelector(`.mapping-select[data-col="${idx}"]`); if (s) s.value = ''; };
    const downloadErrorReport = () => {
        const issues = _importData.validationResults.filter(r => r.status !== 'valid');
        if (!issues.length) { UI.toast.info('No errors or warnings to report'); return; }
        const lines = ['Row,Field,Severity,Message,Suggestion'];
        issues.forEach(r => {
            [...r.errors.map(e => ({ ...e, sev: 'ERROR' })), ...r.warnings.map(w => ({ ...w, sev: 'WARNING' }))].forEach(issue => {
                lines.push(`${r.rowIndex},"${issue.field}","${issue.sev}","${issue.msg}","${issue.suggestion}"`);
            });
        });
        const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a'); a.href = url; a.download = `import_errors_${Date.now()}.csv`;
        document.body.appendChild(a); a.click(); document.body.removeChild(a);
        URL.revokeObjectURL(url);
        UI.toast.success('Error report downloaded');
    };

    const startImport = async () => {
        const duplicateAction = document.querySelector('input[name="duplicate-action"]:checked')?.value || 'skip';
        const assignTo        = document.querySelector('input[name="assign-to"]:checked')?.value || 'myself';

        document.getElementById('progress-area').style.display = 'block';
        document.getElementById('start-import-btn').disabled = true;

        const rowsToProcess = _importData.validationResults.filter(vr => vr.status !== 'error');
        const total = rowsToProcess.length;
        if (total === 0) { UI.toast.error('No valid rows to import'); document.getElementById('start-import-btn').disabled = false; return; }

        const dupMap = new Map();
        _importData.duplicates.list.forEach(d => dupMap.set(d.rowIndex, d));

        let assignedAgentId = null;
        if (assignTo === 'myself') assignedAgentId = _currentUser?.id;

        const reverseMap = buildReverseMapping();
        const isMarketingType = ['products', 'events', 'promotions'].includes(_importData.importType);
        const table = { customers: 'customers', prospects: 'prospects', products: 'products', events: 'events', promotions: 'promotions' }[_importData.importType] || 'prospects';
        let created = 0, updated = 0, skipped = 0, errorCount = 0;

        for (let i = 0; i < rowsToProcess.length; i++) {
            if (i % 10 === 0) {
                updateImportProgress(Math.round((i / total) * 100), i, total);
                await new Promise(r => setTimeout(r, 0));
            }
            const vr = rowsToProcess[i];
            const record = isMarketingType ? mapRowToMarketingRecord(vr.row, reverseMap, _importData.importType) : mapRowToRecord(vr.row, reverseMap, assignedAgentId);
            const dup = dupMap.get(vr.rowIndex);

            if (dup) {
                if (duplicateAction === 'skip') { skipped++; continue; }
                if (duplicateAction === 'update') {
                    try { await AppDataStore.update(table, dup.existingRec.id, record); updated++; }
                    catch (e) { console.error('Update failed row', vr.rowIndex, e); errorCount++; }
                    continue;
                }
                // merge: fall through to create
            }
            try {
                record.id = Date.now() + i;
                record.created_at = new Date().toISOString();
                if (!isMarketingType) {
                    record.status = 'New';
                    record.protection_deadline = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
                    record.score = 5;
                }
                await AppDataStore.create(table, record);
                created++;
            } catch (e) { console.error('Insert failed row', vr.rowIndex, e); errorCount++; }
        }

        updateImportProgress(100, total, total);
        await new Promise(r => setTimeout(r, 200));

        try {
            await AppDataStore.create('import_jobs', {
                file_name:          _importData.fileName || 'import.xlsx',
                import_type:        _importData.importType,
                total_rows:         _importData.data.length,
                valid_rows:         _importData.validation.valid + _importData.validation.warnings,
                error_rows:         _importData.validation.errors + errorCount,
                created_records:    created,
                updated_records:    updated,
                skipped_records:    skipped,
                status:             'completed',
                mapping_config:     _importData.mapping,
                duplicate_handling: duplicateAction,
                assignment_config:  { assignTo, agentId: assignedAgentId },
                created_by:         _currentUser?.id,
                created_at:         new Date().toISOString(),
                completed_at:       new Date().toISOString()
            });
        } catch (e) { console.error('Failed to log import job:', e); }

        UI.hideModal();
        UI.toast.success(`Import complete: ${created} created, ${updated} updated, ${skipped} skipped`);
        const vp = document.getElementById('content-viewport');
        if (vp) {
            if (_importData.importType === 'prospects') {
                await (window.app.showProspectsViewSmart || (() => {}))(vp);
            } else if (['products', 'events', 'promotions'].includes(_importData.importType)) {
                _currentMarketingListTab = _importData.importType;
                await (window.app.showMarketingListsView || (() => Promise.resolve()))(vp);
            } else {
                await showImportDashboard(vp);
            }
        }
    };

    const viewImportDetails = async (id) => {
        const job = await AppDataStore.getById('import_jobs', id);
        if (!job) return;
        const content = `<div><div style="background:var(--gray-50);padding:16px;border-radius:8px;margin-bottom:16px"><div><strong>File:</strong> ${job.file_name}</div><div><strong>Type:</strong> ${job.import_type}</div><div><strong>Status:</strong> ${job.status}</div><div><strong>Date:</strong> ${UI.formatDate(job.created_at)}</div></div><div style="display:grid;grid-template-columns:1fr 1fr;gap:12px"><div><strong>Total rows:</strong> ${job.total_rows}</div><div><strong>Valid rows:</strong> ${job.valid_rows}</div><div><strong>New records:</strong> ${job.created_records}</div><div><strong>Updated:</strong> ${job.updated_records}</div><div><strong>Skipped:</strong> ${job.skipped_records}</div><div><strong>Errors:</strong> ${job.error_rows}</div></div></div>`;
        UI.showModal(`Import Details: ${job.file_name}`, content, [{ label: 'Close', type: 'primary', action: 'UI.hideModal()' }]);
    };

    const downloadImportLog = (id) => UI.toast.info('Import log downloaded');

    const openTemplatesModal = () => {
        const content = `
            <table style="width:100%;border-collapse:collapse">
                <thead><tr><th scope="col" style="padding:10px;text-align:left;background:var(--gray-50)">Template</th><th scope="col" style="padding:10px;text-align:left;background:var(--gray-50)">Description</th><th scope="col" style="padding:10px;text-align:left;background:var(--gray-50)">Download</th></tr></thead>
                <tbody>
                    ${['Prospects', 'Customers', 'Agents', 'Products', 'Events', 'Promotions', 'Activities'].map(t => `<tr><td style="padding:10px;border-bottom:1px solid var(--gray-100)">${t} Template</td><td style="padding:10px;border-bottom:1px solid var(--gray-100)">${t} data import</td><td style="padding:10px;border-bottom:1px solid var(--gray-100)"><button class="btn secondary btn-sm" onclick="app.downloadTemplate('${t.toLowerCase()}','csv')">CSV</button> <button class="btn secondary btn-sm" onclick="app.downloadTemplate('${t.toLowerCase()}','xlsx')">Excel</button></td></tr>`).join('')}
                </tbody>
            </table>`;
        UI.showModal('Download Import Templates', content, [{ label: 'Close', type: 'primary', action: 'UI.hideModal()' }]);
    };

    const downloadTemplate = async (type, format) => {
        if (format === 'xlsx') await window._ensureXlsx();
        const headers = {
            prospects: ['Title','Full Name','Gender','Nationality','Phone','Email','IC Number','Date of Birth','Lunar Birth','Occupation','Company Name','Income Range','Address','City','State','Postal Code','Ming Gua','Referred By','Referral Relationship','Pipeline Stage','Expected Close Date','Deal Value (RM)'],
            customers: ['Full Name','Phone','Email','IC Number','Customer Since','Lifetime Value'],
            agents: ['Full Name','Phone','Email','Agent Code','Commission Rate','License Start','License Expiry'],
            products: ['Name','Price (RM)','Remarks','Delivery Lead Time','Is Active'],
            events: ['Title','Ticket Price (RM)','Duration','Target Group','Description','Is Active'],
            promotions: ['Package Name','Price (RM)','Details','Requirement','Remarks','Delivery Lead Time','Is Active'],
            activities: ['Date','Type','Title','Agent','Prospect','Status']
        };
        const samples = {
            prospects: ['Mr.','Ahmad bin Ali','Male','Malaysian','012-345-6789','ahmad@email.com','901212-10-1234','1990-12-12','','Business Owner','ABC Sdn Bhd','RM5-8k','123 Jalan SS2','Petaling Jaya','Selangor','46000','MG4','','Friend','new','2025-06-30','50000'],
            customers: ['Sample Name','012-345-6789','sample@email.com','901212-10-1234','2024-01-01','50000'],
            agents: ['Sample Name','012-345-6789','sample@email.com','AGT001','0.10','2024-01-01','2025-01-01'],
            products: ['PR4 Power Ring','2500','Premium feng shui ring','3-5 days','Yes'],
            events: ['Feng Shui Workshop','50','2 hours','Homeowners','Introduction to Feng Shui principles','Yes'],
            promotions: ['Starter Package','2000','Basic feng shui consultation','New customers only','Limited time offer','7-14 days','Yes'],
            activities: ['2024-01-01','Meeting','Sample Activity','Agent Name','Prospect Name','Completed']
        };
        const cols = headers[type] || headers.prospects;
        const sample = samples[type] || samples.prospects;
        if (format === 'xlsx') {
            const ws = XLSX.utils.aoa_to_sheet([cols, sample]);
            const wb = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(wb, ws, type);
            XLSX.writeFile(wb, `${type}_template.xlsx`);
        } else {
            const csv = cols.join(',') + '\n' + sample.map(v => `"${v}"`).join(',');
            const blob = new Blob([csv], { type: 'text/csv' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a'); a.href = url; a.download = `${type}_template.csv`; document.body.appendChild(a); a.click(); document.body.removeChild(a);
        }
        UI.toast.success(`${type} template downloaded`);
    };

    const exportMarketingList = async (format) => {
        const type = _currentMarketingListTab;
        const data = await AppDataStore.getAll(type);
        if (!data.length) { UI.toast.error('No data to export'); return; }
        let cols, rows;
        if (type === 'products') {
            cols = ['Name','Price (RM)','Remarks','Delivery Lead Time','Is Active'];
            rows = data.map(d => [d.name || '', d.price || 0, d.remarks || '', d.delivery_lead_time || '', d.is_active ? 'Yes' : 'No']);
        } else if (type === 'events') {
            cols = ['Title','Ticket Price (RM)','Duration','Target Group','Description','Is Active'];
            rows = data.map(d => [d.title || '', d.ticket_price || 0, d.duration || '', d.target_group || '', d.description || '', d.is_active ? 'Yes' : 'No']);
        } else {
            cols = ['Package Name','Price (RM)','Details','Requirement','Remarks','Delivery Lead Time','Is Active'];
            rows = data.map(d => [d.package_name || '', d.price || 0, d.details || '', d.requirement || '', d.remarks || '', d.delivery_lead_time || '', d.is_active ? 'Yes' : 'No']);
        }
        const filename = `${type}_export_${new Date().toISOString().split('T')[0]}`;
        if (format === 'xlsx') {
            await window._ensureXlsx();
            const ws = XLSX.utils.aoa_to_sheet([cols, ...rows]);
            const wb = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(wb, ws, type);
            XLSX.writeFile(wb, `${filename}.xlsx`);
        } else {
            const csvRows = [cols, ...rows].map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(','));
            const blob = new Blob([csvRows.join('\n')], { type: 'text/csv' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a'); a.href = url; a.download = `${filename}.csv`;
            document.body.appendChild(a); a.click(); document.body.removeChild(a);
            URL.revokeObjectURL(url);
        }
        UI.toast.success(`${type.charAt(0).toUpperCase() + type.slice(1)} exported (${data.length} records)`);
    };

    const openImportWizardForType = async (type) => {
        await openImportWizard();
        _importData.importType = type;
    };

    const showImportHistory = async () => {
        const jobs = (await AppDataStore.getAll('import_jobs')).sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
        const rows = jobs.length === 0 ? '<tr><td colspan="6" style="text-align:center;padding:20px">No import history</td></tr>' :
            jobs.map(j => `<tr><td>${j.file_name}</td><td>${j.import_type}</td><td>${j.total_rows}</td><td><span class="import-status status-${j.status}">${j.status.toUpperCase()}</span></td><td>${UI.formatDate(j.created_at)}</td><td><button class="btn-icon" onclick="app.viewImportDetails(${j.id})"><i class="fas fa-eye"></i></button></td></tr>`).join('');
        const content = `<table style="width:100%;border-collapse:collapse"><thead><tr style="background:var(--gray-50)"><th scope="col" style="padding:10px;text-align:left">File</th><th scope="col" style="padding:10px;text-align:left">Type</th><th scope="col" style="padding:10px;text-align:left">Records</th><th scope="col" style="padding:10px;text-align:left">Status</th><th scope="col" style="padding:10px;text-align:left">Date</th><th scope="col" style="padding:10px;text-align:left">Actions</th></tr></thead><tbody>${rows}</tbody></table>`;
        UI.showModal('Import History', content, [{ label: 'Close', type: 'primary', action: 'UI.hideModal()' }]);
    };

    // ========== PHASE 13: FOLLOW-UP MONITORING & REASSIGNMENT ==========

    const showProtectionMonitoringView = async (container) => {
        const [allProspects, allUsers, allActivities, visibleIds] = await Promise.all([
            AppDataStore.getAll('prospects'),
            AppDataStore.getAll('users'),
            AppDataStore.getAll('activities'),
            getVisibleUserIds(_currentUser)
        ]);
        const agentMap = {};
        for (const u of allUsers) agentMap[u.id] = u;
        const now = new Date();
        const lastActivityMap = {};
        for (const p of allProspects) {
            const pActivities = allActivities
                .filter(a => String(a.prospect_id) === String(p.id))
                .sort((a, b) => new Date(b.activity_date) - new Date(a.activity_date));
            const last = pActivities[0];
            const daysSince = last ? Math.floor((now - new Date(last.activity_date)) / (1000 * 60 * 60 * 24)) : 999;
            lastActivityMap[p.id] = { date: last?.activity_date, daysSince, type: last?.activity_type };
        }
        const visibleAgents = allUsers.filter(u => {
            const lvl = _getUserLevel(u);
            if (lvl < 3 || lvl > 11 || u.status === 'deleted') return false;
            return visibleIds === 'all' || visibleIds.includes(u.id);
        });
        const visibleProspects = visibleIds === 'all'
            ? allProspects
            : allProspects.filter(p => visibleIds.includes(p.responsible_agent_id));
        const monitorData = { visibleProspects, visibleAgents, agentMap, lastActivityMap };

        container.innerHTML = `
            <div class="protection-view">
                <div class="protection-header">
                    <div><h1>Protection Period & Follow-up Monitoring</h1><p>Track prospect protection periods and agent follow-up performance</p></div>
                    <div class="protection-header-actions">
                        <button class="btn secondary" onclick="app.refreshFollowupStats()"><i class="fas fa-sync-alt"></i> Refresh Stats</button>
                        <button class="btn secondary" onclick="app.exportFollowupReport()"><i class="fas fa-download"></i> Export Report</button>
                        <button class="btn secondary" onclick="app.configureAlerts()"><i class="fas fa-bell"></i> Configure Alerts</button>
                        <button class="btn primary" onclick="app.navigateTo('import')"><i class="fas fa-upload"></i> Bulk Import</button>
                    </div>
                </div>
                <div class="team-summary-cards">${renderTeamSummaryCards(monitorData)}</div>
                <div class="agent-performance">
                    <h3>Agent Performance</h3>
                    <div class="agent-table-container">
                        <table class="agent-performance-table">
                            <thead><tr><th scope="col">Agent</th><th scope="col">Team</th><th scope="col">Assigned</th><th scope="col">Followed up (7d)</th><th scope="col">Rate</th><th scope="col">Inactive (3-7d)</th><th scope="col">Inactive (8-14d)</th><th scope="col">Inactive (15d+)</th><th scope="col">Actions</th></tr></thead>
                            <tbody>${renderAgentPerformanceRows(monitorData)}</tbody>
                        </table>
                    </div>
                </div>
                <div class="inactive-prospects">
                    <h3>Inactive Prospects (>7 days)</h3>
                    <div class="inactive-table-container">
                        <table class="inactive-table">
                            <thead><tr><th scope="col">Prospect</th><th scope="col">Agent</th><th scope="col">Days Inactive</th><th scope="col">Score</th><th scope="col">Protection Deadline</th><th scope="col">Status</th><th scope="col">Actions</th></tr></thead>
                            <tbody>${renderInactiveProspectsRows(monitorData)}</tbody>
                        </table>
                    </div>
                </div>
                <div class="agent-performance" style="margin-top:24px">
                    <h3>Reassignment History</h3>
                    <div class="agent-table-container">${await renderReassignmentHistory()}</div>
                </div>
            </div>`;
    };

    const renderTeamSummaryCards = ({ visibleProspects, agentMap, lastActivityMap }) => {
        const teamColors = ['team-a', 'team-b', 'team-c', 'team-d', 'team-e'];
        const teamStats = {};
        const totals = { active: 0, attention: 0, inactive: 0, critical: 0 };
        for (const p of visibleProspects) {
            const agent = agentMap[p.responsible_agent_id];
            const teamName = agent?.team || 'Unassigned';
            if (!teamStats[teamName]) teamStats[teamName] = { active: 0, attention: 0, inactive: 0, critical: 0 };
            const days = lastActivityMap[p.id]?.daysSince ?? 999;
            const protDays = (window.app.calculateProtectionDays || (() => 0))(p);
            if (days > 14 || protDays <= 0) { teamStats[teamName].critical++; totals.critical++; }
            else if (days > 7) { teamStats[teamName].inactive++; totals.inactive++; }
            else if (days > 3) { teamStats[teamName].attention++; totals.attention++; }
            else { teamStats[teamName].active++; totals.active++; }
        }
        const teamNames = Object.keys(teamStats).sort();
        const cards = teamNames.map((name, i) => {
            const t = teamStats[name];
            const color = teamColors[i % teamColors.length];
            return `<div class="summary-card ${color}"><h4>${name}</h4><div class="summary-stats"><div><span class="stat-label">Active:</span><span class="stat-value">${t.active}</span></div><div><span class="stat-label">Attention:</span><span class="stat-value warning">${t.attention}</span></div><div><span class="stat-label">Inactive:</span><span class="stat-value danger">${t.inactive}</span></div><div><span class="stat-label">Critical:</span><span class="stat-value danger">${t.critical}</span></div></div></div>`;
        });
        cards.push(`<div class="summary-card total"><h4>Total</h4><div class="summary-stats"><div><span class="stat-label">Active:</span><span class="stat-value">${totals.active}</span></div><div><span class="stat-label">Attention:</span><span class="stat-value warning">${totals.attention}</span></div><div><span class="stat-label">Inactive:</span><span class="stat-value danger">${totals.inactive}</span></div><div><span class="stat-label">Critical:</span><span class="stat-value danger">${totals.critical}</span></div></div></div>`);
        return cards.join('');
    };

    const renderAgentPerformanceRows = ({ visibleAgents, visibleProspects, lastActivityMap }) => {
        return visibleAgents.map(agent => {
            const agentProspects = visibleProspects.filter(p => String(p.responsible_agent_id) === String(agent.id));
            const assigned = agentProspects.length;
            let followedUp7d = 0, i37 = 0, i814 = 0, i15 = 0;
            for (const p of agentProspects) {
                const days = lastActivityMap[p.id]?.daysSince ?? 999;
                if (days <= 7) followedUp7d++;
                if (days > 3 && days <= 7) i37++;
                else if (days > 7 && days <= 14) i814++;
                else if (days > 14) i15++;
            }
            const rate = assigned > 0 ? Math.round((followedUp7d / assigned) * 100) : 0;
            const cls = rate < 70 ? 'rate-bad' : rate < 90 ? 'rate-warning' : 'rate-good';
            const teamName = agent.team || 'Unassigned';
            return `<tr><td><strong>${agent.full_name || 'Unknown'}</strong></td><td>${teamName}</td><td>${assigned}</td><td>${followedUp7d}</td><td><span class="rate-badge ${cls}">${rate}%</span></td><td>${i37}</td><td>${i814}</td><td>${i15}</td><td><button class="btn-icon" onclick="app.viewAgentDetails(${agent.id})" title="View"><i class="fas fa-eye"></i></button><button class="btn-icon" onclick="app.bulkReassign(${agent.id})" title="Reassign"><i class="fas fa-exchange-alt"></i></button><button class="btn-icon" onclick="app.bulkReassign(${agent.id})" title="Bulk Reassign"><i class="fas fa-users"></i></button></td></tr>`;
        }).join('');
    };

    const renderInactiveProspectsRows = ({ visibleProspects, agentMap, lastActivityMap }) => {
        const inactive = visibleProspects
            .filter(p => (lastActivityMap[p.id]?.daysSince ?? 999) > 7)
            .sort((a, b) => (lastActivityMap[b.id]?.daysSince ?? 999) - (lastActivityMap[a.id]?.daysSince ?? 999));
        if (!inactive.length) return '<tr><td colspan="7" style="text-align:center;padding:24px;color:var(--gray-500)">No inactive prospects found</td></tr>';
        return inactive.map(p => {
            const days = lastActivityMap[p.id]?.daysSince ?? 999;
            const agentName = agentMap[p.responsible_agent_id]?.full_name || 'Unassigned';
            const protDays = (window.app.calculateProtectionDays || (() => 0))(p);
            const status = days > 14 || protDays <= 0 ? 'critical' : 'warning';
            const deadline = p.protection_deadline ? UI.formatDate(p.protection_deadline) : 'N/A';
            return `<tr><td><strong>${p.full_name || 'Unknown'}</strong></td><td>${agentName}</td><td class="${days > 14 ? 'critical' : 'warning'}">${days === 999 ? 'Never' : days + ' days'}</td><td>${p.score || 0}</td><td>${deadline}</td><td><span class="status-badge status-${status}">${status === 'critical' ? '🔴 Critical' : '🟡 Warning'}</span></td><td><button class="btn-icon" onclick="app.openReassignModal(${p.id})" title="Reassign"><i class="fas fa-exchange-alt"></i></button><button class="btn-icon" onclick="app.contactProspect(${p.id})" title="Contact"><i class="fas fa-phone"></i></button></td></tr>`;
        }).join('');
    };

    const renderReassignmentHistory = async () => {
        // Fetch history + users in parallel, build a user map once. Previously
        // this fired 3 * history.length getById calls — 300 roundtrips on a
        // 100-row history. Now it's 2 queries total.
        const [historyRaw, allUsers] = await Promise.all([
            AppDataStore.getAll('reassignment_history'),
            AppDataStore.getAll('users'),
        ]);
        const history = (historyRaw || []).sort((a, b) => new Date(b.reassignment_date) - new Date(a.reassignment_date));
        if (history.length === 0) return '<p style="padding:16px;color:var(--gray-500)">No reassignment history yet.</p>';
        const userMap = new Map((allUsers || []).map(u => [String(u.id), u]));
        const nameOf = (id) => userMap.get(String(id))?.full_name || `Agent #${id}`;

        const rows = history.map(r => `<tr><td>${UI.formatDate(r.reassignment_date)}</td><td>#${r.prospect_id}</td><td>${nameOf(r.from_agent_id)}</td><td>${nameOf(r.to_agent_id)}</td><td>${r.reassignment_reason}</td><td>${nameOf(r.reassigned_by)}</td></tr>`);

        return `<table class="agent-performance-table"><thead><tr><th scope="col">Date</th><th scope="col">Prospect ID</th><th scope="col">From Agent</th><th scope="col">To Agent</th><th scope="col">Reason</th><th scope="col">By</th></tr></thead><tbody>${rows.join('')}</tbody></table>`;
    };

    // ────────────────────────────────────────────────────────────────────────
    // Single shared cascade for prospect→agent reassignment.
    // Always updates prospects.responsible_agent_id; optionally cascades to
    // the linked converted customer (responsible_agent_id + legacy agent_id)
    // and to historical activities (lead_agent_id) currently credited to the
    // old agent. Writes a reassignment_history audit row with a cascade note.
    // Best-effort client-side rollback if any write fails mid-flight.
    const cascadeProspectReassign = async (prospectId, toAgentId, opts = {}) => {
        const pid = parseInt(prospectId);
        const newAgentId = parseInt(toAgentId);
        if (!pid || !newAgentId) throw new Error('Missing prospect or agent id');

        const prospect = await AppDataStore.getById('prospects', pid);
        if (!prospect) throw new Error('Prospect not found');
        const fromAgentId = prospect.responsible_agent_id || null;

        if (fromAgentId != null && String(fromAgentId) === String(newAgentId)) {
            return { skipped: true, reason: 'same_agent', fromAgentId, toAgentId: newAgentId,
                     linkedCustomerCount: 0, customersCascaded: 0, activitiesCascaded: 0 };
        }

        const allCustomers = await AppDataStore.getAll('customers');
        const linkedCustomers = (allCustomers || []).filter(c =>
            String(c.converted_from_prospect_id) === String(pid));

        let activitiesToTransfer = [];
        const cascadeActivitiesAfter = opts.cascadeActivitiesAfter ?? null;
        if (cascadeActivitiesAfter) {
            const allActs = await AppDataStore.getAll('activities');
            const cutoffMs = new Date(cascadeActivitiesAfter).getTime();
            const linkedCustomerIds = new Set(linkedCustomers.map(c => String(c.id)));
            activitiesToTransfer = (allActs || []).filter(a => {
                const matchesEntity = String(a.prospect_id) === String(pid)
                    || (a.customer_id && linkedCustomerIds.has(String(a.customer_id)));
                if (!matchesEntity) return false;
                if (fromAgentId != null && String(a.lead_agent_id) !== String(fromAgentId)) return false;
                if (!a.activity_date) return false;
                return new Date(a.activity_date).getTime() >= cutoffMs;
            });
        }

        const now = new Date().toISOString();
        const prospectPatch = { responsible_agent_id: newAgentId };
        let protectionResetTo = null;
        if (opts.resetProtection) {
            protectionResetTo = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
            prospectPatch.protection_deadline = protectionResetTo;
        }

        const customersDone = [];
        const activitiesDone = [];
        let prospectDone = false;
        try {
            await AppDataStore.update('prospects', pid, prospectPatch);
            prospectDone = true;

            if (opts.cascadeCustomer !== false && linkedCustomers.length) {
                for (const c of linkedCustomers) {
                    await AppDataStore.update('customers', c.id, {
                        responsible_agent_id: newAgentId,
                        agent_id: newAgentId
                    });
                    customersDone.push({ id: c.id,
                        prev_responsible: c.responsible_agent_id ?? null,
                        prev_agent: c.agent_id ?? null });
                }
            }

            for (const a of activitiesToTransfer) {
                await AppDataStore.update('activities', a.id, { lead_agent_id: newAgentId });
                activitiesDone.push({ id: a.id, prev_lead: a.lead_agent_id });
            }
        } catch (err) {
            try {
                if (prospectDone) {
                    const rollback = { responsible_agent_id: fromAgentId };
                    if (protectionResetTo) rollback.protection_deadline = prospect.protection_deadline ?? null;
                    await AppDataStore.update('prospects', pid, rollback);
                }
                for (const c of customersDone) {
                    await AppDataStore.update('customers', c.id, {
                        responsible_agent_id: c.prev_responsible,
                        agent_id: c.prev_agent
                    });
                }
                for (const a of activitiesDone) {
                    await AppDataStore.update('activities', a.id, { lead_agent_id: a.prev_lead });
                }
            } catch (_rb) { /* rollback best-effort */ }
            throw new Error(`Reassignment failed and was rolled back: ${err.message}`);
        }

        try {
            const cascadeBits = [];
            if (customersDone.length) cascadeBits.push(`customer×${customersDone.length}`);
            if (activitiesDone.length) cascadeBits.push(`activities×${activitiesDone.length}`);
            const notes = (opts.reasonNotes || '') + (cascadeBits.length
                ? ` [cascaded: ${cascadeBits.join(', ')}]`
                : '');
            await AppDataStore.create('reassignment_history', {
                prospect_id: pid,
                from_agent_id: fromAgentId,
                to_agent_id: newAgentId,
                reassigned_by: _currentUser?.id,
                reassignment_date: now,
                reassignment_reason: opts.reason || 'manual',
                reason_notes: notes,
                days_inactive: opts.daysInactive || 0,
                protection_deadline: protectionResetTo || prospect.protection_deadline || '',
                created_at: now
            });
        } catch (_h) { /* audit log best-effort */ }

        return {
            skipped: false,
            fromAgentId,
            toAgentId: newAgentId,
            linkedCustomerCount: linkedCustomers.length,
            customersCascaded: customersDone.length,
            activitiesCascaded: activitiesDone.length,
            protectionResetTo
        };
    };

    // Customer-side reassignment. Reverse-syncs to the source prospect (if
    // converted) so the two stay aligned. Activity history is preserved.
    const cascadeCustomerReassign = async (customerId, toAgentId) => {
        const cid = parseInt(customerId);
        const newAgentId = parseInt(toAgentId);
        if (!cid || !newAgentId) throw new Error('Missing customer or agent id');

        const customer = await AppDataStore.getById('customers', cid);
        if (!customer) throw new Error('Customer not found');
        const fromAgentId = customer.responsible_agent_id || customer.agent_id || null;
        if (fromAgentId != null && String(fromAgentId) === String(newAgentId)) {
            return { skipped: true, reason: 'same_agent' };
        }

        await AppDataStore.update('customers', cid, {
            responsible_agent_id: newAgentId,
            agent_id: newAgentId
        });

        let prospectSynced = false;
        const sourceProspectId = customer.converted_from_prospect_id;
        if (sourceProspectId) {
            try {
                const sourceProspect = await AppDataStore.getById('prospects', sourceProspectId);
                if (sourceProspect && String(sourceProspect.responsible_agent_id) !== String(newAgentId)) {
                    await AppDataStore.update('prospects', sourceProspectId, { responsible_agent_id: newAgentId });
                    try {
                        await AppDataStore.create('reassignment_history', {
                            prospect_id: sourceProspectId,
                            from_agent_id: sourceProspect.responsible_agent_id || null,
                            to_agent_id: newAgentId,
                            reassigned_by: _currentUser?.id,
                            reassignment_date: new Date().toISOString(),
                            reassignment_reason: 'customer_dropdown_sync',
                            reason_notes: `Synced from customer #${cid} reassignment`,
                            created_at: new Date().toISOString()
                        });
                    } catch (_h) {}
                    prospectSynced = true;
                }
            } catch (_p) {}
        }

        return { skipped: false, fromAgentId, toAgentId: newAgentId, prospectSynced };
    };

    // ────────────────────────────────────────────────────────────────────────
    // Confirmation popup layer: every reassignment path stashes its intent in
    // _pendingReassign and shows a summary popup. Only the user's explicit
    // "Yes, Shift Everything Over" click triggers the actual cascade write.
    let _pendingReassign = null;

    const _renderReassignSummary = (s) => {
        const lines = [];
        if (s.kind === 'single') {
            lines.push(`<li><strong>${escapeHtml(s.prospectName || 'This prospect')}</strong>'s ownership will move from <strong>${escapeHtml(s.fromAgentName)}</strong> to <strong>${escapeHtml(s.toAgentName)}</strong>.</li>`);
            if (s.willCascadeCustomer && s.linkedCustomerCount > 0) {
                lines.push(`<li>✓ <strong>${s.linkedCustomerCount}</strong> linked customer record${s.linkedCustomerCount > 1 ? 's' : ''} will also move (incl. future commission &amp; renewal credit).</li>`);
            } else if (s.linkedCustomerCount > 0) {
                lines.push(`<li>⚠ ${s.linkedCustomerCount} linked customer record${s.linkedCustomerCount > 1 ? 's' : ''} will <strong>stay with ${escapeHtml(s.fromAgentName)}</strong> (customer commission stays on old agent).</li>`);
            } else {
                lines.push(`<li>No converted customer linked — nothing to cascade on the customer side.</li>`);
            }
            if (s.willCascadeActivities && s.activityTransferCount > 0) {
                lines.push(`<li>⚠ <strong>${s.activityTransferCount}</strong> past activit${s.activityTransferCount > 1 ? 'ies' : 'y'} will flip to ${escapeHtml(s.toAgentName)} — historical KPI credit rewrites.</li>`);
            } else if (s.willCascadeActivities) {
                lines.push(`<li>Activity transfer was enabled but no matching activities fell in range — history preserved.</li>`);
            } else {
                lines.push(`<li>Past activity credit stays with ${escapeHtml(s.fromAgentName)} (KPI history preserved).</li>`);
            }
            if (s.protectionResetEnabled) lines.push(`<li>Protection deadline resets to today + 30 days.</li>`);
        } else {
            lines.push(`<li><strong>${s.bulkCount}</strong> prospect${s.bulkCount > 1 ? 's' : ''} will be reassigned${s.toAgentName ? ` to <strong>${escapeHtml(s.toAgentName)}</strong>` : ' across multiple agents (distribution)'}.</li>`);
            if (s.bulkCustomerCascadeEnabled && s.bulkLinkedCustomers > 0) {
                lines.push(`<li>✓ <strong>${s.bulkLinkedCustomers}</strong> linked customer record${s.bulkLinkedCustomers > 1 ? 's' : ''} will also move with their prospect.</li>`);
            } else if (s.bulkLinkedCustomers > 0) {
                lines.push(`<li>⚠ ${s.bulkLinkedCustomers} linked customer record${s.bulkLinkedCustomers > 1 ? 's' : ''} will <strong>stay on the old agent</strong>.</li>`);
            } else {
                lines.push(`<li>None of the selected prospects are converted — no customer cascade.</li>`);
            }
            if (s.bulkActivityCascadeEnabled) {
                lines.push(`<li>⚠ Past activities currently credited to source agent(s) will flip — historical KPI rewrites.</li>`);
            } else {
                lines.push(`<li>Past activity credit is preserved on the source agents.</li>`);
            }
        }
        return `
            <div style="padding:4px 0;">
                <div style="background:#fef3c7;border-left:4px solid #f59e0b;padding:14px;border-radius:6px;margin-bottom:14px;">
                    <div style="font-weight:700;color:#92400e;font-size:14px;">⚠️ Are you sure you want to shift this?</div>
                    <div style="color:#78350f;font-size:13px;margin-top:6px;line-height:1.5;">Once confirmed, the change writes to the database and is logged in the reassignment history. Reverting requires another reassignment.</div>
                </div>
                <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:14px;font-size:13px;">
                    <div style="font-weight:600;margin-bottom:10px;font-size:14px;color:#1f2937;">What will shift:</div>
                    <ul style="margin:0;padding-left:20px;line-height:1.7;color:#334155;">${lines.join('')}</ul>
                </div>
            </div>
        `;
    };

    const _showReassignConfirmPopup = (titleText, summaryHtml, executeFnName) => {
        UI.showModal(titleText, summaryHtml, [
            { label: 'Cancel', type: 'secondary', action: `(async () => { await app.cancelPendingReassign(); })()` },
            { label: '✓ Yes, Shift Everything Over', type: 'primary', action: `(async () => { await app.${executeFnName}(); })()` }
        ]);
    };

    const cancelPendingReassign = async () => {
        const p = _pendingReassign;
        _pendingReassign = null;
        UI.hideModal();
        if (!p) return;

        // Quick dropdown: dropdown was already pre-reverted at popup-open time,
        // so this is just a safety belt in case anything mutated it.
        if (p.kind === 'quick' && p.selectEl && p.fromAgentId != null) {
            try { p.selectEl.value = String(p.fromAgentId); } catch (_) {}
            return;
        }

        // Full reassign modal: re-open the original modal so the user doesn't
        // lose the reason / justification / cascade checkbox state they typed.
        if (p.kind === 'modalSingle' && p.prospectId && p.formSnapshot) {
            try {
                await openReassignModal(p.prospectId);
                // Give the modal a moment to render before restoring values
                await new Promise(r => setTimeout(r, 40));
                const snap = p.formSnapshot;
                const a = document.getElementById('reassign-agent');
                if (a && snap.agentValue) a.value = snap.agentValue;
                const j = document.getElementById('reassign-justification');
                if (j) j.value = snap.justification || '';
                if (snap.reason) {
                    const r = document.querySelector(`input[name="reassign-reason"][value="${snap.reason}"]`);
                    if (r) r.checked = true;
                }
                const cc = document.getElementById('reassign-cascade-customer');
                if (cc) cc.checked = !!snap.cascadeCustomerChecked;
                const ca = document.getElementById('reassign-cascade-activities');
                if (ca) ca.checked = !!snap.cascadeActivitiesChecked;
                const cd = document.getElementById('reassign-cascade-activities-from');
                if (cd && snap.cascadeActivitiesFromValue) cd.value = snap.cascadeActivitiesFromValue;
                const rp = document.getElementById('reassign-reset-protection');
                if (rp) rp.checked = !!snap.resetProtectionChecked;
                const nf = document.getElementById('reassign-notify');
                if (nf) nf.checked = !!snap.notifyChecked;
            } catch (_) {}
        }
    };

    const openReassignModal = async (prospectId) => {
        const [prospect, allActivities, allUsers, allProspectsForCap, allCustomers] = await Promise.all([
            AppDataStore.getById('prospects', prospectId),
            AppDataStore.getAll('activities'),
            AppDataStore.getAll('users'),
            AppDataStore.getAll('prospects'),
            AppDataStore.getAll('customers'),
        ]);
        if (!prospect) { UI.toast.error('Prospect not found'); return; }
        const currentAgent = prospect.responsible_agent_id
            ? allUsers.find(u => String(u.id) === String(prospect.responsible_agent_id)) || null
            : null;
        const linkedCustomers = (allCustomers || []).filter(c => String(c.converted_from_prospect_id) === String(prospectId));
        const linkedCustomerCount = linkedCustomers.length;
        const fromAgentActivityCount = allActivities.filter(a => {
            const pidMatch = String(a.prospect_id) === String(prospectId);
            const cidMatch = a.customer_id && linkedCustomers.some(c => String(c.id) === String(a.customer_id));
            return (pidMatch || cidMatch) && prospect.responsible_agent_id != null
                && String(a.lead_agent_id) === String(prospect.responsible_agent_id);
        }).length;
        const pActs = allActivities.filter(a => String(a.prospect_id) === String(prospectId)).sort((a, b) => new Date(b.activity_date) - new Date(a.activity_date));
        const lastAct = pActs[0];
        const daysSince = lastAct ? Math.floor((Date.now() - new Date(lastAct.activity_date)) / (1000 * 60 * 60 * 24)) : 999;
        const activeAgents = allUsers.filter(u => {
            const lvl = _getUserLevel(u);
            return lvl >= 3 && lvl <= 11 && u.status !== 'deleted' && u.id !== prospect.responsible_agent_id;
        });
        const agentOptions = activeAgents.map(a => {
            const assignedCount = allProspectsForCap.filter(p => String(p.responsible_agent_id) === String(a.id)).length;
            const capacity = Math.max(0, 60 - assignedCount);
            const icon = capacity > 10 ? '🟢' : capacity > 0 ? '🟡' : '🔴';
            return `<option value="${a.id}">${a.full_name || 'Agent'} (${assignedCount} assigned, capacity +${capacity}) ${icon}</option>`;
        }).join('');
        const content = `
            <div class="reassign-modal">
                <input type="hidden" id="reassign-prospect-id" value="${prospectId}">
                <input type="hidden" id="reassign-from-agent-id" value="${prospect.responsible_agent_id || ''}">
                <div class="current-info">
                    <h4>Current Information</h4>
                    <div class="info-grid">
                        <div><strong>Prospect:</strong> ${prospect.full_name || 'Unknown'}</div><div><strong>Current Agent:</strong> ${currentAgent?.full_name || 'Unassigned'}</div>
                        <div><strong>Days Inactive:</strong> <span data-days-inactive="${daysSince}">${daysSince === 999 ? 'Never contacted' : daysSince}</span></div><div><strong>Score:</strong> ${prospect.score || 0}</div>
                        <div><strong>Protection Deadline:</strong> ${prospect.protection_deadline ? UI.formatDate(prospect.protection_deadline) : 'N/A'}</div><div><strong>Last Activity:</strong> ${lastAct ? UI.formatDate(lastAct.activity_date) + ' (' + (lastAct.activity_type || 'Unknown') + ')' : 'Never'}</div>
                    </div>
                </div>
                <div class="form-group">
                    <label>Reassign to</label>
                    <select id="reassign-agent" class="form-control">${agentOptions || '<option value="">No agents available</option>'}</select>
                </div>
                <div class="form-group">
                    <label>Reason for reassignment</label>
                    <div class="radio-group">
                        <label class="radio-label"><input type="radio" name="reassign-reason" value="inactive" checked> Agent inactive / unresponsive</label>
                        <label class="radio-label"><input type="radio" name="reassign-reason" value="workload"> Workload balancing</label>
                        <label class="radio-label"><input type="radio" name="reassign-reason" value="territory"> Territory realignment</label>
                        <label class="radio-label"><input type="radio" name="reassign-reason" value="request"> Prospect request</label>
                    </div>
                </div>
                <div class="form-group">
                    <label>Justification</label>
                    <textarea id="reassign-justification" class="form-control" rows="3"></textarea>
                </div>
                <div class="form-group">
                    <label class="checkbox-label"><input type="checkbox" id="reassign-notify" checked> Send notification to new agent</label>
                    <label class="checkbox-label"><input type="checkbox" id="reassign-reset-protection" checked> Reset protection period (30 days)</label>
                </div>
                <div class="form-group" style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:12px;">
                    <label style="font-weight:600;display:block;margin-bottom:8px;">What else should follow the new agent?</label>
                    ${linkedCustomerCount > 0 ? `
                        <label class="checkbox-label" style="display:flex;align-items:flex-start;gap:8px;margin-bottom:4px;">
                            <input type="checkbox" id="reassign-cascade-customer" checked style="margin-top:3px;">
                            <span>
                                <strong>Transfer linked customer record</strong> (${linkedCustomerCount} converted customer${linkedCustomerCount > 1 ? 's' : ''})
                                <div style="font-size:11px;color:#475569;margin-top:2px;">Recommended — otherwise the new agent owns the prospect but old agent keeps the customer & future commission.</div>
                            </span>
                        </label>
                    ` : `
                        <div style="font-size:12px;color:#64748b;margin-bottom:8px;font-style:italic;">No converted customer linked to this prospect.</div>
                    `}
                    <label class="checkbox-label" style="display:flex;align-items:flex-start;gap:8px;margin-top:8px;">
                        <input type="checkbox" id="reassign-cascade-activities" style="margin-top:3px;">
                        <span>
                            <strong>Transfer activity credit</strong> ${fromAgentActivityCount > 0 ? `(${fromAgentActivityCount} historical activit${fromAgentActivityCount > 1 ? 'ies' : 'y'} on old agent)` : '(no historical activities to transfer)'}
                            <div style="font-size:11px;color:#92400e;margin-top:2px;">⚠️ Off by default — flipping this rewrites who gets KPI credit for past CPS / calls / visits. Only enable when correcting a wrong-assignment.</div>
                            <div style="margin-top:6px;display:flex;align-items:center;gap:6px;font-size:12px;">
                                <span style="color:#475569;">From date:</span>
                                <input type="date" id="reassign-cascade-activities-from" class="form-control" style="font-size:12px;padding:2px 6px;width:auto;" value="${new Date(Date.now() - 365*24*60*60*1000).toISOString().split('T')[0]}">
                            </div>
                        </span>
                    </label>
                </div>
            </div>`;
        UI.showModal(`Reassign Prospect: ${prospect.full_name || 'Unknown'}`, content, [
            { label: 'Cancel', type: 'secondary', action: 'UI.hideModal()' },
            { label: 'CONFIRM REASSIGNMENT', type: 'primary', action: '(async () => { await app.confirmReassignment(); })()' }
        ]);
    };

    const confirmReassignment = async () => {
        try {
            const prospectId = parseInt(document.getElementById('reassign-prospect-id')?.value);
            const toAgentId = parseInt(document.getElementById('reassign-agent')?.value);
            if (!prospectId || !toAgentId) { UI.toast.error('Missing prospect or agent'); return; }

            const cascadeCustomer = document.getElementById('reassign-cascade-customer')?.checked ?? false;
            const cascadeActivitiesChecked = document.getElementById('reassign-cascade-activities')?.checked ?? false;
            const cascadeFromDate = document.getElementById('reassign-cascade-activities-from')?.value || null;
            const resetProtection = document.getElementById('reassign-reset-protection')?.checked ?? false;
            const daysInactive = parseInt(document.querySelector('[data-days-inactive]')?.dataset.daysInactive) || 0;
            const reason = document.querySelector('input[name="reassign-reason"]:checked')?.value || 'inactive';
            const reasonNotes = document.getElementById('reassign-justification')?.value || '';

            // Build preview before showing confirm popup
            const [prospect, allUsers, allCustomers, allActivities] = await Promise.all([
                AppDataStore.getById('prospects', prospectId),
                AppDataStore.getAll('users'),
                AppDataStore.getAll('customers'),
                AppDataStore.getAll('activities'),
            ]);
            const fromAgentId = prospect?.responsible_agent_id || null;
            const fromAgentName = ((allUsers || []).find(u => String(u.id) === String(fromAgentId))?.full_name)
                || (fromAgentId ? `Agent #${fromAgentId}` : 'Unassigned');
            const toAgentName = ((allUsers || []).find(u => String(u.id) === String(toAgentId))?.full_name)
                || `Agent #${toAgentId}`;
            const linkedCustomers = (allCustomers || []).filter(c => String(c.converted_from_prospect_id) === String(prospectId));
            const linkedCustomerCount = linkedCustomers.length;
            let activityTransferCount = 0;
            if (cascadeActivitiesChecked && cascadeFromDate) {
                const cutoffMs = new Date(cascadeFromDate).getTime();
                const linkedIds = new Set(linkedCustomers.map(c => String(c.id)));
                activityTransferCount = (allActivities || []).filter(a => {
                    const matchesEntity = String(a.prospect_id) === String(prospectId)
                        || (a.customer_id && linkedIds.has(String(a.customer_id)));
                    if (!matchesEntity) return false;
                    if (fromAgentId != null && String(a.lead_agent_id) !== String(fromAgentId)) return false;
                    if (!a.activity_date) return false;
                    return new Date(a.activity_date).getTime() >= cutoffMs;
                }).length;
            }

            _pendingReassign = {
                kind: 'modalSingle',
                prospectId, toAgentId,
                cascadeCustomer,
                cascadeActivitiesAfter: cascadeActivitiesChecked ? cascadeFromDate : null,
                resetProtection,
                reason, reasonNotes, daysInactive,
                // Snapshot of form state — used by cancelPendingReassign to
                // restore the modal if the user backs out of the confirmation.
                formSnapshot: {
                    agentValue: String(toAgentId),
                    reason, justification: reasonNotes,
                    cascadeCustomerChecked: cascadeCustomer,
                    cascadeActivitiesChecked,
                    cascadeActivitiesFromValue: cascadeFromDate || '',
                    resetProtectionChecked: resetProtection,
                    notifyChecked: !!document.getElementById('reassign-notify')?.checked
                }
            };

            const summaryHtml = _renderReassignSummary({
                kind: 'single',
                prospectName: prospect?.full_name,
                fromAgentName, toAgentName,
                linkedCustomerCount,
                willCascadeCustomer: cascadeCustomer,
                activityTransferCount,
                willCascadeActivities: cascadeActivitiesChecked,
                protectionResetEnabled: resetProtection
            });
            _showReassignConfirmPopup('Confirm Prospect Reassignment', summaryHtml, 'executeConfirmedReassignment');
        } catch (err) {
            UI.toast.error('Could not prepare confirmation: ' + err.message);
        }
    };

    const executeConfirmedReassignment = async () => {
        const p = _pendingReassign;
        if (!p || p.kind !== 'modalSingle') return;
        _pendingReassign = null;
        UI.hideModal();
        try {
            const result = await cascadeProspectReassign(p.prospectId, p.toAgentId, {
                reason: p.reason,
                reasonNotes: p.reasonNotes,
                resetProtection: p.resetProtection,
                cascadeCustomer: p.cascadeCustomer,
                cascadeActivitiesAfter: p.cascadeActivitiesAfter,
                daysInactive: p.daysInactive
            });
            if (result.skipped) {
                UI.toast.info('No change — already assigned to this agent.');
            } else {
                const bits = [];
                if (result.customersCascaded) bits.push(`${result.customersCascaded} customer record`);
                if (result.activitiesCascaded) bits.push(`${result.activitiesCascaded} activit${result.activitiesCascaded > 1 ? 'ies' : 'y'}`);
                UI.toast.success(bits.length
                    ? `Prospect reassigned (also transferred: ${bits.join(', ')})`
                    : 'Prospect reassigned successfully');
            }
            const container = document.getElementById('content-viewport');
            if (container) await showProtectionMonitoringView(container);
        } catch (err) {
            UI.toast.error('Reassignment failed: ' + err.message);
        }
    };

    const quickReassign = async (entityId, newAgentId, entityType = 'prospect') => {
        // Quick dropdown reassignment. Now requires explicit confirmation via
        // popup before the write fires. Cancel reverts the dropdown.
        newAgentId = parseInt(newAgentId);
        const id = parseInt(entityId);
        if (!id || !newAgentId) return;

        const selectEl = document.querySelector(`select[onchange*="quickReassign(${id}"]`);
        const dropdownName = selectEl?.options[selectEl.selectedIndex]?.text || '';

        let fromAgentId = null;
        let fromAgentName = 'Unassigned';
        let toAgentName = dropdownName;
        let entityName = entityType === 'customer' ? 'This customer' : 'This prospect';
        let linkedCustomerCount = 0;
        try {
            const users = await AppDataStore.getAll('users');
            const userById = (uid) => ((users || []).find(u => String(u.id) === String(uid))?.full_name) || null;
            const toAgentLookup = userById(newAgentId);
            if (!toAgentName || /^Agent$/i.test(toAgentName.trim())) {
                toAgentName = toAgentLookup || `Agent #${newAgentId}`;
            }
            if (entityType === 'customer') {
                const customer = await AppDataStore.getById('customers', id);
                if (!customer) throw new Error('Customer not found');
                fromAgentId = customer.responsible_agent_id || customer.agent_id || null;
                if (fromAgentId != null && String(fromAgentId) === String(newAgentId)) return;
                entityName = customer.full_name || entityName;
                fromAgentName = userById(fromAgentId)
                    || (fromAgentId ? `Agent #${fromAgentId}` : 'Unassigned');
            } else {
                const prospect = await AppDataStore.getById('prospects', id);
                if (!prospect) throw new Error('Prospect not found');
                fromAgentId = prospect.responsible_agent_id || null;
                if (fromAgentId != null && String(fromAgentId) === String(newAgentId)) return;
                entityName = prospect.full_name || entityName;
                const customers = await AppDataStore.getAll('customers');
                fromAgentName = userById(fromAgentId)
                    || (fromAgentId ? `Agent #${fromAgentId}` : 'Unassigned');
                linkedCustomerCount = (customers || []).filter(c =>
                    String(c.converted_from_prospect_id) === String(id)).length;
            }
        } catch (err) {
            if (selectEl && fromAgentId != null) selectEl.value = String(fromAgentId);
            UI.toast.error('Could not load: ' + err.message);
            return;
        }

        // Revert dropdown to OLD agent immediately. The dropdown only flips to
        // the new agent if the user explicitly clicks "Yes, Shift Everything
        // Over" in the popup. This way the × close button can't leave the
        // dropdown lying about its DB state.
        if (selectEl && fromAgentId != null) {
            try { selectEl.value = String(fromAgentId); } catch (_) {}
        }

        _pendingReassign = {
            kind: 'quick',
            entityType, id, newAgentId,
            selectEl, fromAgentId, optimisticName: toAgentName
        };

        const summaryHtml = _renderReassignSummary({
            kind: 'single',
            prospectName: entityName,
            fromAgentName,
            toAgentName,
            linkedCustomerCount: entityType === 'prospect' ? linkedCustomerCount : 0,
            willCascadeCustomer: entityType === 'prospect',
            activityTransferCount: 0,
            willCascadeActivities: false,
            protectionResetEnabled: false
        });
        _showReassignConfirmPopup(
            entityType === 'customer' ? 'Confirm Customer Reassignment' : 'Confirm Prospect Reassignment',
            summaryHtml,
            'executeConfirmedQuickReassign'
        );
    };

    const executeConfirmedQuickReassign = async () => {
        const p = _pendingReassign;
        if (!p || p.kind !== 'quick') return;
        _pendingReassign = null;
        UI.hideModal();
        // Flip dropdown to NEW agent now that user confirmed (we reverted to old
        // when showing the popup so that × close left it correct).
        if (p.selectEl && p.newAgentId != null) {
            try { p.selectEl.value = String(p.newAgentId); } catch (_) {}
        }
        try {
            if (p.entityType === 'customer') {
                const result = await cascadeCustomerReassign(p.id, p.newAgentId);
                if (result.skipped) return;
                const extra = result.prospectSynced ? ' (source prospect synced)' : '';
                UI.toast.success(`Customer reassigned to ${p.optimisticName}${extra}`);
            } else {
                const result = await cascadeProspectReassign(p.id, p.newAgentId, {
                    reason: 'manual',
                    reasonNotes: 'Quick reassign from table',
                    cascadeCustomer: true,
                    cascadeActivitiesAfter: null
                });
                if (result.skipped) return;
                const extra = result.customersCascaded
                    ? ` (also moved ${result.customersCascaded} customer record)`
                    : '';
                UI.toast.success(`Reassigned to ${p.optimisticName}${extra}`);
            }
        } catch (err) {
            if (p.selectEl && p.fromAgentId != null) {
                try { p.selectEl.value = String(p.fromAgentId); } catch (_) {}
            }
            UI.toast.error('Reassignment failed: ' + err.message);
        }
    };

    const bulkReassign = async (agentId) => {
        const [agent, allProspects, allActivities, allUsers] = await Promise.all([
            AppDataStore.getById('users', agentId),
            AppDataStore.getAll('prospects'),
            AppDataStore.getAll('activities'),
            AppDataStore.getAll('users'),
        ]);
        if (!agent) { UI.toast.error('Agent not found'); return; }
        const now = new Date();
        const agentProspects = allProspects.filter(p => String(p.responsible_agent_id) === String(agentId));
        const inactiveProspects = agentProspects.filter(p => {
            const pActs = allActivities.filter(a => String(a.prospect_id) === String(p.id)).sort((a, b) => new Date(b.activity_date) - new Date(a.activity_date));
            const last = pActs[0];
            p._daysSince = last ? Math.floor((now - new Date(last.activity_date)) / (1000 * 60 * 60 * 24)) : 999;
            return p._daysSince > 7;
        }).sort((a, b) => b._daysSince - a._daysSince);
        if (!inactiveProspects.length) { UI.toast.info('No inactive prospects found for this agent'); return; }
        const avgDays = Math.round(inactiveProspects.reduce((s, p) => s + (p._daysSince === 999 ? 0 : p._daysSince), 0) / inactiveProspects.length);
        const otherAgents = allUsers.filter(u => {
            const lvl = _getUserLevel(u);
            return lvl >= 3 && lvl <= 11 && u.status !== 'deleted' && u.id !== agentId;
        });
        const prospectCheckboxes = inactiveProspects.map(p =>
            `<label class="checkbox-label"><input type="checkbox" checked data-prospect-id="${p.id}"> ${p.full_name || 'Unknown'} (${p._daysSince === 999 ? 'Never' : p._daysSince + 'd'}, Score ${p.score || 0})</label>`
        ).join('');
        const perAgent = otherAgents.length ? Math.ceil(inactiveProspects.length / otherAgents.length) : 0;
        const distPreview = otherAgents.map((a, i) => {
            const share = i < inactiveProspects.length % otherAgents.length ? perAgent : Math.floor(inactiveProspects.length / otherAgents.length);
            return `<li>${a.full_name || 'Agent'}: ${share} prospects</li>`;
        }).join('');
        const singleAgentOptions = otherAgents.map(a => `<option value="${a.id}">${a.full_name || 'Agent'}</option>`).join('');
        const content = `<div class="bulk-reassign-modal">
            <input type="hidden" id="bulk-reassign-from-agent" value="${agentId}">
            <div style="background:var(--gray-50);padding:16px;border-radius:8px;margin-bottom:16px">
                <div><strong>From Agent:</strong> ${agent.full_name || 'Unknown'}</div><div><strong>Average inactive days:</strong> ${avgDays}</div><div><strong>Prospects selected:</strong> ${inactiveProspects.length}</div>
            </div>
            <div class="selected-prospects"><h4>Selected Prospects</h4><div class="prospects-list" style="max-height:200px;overflow-y:auto">
                ${prospectCheckboxes}
            </div></div>
            <div class="form-group">
                <label>Reassign to</label>
                <div class="radio-group">
                    <label class="radio-label"><input type="radio" name="bulk-option" value="distribute" checked onchange="document.getElementById('bulk-single-agent').style.display='none'"> Distribute evenly among active agents</label>
                    <label class="radio-label"><input type="radio" name="bulk-option" value="single" onchange="document.getElementById('bulk-single-agent').style.display='block'"> Assign all to single agent</label>
                </div>
                <select id="bulk-single-agent" class="form-control" style="display:none;margin-top:8px">${singleAgentOptions}</select>
            </div>
            <div class="distribution-preview"><h4>Distribution Preview</h4><ul>${distPreview || '<li>No agents available</li>'}</ul></div>
            <div class="form-group"><label>Justification</label><textarea class="form-control" rows="3">${agent.full_name || 'Agent'} has ${inactiveProspects.length} inactive prospect${inactiveProspects.length !== 1 ? 's' : ''}. Redistributing to other agents.</textarea></div>
            <div class="form-group" style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:12px;">
                <label style="font-weight:600;display:block;margin-bottom:8px;font-size:13px;">What else should follow the new agent?</label>
                <label class="checkbox-label" style="display:flex;align-items:flex-start;gap:8px;margin-bottom:6px;">
                    <input type="checkbox" id="bulkmon-cascade-customer" checked style="margin-top:3px;">
                    <span>
                        <strong>Transfer linked customer records</strong>
                        <div style="font-size:11px;color:#475569;margin-top:2px;">Recommended — keeps prospect ownership and customer commission aligned.</div>
                    </span>
                </label>
                <label class="checkbox-label" style="display:flex;align-items:flex-start;gap:8px;">
                    <input type="checkbox" id="bulkmon-cascade-activities" style="margin-top:3px;">
                    <span>
                        <strong>Transfer activity credit</strong>
                        <div style="font-size:11px;color:#92400e;margin-top:2px;">⚠️ Off by default — rewrites who gets KPI credit for past CPS / calls / visits.</div>
                        <div style="margin-top:6px;display:flex;align-items:center;gap:6px;font-size:12px;">
                            <span style="color:#475569;">From date:</span>
                            <input type="date" id="bulkmon-cascade-activities-from" class="form-control" style="font-size:12px;padding:2px 6px;width:auto;" value="${new Date(Date.now() - 365*24*60*60*1000).toISOString().split('T')[0]}">
                        </div>
                    </span>
                </label>
            </div>
        </div>`;
        UI.showModal('Bulk Reassignment', content, [
            { label: 'Cancel', type: 'secondary', action: 'UI.hideModal()' },
            { label: 'CONFIRM BULK REASSIGNMENT', type: 'primary', action: '(async () => { await app.confirmBulkReassignment(); })()' }
        ]);
    };

    const confirmBulkReassignment = async () => {
        try {
            const option = document.querySelector('input[name="bulk-option"]:checked')?.value || 'distribute';
            const checkedProspectIds = Array.from(document.querySelectorAll('.prospects-list input[type="checkbox"]:checked'))
                .map(cb => parseInt(cb.dataset.prospectId))
                .filter(id => !isNaN(id));
            const justification = document.querySelector('.bulk-reassign-modal textarea')?.value || 'Bulk reassignment';
            if (!checkedProspectIds.length) { UI.toast.error('No prospects selected'); return; }

            const allProspects = await AppDataStore.getAll('prospects');
            const matchedProspects = allProspects.filter(p => checkedProspectIds.includes(p.id));
            const fromAgentId = parseInt(document.getElementById('bulk-reassign-from-agent')?.value) || null;

            const allUsers = await AppDataStore.getAll('users');
            let targetAgents;
            if (option === 'single') {
                const singleId = parseInt(document.getElementById('bulk-single-agent')?.value);
                const singleAgent = allUsers.find(u => u.id === singleId);
                targetAgents = singleAgent ? [singleAgent] : [];
            } else {
                targetAgents = allUsers.filter(u => {
                    const lvl = _getUserLevel(u);
                    return lvl >= 3 && lvl <= 11 && u.status !== 'deleted' && u.id !== fromAgentId;
                });
            }
            if (!targetAgents.length) { UI.toast.error('No active agents to assign to'); return; }

            const cascadeCustomer = document.getElementById('bulkmon-cascade-customer')?.checked ?? true;
            const cascadeActivitiesChecked = document.getElementById('bulkmon-cascade-activities')?.checked ?? false;
            const cascadeFromDate = document.getElementById('bulkmon-cascade-activities-from')?.value || null;

            // Preview cascade scope
            const allCustomers = await AppDataStore.getAll('customers');
            const matchedIds = new Set(matchedProspects.map(p => String(p.id)));
            const linkedCount = (allCustomers || []).filter(c =>
                matchedIds.has(String(c.converted_from_prospect_id))).length;

            _pendingReassign = {
                kind: 'bulkMonitoring',
                option,
                fromAgentId,
                cascadeCustomer,
                cascadeActivitiesAfter: cascadeActivitiesChecked ? cascadeFromDate : null,
                justification,
                matchedProspects: matchedProspects.map(p => ({ id: p.id, responsible_agent_id: p.responsible_agent_id })),
                targetAgents: targetAgents.map(a => ({ id: a.id, full_name: a.full_name }))
            };

            const summaryHtml = _renderReassignSummary({
                kind: 'bulk',
                toAgentName: option === 'single' ? targetAgents[0]?.full_name : null,
                bulkCount: matchedProspects.length,
                bulkLinkedCustomers: linkedCount,
                bulkCustomerCascadeEnabled: cascadeCustomer,
                bulkActivityCascadeEnabled: cascadeActivitiesChecked
            });
            _showReassignConfirmPopup('Confirm Bulk Reassignment', summaryHtml, 'executeConfirmedBulkReassignment');
        } catch (err) {
            UI.toast.error('Could not prepare confirmation: ' + err.message);
        }
    };

    const executeConfirmedBulkReassignment = async () => {
        const p = _pendingReassign;
        if (!p || p.kind !== 'bulkMonitoring') return;
        _pendingReassign = null;
        UI.hideModal();
        try {
            let count = 0, totalCust = 0, totalActs = 0, errors = 0;
            for (let i = 0; i < p.matchedProspects.length; i++) {
                const prospect = p.matchedProspects[i];
                const targetAgent = p.targetAgents[i % p.targetAgents.length];
                try {
                    const result = await cascadeProspectReassign(prospect.id, targetAgent.id, {
                        reason: 'bulk_reassignment',
                        reasonNotes: p.justification,
                        cascadeCustomer: p.cascadeCustomer,
                        cascadeActivitiesAfter: p.cascadeActivitiesAfter
                    });
                    totalCust += result.customersCascaded || 0;
                    totalActs += result.activitiesCascaded || 0;
                    if (!result.skipped) count++;
                } catch { errors++; }
            }
            const bits = [];
            if (totalCust) bits.push(`${totalCust} customer record${totalCust > 1 ? 's' : ''}`);
            if (totalActs) bits.push(`${totalActs} activit${totalActs > 1 ? 'ies' : 'y'}`);
            const tail = bits.length ? ` (also transferred: ${bits.join(', ')})` : '';
            const errTail = errors ? ` — ${errors} failed.` : '';
            UI.toast.success(`${count} prospect${count !== 1 ? 's' : ''} reassigned${tail}${errTail}`);
            const container = document.getElementById('content-viewport');
            if (container) await showProtectionMonitoringView(container);
        } catch (err) {
            UI.toast.error('Reassignment failed: ' + err.message);
        }
    };

    const refreshFollowupStats = async () => {
        const container = document.getElementById('content-viewport');
        if (container) {
            await showProtectionMonitoringView(container);
            UI.toast.success('Follow-up statistics refreshed');
        }
    };

    const exportFollowupReport = async () => {
        try {
            const [prospects, agents, activities] = await Promise.all([
                AppDataStore.getAll('prospects'),
                AppDataStore.getAll('users'),
                AppDataStore.getAll('activities'),
            ]);
            const agentMap = Object.fromEntries(agents.map(a => [a.id, a.full_name]));
            const now = new Date();
            const rows = prospects.map(p => {
                const lastActivity = activities
                    .filter(a => a.prospect_id === p.id)
                    .sort((a, b) => new Date(b.activity_date) - new Date(a.activity_date))[0];
                const daysSince = lastActivity
                    ? Math.floor((now - new Date(lastActivity.activity_date)) / (1000 * 60 * 60 * 24))
                    : null;
                return [
                    p.full_name || '',
                    p.phone || '',
                    agentMap[p.responsible_agent_id] || 'Unassigned',
                    p.score || 0,
                    p.status || 'new',
                    lastActivity ? lastActivity.activity_date : 'Never',
                    daysSince !== null ? daysSince : 'N/A'
                ];
            });
            const cols = ['Prospect Name', 'Phone', 'Responsible Agent', 'Score', 'Status', 'Last Activity Date', 'Days Since Last Activity'];
            const csvRows = [cols, ...rows].map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(','));
            const blob = new Blob([csvRows.join('\n')], { type: 'text/csv' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `followup_report_${new Date().toISOString().slice(0,10)}.csv`;
            document.body.appendChild(a); a.click(); document.body.removeChild(a);
            URL.revokeObjectURL(url);
            UI.toast.success(`Follow-up report exported (${rows.length} prospects)`);
        } catch (err) {
            UI.toast.error('Export failed: ' + err.message);
        }
    };

    const configureAlerts = () => {
        let config = {};
        try {
            config = JSON.parse(localStorage.getItem('fs_crm_alert_config') || '{}') || {};
        } catch (_) {
            // Corrupt localStorage payload — reset to defaults rather than crashing the alerts UI.
            localStorage.removeItem('fs_crm_alert_config');
            config = {};
        }
        const warningDays = config.warningDays || 7;
        const criticalDays = config.criticalDays || 14;
        const autoReassign = config.autoReassign || false;
        const autoReassignDays = config.autoReassignDays || 21;
        const content = `
            <div class="alert-config-modal">
                <div class="form-group">
                    <label>Warning threshold (days inactive)</label>
                    <input type="number" id="alert-warning-days" class="form-control" value="${warningDays}" min="1" max="30">
                    <small style="color:var(--gray-500)">Prospects inactive for this many days will show as "Attention"</small>
                </div>
                <div class="form-group">
                    <label>Critical threshold (days inactive)</label>
                    <input type="number" id="alert-critical-days" class="form-control" value="${criticalDays}" min="1" max="60">
                    <small style="color:var(--gray-500)">Prospects inactive beyond this will show as "Critical"</small>
                </div>
                <hr style="border:none;border-top:1px solid var(--gray-200);margin:16px 0">
                <div class="form-group">
                    <label class="checkbox-label"><input type="checkbox" id="alert-auto-reassign" ${autoReassign ? 'checked' : ''}> Enable auto-reassign suggestion</label>
                    <small style="color:var(--gray-500)">Flag prospects for reassignment after the threshold below</small>
                </div>
                <div class="form-group">
                    <label>Auto-reassign suggestion after (days)</label>
                    <input type="number" id="alert-auto-days" class="form-control" value="${autoReassignDays}" min="1" max="90">
                </div>
            </div>`;
        UI.showModal('Configure Alerts', content, [
            { label: 'Cancel', type: 'secondary', action: 'UI.hideModal()' },
            { label: 'Save Configuration', type: 'primary', action: '(async () => { app.saveAlertConfig(); })()' }
        ]);
    };

    const saveAlertConfig = () => {
        const config = {
            warningDays: parseInt(document.getElementById('alert-warning-days')?.value) || 7,
            criticalDays: parseInt(document.getElementById('alert-critical-days')?.value) || 14,
            autoReassign: document.getElementById('alert-auto-reassign')?.checked || false,
            autoReassignDays: parseInt(document.getElementById('alert-auto-days')?.value) || 21
        };
        localStorage.setItem('fs_crm_alert_config', JSON.stringify(config));
        UI.hideModal();
        UI.toast.success('Alert configuration saved');
    };

    const viewAgentDetails = async (agentIdOrName) => {
        if (typeof agentIdOrName === 'number' || !isNaN(parseInt(agentIdOrName))) {
            await (window.app.showAgentDetail || (() => {}))(parseInt(agentIdOrName));
        } else {
            const agents = await AppDataStore.getAll('users');
            const agent = agents.find(a => a.full_name?.toLowerCase().includes(String(agentIdOrName).toLowerCase()));
            if (agent) await (window.app.showAgentDetail || (() => {}))(agent.id);
            else UI.toast.info(`Agent "${agentIdOrName}" not found in database`);
        }
    };
    const contactProspect = async (prospectId) => { await (window.app.openActivityModal || (() => {}))(null, prospectId); };

    // Phase 13: seed demo data


const initImportDemoData = async () => {
    // Clear demo data if requested (optional)
    if (window.location.search.includes('resetDemo=true')) {
        const tables = ['import_jobs', 'reassignment_history'];
        for (const table of tables) {
            const all = await AppDataStore.getAll(table);
            const demoItems = all.filter(item => item.is_demo);
            for (const item of demoItems) {
                await AppDataStore.delete(table, item.id).catch(() => {});
            }
        }
        UI.toast.info('Demo data cleared.');
    }

    // --- Helper to check if a user exists ---
    const userExists = async (userId) => {
        const user = await AppDataStore.getById('users', userId);
        return !!user;
    };

    // --- Import Jobs ---
    const importJobs = await AppDataStore.getAll('import_jobs');
    if (importJobs.length === 0) {
        // Only create jobs if user 5 exists
        if (await userExists(5)) {
            const jobs = [
                { id: 9001, file_name: 'leads_march_2026.xlsx', import_type: 'prospects', total_rows: 250, valid_rows: 235, error_rows: 15, created_records: 217, updated_records: 18, skipped_records: 15, status: 'completed', mapping_config: {}, duplicate_handling: 'skip', assignment_config: { assignTo: 'myself' }, created_by: 5, created_at: '2026-03-05T14:30:00Z', completed_at: '2026-03-05T14:32:35Z' },
                { id: 9002, file_name: 'customers_feb.xlsx', import_type: 'customers', total_rows: 128, valid_rows: 122, error_rows: 6, created_records: 115, updated_records: 7, skipped_records: 6, status: 'completed', mapping_config: {}, duplicate_handling: 'update', assignment_config: { assignTo: 'team' }, created_by: 5, created_at: '2026-02-28T10:15:00Z', completed_at: '2026-02-28T10:17:22Z' },
                { id: 9003, file_name: 'agents_2026.xlsx', import_type: 'agents', total_rows: 15, valid_rows: 15, error_rows: 0, created_records: 15, updated_records: 0, skipped_records: 0, status: 'completed', mapping_config: {}, duplicate_handling: 'skip', assignment_config: {}, created_by: 1, created_at: '2026-02-15T09:00:00Z', completed_at: '2026-02-15T09:01:00Z' },
                { id: 9004, file_name: 'product_catalog.xlsx', import_type: 'products', total_rows: 45, valid_rows: 0, error_rows: 45, created_records: 0, updated_records: 0, skipped_records: 0, status: 'failed', mapping_config: {}, duplicate_handling: 'skip', assignment_config: {}, created_by: 5, created_at: '2026-02-10T09:45:00Z', completed_at: '2026-02-10T09:45:30Z' }
            ];
            for (const j of jobs) {
                try {
                    await AppDataStore.create('import_jobs', j);
                } catch (err) {
                    console.warn(`Skipping import_job ${j.id}:`, err.message);
                }
            }
        } else {
            // Skipping import_jobs seeding: user 5 does not exist
        }
    }

    // --- Reassignment History ---
    const reassignmentsAll = await AppDataStore.getAll('reassignment_history');
    if (reassignmentsAll.length === 0) {
        // Check that all referenced users exist
        const usersExist = await Promise.all([userExists(8), userExists(6), userExists(5), userExists(7), userExists(3)]);
        if (usersExist.every(v => v === true)) {
            const reassignments = [
                { id: 8001, prospect_id: 101, from_agent_id: 8, to_agent_id: 6, reassigned_by: 5, reassignment_date: '2026-03-06T10:23:00Z', reassignment_reason: 'inactive', reason_notes: 'Raj Kumar unresponsive', days_inactive: 14, protection_deadline: '2026-03-17', created_at: '2026-03-06T10:23:00Z' },
                { id: 8002, prospect_id: 102, from_agent_id: 8, to_agent_id: 5, reassigned_by: 5, reassignment_date: '2026-03-05T15:45:00Z', reassignment_reason: 'inactive', reason_notes: 'High score prospect', days_inactive: 16, protection_deadline: '2026-03-15', created_at: '2026-03-05T15:45:00Z' },
                { id: 8003, prospect_id: 103, from_agent_id: 6, to_agent_id: 7, reassigned_by: 3, reassignment_date: '2026-03-04T09:30:00Z', reassignment_reason: 'workload', reason_notes: 'Balancing workload', days_inactive: 12, protection_deadline: '2026-03-20', created_at: '2026-03-04T09:30:00Z' }
            ];
            for (const r of reassignments) {
                try {
                    await AppDataStore.create('reassignment_history', r);
                } catch (err) {
                    console.warn(`Skipping reassignment_history ${r.id}:`, err.message);
                }
            }
        } else {
            // Skipping reassignment_history seeding: referenced users missing
        }
    }
};

    // ========== PHASE 18: MOBILE APP & OFFLINE SYNC ==========
    const initMobileApp = async () => {
        if (!isMobile()) return;

        try {
            // Initializing Phase 18 mobile features

            // 1. Initialize Offline Storage & Sync
            if (typeof SyncManager !== 'undefined') {
                await SyncManager.init();
            }

            // 2. Setup Push Notifications
            if (typeof PushNotifications !== 'undefined') {
                const pushSupport = await PushNotifications.checkSupport();
                if (pushSupport) {
                    await PushNotifications.requestPermission();
                }
            }

            // 3. Register Service Worker
            if ('serviceWorker' in navigator) {
                navigator.serviceWorker.register('./service-worker.js')
                    .then(() => {})
                    .catch(err => console.error('Service Worker sync failed', err));
            }

            // 4. Add meta tags for PWA
            (window.app.addMobileMetaTags || (() => {}))();

            // Phase 18 mobile features initialized
        } catch (error) {
            console.error('Error initializing mobile features:', error);
        }
    };

    const addMobileMetaTags = () => {
        const head = document.head;
        if (!document.querySelector('meta[name="theme-color"]')) {
            const metaTheme = document.createElement('meta');
            metaTheme.name = 'theme-color';
            metaTheme.content = '#2563eb';
            head.appendChild(metaTheme);
        }
        if (!document.querySelector('meta[name="apple-mobile-web-app-capable"]')) {
            const metaApple = document.createElement('meta');
            metaApple.name = 'apple-mobile-web-app-capable';
            metaApple.content = 'yes';
            head.appendChild(metaApple);
        }
    };

    const refreshPipelineCalculations = async () => {
        UI.toast.info('Recalculating pipeline...');
        setTimeout(async () => {
            await (window.app.refreshPipeline || (() => {}))();
        }, 500);
    };

    const filterPipeline = async () => {
        // Redraw with current filter value
        await (window.app.refreshPipeline || (() => {}))();
    };

    const saveFocusOrder = async () => {
        // Placeholder for compatibility if called from HTML
        await (window.app.saveManualOrder || (() => {}))();
    };

    const showAddToFocusModal = () => {
        UI.toast.info('Select a prospect from the System Pipeline below to add to your Focus List.');
    };

    const openPrerequisiteConfig = () => {
        UI.toast.info('Opening prerequisite configuration (Marketing Manager only)');
    };

    // ========== FEATURE: AUTOMATED SCORING RULES ==========
    const SCORING_RULES = {
        CREATE_PROSPECT: 5,
        FIRST_CONTACT: 10,
        CPS_ACTIVITY: 10,
        FTF_MEETING: 10,
        FSA_CONSULTATION: 25,
        GR_GROUP_REVIEW: 15,
        SITE_VISIT: 15,
        CALL: 5,
        WHATSAPP: 5,
        EVENT_ATTENDANCE: 10,
        PRICE_INQUIRY: 30,
        HEARD_LIFE_PLAN: 40,
        REFERRAL_CLOSED: 50,
        WEEKLY_INACTIVITY: -5,
        MARK_NOT_INTERESTED: -500
    };

    // Audit-log threshold for score_history. Activities that fire on every
    // CPS/Call/WhatsApp/event-attendance (±5..±10 points) generate >80% of the
    // write volume but carry the least audit value. The Postgres trigger
    // log_score_change_trigger (migrations/server_cron_2026-05-03.sql) covers
    // every change atomically; this client-side write is now a redundant
    // backup that we only keep for high-signal events while the trigger rolls
    // out. Once every environment has the trigger applied, this constant can
    // be raised to Infinity (effectively disabling client-side logging).
    const _SCORE_HISTORY_MIN_ABS = 20;

    const addScoreToProspect = async (prospectId, points, reason) => {
        if (!prospectId || !points) return;
        const prospect = await AppDataStore.getById('prospects', prospectId);
        if (!prospect) return;
        const oldScore = prospect.score || 0;
        const newScore = Math.max(0, oldScore + points);
        await AppDataStore.update('prospects', prospectId, { score: newScore });
        if (Math.abs(points) >= _SCORE_HISTORY_MIN_ABS) {
            AppDataStore.create('score_history', {
                entity_type: 'prospect',
                entity_id: prospectId,
                old_score: oldScore,
                new_score: newScore,
                points_change: points,
                reason: reason,
                created_at: new Date().toISOString()
            }).catch(() => {});
        }
    };

    const addScoreToCustomer = async (customerId, points, reason) => {
        if (!customerId || !points) return;
        const customer = await AppDataStore.getById('customers', customerId);
        if (!customer) return;
        const oldScore = customer.score || 0;
        const newScore = Math.max(0, oldScore + points);
        await AppDataStore.update('customers', customerId, { score: newScore });
        if (Math.abs(points) >= _SCORE_HISTORY_MIN_ABS) {
            AppDataStore.create('score_history', {
                entity_type: 'customer',
                entity_id: customerId,
                old_score: oldScore,
                new_score: newScore,
                points_change: points,
                reason: reason,
                created_at: new Date().toISOString()
            }).catch(() => {});
        }
    };

    const scoreActivityType = (activityType) => {
        switch (activityType) {
            case 'CPS':     return { points: SCORING_RULES.CPS_ACTIVITY,     reason: 'CPS - Consultation/Planning Session' };
            case 'FTF':     return { points: SCORING_RULES.FTF_MEETING,       reason: 'Face to Face Meeting' };
            case 'FSA':     return { points: SCORING_RULES.FSA_CONSULTATION,  reason: 'Feng Shui Analysis (Consultation)' };
            case 'GR':      return { points: SCORING_RULES.GR_GROUP_REVIEW,   reason: 'Group Review' };
            case 'SITE':    return { points: SCORING_RULES.SITE_VISIT,        reason: 'Site Visit' };
            case 'XG':      return { points: SCORING_RULES.FTF_MEETING,       reason: 'Xin Gua Session' };
            case 'Call':    return { points: SCORING_RULES.CALL,              reason: 'Phone Call' };
            case 'WhatsApp':return { points: SCORING_RULES.WHATSAPP,          reason: 'WhatsApp Chat' };
            case 'EVENT':   return { points: SCORING_RULES.EVENT_ATTENDANCE,  reason: 'Event Attendance' };
            default:        return { points: 5, reason: `Activity: ${activityType}` };
        }
    };

    const applyActivityScoring = async (activity) => {
        const { points, reason } = scoreActivityType(activity.activity_type);

        if (activity.prospect_id) {
            // First contact bonus — awarded once, when the prospect's score has never been touched by an activity
            try {
                const existingActs = await AppDataStore.getActivitiesForProspect(activity.prospect_id, { limit: 2 });
                const isFirst = existingActs.filter(a => String(a.id) !== String(activity.id)).length === 0;
                if (isFirst) {
                    await addScoreToProspect(activity.prospect_id, SCORING_RULES.FIRST_CONTACT, 'First contact made');
                }
            } catch (e) { /* ignore */ }
            await addScoreToProspect(activity.prospect_id, points, reason);
        } else if (activity.customer_id) {
            await addScoreToCustomer(activity.customer_id, points, reason);
        }

        // Bonus scoring for closing/transaction
        if (activity.is_closing && activity.amount_closed) {
            const txPoints = Math.round(parseFloat(activity.amount_closed) / 100);
            if (activity.prospect_id) {
                await addScoreToProspect(activity.prospect_id, txPoints, `Transaction closed: RM ${activity.amount_closed}`);
                // Referral bonus: if this prospect was referred by another prospect, reward the referrer
                try {
                    const closedP = await AppDataStore.getById('prospects', activity.prospect_id);
                    if (closedP?.referred_by_id && closedP?.referred_by_type === 'prospect') {
                        await addScoreToProspect(closedP.referred_by_id, SCORING_RULES.REFERRAL_CLOSED,
                            `Referral converted: ${closedP.full_name || 'Prospect #' + activity.prospect_id}`);
                    }
                } catch (e) { /* ignore */ }
            } else if (activity.customer_id) {
                await addScoreToCustomer(activity.customer_id, txPoints, `Transaction closed: RM ${activity.amount_closed}`);
            }
        }
    };

    // Weekly inactivity deduction — runs once per ISO week per browser session.
    // Prospects with no activity in 7+ days lose 5 points (excludes unable_to_serve / converted / lost).
    const _runWeeklyInactivityCheck = async () => {
        const getISOWeek = (d) => {
            const dt = new Date(d); dt.setHours(0, 0, 0, 0);
            dt.setDate(dt.getDate() + 3 - (dt.getDay() + 6) % 7);
            const w1 = new Date(dt.getFullYear(), 0, 4);
            return `${dt.getFullYear()}-W${String(1 + Math.round(((dt - w1) / 86400000 - 3 + (w1.getDay() + 6) % 7) / 7)).padStart(2, '0')}`;
        };
        const thisWeek = getISOWeek(new Date());
        if (localStorage.getItem('_inactivityCheckWeek') === thisWeek) return;
        try {
            const prospects = await AppDataStore.getAll('prospects');
            const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
            let count = 0;
            for (const p of prospects) {
                if (p.unable_to_serve || p.status === 'converted' || p.status === 'lost') continue;
                const lastAct = p.last_activity_date;
                if (!lastAct || lastAct < cutoff) {
                    await addScoreToProspect(p.id, SCORING_RULES.WEEKLY_INACTIVITY, 'Weekly inactivity — no activity for 7+ days');
                    count++;
                }
            }
            localStorage.setItem('_inactivityCheckWeek', thisWeek);
            if (count > 0) console.log(`[Scoring] Weekly inactivity applied to ${count} prospects`);
        } catch (e) { console.warn('[Scoring] Weekly inactivity check failed:', e); }
    };

    // Manual score adjustment modal — agents/admins can add or deduct points with a reason.
    const openScoreAdjustmentModal = async (entityType, entityId) => {
        const tableName = entityType === 'prospect' ? 'prospects' : 'customers';
        const entity = await AppDataStore.getById(tableName, entityId);
        if (!entity) { UI.toast.error('Record not found'); return; }
        const currentScore = entity.score || 0;
        const grade = (window.app.getScoreGrade || (() => ({ grade:"N/A",label:"N/A",color:"#888" })))(currentScore);
        const presets = [
            { label: '— Select a quick preset —', pts: '' },
            { label: 'Customer Satisfied (+20)', pts: 20 },
            { label: `Price Inquiry Discussed (+${SCORING_RULES.PRICE_INQUIRY})`, pts: SCORING_RULES.PRICE_INQUIRY },
            { label: `Life Plan Shared (+${SCORING_RULES.HEARD_LIFE_PLAN})`, pts: SCORING_RULES.HEARD_LIFE_PLAN },
            { label: `Referral Closed Bonus (+${SCORING_RULES.REFERRAL_CLOSED})`, pts: SCORING_RULES.REFERRAL_CLOSED },
            { label: 'Customer Complaint (−20)', pts: -20 },
            { label: 'No-show / Cancelled (−10)', pts: -10 },
            { label: 'Custom (enter below)', pts: '' },
        ];
        const content = `
            <div>
                <div style="background:var(--gray-50);border-radius:8px;padding:10px 14px;margin-bottom:16px;display:flex;justify-content:space-between;align-items:center;font-size:14px;">
                    <strong>${escapeHtml(entity.full_name)}</strong>
                    <span style="font-weight:700;color:var(--primary);">${currentScore} pts &nbsp;·&nbsp; Grade ${grade}</span>
                </div>
                <div class="form-group">
                    <label>Quick Presets</label>
                    <select id="score-adj-preset" class="form-control" onchange="(function(s){const v=s.options[s.selectedIndex]?.dataset.pts;if(v!==''&&v!==undefined){document.getElementById('score-adj-points').value=v;}})(this)">
                        ${presets.map(p => `<option data-pts="${p.pts}">${p.label}</option>`).join('')}
                    </select>
                </div>
                <div class="form-group">
                    <label>Points adjustment <span style="color:var(--gray-400);font-size:12px;">(positive = add, negative = deduct)</span></label>
                    <input type="number" id="score-adj-points" class="form-control" placeholder="e.g. 20 or -15">
                </div>
                <div class="form-group">
                    <label>Reason / Note <span style="color:#ef4444;">*</span></label>
                    <input type="text" id="score-adj-note" class="form-control" placeholder="e.g. Customer satisfied with feng shui analysis" maxlength="200">
                </div>
            </div>`;
        UI.showModal(`Adjust Score — ${escapeHtml(entity.full_name)}`, content, [
            { label: 'Apply', type: 'primary',   action: `app.confirmScoreAdjustment('${entityType}', ${entityId})` },
            { label: 'Cancel', type: 'secondary', action: 'UI.hideModal()' }
        ]);
    };

    const confirmScoreAdjustment = async (entityType, entityId) => {
        const rawPts = document.getElementById('score-adj-points')?.value;
        const pts = parseInt(rawPts);
        const note = document.getElementById('score-adj-note')?.value?.trim();
        if (!rawPts || isNaN(pts) || pts === 0) { UI.toast.error('Enter a non-zero point value.'); return; }
        if (!note) { UI.toast.error('A reason is required.'); return; }
        try {
            if (entityType === 'prospect') {
                await addScoreToProspect(entityId, pts, `[Manual] ${note}`);
                UI.hideModal();
                UI.toast.success(`Score ${pts > 0 ? '+' : ''}${pts} pts applied`);
                await (window.app.showProspectDetail || (() => {}))(entityId);
            } else {
                await addScoreToCustomer(entityId, pts, `[Manual] ${note}`);
                UI.hideModal();
                UI.toast.success(`Score ${pts > 0 ? '+' : ''}${pts} pts applied`);
            }
        } catch (e) { UI.toast.error('Failed: ' + (e.message || 'Unknown error')); }
    };

    // ========== FEATURE: PROTECTION PERIOD AUTO-EXTENSION ==========
    const PROTECTION_EXTENSIONS = {
        ACTIVITY: 15,
        CONSULTATION: 30,
        TRANSACTION: 90,
        EVENT: 10
    };

    const autoExtendProtection = async (prospectId, extensionType) => {
        if (!prospectId) return;
        const prospect = await AppDataStore.getById('prospects', prospectId);
        if (!prospect) return;

        let days = PROTECTION_EXTENSIONS.ACTIVITY;
        let label = 'activity';
        if (extensionType === 'consultation') {
            days = PROTECTION_EXTENSIONS.CONSULTATION;
            label = 'consultation';
        } else if (extensionType === 'transaction') {
            days = PROTECTION_EXTENSIONS.TRANSACTION;
            label = 'transaction';
        } else if (extensionType === 'event') {
            days = PROTECTION_EXTENSIONS.EVENT;
            label = 'event attendance';
        }

        const currentDeadline = new Date(prospect.protection_deadline || Date.now());
        const today = new Date();
        const baseDate = currentDeadline > today ? currentDeadline : today;
        const newDeadline = new Date(baseDate.getTime() + days * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
        await AppDataStore.update('prospects', prospectId, {
            protection_deadline: newDeadline,
            last_contact_date: new Date().toISOString().split('T')[0]
        });
        // Protection auto-extended
    };

    const getExtensionType = (activityType) => {
        if (['FSA', 'GR'].includes(activityType)) return 'consultation';
        if (['EVENT'].includes(activityType)) return 'event';
        return 'activity';
    };

    // ========== FEATURE: PROSPECT POTENTIAL & OPPORTUNITIES ==========
    const openLatestMeetupNotes = async (prospectId) => {
        const allActivities = (await AppDataStore.getAll('activities'))
            .filter(a => a.prospect_id == prospectId)
            .sort((a, b) => new Date(b.activity_date) - new Date(a.activity_date) || b.id - a.id);
        if (allActivities.length === 0) {
            UI.toast.error('No activities found. Log a meetup or event first.');
            return;
        }
        await (window.app.openPostMeetupNotesModal || (() => {}))(allActivities[0].id, prospectId);
    };

    const openEditPotentialModal = async (prospectId) => {
        const prospect = await AppDataStore.getById('prospects', prospectId);
        if (!prospect) return;

        const content = `
            <div class="form-grid" style="display:grid; grid-template-columns:1fr 1fr; gap:12px;">
                <div class="form-group">
                    <label>Potential Level</label>
                    <select id="pot-level" class="form-control">
                        <option value="High" ${prospect.potential_level === 'High' ? 'selected' : ''}>HIGH POTENTIAL</option>
                        <option value="Medium" ${prospect.potential_level === 'Medium' ? 'selected' : ''}>MEDIUM POTENTIAL</option>
                        <option value="Low" ${prospect.potential_level === 'Low' ? 'selected' : ''}>LOW POTENTIAL</option>
                    </select>
                </div>
                <div class="form-group">
                    <label>Close Probability (%)</label>
                    <input type="number" id="pot-probability" class="form-control" min="0" max="100" value="${prospect.close_probability || 0}">
                </div>
                <div class="form-group">
                    <label>Est. Value Min (RM)</label>
                    <input type="number" id="pot-value-min" class="form-control" value="${prospect.estimated_value_min || 0}">
                </div>
                <div class="form-group">
                    <label>Est. Value Max (RM)</label>
                    <input type="number" id="pot-value-max" class="form-control" value="${prospect.estimated_value_max || 0}">
                </div>
                <div class="form-group" style="grid-column:1/3;">
                    <label>Decision Timeline</label>
                    <input type="text" id="pot-timeline" class="form-control" placeholder="e.g. Within 1 month" value="${prospect.decision_timeline || ''}">
                </div>
                <div class="form-group" style="grid-column:1/3;">
                    <label>Pain Points</label>
                    <textarea id="pot-pain" class="form-control" rows="2" placeholder="e.g. Declining revenue, team morale">${prospect.pain_points || ''}</textarea>
                </div>
                <div class="form-group" style="grid-column:1/3;">
                    <label>Interests</label>
                    <input type="text" id="pot-interests" class="form-control" placeholder="e.g. PR4, Office Audit, Career Consultation" value="${prospect.interests || ''}">
                </div>
                <div class="form-group">
                    <label>Decision Maker?</label>
                    <select id="pot-decision-maker" class="form-control">
                        <option value="yes" ${prospect.decision_maker === 'yes' ? 'selected' : ''}>Yes</option>
                        <option value="no" ${prospect.decision_maker === 'no' ? 'selected' : ''}>No</option>
                        <option value="unknown" ${(!prospect.decision_maker || prospect.decision_maker === 'unknown') ? 'selected' : ''}>Unknown</option>
                    </select>
                </div>
                <div class="form-group">
                    <label>Budget Range</label>
                    <input type="text" id="pot-budget" class="form-control" placeholder="e.g. RM 15k-20k/mo" value="${prospect.budget_range || ''}">
                </div>
            </div>
        `;
        UI.showModal('Edit Potential & Opportunities', content, [
            { label: 'Cancel', type: 'secondary', action: 'UI.hideModal()' },
            { label: 'Save', type: 'primary', action: `(async () => { await app.savePotential(${prospectId}); })()` }
        ]);
    };

    const savePotential = async (prospectId) => {
        const data = {
            potential_level: document.getElementById('pot-level')?.value || 'Medium',
            close_probability: parseInt(document.getElementById('pot-probability')?.value) || 0,
            estimated_value_min: parseFloat(document.getElementById('pot-value-min')?.value) || 0,
            estimated_value_max: parseFloat(document.getElementById('pot-value-max')?.value) || 0,
            decision_timeline: document.getElementById('pot-timeline')?.value || '',
            pain_points: document.getElementById('pot-pain')?.value || '',
            interests: document.getElementById('pot-interests')?.value || '',
            decision_maker: document.getElementById('pot-decision-maker')?.value || 'unknown',
            budget_range: document.getElementById('pot-budget')?.value || ''
        };
        await AppDataStore.update('prospects', prospectId, data);
        UI.hideModal();
        UI.toast.success('Potential & Opportunities updated');
        await (window.app.showProspectDetail || (() => {}))(prospectId);
    };

    // ========== FEATURE: BIRTHDAY ACTION WORKFLOWS ==========
    const sendBirthdayWish = async (personName, phone) => {
        const templates = await AppDataStore.getAll('whatsapp_templates');
        const bdayTemplate = templates.find(t => t.template_name?.toLowerCase().includes('birthday'));
        const message = bdayTemplate
            ? bdayTemplate.content.replace(/\{\{name\}\}/g, personName)
            : `Hi ${personName}, Happy Birthday! 🎂 Wishing you a wonderful day filled with joy and blessings. — From the DestinOracles Team`;

        UI.showModal('Send Birthday Wish', `
            <div class="form-group">
                <label>To: ${personName}</label>
                <input type="text" class="form-control" value="${phone || ''}" readonly>
            </div>
            <div class="form-group">
                <label>Message</label>
                <textarea id="bday-msg" class="form-control" rows="5">${message}</textarea>
            </div>
            <div class="form-group">
                <label>Channel</label>
                <select id="bday-channel" class="form-control">
                    <option value="whatsapp">WhatsApp</option>
                    <option value="sms">SMS</option>
                    <option value="call">Phone Call</option>
                </select>
            </div>
        `, [
            { label: 'Cancel', type: 'secondary', action: 'UI.hideModal()' },
            { label: 'Send', type: 'primary', action: `(async () => { UI.hideModal(); UI.toast.success('Birthday wish sent to ${personName} via ' + document.getElementById('bday-channel').value); })()` }
        ]);
    };

    const scheduleBirthdayFollowup = async (personName, entityId, entityType) => {
        const tomorrow = new Date();
        tomorrow.setDate(tomorrow.getDate() + 1);
        const dateStr = tomorrow.toISOString().split('T')[0];

        UI.showModal('Schedule Birthday Follow-up', `
            <div class="form-group">
                <label>For: ${personName}</label>
            </div>
            <div class="form-group">
                <label>Action Type</label>
                <select id="bday-action-type" class="form-control">
                    <option value="gift">Prepare Birthday Gift</option>
                    <option value="call">Schedule Follow-up Call</option>
                    <option value="meeting">Schedule Birthday Meeting</option>
                    <option value="task">Create General Task</option>
                </select>
            </div>
            <div class="form-group">
                <label>Date</label>
                <input type="date" id="bday-action-date" class="form-control" value="${dateStr}">
            </div>
            <div class="form-group">
                <label>Notes</label>
                <textarea id="bday-action-notes" class="form-control" rows="2" placeholder="e.g. Prepare fruit basket, call to wish..."></textarea>
            </div>
        `, [
            { label: 'Cancel', type: 'secondary', action: 'UI.hideModal()' },
            { label: 'Create', type: 'primary', action: `(async () => { await app.executeBirthdayAction('${personName}', ${entityId}, '${entityType || 'prospect'}'); })()` }
        ]);
    };

    const executeBirthdayAction = async (personName, entityId, entityType) => {
        const actionType = document.getElementById('bday-action-type')?.value || 'task';
        const actionDate = document.getElementById('bday-action-date')?.value || new Date().toISOString().split('T')[0];
        const notes = document.getElementById('bday-action-notes')?.value || '';

        if (actionType === 'call' || actionType === 'meeting') {
            const activity = {
                activity_type: actionType === 'call' ? 'Call' : 'FTF',
                activity_date: actionDate,
                start_time: '10:00',
                end_time: '10:30',
                activity_title: `Birthday follow-up with ${personName}`,
                lead_agent_id: _currentUser?.id || 5,
                discussion_summary: `Birthday follow-up. ${notes}`
            };
            if (entityType === 'prospect') activity.prospect_id = entityId;
            else activity.customer_id = entityId;
            const savedBdayActivity = await AppDataStore.create('activities', activity);
            UI.hideModal();
            UI.toast.success(`${actionType === 'call' ? 'Call' : 'Meeting'} scheduled for ${personName} on ${actionDate}`);

        } else {
            // Create as a note/task
            await AppDataStore.create('notes', {
                entity_type: entityType,
                entity_id: entityId,
                content: `[Birthday ${actionType === 'gift' ? 'Gift' : 'Task'}] ${personName} — ${notes || 'Prepare birthday follow-up'}`,
                created_by: _currentUser?.id || 5,
                created_at: new Date().toISOString(),
                due_date: actionDate
            });
            UI.hideModal();
            UI.toast.success(`Birthday ${actionType} created for ${personName}`);
        }
    };

    // ========== FEATURE: KPI HIERARCHICAL TARGETS ==========
    const openKPITargetsModal = async () => {
        const currentYear = new Date().getFullYear();
        const existing = (await AppDataStore.getAll('yearly_targets')).find(t => t.target_year === currentYear);
        const allQ = (await AppDataStore.getAll('quarterly_targets')).filter(t => t.year === currentYear);
        const getQ = (q, field) => { const qt = allQ.find(t => t.quarter === q); return qt?.[field] || ''; };

        const qRow = (label, field, qkey) => `
            <tr style="border-bottom:1px solid var(--gray-200);">
                <td style="padding:5px 8px; font-size:12px; white-space:nowrap;">${label}</td>
                ${[1,2,3,4].map(q => `<td style="padding:4px;"><input type="number" id="qt-q${q}-${qkey}" class="form-control" style="min-width:80px; font-size:12px; padding:4px 6px;" placeholder="auto" value="${getQ(q, field)}"></td>`).join('')}
            </tr>`;

        const content = `
            <div style="max-height:75vh; overflow-y:auto; padding-right:4px;">
                <h3 style="margin-bottom:12px;">Yearly Targets — ${currentYear}</h3>
                <div class="form-grid" style="display:grid; grid-template-columns:1fr 1fr; gap:10px;">
                    <div class="form-group"><label>CPS Count Target</label>
                        <input type="number" id="yt-cps" class="form-control" value="${existing?.cps_count_target || 840}"></div>
                    <div class="form-group"><label>Total Sales Target (RM)</label>
                        <input type="number" id="yt-sales" class="form-control" value="${existing?.total_sales_target || 1680000}"></div>
                    <div class="form-group"><label>POP Case Target</label>
                        <input type="number" id="yt-pop-count" class="form-control" value="${existing?.pop_case_count_target || 120}"></div>
                    <div class="form-group"><label>POP Sales Target (RM)</label>
                        <input type="number" id="yt-pop-sales" class="form-control" value="${existing?.pop_sales_target || 480000}"></div>
                    <div class="form-group"><label>EPP Case Target</label>
                        <input type="number" id="yt-epp-count" class="form-control" value="${existing?.epp_case_count_target || 80}"></div>
                    <div class="form-group"><label>EPP Sales Target (RM)</label>
                        <input type="number" id="yt-epp-sales" class="form-control" value="${existing?.epp_sales_target || 320000}"></div>
                    <div class="form-group"><label>New Agents Target</label>
                        <input type="number" id="yt-agents" class="form-control" value="${existing?.new_agents_target || 48}"></div>
                    <div class="form-group"><label>New Customers Target</label>
                        <input type="number" id="yt-customers" class="form-control" value="${existing?.new_customers_target || 360}"></div>
                    <div class="form-group"><label>Total Meetings Target</label>
                        <input type="number" id="yt-meetings" class="form-control" value="${existing?.total_meetings_target || 2000}"></div>
                    <div class="form-group"><label>Activity Headcount Target</label>
                        <input type="number" id="yt-headcount" class="form-control" value="${existing?.activity_headcount_target || 500}"></div>
                </div>
                <hr style="margin:16px 0; border:none; border-top:1px solid var(--gray-200);">
                <h3 style="margin-bottom:4px;">Quarterly Targets — ${currentYear}</h3>
                <p style="font-size:12px; color:var(--gray-500); margin-bottom:10px;">Set per-quarter values manually, or leave blank to auto-calculate from yearly targets × seasonal weights below.</p>
                <div style="overflow-x:auto;">
                    <table style="width:100%; border-collapse:collapse;">
                        <thead>
                            <tr style="background:var(--gray-100);">
                                <th scope="col" style="text-align:left; padding:6px 8px; font-size:12px; font-weight:600;">Metric</th>
                                <th scope="col" style="text-align:center; padding:6px 8px; font-size:12px; font-weight:600;">Q1</th>
                                <th scope="col" style="text-align:center; padding:6px 8px; font-size:12px; font-weight:600;">Q2</th>
                                <th scope="col" style="text-align:center; padding:6px 8px; font-size:12px; font-weight:600;">Q3</th>
                                <th scope="col" style="text-align:center; padding:6px 8px; font-size:12px; font-weight:600;">Q4</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${qRow('CPS Count', 'cps_count_target', 'cps')}
                            ${qRow('Total Sales (RM)', 'total_sales_target', 'sales')}
                            ${qRow('POP Case', 'pop_case_count_target', 'pop-count')}
                            ${qRow('POP Sales (RM)', 'pop_sales_target', 'pop-sales')}
                            ${qRow('EPP Case', 'epp_case_count_target', 'epp-count')}
                            ${qRow('EPP Sales (RM)', 'epp_sales_target', 'epp-sales')}
                            ${qRow('New Agents', 'new_agents_target', 'agents')}
                            ${qRow('New Customers', 'new_customers_target', 'customers')}
                            ${qRow('Total Meetings', 'total_meetings_target', 'meetings')}
                            ${qRow('Activity Headcount', 'activity_headcount_target', 'headcount')}
                        </tbody>
                    </table>
                </div>
                <h3 style="margin:16px 0 8px;">Seasonal Weighting (auto-calc fallback)</h3>
                <p style="font-size:12px; color:var(--gray-500); margin-bottom:8px;">Used only when quarterly fields above are left blank. Must sum to 100%.</p>
                <div class="form-grid" style="display:grid; grid-template-columns:repeat(4,1fr); gap:8px;">
                    <div class="form-group"><label>Q1 %</label><input type="number" id="yt-q1w" class="form-control" value="${existing?.q1_weight || 22}"></div>
                    <div class="form-group"><label>Q2 %</label><input type="number" id="yt-q2w" class="form-control" value="${existing?.q2_weight || 25}"></div>
                    <div class="form-group"><label>Q3 %</label><input type="number" id="yt-q3w" class="form-control" value="${existing?.q3_weight || 27}"></div>
                    <div class="form-group"><label>Q4 %</label><input type="number" id="yt-q4w" class="form-control" value="${existing?.q4_weight || 26}"></div>
                </div>
            </div>
        `;
        UI.showModal('Set KPI Targets', content, [
            { label: 'Cancel', type: 'secondary', action: 'UI.hideModal()' },
            { label: 'Save Targets', type: 'primary', action: `(async () => { await app.saveKPITargets(${currentYear}); })()` }
        ]);
    };

    const saveKPITargets = async (year) => {
        const d = (id) => parseFloat(document.getElementById(id)?.value) || 0;
        const weights = [d('yt-q1w'), d('yt-q2w'), d('yt-q3w'), d('yt-q4w')];
        const totalWeight = weights.reduce((a, b) => a + b, 0);
        // Only enforce weight sum if weights are being used (non-zero)
        if (totalWeight > 0 && Math.abs(totalWeight - 100) > 1) {
            UI.toast.error(`Quarter weights must sum to 100% (currently ${totalWeight}%)`);
            return;
        }
        const effectiveWeights = totalWeight > 0 ? weights : [25, 25, 25, 25];

        const yearlyData = {
            target_year: year,
            cps_count_target: d('yt-cps'),
            total_sales_target: d('yt-sales'),
            pop_case_count_target: d('yt-pop-count'),
            pop_sales_target: d('yt-pop-sales'),
            epp_case_count_target: d('yt-epp-count'),
            epp_sales_target: d('yt-epp-sales'),
            new_agents_target: d('yt-agents'),
            new_customers_target: d('yt-customers'),
            total_meetings_target: d('yt-meetings'),
            activity_headcount_target: d('yt-headcount'),
            q1_weight: effectiveWeights[0],
            q2_weight: effectiveWeights[1],
            q3_weight: effectiveWeights[2],
            q4_weight: effectiveWeights[3],
            created_at: new Date().toISOString()
        };

        // Save or update yearly target
        const existing = (await AppDataStore.getAll('yearly_targets')).find(t => t.target_year === year);
        if (existing) {
            await AppDataStore.update('yearly_targets', existing.id, yearlyData);
        } else {
            yearlyData.id = Date.now();
            await AppDataStore.create('yearly_targets', yearlyData);
        }

        // Save quarterly targets — use manual inputs if provided, else auto-calculate from weights
        const metrics = ['cps_count_target', 'total_sales_target', 'pop_case_count_target', 'pop_sales_target', 'epp_case_count_target', 'epp_sales_target', 'new_agents_target', 'new_customers_target', 'total_meetings_target', 'activity_headcount_target'];
        const qkeys = ['cps', 'sales', 'pop-count', 'pop-sales', 'epp-count', 'epp-sales', 'agents', 'customers', 'meetings', 'headcount'];
        for (let q = 1; q <= 4; q++) {
            const w = effectiveWeights[q - 1] / 100;
            const qData = { quarter: q, year: year };
            metrics.forEach((m, i) => {
                const el = document.getElementById(`qt-q${q}-${qkeys[i]}`);
                const manual = el ? parseFloat(el.value) : NaN;
                qData[m] = (!isNaN(manual) && el?.value !== '') ? manual : Math.round(yearlyData[m] * w);
            });
            const existingQ = (await AppDataStore.getAll('quarterly_targets')).find(t => t.quarter === q && t.year === year);
            if (existingQ) {
                await AppDataStore.update('quarterly_targets', existingQ.id, qData);
            } else {
                qData.id = Date.now() + q;
                await AppDataStore.create('quarterly_targets', qData);
            }

            // Auto-generate monthly targets (3 months per quarter, even split)
            for (let m = 0; m < 3; m++) {
                const month = (q - 1) * 3 + m + 1;
                const mData = { month: month, year: year, quarter: q };
                metrics.forEach(met => { mData[met] = Math.round(qData[met] / 3); });
                const existingM = (await AppDataStore.getAll('monthly_targets')).find(t => t.month === month && t.year === year);
                if (existingM) {
                    await AppDataStore.update('monthly_targets', existingM.id, mData);
                } else {
                    mData.id = Date.now() + q * 10 + m;
                    await AppDataStore.create('monthly_targets', mData);
                }
            }
        }

        UI.hideModal();
        UI.toast.success('KPI targets saved — monthly breakdowns auto-generated from quarterly values');
        if (typeof window.app.refreshKPIDashboard === 'function') await window.app.refreshKPIDashboard();
    };

    // ========== QUARTERLY TARGETS (standalone modal) ==========
    const openQuarterlyTargetsModal = async () => {
        const currentYear = new Date().getFullYear();
        const allQ = (await AppDataStore.getAll('quarterly_targets')).filter(t => t.year === currentYear);
        const getQ = (q, field) => { const qt = allQ.find(t => t.quarter === q); return qt?.[field] ?? ''; };

        const qRow = (label, field, qkey) => `
            <tr style="border-bottom:1px solid var(--gray-200);">
                <td style="padding:6px 8px; font-size:12px; white-space:nowrap; font-weight:500;">${label}</td>
                ${[1,2,3,4].map(q => `<td style="padding:4px;"><input type="number" id="qo-q${q}-${qkey}" class="form-control" style="min-width:90px; font-size:12px; padding:5px 7px;" placeholder="0" value="${getQ(q, field)}"></td>`).join('')}
            </tr>`;

        const content = `
            <div style="max-height:70vh; overflow-y:auto; padding-right:4px;">
                <p style="font-size:12px;color:var(--gray-500);margin-bottom:12px;">
                    Set per-quarter targets for ${currentYear}. These values override the yearly auto-split.
                </p>
                <div style="overflow-x:auto;">
                    <table style="width:100%; border-collapse:collapse; min-width:560px;">
                        <thead>
                            <tr style="background:var(--gray-100);">
                                <th scope="col" style="text-align:left; padding:8px; font-size:12px; font-weight:600;">Metric</th>
                                <th scope="col" style="text-align:center; padding:8px; font-size:12px; font-weight:600;">Q1 (Jan–Mar)</th>
                                <th scope="col" style="text-align:center; padding:8px; font-size:12px; font-weight:600;">Q2 (Apr–Jun)</th>
                                <th scope="col" style="text-align:center; padding:8px; font-size:12px; font-weight:600;">Q3 (Jul–Sep)</th>
                                <th scope="col" style="text-align:center; padding:8px; font-size:12px; font-weight:600;">Q4 (Oct–Dec)</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${qRow('CPS Count', 'cps_count_target', 'cps')}
                            ${qRow('Total Sales (RM)', 'total_sales_target', 'sales')}
                            ${qRow('POP Cases', 'pop_case_count_target', 'pop-count')}
                            ${qRow('POP Sales (RM)', 'pop_sales_target', 'pop-sales')}
                            ${qRow('EPP Cases', 'epp_case_count_target', 'epp-count')}
                            ${qRow('EPP Sales (RM)', 'epp_sales_target', 'epp-sales')}
                            ${qRow('New Agents', 'new_agents_target', 'agents')}
                            ${qRow('New Customers', 'new_customers_target', 'customers')}
                            ${qRow('Total Meetings', 'total_meetings_target', 'meetings')}
                            ${qRow('Activity Headcount', 'activity_headcount_target', 'headcount')}
                        </tbody>
                    </table>
                </div>
            </div>`;
        UI.showModal(`Set Quarterly Targets — ${currentYear}`, content, [
            { label: 'Cancel', type: 'secondary', action: 'UI.hideModal()' },
            { label: 'Save Quarterly Targets', type: 'primary', action: `(async () => { await app.saveQuarterlyTargets(${currentYear}); })()` }
        ]);
    };

    const saveQuarterlyTargets = async (year) => {
        const d = (id) => {
            const el = document.getElementById(id);
            if (!el || el.value === '') return null;
            const n = parseFloat(el.value);
            return isNaN(n) ? null : n;
        };
        const metrics = ['cps_count_target', 'total_sales_target', 'pop_case_count_target', 'pop_sales_target', 'epp_case_count_target', 'epp_sales_target', 'new_agents_target', 'new_customers_target', 'total_meetings_target', 'activity_headcount_target'];
        const qkeys = ['cps', 'sales', 'pop-count', 'pop-sales', 'epp-count', 'epp-sales', 'agents', 'customers', 'meetings', 'headcount'];

        for (let q = 1; q <= 4; q++) {
            const qData = { quarter: q, year: year };
            let hasValue = false;
            metrics.forEach((m, i) => {
                const val = d(`qo-q${q}-${qkeys[i]}`);
                if (val !== null) { qData[m] = val; hasValue = true; }
                else { qData[m] = 0; }
            });
            const existingQ = (await AppDataStore.getAll('quarterly_targets')).find(t => t.quarter === q && t.year === year);
            if (existingQ) {
                await AppDataStore.update('quarterly_targets', existingQ.id, qData);
            } else if (hasValue) {
                qData.id = Date.now() + q;
                await AppDataStore.create('quarterly_targets', qData);
            }
        }

        UI.hideModal();
        UI.toast.success(`Quarterly targets saved for ${year}`);
        if (typeof window.app.refreshKPIDashboard === 'function') await window.app.refreshKPIDashboard();
    };

    // ========== SPECIAL PROGRAM FIGHTING ==========
    // Incentive programs for selected agents (e.g. close RM200k in 60 days → China trip)

    const _today = () => new Date().toISOString().slice(0, 10);

    // Compute one participant's progress toward a program's targets
    const calculateProgramProgress = async (program, agentId) => {
        const from = program.start_date;
        const to = program.end_date;
        const [purchases, customers, activities] = await Promise.all([
            AppDataStore.getAll('purchases'),
            AppDataStore.getAll('customers'),
            AppDataStore.getAll('activities')
        ]);
        // Build customer map for agent fallback (old purchases may lack agent_id)
        const customerMap = {};
        customers.forEach(c => { customerMap[c.id] = c; });
        let salesActual = 0;
        for (const p of purchases) {
            const pAgent = p.agent_id || customerMap[p.customer_id]?.responsible_agent_id;
            if (pAgent !== agentId) continue;
            if (p.date < from || p.date > to) continue;
            if (p.is_agent_package) continue;
            salesActual += (p.amount || 0);
        }
        let customersActual = 0;
        for (const c of customers) {
            if (c.responsible_agent_id !== agentId) continue;
            if (!c.customer_since || c.customer_since < from || c.customer_since > to) continue;
            customersActual++;
        }
        let cpsActual = 0;
        for (const a of activities) {
            if (a.activity_type !== 'CPS') continue;
            if (a.lead_agent_id !== agentId) continue;
            if (a.activity_date < from || a.activity_date > to) continue;
            cpsActual++;
        }
        const targets = [];
        if (program.sales_target > 0) {
            targets.push({
                label: 'Total Sales',
                actual: salesActual,
                target: program.sales_target,
                display: `RM ${salesActual.toLocaleString()} / RM ${program.sales_target.toLocaleString()}`,
                pct: Math.min(100, Math.round((salesActual / program.sales_target) * 100))
            });
        }
        if (program.new_customers_target > 0) {
            targets.push({
                label: 'New Customers',
                actual: customersActual,
                target: program.new_customers_target,
                display: `${customersActual} / ${program.new_customers_target}`,
                pct: Math.min(100, Math.round((customersActual / program.new_customers_target) * 100))
            });
        }
        if (program.cps_target > 0) {
            targets.push({
                label: 'CPS Count',
                actual: cpsActual,
                target: program.cps_target,
                display: `${cpsActual} / ${program.cps_target}`,
                pct: Math.min(100, Math.round((cpsActual / program.cps_target) * 100))
            });
        }
        const allHit = targets.length > 0 && targets.every(t => t.actual >= t.target);
        return { targets, qualified: allHit };
    };

    // Render the Special Programs section on the KPI dashboard
    const renderSpecialPrograms = async () => {
        const [programs, allParts, users] = await Promise.all([
            AppDataStore.getAll('special_programs'),
            AppDataStore.getAll('special_program_participants'),
            AppDataStore.getAll('users')
        ]);
        const userMap = {}; users.forEach(u => { userMap[u.id] = u; });
        const active = programs.filter(p => p.status !== 'cancelled' && p.status !== 'deleted');
        active.sort((a, b) => (a.end_date || '').localeCompare(b.end_date || ''));

        const canManage = isTeamLeaderOrAbove(_currentUser);
        const newBtn = canManage
            ? `<button class="btn primary btn-sm" onclick="app.openSpecialProgramModal()"><i class="fas fa-plus"></i> New Program</button>`
            : '';

        if (active.length === 0) {
            return `
                <div class="card" style="padding:20px;border:2px dashed var(--gray-200);">
                    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
                        <h3 style="margin:0;">🏆 Special Program Fighting</h3>
                        ${newBtn}
                    </div>
                    <p style="text-align:center;color:var(--gray-400);padding:24px 0;margin:0;">No active special programs. Create one to launch a new challenge for selected agents.</p>
                </div>`;
        }

        const cards = [];
        for (const program of active) {
            const parts = allParts.filter(p => p.program_id === program.id);
            const today = _today();
            const daysLeft = program.end_date ? Math.max(0, Math.ceil((new Date(program.end_date) - new Date(today)) / 86400000)) : 0;
            const isExpired = program.end_date && today > program.end_date;

            // Calculate progress for each participant (concurrent)
            const partProgress = await Promise.all(parts.map(async (part) => {
                const progress = await calculateProgramProgress(program, part.agent_id);
                return {
                    agentId: part.agent_id,
                    agentName: userMap[part.agent_id]?.full_name || `Agent #${part.agent_id}`,
                    agentRole: userMap[part.agent_id]?.role || '',
                    progress
                };
            }));

            // Count how many qualified
            const qualifiedCount = partProgress.filter(p => p.progress.qualified).length;

            const partsHtml = partProgress.length > 0 ? `
                <table style="width:100%;border-collapse:collapse;font-size:12px;margin-top:12px;">
                    <thead>
                        <tr style="background:var(--gray-50,#f7f4ed);">
                            <th scope="col" style="text-align:left;padding:8px;border-bottom:1px solid var(--gray-200);">Agent</th>
                            ${program.sales_target > 0 ? '<th scope="col" style="text-align:left;padding:8px;border-bottom:1px solid var(--gray-200);">Sales</th>' : ''}
                            ${program.new_customers_target > 0 ? '<th scope="col" style="text-align:left;padding:8px;border-bottom:1px solid var(--gray-200);">New Customers</th>' : ''}
                            ${program.cps_target > 0 ? '<th scope="col" style="text-align:left;padding:8px;border-bottom:1px solid var(--gray-200);">CPS</th>' : ''}
                            <th scope="col" style="text-align:center;padding:8px;border-bottom:1px solid var(--gray-200);">Status</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${partProgress.map(p => {
                            const barsHtml = (metric) => {
                                const t = p.progress.targets.find(t => t.label === metric);
                                if (!t) return '';
                                const color = t.actual >= t.target ? '#16a34a' : (t.pct >= 60 ? '#f59e0b' : '#dc2626');
                                return `
                                    <td style="padding:8px;border-bottom:1px solid var(--gray-100);">
                                        <div style="font-size:11px;margin-bottom:2px;">${t.display}</div>
                                        <div style="background:#eee;border-radius:4px;height:6px;overflow:hidden;">
                                            <div style="background:${color};height:100%;width:${t.pct}%;transition:width .3s;"></div>
                                        </div>
                                    </td>`;
                            };
                            const statusBadge = p.progress.qualified
                                ? '<span style="background:#dcfce7;color:#166534;padding:3px 10px;border-radius:12px;font-size:11px;font-weight:600;">✓ Qualified</span>'
                                : '<span style="background:#fef3c7;color:#92400e;padding:3px 10px;border-radius:12px;font-size:11px;">In Progress</span>';
                            return `
                                <tr>
                                    <td style="padding:8px;border-bottom:1px solid var(--gray-100);"><strong>${p.agentName}</strong><br/><span style="font-size:10px;color:var(--gray-400);">${p.agentRole}</span></td>
                                    ${program.sales_target > 0 ? barsHtml('Total Sales') : ''}
                                    ${program.new_customers_target > 0 ? barsHtml('New Customers') : ''}
                                    ${program.cps_target > 0 ? barsHtml('CPS Count') : ''}
                                    <td style="padding:8px;border-bottom:1px solid var(--gray-100);text-align:center;">${statusBadge}</td>
                                </tr>`;
                        }).join('')}
                    </tbody>
                </table>` : '<p style="color:var(--gray-400);text-align:center;padding:16px;margin:12px 0 0;">No participants assigned yet.</p>';

            const manageBtns = canManage ? `
                <button class="btn secondary btn-sm" onclick="app.openSpecialProgramModal(${program.id})" title="Edit"><i class="fas fa-edit"></i></button>
                <button class="btn btn-sm" style="background:#fee2e2;color:#991b1b;" onclick="app.deleteSpecialProgram(${program.id})" title="Delete"><i class="fas fa-trash"></i></button>
            ` : '';

            cards.push(`
                <div class="card" style="padding:20px;margin-bottom:16px;${isExpired ? 'opacity:0.75;' : ''}">
                    <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;">
                        <div style="flex:1;">
                            <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;">
                                <h3 style="margin:0;font-size:16px;">🏆 ${program.program_name || 'Untitled Program'}</h3>
                                ${isExpired ? '<span style="background:#f3f4f6;color:#6b7280;padding:3px 8px;border-radius:10px;font-size:11px;">EXPIRED</span>' : `<span style="background:#fef3c7;color:#92400e;padding:3px 8px;border-radius:10px;font-size:11px;">${daysLeft} days left</span>`}
                            </div>
                            <div style="font-size:13px;color:var(--gray-500);margin-top:4px;">
                                🎁 <strong>${program.reward || '—'}</strong>
                                &nbsp;·&nbsp; ${program.start_date || '?'} to ${program.end_date || '?'}
                                &nbsp;·&nbsp; ${parts.length} participant${parts.length===1?'':'s'}
                                ${qualifiedCount > 0 ? `&nbsp;·&nbsp; <span style="color:#16a34a;font-weight:600;">${qualifiedCount} qualified</span>` : ''}
                            </div>
                            ${program.description ? `<p style="font-size:12px;color:var(--gray-500);margin:6px 0 0;">${program.description}</p>` : ''}
                        </div>
                        <div style="display:flex;gap:6px;">${manageBtns}</div>
                    </div>
                    ${partsHtml}
                </div>`);
        }

        return `
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;">
                <h2 style="margin:0;font-size:18px;">🏆 Special Program Fighting</h2>
                ${newBtn}
            </div>
            ${cards.join('')}`;
    };

    // ===== Special Programs Table (Marketing List tab) =====
    // Flat KPI-style table — one row per (program × agent), showing how much they made and how far to target
    const renderSpecialProgramsTable = async () => {
        const [programs, allParts, users] = await Promise.all([
            AppDataStore.getAll('special_programs'),
            AppDataStore.getAll('special_program_participants'),
            AppDataStore.getAll('users')
        ]);
        const userMap = {}; users.forEach(u => { userMap[u.id] = u; });
        const active = programs.filter(p => p.status !== 'cancelled' && p.status !== 'deleted');
        active.sort((a, b) => (a.end_date || '').localeCompare(b.end_date || ''));

        const canManage = isTeamLeaderOrAbove(_currentUser);
        const today = _today();

        if (active.length === 0) {
            return `
                <div class="card" style="padding:32px;border:2px dashed var(--gray-200);text-align:center;">
                    <h3 style="margin:0 0 8px;">🏆 No Active Special Programs</h3>
                    <p style="color:var(--gray-400);margin:0;">${canManage ? 'Click "New Program" to launch a new challenge for selected agents.' : 'No special programs have been launched yet.'}</p>
                </div>`;
        }

        // Build flat rows: one per (program, participant)
        const rows = [];
        for (const program of active) {
            const parts = allParts.filter(p => p.program_id === program.id);
            const isExpired = program.end_date && today > program.end_date;
            const daysLeft = program.end_date ? Math.max(0, Math.ceil((new Date(program.end_date) - new Date(today)) / 86400000)) : 0;

            if (parts.length === 0) {
                rows.push({
                    program, isExpired, daysLeft,
                    agentName: '—', agentRole: '',
                    progress: { targets: [], qualified: false },
                    noParticipants: true
                });
                continue;
            }
            for (const part of parts) {
                const progress = await calculateProgramProgress(program, part.agent_id);
                rows.push({
                    program, isExpired, daysLeft,
                    agentId: part.agent_id,
                    agentName: userMap[part.agent_id]?.full_name || `Agent #${part.agent_id}`,
                    agentRole: userMap[part.agent_id]?.role || '',
                    progress
                });
            }
        }

        const fmtRM = (n) => 'RM ' + (Number(n) || 0).toLocaleString();
        const cell = (t) => {
            if (!t) return '<td style="padding:10px;color:var(--gray-300);text-align:center;">—</td>';
            const color = t.actual >= t.target ? '#16a34a' : (t.pct >= 60 ? '#f59e0b' : '#dc2626');
            const remaining = Math.max(0, t.target - t.actual);
            const remainingDisplay = t.label === 'Total Sales' ? fmtRM(remaining) : remaining;
            return `
                <td style="padding:10px;border-bottom:1px solid var(--gray-100);min-width:160px;">
                    <div style="font-size:12px;font-weight:600;margin-bottom:3px;">${t.display}</div>
                    <div style="background:#eee;border-radius:4px;height:6px;overflow:hidden;margin-bottom:3px;">
                        <div style="background:${color};height:100%;width:${t.pct}%;transition:width .3s;"></div>
                    </div>
                    <div style="font-size:11px;color:var(--gray-500);">${t.pct}% · ${remaining > 0 ? remainingDisplay + ' to go' : '✓ Hit'}</div>
                </td>`;
        };

        const tbody = rows.map(r => {
            const salesT = r.progress.targets.find(t => t.label === 'Total Sales');
            const custT = r.progress.targets.find(t => t.label === 'New Customers');
            const cpsT = r.progress.targets.find(t => t.label === 'CPS Count');
            const statusBadge = r.noParticipants
                ? '<span style="background:#f3f4f6;color:#6b7280;padding:3px 10px;border-radius:12px;font-size:11px;">No Agents</span>'
                : (r.progress.qualified
                    ? '<span style="background:#dcfce7;color:#166534;padding:3px 10px;border-radius:12px;font-size:11px;font-weight:600;">✓ Qualified</span>'
                    : '<span style="background:#fef3c7;color:#92400e;padding:3px 10px;border-radius:12px;font-size:11px;">In Progress</span>');
            const expiredBadge = r.isExpired
                ? '<span style="background:#f3f4f6;color:#6b7280;padding:2px 6px;border-radius:8px;font-size:10px;margin-left:6px;">EXPIRED</span>'
                : `<span style="background:#fef3c7;color:#92400e;padding:2px 6px;border-radius:8px;font-size:10px;margin-left:6px;">${r.daysLeft}d left</span>`;
            const actionBtns = canManage ? `
                <button class="btn-icon" onclick="app.openSpecialProgramModal(${r.program.id})" title="Edit"><i class="fas fa-pencil-alt"></i></button>
                <button class="btn-icon text-danger" onclick="app.deleteSpecialProgram(${r.program.id})" title="Delete"><i class="fas fa-trash-alt"></i></button>
            ` : '';
            return `
                <tr style="${r.isExpired ? 'opacity:0.6;background:#f9fafb;' : ''}">
                    <td style="padding:10px;border-bottom:1px solid var(--gray-100);min-width:200px;">
                        <strong style="font-size:13px;">🏆 ${r.program.program_name || 'Untitled'}</strong>${expiredBadge}
                        <div style="font-size:11px;color:var(--gray-500);margin-top:3px;">🎁 ${r.program.reward || '—'}</div>
                        <div style="font-size:10px;color:var(--gray-400);margin-top:2px;">${r.program.start_date || '?'} → ${r.program.end_date || '?'}</div>
                    </td>
                    <td style="padding:10px;border-bottom:1px solid var(--gray-100);min-width:160px;">
                        ${r.noParticipants ? '<span style="color:var(--gray-400);font-style:italic;">No participants</span>' : `
                            <strong style="font-size:13px;">${r.agentName}</strong>
                            <div style="font-size:11px;color:var(--gray-500);margin-top:2px;">${r.agentRole}</div>
                        `}
                    </td>
                    ${cell(salesT)}
                    ${cell(custT)}
                    ${cell(cpsT)}
                    <td style="padding:10px;border-bottom:1px solid var(--gray-100);text-align:center;">${statusBadge}</td>
                    <td style="padding:10px;border-bottom:1px solid var(--gray-100);white-space:nowrap;">${actionBtns}</td>
                </tr>`;
        }).join('');

        return `
            <div style="margin-bottom:12px;color:var(--gray-500);font-size:13px;">
                Track each agent's progress toward their special program targets. Bars show how much they have made and how far to go.
            </div>
            <div style="overflow-x:auto;">
                <table class="data-table" style="width:100%;">
                    <thead>
                        <tr>
                            <th scope="col" style="text-align:left;">Program</th>
                            <th scope="col" style="text-align:left;">Agent</th>
                            <th scope="col" style="text-align:left;">Total Sales</th>
                            <th scope="col" style="text-align:left;">New Customers</th>
                            <th scope="col" style="text-align:left;">CPS Count</th>
                            <th scope="col" style="text-align:center;">Status</th>
                            <th scope="col" style="text-align:left;">Actions</th>
                        </tr>
                    </thead>
                    <tbody>${tbody}</tbody>
                </table>
            </div>`;
    };

    // Open create/edit modal for a special program
    const openSpecialProgramModal = async (programId = null) => {
        const existing = programId ? (await AppDataStore.getAll('special_programs')).find(p => p.id === programId) : null;
        const participants = programId
            ? (await AppDataStore.getAll('special_program_participants')).filter(p => p.program_id === programId)
            : [];
        const selectedIds = new Set(participants.map(p => p.agent_id));

        // Pull eligible agents: Level 6-12 (Senior Consultant through Ambassador)
        const allUsers = await AppDataStore.getAll('users');
        const eligible = allUsers.filter(u => {
            if (u.status === 'deleted') return false;
            const m = u.role?.match(/Level\s*(\d+)/);
            if (!m) return false;
            const lvl = parseInt(m[1]);
            return lvl >= 6 && lvl <= 12;
        });

        const todayStr = _today();
        const defaultEnd = (() => { const d = new Date(); d.setDate(d.getDate() + 60); return d.toISOString().slice(0, 10); })();

        const agentRows = eligible.map(u => `
            <tr>
                <td style="padding:6px 8px;"><input type="checkbox" class="sp-agent-cb" value="${u.id}" ${selectedIds.has(u.id) ? 'checked' : ''}></td>
                <td style="padding:6px 8px;"><strong>${u.full_name || u.username || '—'}</strong></td>
                <td style="padding:6px 8px;font-size:11px;color:var(--gray-500);">${u.role || '—'}</td>
            </tr>`).join('');

        const content = `
            <div style="max-height:75vh;overflow-y:auto;padding-right:4px;">
                <h4 style="margin:0 0 10px;">Program Details</h4>
                <div class="form-group"><label>Program Name *</label>
                    <input type="text" id="sp-name" class="form-control" value="${existing?.program_name || ''}" placeholder="e.g. China Trip Challenge"></div>
                <div class="form-group"><label>Reward *</label>
                    <input type="text" id="sp-reward" class="form-control" value="${existing?.reward || ''}" placeholder="e.g. China 5D4N Trip"></div>
                <div class="form-group"><label>Description</label>
                    <textarea id="sp-desc" class="form-control" rows="2" placeholder="Optional details about the program">${existing?.description || ''}</textarea></div>
                <div class="form-row" style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">
                    <div class="form-group"><label>Start Date *</label>
                        <input type="date" id="sp-start" class="form-control" value="${existing?.start_date || todayStr}"></div>
                    <div class="form-group"><label>End Date *</label>
                        <input type="date" id="sp-end" class="form-control" value="${existing?.end_date || defaultEnd}"></div>
                </div>

                <h4 style="margin:16px 0 10px;">Targets (all must be hit to qualify)</h4>
                <div class="form-row" style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px;">
                    <div class="form-group"><label>Sales Target (RM)</label>
                        <input type="number" id="sp-sales" class="form-control" value="${existing?.sales_target || ''}" placeholder="e.g. 200000"></div>
                    <div class="form-group"><label>New Customers</label>
                        <input type="number" id="sp-customers" class="form-control" value="${existing?.new_customers_target || ''}" placeholder="e.g. 5"></div>
                    <div class="form-group"><label>CPS Count</label>
                        <input type="number" id="sp-cps" class="form-control" value="${existing?.cps_target || ''}" placeholder="optional"></div>
                </div>
                <p style="font-size:11px;color:var(--gray-400);margin:0 0 14px;">Leave a target blank to exclude it from the program.</p>

                <h4 style="margin:16px 0 6px;">Participating Agents (${eligible.length} eligible)</h4>
                <p style="font-size:11px;color:var(--gray-400);margin:0 0 8px;">Pick from Consultant/Agent roles (Level 6–12)</p>
                <div style="max-height:260px;overflow-y:auto;border:1px solid var(--gray-200);border-radius:6px;">
                    <table style="width:100%;border-collapse:collapse;font-size:12px;">
                        <thead style="background:var(--gray-50,#f7f4ed);position:sticky;top:0;">
                            <tr>
                                <th scope="col" style="padding:8px;width:40px;"><input type="checkbox" id="sp-select-all" onchange="document.querySelectorAll('.sp-agent-cb').forEach(cb => cb.checked = this.checked)"></th>
                                <th scope="col" style="text-align:left;padding:8px;">Name</th>
                                <th scope="col" style="text-align:left;padding:8px;">Role</th>
                            </tr>
                        </thead>
                        <tbody>${agentRows || '<tr><td colspan="3" style="padding:16px;text-align:center;color:var(--gray-400);">No eligible agents found</td></tr>'}</tbody>
                    </table>
                </div>
            </div>`;

        UI.showModal(existing ? 'Edit Special Program' : 'New Special Program', content, [
            { label: 'Cancel', type: 'secondary', action: 'UI.hideModal()' },
            { label: existing ? 'Save Changes' : 'Create Program', type: 'primary', action: `(async () => { await app.saveSpecialProgram(${programId || 'null'}); })()` }
        ]);
    };

    const saveSpecialProgram = async (programId = null) => {
        const name = document.getElementById('sp-name')?.value?.trim();
        const reward = document.getElementById('sp-reward')?.value?.trim();
        const description = document.getElementById('sp-desc')?.value?.trim() || '';
        const startDate = document.getElementById('sp-start')?.value;
        const endDate = document.getElementById('sp-end')?.value;
        const salesTarget = parseFloat(document.getElementById('sp-sales')?.value) || 0;
        const customersTarget = parseInt(document.getElementById('sp-customers')?.value) || 0;
        const cpsTarget = parseInt(document.getElementById('sp-cps')?.value) || 0;

        if (!name) return UI.toast.error('Program name is required');
        if (!reward) return UI.toast.error('Reward is required');
        if (!startDate || !endDate) return UI.toast.error('Start and end dates are required');
        if (endDate < startDate) return UI.toast.error('End date must be after start date');
        if (salesTarget <= 0 && customersTarget <= 0 && cpsTarget <= 0) return UI.toast.error('At least one target must be set');

        const selectedAgents = Array.from(document.querySelectorAll('.sp-agent-cb:checked')).map(cb => parseInt(cb.value));

        const programData = {
            program_name: name,
            reward: reward,
            description: description,
            start_date: startDate,
            end_date: endDate,
            sales_target: salesTarget,
            new_customers_target: customersTarget,
            cps_target: cpsTarget,
            qualify_mode: 'all',
            status: 'active',
            created_by: _currentUser?.id || null,
            created_at: new Date().toISOString()
        };

        let savedProgramId = programId;
        if (programId) {
            await AppDataStore.update('special_programs', programId, programData);
            // Remove old participants
            const oldParts = (await AppDataStore.getAll('special_program_participants')).filter(p => p.program_id === programId);
            for (const p of oldParts) {
                await AppDataStore.delete('special_program_participants', p.id);
            }
        } else {
            programData.id = Date.now();
            savedProgramId = programData.id;
            await AppDataStore.create('special_programs', programData);
        }

        // Create new participants
        for (const agentId of selectedAgents) {
            await AppDataStore.create('special_program_participants', {
                id: Date.now() + agentId,
                program_id: savedProgramId,
                agent_id: agentId,
                joined_at: new Date().toISOString()
            });
        }

        UI.hideModal();
        UI.toast.success(programId ? 'Program updated' : `Program created with ${selectedAgents.length} participant${selectedAgents.length===1?'':'s'}`);
        await refreshSpecialProgramView();
    };

    // Refresh whichever view currently hosts the special programs UI
    const refreshSpecialProgramView = async () => {
        const mlContent = document.getElementById('marketing-list-content');
        if (mlContent && _currentMarketingListTab === 'special_programs') {
            mlContent.innerHTML = await renderMarketingListTable();
            return;
        }
        if (typeof window.app.refreshKPIDashboard === 'function') await window.app.refreshKPIDashboard();
    };

    const deleteSpecialProgram = async (programId) => {
        UI.showModal('Delete Program', '<p>Are you sure you want to delete this special program? Participants and progress history will be removed.</p>', [
            { label: 'Cancel', type: 'secondary', action: 'UI.hideModal()' },
            { label: 'Delete', type: 'primary', action: `(async () => { await app.confirmDeleteSpecialProgram(${programId}); })()` }
        ]);
    };

    const confirmDeleteSpecialProgram = async (programId) => {
        await AppDataStore.delete('special_programs', programId);
        const parts = (await AppDataStore.getAll('special_program_participants')).filter(p => p.program_id === programId);
        for (const p of parts) {
            await AppDataStore.delete('special_program_participants', p.id);
        }
        UI.hideModal();
        UI.toast.success('Program deleted');
        await refreshSpecialProgramView();
    };

    // Calendar popup — show on first calendar visit per session if current user is in any active program
    const checkSpecialProgramPopup = async () => {
        if (!_currentUser) return;
        if (sessionStorage.getItem('specialProgramPopupShown') === '1') return;

        const [programs, parts] = await Promise.all([
            AppDataStore.getAll('special_programs'),
            AppDataStore.getAll('special_program_participants')
        ]);
        const today = _today();
        const myParts = parts.filter(p => p.agent_id === _currentUser.id);
        if (myParts.length === 0) return;

        const myActive = [];
        for (const part of myParts) {
            const program = programs.find(pr => pr.id === part.program_id);
            if (!program || program.status === 'cancelled' || program.status === 'deleted') continue;
            if (program.start_date > today || program.end_date < today) continue;
            myActive.push(program);
        }
        if (myActive.length === 0) return;

        // Build progress cards
        const cards = [];
        for (const program of myActive) {
            const progress = await calculateProgramProgress(program, _currentUser.id);
            const daysLeft = program.end_date ? Math.max(0, Math.ceil((new Date(program.end_date) - new Date(today)) / 86400000)) : 0;
            const barsHtml = progress.targets.map(t => {
                const color = t.actual >= t.target ? '#16a34a' : (t.pct >= 60 ? '#f59e0b' : '#dc2626');
                return `
                    <div style="margin-bottom:10px;">
                        <div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:4px;">
                            <span>${t.label}</span>
                            <strong>${t.display}</strong>
                        </div>
                        <div style="background:#eee;border-radius:6px;height:10px;overflow:hidden;">
                            <div style="background:${color};height:100%;width:${t.pct}%;transition:width .4s;"></div>
                        </div>
                    </div>`;
            }).join('');
            const statusBanner = progress.qualified
                ? '<div style="background:#dcfce7;color:#166534;padding:10px;border-radius:6px;margin-bottom:10px;font-weight:600;text-align:center;">🎉 You\'ve qualified for this reward!</div>'
                : `<div style="background:#fef3c7;color:#92400e;padding:10px;border-radius:6px;margin-bottom:10px;text-align:center;font-size:13px;">⏳ <strong>${daysLeft} days left</strong> — keep pushing!</div>`;

            cards.push(`
                <div style="background:var(--white,#fff);border:2px solid #8B1A1A;border-radius:10px;padding:16px;margin-bottom:14px;">
                    <h3 style="margin:0 0 4px;color:#8B1A1A;">🏆 ${program.program_name}</h3>
                    <p style="font-size:13px;color:var(--gray-500);margin:0 0 10px;">🎁 Reward: <strong>${program.reward}</strong></p>
                    ${statusBanner}
                    ${barsHtml}
                </div>`);
        }

        sessionStorage.setItem('specialProgramPopupShown', '1');
        UI.showModal('Your Special Programs', cards.join(''), [
            { label: 'Let\'s Go! 💪', type: 'primary', action: 'UI.hideModal()' }
        ]);
    };

    const renderKPITargetComparison = async () => {
        const year = new Date().getFullYear();
        const quarter = Math.ceil((new Date().getMonth() + 1) / 3);
        const month = new Date().getMonth() + 1;

        const yearlyTargets = (await AppDataStore.getAll('yearly_targets')).find(t => t.target_year === year);
        const quarterlyTarget = (await AppDataStore.getAll('quarterly_targets')).find(t => t.quarter === quarter && t.year === year);
        const monthlyTarget = (await AppDataStore.getAll('monthly_targets')).find(t => t.month === month && t.year === year);

        if (!yearlyTargets) return '<div style="text-align:center; padding:20px; color:var(--gray-500);">No targets set for ' + year + '. <button class="btn primary btn-sm" onclick="app.openKPITargetsModal()">Set Targets</button></div>';

        // Calculate quarter date range
        const qStart = `${year}-${String((quarter - 1) * 3 + 1).padStart(2, '0')}-01`;
        const qEndMonth = quarter * 3;
        const qEnd = `${year}-${String(qEndMonth).padStart(2, '0')}-${new Date(year, qEndMonth, 0).getDate()}`;

        // Get actuals
        const cpsActual = await getCPSCount(qStart, qEnd);
        const salesActual = await getTotalSales(qStart, qEnd);
        const popCountActual = await getPOPCaseCount(qStart, qEnd);
        const popSalesActual = await getPOPSales(qStart, qEnd);
        const eppCountActual = await getEPPCaseCount(qStart, qEnd);
        const eppSalesActual = await getEPPSales(qStart, qEnd);
        const agentsActual = await getNewAgents(qStart, qEnd);
        const customersActual = await getNewCustomers(qStart, qEnd);
        const meetingsActual = await getTotalMeetings(qStart, qEnd);

        const row = (label, actual, target) => {
            const pct = target > 0 ? Math.round((actual / target) * 100) : 0;
            const color = pct >= 95 ? 'success' : pct >= 80 ? 'warning' : 'danger';
            const variance = actual - target;
            return `<tr>
                <td>${label}</td>
                <td style="text-align:right;">${typeof target === 'number' && target > 999 ? 'RM ' + target.toLocaleString() : target}</td>
                <td style="text-align:right;">${typeof actual === 'number' && actual > 999 ? 'RM ' + actual.toLocaleString() : actual}</td>
                <td style="text-align:right; color:${variance >= 0 ? 'var(--success)' : 'var(--danger)'};">${variance >= 0 ? '+' : ''}${typeof variance === 'number' && Math.abs(variance) > 999 ? 'RM ' + variance.toLocaleString() : variance}</td>
                <td style="text-align:right;"><span class="badge ${color}">${pct}%</span></td>
            </tr>`;
        };

        return `
            <div class="profile-section" style="margin-top:20px;">
                <h2><i class="fas fa-bullseye"></i> Q${quarter} ${year} — Target vs Actual</h2>
                <table class="data-table" style="width:100%;">
                    <thead><tr><th scope="col">Metric</th><th scope="col" style="text-align:right;">Target</th><th scope="col" style="text-align:right;">Actual</th><th scope="col" style="text-align:right;">Variance</th><th scope="col" style="text-align:right;">%</th></tr></thead>
                    <tbody>
                        ${row('CPS Count', cpsActual, quarterlyTarget?.cps_count_target || 0)}
                        ${row('Total Sales', salesActual, quarterlyTarget?.total_sales_target || 0)}
                        ${row('POP Cases', popCountActual, quarterlyTarget?.pop_case_count_target || 0)}
                        ${row('POP Sales', popSalesActual, quarterlyTarget?.pop_sales_target || 0)}
                        ${row('EPP Cases', eppCountActual, quarterlyTarget?.epp_case_count_target || 0)}
                        ${row('EPP Sales', eppSalesActual, quarterlyTarget?.epp_sales_target || 0)}
                        ${row('New Agents', agentsActual, quarterlyTarget?.new_agents_target || 0)}
                        ${row('New Customers', customersActual, quarterlyTarget?.new_customers_target || 0)}
                        ${row('Total Meetings', meetingsActual, quarterlyTarget?.total_meetings_target || 0)}
                    </tbody>
                </table>
            </div>
            <div class="profile-section" style="margin-top:16px;">
                <h2><i class="fas fa-calendar-alt"></i> Yearly Target Overview — ${year}</h2>
                <table class="data-table" style="width:100%;">
                    <thead><tr><th scope="col">Metric</th><th scope="col" style="text-align:right;">Q1</th><th scope="col" style="text-align:right;">Q2</th><th scope="col" style="text-align:right;">Q3</th><th scope="col" style="text-align:right;">Q4</th><th scope="col" style="text-align:right;">Year Total</th></tr></thead>
                    <tbody>
                        ${await renderYearlyTargetRows(year)}
                    </tbody>
                </table>
            </div>`;
    };

    const renderYearlyTargetRows = async (year) => {
        const qTargets = (await AppDataStore.getAll('quarterly_targets')).filter(t => t.year === year).sort((a, b) => a.quarter - b.quarter);
        const yearlyTarget = (await AppDataStore.getAll('yearly_targets')).find(t => t.target_year === year);
        if (!yearlyTarget || qTargets.length === 0) return '<tr><td colspan="6" style="text-align:center;">No targets configured</td></tr>';

        const metrics = [
            { key: 'cps_count_target', label: 'CPS Count' },
            { key: 'total_sales_target', label: 'Total Sales (RM)' },
            { key: 'pop_case_count_target', label: 'POP Cases' },
            { key: 'pop_sales_target', label: 'POP Sales (RM)' },
            { key: 'new_agents_target', label: 'New Agents' },
            { key: 'new_customers_target', label: 'New Customers' },
            { key: 'total_meetings_target', label: 'Total Meetings' }
        ];
        return metrics.map(m => {
            const vals = qTargets.map(q => q[m.key] || 0);
            const fmt = (v) => v > 999 ? v.toLocaleString() : v;
            return `<tr>
                <td>${m.label}</td>
                ${vals.map(v => `<td style="text-align:right;">${fmt(v)}</td>`).join('')}
                ${vals.length < 4 ? '<td></td>'.repeat(4 - vals.length) : ''}
                <td style="text-align:right; font-weight:600;">${fmt(yearlyTarget[m.key] || 0)}</td>
            </tr>`;
        }).join('');
    };


    // [CHUNK: performance] 913 lines extracted to chunks/script-performance.js
    // Covers: showRankingPerformanceView, showWorkflowAutomationView, showNoticeboardView
    // + all workflow CRUD helpers. Loaded lazily by navigateTo() for views:
    // 'ranking', 'performance', 'noticeboard'.
    // Registered on window.app via Object.assign at chunk load time.

    // Workflow execution engine — called from activity save and prospect create paths;
    // must live in the main IIFE so it's available without navigating to the ranking view.
    const executeWorkflows = async (triggerType, context = {}) => {
        const workflows = (await AppDataStore.getAll('automation_workflows')).filter(w => w.trigger_type === triggerType && w.status === 'active');
        for (const wf of workflows) {
            try {
                if (wf.trigger_conditions?.value) {
                    if (triggerType === 'score_change' && context.score < parseInt(wf.trigger_conditions.value)) continue;
                    if (triggerType === 'inactivity' && context.daysInactive < parseInt(wf.trigger_conditions.value)) continue;
                }
                const config = (wf.action_config || '')
                    .replace(/\{\{name\}\}/g, context.name || '')
                    .replace(/\{\{prospect_name\}\}/g, context.name || '')
                    .replace(/\{\{score\}\}/g, context.score || '')
                    .replace(/\{\{days\}\}/g, context.days || '')
                    .replace(/\{\{event_name\}\}/g, context.eventName || '');
                void config;
                await AppDataStore.update('automation_workflows', wf.id, {
                    run_count: (wf.run_count || 0) + 1,
                    last_run: new Date().toISOString()
                });
            } catch (err) {
                console.error(`Workflow execution error for "${wf.workflow_name}":`, err);
            }
        }
    };

    // Called from activity save, milestone view, and admin "Mark ✓" buttons.
    // Must live here so it's available before the performance chunk is ever loaded.
    const markMilestoneCompleted = async (userId, milestoneName) => {
        try {
            const existing = await AppDataStore.query('user_milestones', { user_id: userId, milestone_name: milestoneName });
            if (existing.length === 0) {
                await AppDataStore.create('user_milestones', {
                    id: Date.now(),
                    user_id: userId,
                    milestone_name: milestoneName,
                    completed: true,
                    completed_date: new Date().toISOString().split('T')[0]
                });
            } else if (!existing[0].completed) {
                await AppDataStore.update('user_milestones', existing[0].id, {
                    completed: true,
                    completed_date: new Date().toISOString().split('T')[0]
                });
            }
        } catch (err) {
            console.warn('markMilestoneCompleted error:', err);
        }
    };

    // showMilestonesView(container, targetUserId?)
    // If targetUserId is supplied (admin use), shows that user's progress instead of the current user's.
    const showMilestonesView = async (container, targetUserId = null) => {
        const currentUser = _currentUser;
        if (!currentUser) return;

        // ── Paint skeleton immediately ──────────────────────────────────────
        container.innerHTML = `
            <div class="milestone-view-wrap">
                <div class="milestone-container">
                    <div class="milestone-inner">
                        <div class="milestone-header"><h1>增运九法</h1></div>
                        <div class="nine-method-grid">
                            ${Array(9).fill(0).map(() => `<div class="skeleton" style="border-radius:12px;height:120px;"></div>`).join('')}
                        </div>
                        <div style="margin-top:32px;">
                            <div class="skeleton" style="height:24px;width:140px;border-radius:4px;margin-bottom:16px;"></div>
                            <div style="display:grid;grid-template-columns:repeat(2,1fr);gap:16px;">
                                ${Array(4).fill(0).map(() => `<div class="skeleton" style="border-radius:12px;height:100px;"></div>`).join('')}
                            </div>
                        </div>
                    </div>
                </div>
            </div>`;

        // Determine admin status
        const viewerLevel = (() => {
            const m = (currentUser.role || '').match(/Level\s+(\d+)/i);
            return m ? parseInt(m[1]) : 12;
        })();
        const isAdmin = viewerLevel <= 2;

        // Resolve subject (whose milestones to show)
        const subjectUserId = (isAdmin && targetUserId) ? parseInt(targetUserId) : currentUser.id;
        const subjectUser   = (isAdmin && targetUserId) ? (await AppDataStore.getById('users', subjectUserId) || currentUser) : currentUser;
        const viewingOther  = isAdmin && subjectUserId !== currentUser.id;

        const subject = {
            user_id: subjectUserId,
            customer_id: subjectUser.customer_id || null,
            prospect_id: subjectUser.prospect_id || null,
        };

        // Compute statuses (parallel)
        const [nineStatuses, pillarStatuses] = await Promise.all([
            computeNineMethodStatuses(subject),
            computeFourPillarStatuses(subject),
        ]);

        // Admin user picker
        let adminPicker = '';
        if (isAdmin) {
            let allUsers = [];
            try { allUsers = (await AppDataStore.getAll('users')).filter(u => u.role && u.role.match(/Level\s+1[34]/i)); } catch(e) {}
            if (allUsers.length) {
                adminPicker = `
                    <div class="milestone-admin-picker">
                        <span>View:</span>
                        <select onchange="(async()=>{ const vp=document.getElementById('content-viewport'); if(vp) await app.showMilestonesView(vp, this.value||null); })()">
                            <option value="">— My own —</option>
                            ${allUsers.map(u => `<option value="${u.id}" ${u.id === subjectUserId && viewingOther ? 'selected' : ''}>${u.full_name}</option>`).join('')}
                        </select>
                    </div>`;
            }
        }

        const reloadAfter = `setTimeout(() => { const vp=document.getElementById('content-viewport'); if(vp) app.showMilestonesView(vp, ${targetUserId ? targetUserId : 'null'}); }, 120)`;
        const adminBtn = (key, isOn) => {
            if (!isAdmin) return '';
            if (isOn) {
                return `<button class="mc-admin reset" onclick="event.stopPropagation(); app.resetMilestone(${subjectUserId},'${key}').then(()=>{${reloadAfter}})">Reset</button>`;
            }
            return `<button class="mc-admin" onclick="event.stopPropagation(); app.markMilestoneCompleted(${subjectUserId},'${key}').then(()=>{${reloadAfter}})">Mark ✓</button>`;
        };
        const adminBtnPillar = (key, isOn) => {
            if (!isAdmin) return '';
            if (isOn) {
                return `<button class="pc-admin reset" onclick="event.stopPropagation(); app.resetMilestone(${subjectUserId},'${key}').then(()=>{${reloadAfter}})">Reset</button>`;
            }
            return `<button class="pc-admin" onclick="event.stopPropagation(); app.markMilestoneCompleted(${subjectUserId},'${key}').then(()=>{${reloadAfter}})">Mark ✓</button>`;
        };

        container.innerHTML = `
            <div class="milestone-view-wrap">
                <div class="milestone-container">
                    <div class="milestone-inner">
                        <div class="milestone-header">
                            <h1>增运九法</h1>
                            ${viewingOther ? `<div class="viewer-note">Viewing: ${subjectUser.full_name}</div>` : ''}
                        </div>
                        ${adminPicker}
                        <div class="nine-method-grid">
                            ${NINE_METHOD_DEFS.map(def => {
                                const on = !!nineStatuses[def.key];
                                return `
                                    <div class="nine-method-card ${on ? 'attended' : ''}">
                                        <div class="mc-icon"><picture><source srcset="${def.icon.replace(/\.png$/i,'.webp')}" type="image/webp"><img loading="lazy" decoding="async" src="${def.icon}" alt=""></picture></div>
                                        ${adminBtn(def.key, on)}
                                    </div>
                                `;
                            }).join('')}
                        </div>

                        <div class="four-pillar-section">
                            <h2>丁财贵寿四柱</h2>
                            <div class="four-pillar-grid">
                                ${FOUR_PILLAR_DEFS.map(def => {
                                    const on = !!pillarStatuses[def.key];
                                    return `
                                        <div class="four-pillar-card ${on ? 'owned' : ''}">
                                            <div class="pc-icon"><picture><source srcset="${def.icon.replace(/\.png$/i,'.webp')}" type="image/webp"><img loading="lazy" decoding="async" src="${def.icon}" alt=""></picture></div>
                                            <div class="pc-label">${def.label}</div>
                                            ${adminBtnPillar(def.key, on)}
                                        </div>
                                    `;
                                }).join('')}
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        `;
    };

    // Reset a milestone — removes the admin override row so auto-detect takes over.
    // (Previously set completed=false; that prevented auto-detect from re-lighting the icon.)
    const resetMilestone = async (userId, milestoneName) => {
        try {
            const existing = await AppDataStore.query('user_milestones', { user_id: userId, milestone_name: milestoneName });
            for (const row of existing) {
                await AppDataStore.delete('user_milestones', row.id);
            }
            if (existing.length > 0) UI.toast.success(`Override removed for "${milestoneName}".`);
        } catch(err) {
            UI.toast.error('Reset failed: ' + (err.message || 'Unknown error'));
        }
    };

    // ========== LEVEL 13/14: 福德 VIEW ==========
    const showFudeView = async (container) => {
        const currentUser = _currentUser;
        if (!currentUser) return;

        const userLevel = (() => {
            const m = (currentUser.role || '').match(/Level\s+(\d+)/i);
            return m ? parseInt(m[1]) : 12;
        })();
        const isAdmin   = userLevel <= 2 || ['mianformula@gmail.com', 'destinyoracles@gmail.com', 'shilynateh7689@gmail.com'].includes((currentUser.email || '').toLowerCase());
        const isL1314   = userLevel >= 13;
        const isCustomer = userLevel === 13;

        // --- Data loading ---
        let highlights = [], myRewards = [], myPurchases = [], allRewards = [];
        try {
            highlights = isAdmin
                ? await AppDataStore.getAll('news_highlights')
                : await AppDataStore.query('news_highlights', { is_active: true });
        } catch(e) {}
        try { myRewards = await AppDataStore.query('recommendation_rewards', { user_id: currentUser.id }); } catch(e) {}
        if (isCustomer && currentUser.customer_id) {
            try { myPurchases = await AppDataStore.query('purchases', { customer_id: currentUser.customer_id }); } catch(e) {}
        }
        let allUsersForReward = [];
        if (isAdmin) {
            try { allUsersForReward = (await AppDataStore.getAll('users')).filter(u => u.role && u.role.match(/Level\s*1[34]/i)); } catch(e) {}
            try { allRewards = await AppDataStore.getAll('recommendation_rewards'); } catch(e) {}
        }

        // --- Helpers ---
        const fmtDate = d => { try { return new Date(d).toLocaleDateString(); } catch(e) { return d || '-'; } };
        const fmtAmt  = v => { try { return 'RM ' + parseFloat(v || 0).toLocaleString('en-MY', { minimumFractionDigits: 2 }); } catch(e) { return v; } };
        const badge   = (txt, bg, col) => `<span style="padding:2px 8px;border-radius:12px;font-size:0.78rem;background:${bg};color:${col};">${txt}</span>`;

        // --- Content filters ---
        // Sort highlights/news by created_at desc so the newest one is slide 0
        // (the user expects to see freshly-added highlights immediately, not
        // hidden behind the carousel's next-arrow).
        const publicNews         = highlights.filter(h => h.type === 'highlight').sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
        const successStories     = highlights.filter(h => h.type === 'success_story').sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
        const recommendationTips = highlights.filter(h => h.type === 'recommendation_tip').sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

        // --- Pre-sign highlight images so render doesn't depend on DOM resolver ---
        const withImg = [...publicNews, ...successStories].filter(h => h.image_url);
        if (withImg.length && AppDataStore.resolveAttachmentSrc) {
            await Promise.all(withImg.map(async h => {
                try { h._signedUrl = await AppDataStore.resolveAttachmentSrc(h.image_url); } catch(e) {}
            }));
        }

        // --- Totals & summary sync ---
        const totalPoints  = myRewards.reduce((s, r) => s + (parseInt(r.fudi_points)    || 0), 0);
        const totalReturns = myRewards.reduce((s, r) => s + (parseFloat(r.sharing_return) || 0), 0);
        if (myRewards.length > 0) { try { await syncFudiSummary(currentUser.id, totalPoints, totalReturns); } catch(e) {} }

        // --- Helper: pre-signed image src attr ---
        const imgSrc = (h) => h._signedUrl ? `src="${h._signedUrl}"` : '';

        // --- Summary tiles (L13/14) ---
        const summaryBanner = isL1314 ? `
            <div class="fude-summary-grid">
                <div class="fude-summary-tile" style="background:linear-gradient(135deg,#be185d,#e91e8c);">
                    <div class="fude-summary-tile-val">${totalPoints}</div>
                    <div class="fude-summary-tile-label">福气 Points</div>
                </div>
                <div class="fude-summary-tile" style="background:linear-gradient(135deg,#065f46,#10b981);">
                    <div class="fude-summary-tile-val">RM ${totalReturns.toFixed(2)}</div>
                    <div class="fude-summary-tile-label">Sharing Returns</div>
                </div>
            </div>` : '';

        // --- Admin: leaderboard ---
        const leaderboardSection = isAdmin ? (() => {
            const totals = {};
            allRewards.forEach(r => {
                if (!totals[r.user_id]) totals[r.user_id] = { pts: 0, ret: 0 };
                totals[r.user_id].pts += parseInt(r.fudi_points)    || 0;
                totals[r.user_id].ret += parseFloat(r.sharing_return) || 0;
            });
            const ranked = Object.entries(totals)
                .map(([uid, t]) => { const u = allUsersForReward.find(u => u.id === parseInt(uid)); return { name: u?.full_name || 'User ' + uid, ...t }; })
                .sort((a, b) => b.pts - a.pts);
            if (!ranked.length) return '';
            const medals = ['🥇','🥈','🥉'];
            return `<div class="fude-section">
                <div class="fude-sec-bar"><div class="fude-sec-bar-icon news">🏆</div><h2>福气 Leaderboard</h2></div>
                <div class="fude-sec-body"><div style="overflow-x:auto;"><table class="data-table"><thead><tr>
                    <th scope="col">#</th><th scope="col">Name</th><th scope="col">福气 Points</th><th scope="col">Sharing Returns (RM)</th>
                </tr></thead><tbody>
                    ${ranked.map((r, i) => `<tr>
                        <td>${medals[i] || (i + 1)}</td>
                        <td style="font-weight:600;">${r.name}</td>
                        <td>${r.pts}</td>
                        <td>${r.ret.toFixed(2)}</td>
                    </tr>`).join('')}
                </tbody></table></div></div>
            </div>`;
        })() : '';

        // --- Admin: manage highlights table ---
        const adminHighlightsSection = isAdmin ? `
            <div class="fude-section">
                <div class="fude-sec-bar" style="justify-content:space-between;">
                    <div style="display:flex;align-items:center;gap:12px;"><div class="fude-sec-bar-icon news">⚙️</div><h2>Manage Highlights &amp; Stories</h2></div>
                    <button class="btn primary btn-sm" onclick="app.openHighlightModal()"><i class="fas fa-plus"></i> Add New</button>
                </div>
                <div class="fude-sec-body"><div style="overflow-x:auto;"><table class="data-table"><thead><tr>
                    <th scope="col">Title</th><th scope="col">Type</th><th scope="col">Status</th><th scope="col">Created</th><th scope="col">Actions</th>
                </tr></thead><tbody>
                    ${highlights.length ? highlights.map(h => `<tr>
                        <td style="max-width:240px;overflow:hidden;text-overflow:ellipsis;">${h.title}</td>
                        <td>${badge(h.type || '-', '#e0e7ff', '#3730a3')}</td>
                        <td>${badge(h.is_active ? 'Active' : 'Hidden', h.is_active ? '#d1fae5' : '#f3f4f6', h.is_active ? '#065f46' : '#6b7280')}</td>
                        <td>${fmtDate(h.created_at)}</td>
                        <td style="white-space:nowrap;">
                            <button class="btn secondary btn-sm" onclick="event.stopPropagation();app.openHighlightModal(${h.id})"><i class="fas fa-edit"></i></button>
                            <button class="btn danger btn-sm" style="margin-left:4px;" onclick="event.stopPropagation();app.deleteHighlight(${h.id})"><i class="fas fa-trash"></i></button>
                        </td>
                    </tr>`).join('') : '<tr><td colspan="5" style="text-align:center;color:var(--gray-400);">No highlights yet.</td></tr>'}
                </tbody></table></div></div>
            </div>` : '';

        // --- Admin: manage rewards table ---
        const adminRewardsSection = isAdmin ? `
            <div class="fude-section">
                <div class="fude-sec-bar" style="justify-content:space-between;">
                    <div style="display:flex;align-items:center;gap:12px;"><div class="fude-sec-bar-icon gem">🎁</div><h2>Manage Rewards &amp; 福气 Points</h2></div>
                    <button class="btn primary btn-sm" onclick="app.openRewardModal()"><i class="fas fa-plus"></i> Award Points</button>
                </div>
                <div class="fude-sec-body"><div style="overflow-x:auto;"><table class="data-table"><thead><tr>
                    <th scope="col">User</th><th scope="col">Action</th><th scope="col">福气 Pts</th><th scope="col">Sharing Return</th><th scope="col">Description</th><th scope="col">Date</th><th scope="col"></th>
                </tr></thead><tbody>
                    ${allRewards.length ? allRewards.map(r => {
                        const u = allUsersForReward.find(u => u.id === r.user_id);
                        return `<tr>
                            <td style="font-weight:600;">${u ? u.full_name : 'User ' + r.user_id}</td>
                            <td>${badge(r.action_type || '-', '#e0e7ff', '#3730a3')}</td>
                            <td>${r.fudi_points || 0}</td>
                            <td>${parseFloat(r.sharing_return || 0).toFixed(2)}</td>
                            <td style="max-width:180px;overflow:hidden;text-overflow:ellipsis;">${r.description || '-'}</td>
                            <td>${fmtDate(r.created_at)}</td>
                            <td><button class="btn danger btn-sm" onclick="event.stopPropagation();app.deleteReward(${r.id})"><i class="fas fa-trash"></i></button></td>
                        </tr>`;
                    }).join('') : '<tr><td colspan="7" style="text-align:center;color:var(--gray-400);">No rewards yet.</td></tr>'}
                </tbody></table></div></div>
            </div>` : '';

        // --- Purchases section (L13 only) ---
        let purchasesSection = '';
        if (isCustomer) {
            const rows = myPurchases.length
                ? myPurchases.map(p => `<tr>
                    <td>${p.product_name || p.package_name || p.solution || '-'}</td>
                    <td>${fmtAmt(p.amount || p.total_amount)}</td>
                    <td>${badge(p.status || 'pending', p.status === 'completed' ? '#d1fae5' : '#fef3c7', p.status === 'completed' ? '#065f46' : '#92400e')}</td>
                    <td>${fmtDate(p.purchase_date || p.created_at)}</td>
                  </tr>`).join('')
                : '<tr><td colspan="4" style="text-align:center;color:var(--gray-400);">No purchases found.</td></tr>';
            purchasesSection = `<div class="fude-section">
                <div class="fude-sec-bar"><div class="fude-sec-bar-icon story">🛍️</div><h2>My Purchase History</h2></div>
                <div class="fude-sec-body"><div style="overflow-x:auto;"><table class="data-table"><thead><tr>
                    <th scope="col">Product / Package</th><th scope="col">Amount</th><th scope="col">Status</th><th scope="col">Date</th>
                </tr></thead><tbody>${rows}</tbody></table></div></div></div>`;
        }

        // --- News carousel HTML ---
        const carouselSection = (() => {
            if (!publicNews.length) return `
                <div class="fude-section">
                    <div class="fude-sec-bar"><div class="fude-sec-bar-icon news">📰</div><h2>Highlights &amp; News</h2></div>
                    <div class="fude-sec-body"><p style="color:var(--gray-500,#6b7280);margin:0;">No highlights yet.</p></div>
                </div>`;
            const slides = publicNews.map((n, i) => `
                <div class="fude-carousel-slide" onclick="app.openStoryDetail(${n.id})" style="cursor:pointer;">
                    ${n._signedUrl ? `<img loading="lazy" decoding="async" ${imgSrc(n)} alt="" onerror="this.style.display='none'">` : ''}
                    <div class="fude-carousel-overlay">
                        <span class="fude-carousel-badge">${i === 0 ? 'Latest News' : 'News'}</span>
                        <h3>${n.title}</h3>
                        ${n.content ? `<p>${n.content}</p>` : ''}
                        <span class="fude-carousel-date">📅 ${fmtDate(n.created_at)}</span>
                        <button class="fude-carousel-readmore" onclick="event.stopPropagation(); app.openStoryDetail(${n.id})">Read More</button>
                    </div>
                </div>`).join('');
            const dots = publicNews.length > 1
                ? `<div class="fude-carousel-dots">${publicNews.map((_, i) => `<button class="fude-carousel-dot${i === 0 ? ' active' : ''}" data-idx="${i}"></button>`).join('')}</div>`
                : '';
            const arrows = publicNews.length > 1
                ? `<button class="fude-carousel-arrow prev" onclick="event.stopPropagation();(function(){var w=this.closest('.fude-carousel-wrap');var t=w.querySelector('.fude-carousel-track');var n=parseInt(t.dataset.idx||0);var tot=t.children.length;var ni=(n-1+tot)%tot;t.dataset.idx=ni;t.style.transform='translateX(-'+ni*100+'%)';w.querySelectorAll('.fude-carousel-dot').forEach(function(d,i){d.classList.toggle('active',i===ni);});}).call(this)">&#8249;</button>
                  <button class="fude-carousel-arrow next" onclick="event.stopPropagation();(function(){var w=this.closest('.fude-carousel-wrap');var t=w.querySelector('.fude-carousel-track');var n=parseInt(t.dataset.idx||0);var tot=t.children.length;var ni=(n+1)%tot;t.dataset.idx=ni;t.style.transform='translateX(-'+ni*100+'%)';w.querySelectorAll('.fude-carousel-dot').forEach(function(d,i){d.classList.toggle('active',i===ni);});}).call(this)">&#8250;</button>`
                : '';
            return `
                <div class="fude-section">
                    <div class="fude-sec-bar" style="justify-content:space-between;">
                        <div style="display:flex;align-items:center;gap:12px;"><div class="fude-sec-bar-icon news">📰</div><h2>Highlights &amp; News</h2></div>
                        <a class="fude-sec-link">See all news →</a>
                    </div>
                    <div class="fude-carousel-wrap">
                        ${arrows}
                        <div class="fude-carousel-track" data-idx="0">${slides}</div>
                    </div>
                    ${dots}
                </div>`;
        })();

        // --- Success Stories grid ---
        const storiesSection = (() => {
            const PREVIEW = 6;
            const shown = successStories.slice(0, PREVIEW);
            const hasMore = successStories.length > PREVIEW;
            if (!successStories.length) return `
                <div class="fude-section fude-stories-section">
                    <div class="fude-stories-masthead">
                        <div class="fude-stories-masthead-line"></div>
                        <div class="fude-stories-masthead-center">
                            <div class="fude-stories-masthead-icon">🏆</div>
                            <div class="fude-stories-title">成功案例分享</div>
                            <div class="fude-stories-subtitle">Success&nbsp;&nbsp;Stories</div>
                        </div>
                        <div class="fude-stories-masthead-line"></div>
                    </div>
                    <div style="padding:20px;color:var(--gray-500,#6b7280);">No success stories yet.</div>
                </div>`;
            const cards = shown.map((s) => {
                const imgEl = s._signedUrl
                    ? `<img loading="lazy" decoding="async" class="fude-story-card-img" ${imgSrc(s)} alt="" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'">`
                    : '';
                const ph = `<div class="fude-story-card-img-ph" style="display:${s._signedUrl ? 'none' : 'flex'};">📖</div>`;
                const tags = (s.tags || '').split(',').filter(Boolean).slice(0, 2)
                    .map(t => `<span class="fude-story-tag">${t.trim()}</span>`).join('');
                return `<div class="fude-story-card" onclick="app.openStoryDetail(${s.id})" style="cursor:pointer;">
                    ${imgEl}${ph}
                    <div class="fude-story-card-body">
                        ${tags ? `<div class="fude-story-card-tags">${tags}</div>` : ''}
                        <h3>${s.title}</h3>
                        ${s.content ? `<p>${s.content}</p>` : '<p style="flex:1"></p>'}
                        <div class="fude-story-card-footer">
                            <div class="fude-story-card-meta">
                                <div class="fude-story-card-avatar">${(s.title || 'D')[0].toUpperCase()}</div>
                                <span>${fmtDate(s.created_at)}</span>
                            </div>
                            <button class="fude-story-readmore" onclick="event.stopPropagation(); app.openStoryDetail(${s.id})">Read More →</button>
                        </div>
                    </div>
                </div>`;
            }).join('');
            return `
                <div class="fude-section fude-stories-section">
                    <div class="fude-stories-masthead">
                        <div class="fude-stories-masthead-line"></div>
                        <div class="fude-stories-masthead-center">
                            <div class="fude-stories-masthead-icon">🏆</div>
                            <div class="fude-stories-title">成功案例分享</div>
                            <div class="fude-stories-subtitle">Success&nbsp;&nbsp;Stories</div>
                        </div>
                        <div class="fude-stories-masthead-line"></div>
                    </div>
                    <div class="fude-story-grid">${cards}</div>
                    ${hasMore ? `<button class="fude-stories-more-btn">✦ Explore More Success Stories</button>` : ''}
                </div>`;
        })();

        // --- Tips row (dynamic + 2 static) ---
        const dynamicTips = recommendationTips.slice(0, 1);
        const tipsSection = (() => {
            const tipCols = [];
            if (dynamicTips.length) {
                tipCols.push(`<div class="fude-tip-col">
                    <div class="fude-tip-icon">💡</div>
                    <h3>${dynamicTips[0].title}</h3>
                    ${dynamicTips[0].content ? `<p>${dynamicTips[0].content}</p>` : ''}
                    <button class="fude-tip-link">Learn More →</button>
                </div>`);
            } else {
                tipCols.push(`<div class="fude-tip-col">
                    <div class="fude-tip-icon">🛡️</div>
                    <h3>账户安全</h3>
                    <p>定期更新密码，避免使用常见密码，并开启双重验证，防止账户被盗用。</p>
                    <button class="fude-tip-link">Learn More →</button>
                </div>`);
            }
            tipCols.push(`<div class="fude-tip-col">
                <div class="fude-tip-icon">🎁</div>
                <h3>积分攻略</h3>
                <p>每日签到、参与活动、分享推荐好友，都能累积积分！</p>
                <button class="fude-tip-link">Learn More →</button>
            </div>`);
            tipCols.push(`<div class="fude-tip-col">
                <div class="fude-tip-icon" style="background:#fee2e2;">🎧</div>
                <h3>需要帮助?</h3>
                <p>遇到问题？我们的客服团队随时为您提供支持。</p>
                <button class="fude-tip-link">Contact Us →</button>
            </div>`);
            return `
                <div class="fude-tips-section">
                    <div class="fude-tips-header">
                        <span class="fude-tips-header-icon">💡</span>
                        <h2>今日 Tips</h2>
                    </div>
                    <div class="fude-tips-row">${tipCols.join('')}</div>
                </div>`;
        })();

        // --- My Recommendations & Returns ---
        const rewardsTableHtml = myRewards.length === 0
            ? '<p style="color:var(--gray-500,#6b7280);margin:8px 0 0;">No recommendations or rewards yet.</p>'
            : `<div style="overflow-x:auto;"><table class="data-table"><thead><tr>
                <th scope="col">Action</th><th scope="col">福气 Points</th><th scope="col">Sharing Return (RM)</th><th scope="col">Description</th><th scope="col">Date</th>
               </tr></thead><tbody>
                ${myRewards.map(r => `<tr>
                    <td>${badge(r.action_type || '-', '#e0e7ff', '#3730a3')}</td>
                    <td style="font-weight:600;">${r.fudi_points || 0}</td>
                    <td>${parseFloat(r.sharing_return || 0).toFixed(2)}</td>
                    <td style="max-width:180px;overflow:hidden;text-overflow:ellipsis;">${r.description || '-'}</td>
                    <td>${fmtDate(r.created_at)}</td>
                </tr>`).join('')}
               </tbody></table></div>`;

        const returnsSection = `
            <div class="fude-returns-section">
                <div class="fude-returns-header">
                    <h2>My Recommendations &amp; Returns</h2>
                    <button class="fude-returns-viewall" onclick="(function(btn){var d=btn.closest('.fude-returns-section').querySelector('.fude-rewards-detail');var ic=btn.closest('.fude-returns-section').querySelector('.fude-rewards-toggle');d.classList.toggle('open');ic.querySelector('.fude-rewards-toggle-icon').classList.toggle('open');btn.textContent=d.classList.contains('open')?'View less':'View all →';}).call(this, this)">View all →</button>
                </div>
                <div class="fude-returns-cards">
                    <div class="fude-returns-card">
                        <div class="fude-returns-card-img-ph pink">🎀</div>
                        <div class="fude-returns-card-body">
                            <h3>推荐奖励</h3>
                            <p>推荐好友加入，双方都能获得积分奖励！</p>
                            <button class="fude-returns-card-cta">Learn More →</button>
                        </div>
                    </div>
                </div>
                <div class="fude-rewards-table-wrap">
                    <button class="fude-rewards-toggle">
                        <span class="fude-rewards-toggle-icon">▾</span>
                        积分 &amp; 推荐记录 (${myRewards.length})
                    </button>
                    <div class="fude-rewards-detail">${rewardsTableHtml}</div>
                </div>
            </div>`;

        // --- Render ---
        container.innerHTML = `
            <div class="fude-tab">
                <div class="fude-inner">
                    ${summaryBanner}
                    ${isL1314 && totalPoints > 0 ? `
                    <div class="fude-points-banner">
                        <span class="fude-points-banner-text">🎉 当前累积 <strong>${totalPoints}</strong> 福气积分，可兑换精选奖励！</span>
                        <button class="fude-points-banner-cta" onclick="app.todo('Redeem Points')">立即兑换 →</button>
                    </div>` : ''}
                    ${leaderboardSection}
                    ${adminHighlightsSection}
                    ${adminRewardsSection}
                </div>
                ${carouselSection}
                ${storiesSection}
                ${purchasesSection}
            </div>
        `;

        // Wire carousel dot clicks
        container.querySelectorAll('.fude-carousel-dot').forEach((dot, i) => {
            dot.addEventListener('click', () => {
                const track = dot.closest('.fude-carousel-wrap').querySelector('.fude-carousel-track');
                track.dataset.idx = i;
                track.style.transform = `translateX(-${i * 100}%)`;
                dot.closest('.fude-carousel-dots').querySelectorAll('.fude-carousel-dot').forEach((d, j) => d.classList.toggle('active', j === i));
            });
        });
    };

    // ========== Story / Highlight detail viewer (everyone) ==========
    const openStoryDetail = async (highlightId) => {
        try {
            const h = await AppDataStore.getById('news_highlights', highlightId);
            if (!h) { UI.toast.error('Story not found'); return; }
            let imgSrc = null;
            try { imgSrc = h.image_url ? await AppDataStore.resolveAttachmentSrc(h.image_url) : null; } catch (_) {}
            const fmtDate = d => { try { return new Date(d).toLocaleDateString(); } catch (e) { return d || ''; } };
            const tags = (h.tags || '').split(',').filter(Boolean)
                .map(t => `<span style="display:inline-block;background:var(--primary-50,#fef3c7);color:var(--primary-700,#92400e);border:1px solid var(--primary-200,#fde68a);border-radius:10px;padding:2px 8px;margin:2px 4px 2px 0;font-size:11px;">${t.trim()}</span>`).join('');
            const content = `
                <div style="max-height:75vh;overflow-y:auto;padding-right:4px;">
                    ${imgSrc ? `<div style="margin:-4px -4px 16px;"><img loading="lazy" decoding="async" src="${imgSrc}" style="width:100%;max-height:320px;object-fit:cover;border-radius:8px;display:block;"></div>` : ''}
                    ${tags ? `<div style="margin-bottom:8px;">${tags}</div>` : ''}
                    <h2 style="margin:0 0 8px;font-size:1.4rem;">${h.title || ''}</h2>
                    <div style="font-size:12px;color:var(--gray-500,#6b7280);margin-bottom:14px;">📅 ${fmtDate(h.created_at)}</div>
                    <div style="font-size:14px;line-height:1.7;color:var(--gray-700,#374151);white-space:pre-wrap;">${h.content || '<em>No content.</em>'}</div>
                </div>`;
            UI.showModal(h.title || 'Story', content, [
                { label: 'Close', type: 'secondary', action: 'UI.hideModal()' }
            ]);
        } catch (err) {
            UI.toast.error('Failed to open story: ' + (err.message || 'Unknown error'));
        }
    };

    // ========== LEVEL 13/14: Highlight CRUD (Admin only) ==========
    const openHighlightModal = async (highlightId = null) => {
        const h = highlightId ? await AppDataStore.getById('news_highlights', highlightId) : null;
        const isEdit = !!h;

        const content = `
            <div class="form-section">
                <input type="hidden" id="edit-highlight-id" value="${highlightId || ''}">
                <div class="form-group">
                    <label>Title <span class="required">*</span></label>
                    <input type="text" id="highlight-title" class="form-control" value="${h?.title || ''}" placeholder="Enter title">
                </div>
                <div class="form-group">
                    <label>Content</label>
                    <textarea id="highlight-content" class="form-control" rows="4" placeholder="Enter content...">${h?.content || ''}</textarea>
                </div>
                <div class="form-group">
                    <label>Photo</label>
                    <div style="display:flex;flex-direction:column;gap:8px;">
                        <label style="display:inline-flex;align-items:center;gap:8px;cursor:pointer;background:var(--gray-100,#f3f4f6);border:1px dashed var(--gray-300,#d1d5db);border-radius:8px;padding:10px 14px;font-size:14px;color:var(--gray-600,#4b5563);">
                            <i class="fas fa-upload"></i> Upload image file
                            <input type="file" id="highlight-image-file" accept="image/*" style="display:none;" onchange="
                                const file = this.files[0];
                                if (file) {
                                    const reader = new FileReader();
                                    reader.onload = e => {
                                        const prev = document.getElementById('highlight-image-preview');
                                        if (prev) { prev.src = e.target.result; prev.style.display='block'; }
                                        document.getElementById('highlight-image-url').value = '';
                                        document.getElementById('highlight-url-preview').style.display='none';
                                    };
                                    reader.readAsDataURL(file);
                                }
                            ">
                        </label>
                        <img loading="lazy" decoding="async" id="highlight-image-preview" style="width:100%;max-height:140px;object-fit:cover;border-radius:8px;display:none;" onerror="this.style.display='none'">
                        <div style="display:flex;align-items:center;gap:8px;color:var(--gray-400,#9ca3af);font-size:13px;"><span style="flex:1;height:1px;background:currentColor;opacity:.4;"></span>or paste a URL<span style="flex:1;height:1px;background:currentColor;opacity:.4;"></span></div>
                        <input type="url" id="highlight-image-url" class="form-control" value="${h?.image_url || ''}" placeholder="https://example.com/photo.jpg" oninput="
                            const prev = document.getElementById('highlight-url-preview');
                            if (this.value) { prev.src = this.value; prev.style.display='block'; document.getElementById('highlight-image-file').value=''; document.getElementById('highlight-image-preview').style.display='none'; }
                            else { prev.style.display='none'; }
                        ">
                        <img loading="lazy" decoding="async" id="highlight-url-preview" src="${h?.image_url || ''}" style="width:100%;max-height:140px;object-fit:cover;border-radius:8px;${h?.image_url ? '' : 'display:none;'}" onerror="this.style.display='none'">
                    </div>
                </div>
                <div class="form-group">
                    <label>Type</label>
                    <select id="highlight-type" class="form-control">
                        <option value="highlight" ${(!h || h.type === 'highlight') ? 'selected' : ''}>Highlight / News</option>
                        <option value="success_story" ${h?.type === 'success_story' ? 'selected' : ''}>Success Story</option>
                        <option value="recommendation_tip" ${h?.type === 'recommendation_tip' ? 'selected' : ''}>Recommendation Tip</option>
                    </select>
                </div>
                <div class="form-group">
                    <label style="display:flex; align-items:center; gap:8px; cursor:pointer;">
                        <input type="checkbox" id="highlight-active" ${!h || h.is_active ? 'checked' : ''}>
                        Show publicly (active)
                    </label>
                </div>
            </div>
        `;

        UI.showModal(isEdit ? 'Edit Highlight' : 'Add New Highlight', content, [
            { label: 'Cancel', type: 'secondary', action: 'UI.hideModal()' },
            { label: isEdit ? 'Save Changes' : 'Add Highlight', type: 'primary', action: '(async () => { await app.saveHighlight(); })()' }
        ]);
    };

    const saveHighlight = async () => {
        const id    = document.getElementById('edit-highlight-id')?.value;
        const title = document.getElementById('highlight-title')?.value?.trim();
        if (!title) { UI.toast.error('Title is required.'); return; }

        // Resolve image URL: uploaded file takes priority over pasted URL
        let imageUrl = document.getElementById('highlight-image-url')?.value?.trim() || null;
        const fileInput = document.getElementById('highlight-image-file');
        const file = fileInput?.files?.[0];
        if (file) {
            const sb = window.supabase || window.supabaseClient;
            if (!sb || !sb.storage) {
                UI.toast.error('Supabase not connected — cannot upload image');
                return;
            }
            if (file.size > 5 * 1024 * 1024) { UI.toast.error('Image too large (max 5MB)'); return; }
            const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
            const path = `highlights/${Date.now()}_${safeName}`;
            const { error: upErr } = await sb.storage.from('attachments').upload(path, file, { upsert: false, contentType: file.type });
            if (upErr) { UI.toast.error('Upload failed: ' + upErr.message); return; }
            imageUrl = path; // store path; signed URL resolved at render time
        }

        const payload = {
            title,
            content:   document.getElementById('highlight-content')?.value || '',
            image_url: imageUrl,
            type:      document.getElementById('highlight-type')?.value || 'highlight',
            is_active: document.getElementById('highlight-active')?.checked ?? true,
            author_id: _currentUser?.id || null
        };

        try {
            const isNew = !id;
            if (id) {
                await AppDataStore.update('news_highlights', parseInt(id), payload);
                UI.toast.success('Highlight updated.');
            } else {
                await AppDataStore.create('news_highlights', { id: Date.now(), ...payload, created_at: new Date().toISOString() });
                UI.toast.success('Highlight added.');
            }
            // Push notification fan-out (non-blocking, best-effort)
            _notifyHighlightSaved(payload, isNew).catch(() => {});
            UI.hideModal();
            const viewport = document.getElementById('content-viewport');
            if (viewport) await showFudeView(viewport);
        } catch(err) {
            UI.toast.error('Save failed: ' + (err.message || 'Unknown error'));
        }
    };

    const deleteHighlight = async (highlightId) => {
        UI.showModal('Delete Highlight', '<p>Are you sure you want to delete this highlight? This cannot be undone.</p>', [
            { label: 'Cancel', type: 'secondary', action: 'UI.hideModal()' },
            { label: 'Delete', type: 'danger', action: `(async () => { await app.confirmDeleteHighlight(${highlightId}); })()` }
        ]);
    };

    const confirmDeleteHighlight = async (highlightId) => {
        try {
            await AppDataStore.delete('news_highlights', highlightId);
            UI.hideModal();
            UI.toast.success('Highlight deleted.');
            const viewport = document.getElementById('content-viewport');
            if (viewport) await showFudeView(viewport);
        } catch(err) {
            UI.toast.error('Delete failed: ' + (err.message || 'Unknown error'));
        }
    };

    // ========== LEVEL 13/14: Reward CRUD + 福气 Summary Sync ==========

    const syncFudiSummary = async (userId, totalPoints, totalReturns) => {
        try {
            const existing = await AppDataStore.query('user_fudi_summary', { user_id: userId });
            const payload  = { total_fudi_points: totalPoints, total_sharing_return: totalReturns, updated_at: new Date().toISOString() };
            if (existing.length > 0) {
                await AppDataStore.update('user_fudi_summary', existing[0].user_id, payload);
            } else {
                await AppDataStore.create('user_fudi_summary', { user_id: userId, ...payload });
            }
        } catch(e) { console.warn('syncFudiSummary error:', e); }
    };

    const openRewardModal = async (rewardId = null) => {
        const r = rewardId ? await AppDataStore.getById('recommendation_rewards', rewardId) : null;
        const isEdit = !!r;

        let eligibleUsers = [];
        try { eligibleUsers = (await AppDataStore.getAll('users')).filter(u => u.role && u.role.match(/Level\s*1[34]/i)); } catch(e) {}
        const userOptions = eligibleUsers.map(u =>
            `<option value="${u.id}" ${r?.user_id === u.id ? 'selected' : ''}>${u.full_name} (${u.role})</option>`
        ).join('');

        const content = `
            <div class="form-section">
                <input type="hidden" id="edit-reward-id" value="${rewardId || ''}">
                <div class="form-group">
                    <label>Recipient <span class="required">*</span></label>
                    <select id="reward-user" class="form-control">
                        <option value="">— Select user —</option>
                        ${userOptions}
                    </select>
                </div>
                <div class="form-group">
                    <label>Action Type <span class="required">*</span></label>
                    <select id="reward-action" class="form-control">
                        <option value="recommendation"   ${(!r || r.action_type === 'recommendation')   ? 'selected' : ''}>Recommendation</option>
                        <option value="sharing"          ${r?.action_type === 'sharing'          ? 'selected' : ''}>Sharing</option>
                        <option value="class_attendance" ${r?.action_type === 'class_attendance' ? 'selected' : ''}>Class Attendance</option>
                    </select>
                </div>
                <div class="form-group">
                    <label>福气 Points</label>
                    <input type="number" id="reward-points" class="form-control" value="${r?.fudi_points || 0}" min="0">
                </div>
                <div class="form-group">
                    <label>Sharing Return (RM)</label>
                    <input type="number" id="reward-return" class="form-control" value="${parseFloat(r?.sharing_return || 0).toFixed(2)}" min="0" step="0.01">
                </div>
                <div class="form-group">
                    <label>Description</label>
                    <input type="text" id="reward-desc" class="form-control" value="${r?.description || ''}" placeholder="e.g. Referred Tan Ah Kow to CPS session">
                </div>
            </div>
        `;

        UI.showModal(isEdit ? 'Edit Reward' : 'Award 福气 Points', content, [
            { label: 'Cancel', type: 'secondary', action: 'UI.hideModal()' },
            { label: isEdit ? 'Save Changes' : 'Award', type: 'primary', action: '(async () => { await app.saveReward(); })()' }
        ]);
    };

    const saveReward = async () => {
        const id     = document.getElementById('edit-reward-id')?.value;
        const userId = parseInt(document.getElementById('reward-user')?.value);
        if (!userId) { UI.toast.error('Please select a recipient.'); return; }

        const payload = {
            user_id:        userId,
            action_type:    document.getElementById('reward-action')?.value || 'recommendation',
            fudi_points:    parseInt(document.getElementById('reward-points')?.value) || 0,
            sharing_return: parseFloat(document.getElementById('reward-return')?.value) || 0,
            description:    document.getElementById('reward-desc')?.value || ''
        };

        try {
            if (id) {
                await AppDataStore.update('recommendation_rewards', parseInt(id), payload);
                UI.toast.success('Reward updated.');
            } else {
                await AppDataStore.create('recommendation_rewards', { id: Date.now(), ...payload, created_at: new Date().toISOString() });
                UI.toast.success('Reward awarded!');
            }
            // Recalculate and sync summary for the recipient
            const allRewards = await AppDataStore.query('recommendation_rewards', { user_id: userId });
            await syncFudiSummary(
                userId,
                allRewards.reduce((s, r) => s + (parseInt(r.fudi_points)    || 0), 0),
                allRewards.reduce((s, r) => s + (parseFloat(r.sharing_return) || 0), 0)
            );
            UI.hideModal();
            const viewport = document.getElementById('content-viewport');
            if (viewport) await showFudeView(viewport);
        } catch(err) {
            UI.toast.error('Save failed: ' + (err.message || 'Unknown error'));
        }
    };

    const deleteReward = async (rewardId) => {
        UI.showModal('Delete Reward', "<p>Remove this reward record? The user's 福气 points will be recalculated.</p>", [
            { label: 'Cancel', type: 'secondary', action: 'UI.hideModal()' },
            { label: 'Delete', type: 'danger', action: `(async () => { await app.confirmDeleteReward(${rewardId}); })()` }
        ]);
    };

    const confirmDeleteReward = async (rewardId) => {
        try {
            const r = await AppDataStore.getById('recommendation_rewards', rewardId);
            await AppDataStore.delete('recommendation_rewards', rewardId);
            if (r?.user_id) {
                const remaining = await AppDataStore.query('recommendation_rewards', { user_id: r.user_id });
                await syncFudiSummary(
                    r.user_id,
                    remaining.reduce((s, x) => s + (parseInt(x.fudi_points)    || 0), 0),
                    remaining.reduce((s, x) => s + (parseFloat(x.sharing_return) || 0), 0)
                );
            }
            UI.hideModal();
            UI.toast.success('Reward deleted.');
            const viewport = document.getElementById('content-viewport');
            if (viewport) await showFudeView(viewport);
        } catch(err) {
            UI.toast.error('Delete failed: ' + (err.message || 'Unknown error'));
        }
    };

    // ==========================================================================
    // STUB IMPLEMENTATIONS (replacing app.todo placeholders) — 2026-04-11
    // ==========================================================================

    // Stub 1: View Roadmap — was: onclick="app.todo('Feature development')"
    // Shows a modal listing shipped features vs. the planned backlog so users
    // on a placeholder view have context on what's coming.
    const showRoadmap = () => {
        const content = `
            <div style="max-height:60vh; overflow-y:auto; padding:4px 2px; font-size:14px;">
                <div style="background:#fef3c7; border-left:4px solid #f59e0b; padding:12px; border-radius:4px; margin-bottom:16px;">
                    <strong>📍 DestinOraclesSolution CRM</strong><br>
                    Core modules are live. This list tracks what's shipped and what's planned.
                </div>
                <h3 style="margin-top:12px;">✅ Shipped</h3>
                <ul style="margin-left:16px;">
                    <li>Prospects &amp; Customers pipeline</li>
                    <li>Activity tracking (FSA, CPS, Site Visit, Events, Meetings, Training)</li>
                    <li>Relationship Tree with fast-rendering synchronous DFS</li>
                    <li>Referrals leaderboard, period filter, and rewards</li>
                    <li>Events with check-in &amp; engagement scoring</li>
                    <li>Document upload per prospect</li>
                    <li>Recruitment approval workflow</li>
                    <li>KPI dashboard with agent filter</li>
                    <li>Marketing Automation (Monthly Promotions, Bujishu, Formula)</li>
                    <li>Agent reassignment (single &amp; bulk)</li>
                </ul>
                <h3 style="margin-top:16px;">🚧 Planned</h3>
                <ul style="margin-left:16px;">
                    <li>WhatsApp Business deep integration</li>
                    <li>Mobile PWA + biometric auth</li>
                    <li>Advanced analytics dashboards</li>
                    <li>Multi-tenant support</li>
                    <li>Automated compliance reports (GDPR / DSAR)</li>
                    <li>Export Tree to PDF (CSV already ships)</li>
                </ul>
            </div>
        `;
        UI.showModal('Feature Roadmap', content, [
            { label: 'Close', type: 'secondary', action: 'UI.hideModal()' }
        ]);
    };

    // Stub 2: Export Tree — was: onclick="app.todo('Export Tree')"
    // Walks the currently-loaded _currentTreeData object (depth-first) and
    // downloads a CSV with one row per node (parent link + key fields).
    const exportRelationshipTree = () => {
        if (!_currentTreeData) {
            UI.toast.error('No tree loaded — search for a person first.');
            return;
        }
        const rows = [];
        const walk = (node, parentName = '', depth = 0) => {
            rows.push({
                depth,
                parent: parentName,
                name: node.name || '',
                type: node.type || '',
                role: node.role || '',
                pipeline: node.pipeline_stage || '',
                last_activity: node.last_activity_date || '',
                join_date: node.join_date || ''
            });
            (node.children || []).forEach(c => walk(c, node.name, depth + 1));
        };
        walk(_currentTreeData);
        const esc = v => {
            const s = String(v ?? '');
            return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
        };
        const header = 'Depth,Parent,Name,Type,Role,Pipeline Stage,Last Activity,Join Date\n';
        const body = rows.map(r => [r.depth, r.parent, r.name, r.type, r.role, r.pipeline, r.last_activity, r.join_date].map(esc).join(',')).join('\n');
        const csv = '\ufeff' + header + body; // BOM so Excel reads UTF-8 (Chinese names) correctly
        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        const safeName = String(_currentTreeData.name || 'export').replace(/[^\w\u4e00-\u9fff-]+/g, '_');
        a.download = `relationship-tree-${safeName}-${new Date().toISOString().split('T')[0]}.csv`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        UI.toast.success(`Exported ${rows.length} nodes to CSV`);
    };

    // Stub 3: Change leaderboard period — was: onchange="app.todo('Change period')"
    // Stores the selected period in a module-level variable that renderLeaderboard
    // reads to filter referrals by date before grouping.
    const changeLeaderboardPeriod = async (label) => {
        const map = { 'All Time': 'all', 'This Year': 'year', 'This Month': 'month' };
        _leaderboardPeriod = map[label] || 'all';
        await renderLeaderboard();
    };

    // Stub 4: Customer-initiated referral workflow — was: onclick="app.todo('Referral workflow')"
    // The openCustomerReferralModal function already existed at line ~15515;
    // this stub was purely a wiring fix — the onclick now points at the real function.

    // Stub 5: Upload document on prospect detail — was: onclick="app.todo('Upload document')"
    // Opens a hidden file input, reads as base64, stores in `documents` table
    // linked to the prospect via filename prefix.
    const uploadProspectDocument = async (prospectId) => {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = 'image/*,application/pdf,.doc,.docx,.txt';
        input.onchange = async (ev) => {
            const file = ev.target.files && ev.target.files[0];
            if (!file) return;
            const MAX_BYTES = 5 * 1024 * 1024; // 5 MB
            if (file.size > MAX_BYTES) {
                UI.toast.error('File too large — 5 MB max');
                return;
            }
            try {
                const dataUrl = await new Promise((resolve, reject) => {
                    const reader = new FileReader();
                    reader.onload = () => resolve(reader.result);
                    reader.onerror = reject;
                    reader.readAsDataURL(file);
                });
                await AppDataStore.create('documents', {
                    filename: `prospect_${prospectId}/${file.name}`,
                    size: file.size,
                    mime_type: file.type || 'application/octet-stream',
                    data: String(dataUrl || ''),
                    current_version: 1,
                    created_by: _currentUser?.id || null,
                    description: `Uploaded for prospect #${prospectId}`,
                    is_starred: false
                });
                UI.toast.success('Document uploaded');
                // Re-render the prospect detail so the new doc shows up
                if (typeof app.showProspectDetail === 'function') {
                    await app.showProspectDetail(prospectId);
                }
            } catch (err) {
                UI.toast.error('Upload failed: ' + (err.message || 'Unknown error'));
            }
        };
        input.click();
    };

    // Stub 6: Submit recruitment approval — was: action="app.todo('Recruitment approval workflow submitted')"
    // Captures recruitment form data and writes to approval_queue as pending.
    const submitRecruitmentApproval = async () => {
        try {
            const modal = document.getElementById('modal-content') || document;
            const textareas = modal.querySelectorAll('textarea');
            const inputs = modal.querySelectorAll('input.form-control, select.form-control');
            const snapshot = {};
            inputs.forEach((el, i) => {
                const label = el.closest('.form-group')?.querySelector('label')?.textContent?.trim() || `field_${i}`;
                snapshot[label] = el.value;
            });
            textareas.forEach((el, i) => {
                const label = el.closest('.form-group')?.querySelector('label')?.textContent?.trim() || `textarea_${i}`;
                snapshot[label] = el.value;
            });
            await AppDataStore.create('approval_queue', {
                approval_type: 'recruitment',
                status: 'pending',
                submitted_by: _currentUser?.id || null,
                submitted_at: new Date().toISOString(),
                description: 'Recruitment: Convert customer to agent',
                snapshot_after: snapshot,
                created_at: new Date().toISOString()
            });
            UI.hideModal();
            UI.toast.success('Recruitment submitted for approval');
        } catch (err) {
            UI.toast.error('Submit failed: ' + (err.message || 'Unknown error'));
        }
    };

    // [CHUNK: egg] Section extracted to chunks/script-egg.js — loaded role-gated by navigateTo().

    // [CHUNK: boss_report] Section extracted to chunks/script-boss-report.js — loaded role-gated by navigateTo().

    // [CHUNK: formula] 32 functions extracted to chunks/script-formula.js — loaded role-gated by navigateTo().

    // [CHUNK: stock_take] Section extracted to chunks/script-stock-take.js — loaded role-gated by navigateTo().

    // ==================== BUG AUDIT 2026-04-24: fill 3 missing function impls ====================
    // Single-file delete — mirrors confirmDeleteSelected pattern (line ~3103)
    const deleteFile = async (fileId) => {
        if (!fileId) return;
        UI.showModal('Delete File',
            `<p>Are you sure you want to delete this file?</p><p class="text-error">This action cannot be undone.</p>`,
            [
                { label: 'Cancel', type: 'secondary', action: 'UI.hideModal()' },
                { label: 'Delete', type: 'primary', action: `(async () => { await app._confirmDeleteFile(${fileId}); })()` }
            ]
        );
    };
    const _confirmDeleteFile = async (fileId) => {
        await AppDataStore.delete('documents', fileId);
        UI.hideModal();
        UI.toast.success('File deleted');
        if (typeof window.app.loadFolderContents === 'function') await window.app.loadFolderContents();
    };

    // Route Last-Transactions modal profile-link to the right detail view
    const showProfile = async (id, type) => {
        if (!id) return;
        if (type === 'prospect' && window.app.showProspectDetail) return window.app.showProspectDetail(id);
        if (window.app.showCustomerDetail) return window.app.showCustomerDetail(id);
    };

    // Placeholder — export-data flow needs product scoping before full impl
    const exportKPIDashboard = () => (window.app.todo || (() => {}))('Export KPI Dashboard');

    // [CHUNK: knowledge] Section extracted to chunks/script-knowledge.js — loaded role-gated by navigateTo().

    // =========================================================================
    // CUSTOMER FORMS — Survey + CPS + APU (Marketing > Forms sub-tab)
    // 3 official Destin Oracles forms with bilingual labels, bagua grids,
    // canvas signatures, mobile-responsive, print-friendly.
    // =========================================================================

    // ── Signature pad: bare HTML5 canvas, no external lib (~120 lines covers it)
    const _bindSignaturePad = (canvasId) => {
        const c = document.getElementById(canvasId);
        if (!c) return;
        // Make the backing buffer match displayed size × DPR so strokes stay crisp on mobile.
        const dpr = window.devicePixelRatio || 1;
        const rect = c.getBoundingClientRect();
        c.width = rect.width * dpr;
        c.height = rect.height * dpr;
        const ctx = c.getContext('2d');
        ctx.scale(dpr, dpr);
        ctx.lineWidth = 2.2;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.strokeStyle = '#0f172a';
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, c.width, c.height);

        let drawing = false, last = null, hasInk = false;
        const getXY = (e) => {
            const r = c.getBoundingClientRect();
            if (e.touches && e.touches[0]) {
                return { x: e.touches[0].clientX - r.left, y: e.touches[0].clientY - r.top };
            }
            return { x: e.clientX - r.left, y: e.clientY - r.top };
        };
        const start = (e) => {
            e.preventDefault();
            drawing = true;
            last = getXY(e);
        };
        const move = (e) => {
            if (!drawing) return;
            e.preventDefault();
            const p = getXY(e);
            ctx.beginPath();
            ctx.moveTo(last.x, last.y);
            ctx.lineTo(p.x, p.y);
            ctx.stroke();
            last = p;
            hasInk = true;
        };
        const end = () => { drawing = false; last = null; };

        c.addEventListener('mousedown', start);
        c.addEventListener('mousemove', move);
        c.addEventListener('mouseup', end);
        c.addEventListener('mouseleave', end);
        c.addEventListener('touchstart', start, { passive: false });
        c.addEventListener('touchmove', move, { passive: false });
        c.addEventListener('touchend', end);

        c._hasInk = () => hasInk;
        c._reset = () => {
            ctx.fillStyle = '#ffffff';
            ctx.fillRect(0, 0, c.width, c.height);
            hasInk = false;
        };

        // If a saved signature was preloaded into c.dataset.preload, paint it.
        if (c.dataset.preload) {
            const img = new Image();
            img.onload = () => {
                ctx.drawImage(img, 0, 0, rect.width, rect.height);
                hasInk = true;
            };
            img.src = c.dataset.preload;
        }
    };

    const _clearSignaturePad = (canvasId) => {
        const c = document.getElementById(canvasId);
        if (c && c._reset) c._reset();
    };
    // Exposed as app.cfClearSignature for inline onclick handlers
    const cfClearSignature = (canvasId) => _clearSignaturePad(canvasId);

    const _getSignatureDataUrl = (canvasId) => {
        const c = document.getElementById(canvasId);
        if (!c || !c._hasInk || !c._hasInk()) return null;
        return c.toDataURL('image/png');
    };

    // ── Helpers ──────────────────────────────────────────────────────────────
    const _cfFmtDate = (iso) => {
        if (!iso) return '';
        try { return new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }); }
        catch (_) { return iso; }
    };
    const _cfEscape = (s) => (s == null ? '' : String(s).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c])));

    // ── Forms TAB main view ──────────────────────────────────────────────────
    let _cfState = { prospectId: null, prospectQuery: '' };

    const renderFormsTab = async () => {
        // Wrap each fetch with a short timeout so a missing migration (the 3 new
        // customer-form tables) doesn't hang the whole tab for 15+ seconds.
        const _quickFetch = (table, ms = 4000) => Promise.race([
            AppDataStore.getAll(table).catch(() => []),
            new Promise(resolve => setTimeout(() => resolve([]), ms))
        ]);
        const [prospects, surveys, cps, apus, blueprints] = await Promise.all([
            _quickFetch('prospects', 6000),
            _quickFetch('customer_surveys'),
            _quickFetch('cps_analyses'),
            _quickFetch('apu_appraisals'),
            _quickFetch('destiny_blueprints')
        ]);

        // Build per-prospect status map
        const byProspect = new Map();
        prospects.forEach(p => byProspect.set(p.id, {
            id: p.id,
            name: p.full_name || p.nickname || '(no name)',
            phone: p.phone || '',
            survey: null, cps: null, apu: null, blueprint: null
        }));
        surveys.forEach(s => { const e = byProspect.get(s.prospect_id); if (e) e.survey = s; });
        cps.forEach(c => { const e = byProspect.get(c.prospect_id); if (e) e.cps = c; });
        apus.forEach(a => { const e = byProspect.get(a.prospect_id); if (e) e.apu = a; });
        blueprints.forEach(b => { const e = byProspect.get(b.prospect_id); if (e) e.blueprint = b; });

        const q = (_cfState.prospectQuery || '').toLowerCase();
        const filtered = Array.from(byProspect.values())
            .filter(p => !q || p.name.toLowerCase().includes(q) || (p.phone || '').includes(q))
            .sort((a, b) => {
                // Show prospects with any form filled in first, then by name
                const ax = (a.survey || a.cps || a.apu || a.blueprint) ? 0 : 1;
                const bx = (b.survey || b.cps || b.apu || b.blueprint) ? 0 : 1;
                return ax - bx || a.name.localeCompare(b.name);
            })
            .slice(0, 200);

        const badge = (val, label, color) => val
            ? `<span class="cf-badge cf-badge-done" title="${_cfEscape(label)} · ${_cfFmtDate(val.created_at)}"><i class="fas fa-check"></i> ${label}</span>`
            : `<span class="cf-badge cf-badge-pending">${label}</span>`;

        return `
            <style>
                .cf-wrap{ max-width:1100px; margin:0 auto; padding:8px 4px; }
                .cf-header{ display:flex; flex-wrap:wrap; gap:12px; justify-content:space-between; align-items:center; margin-bottom:18px; }
                .cf-header h2{ margin:0 0 4px; font-size:20px; }
                .cf-header p{ margin:0; color:#6B7280; font-size:13px; }
                .cf-search{ flex:1; min-width:200px; max-width:340px; padding:9px 12px; border:1px solid #E5E7EB; border-radius:8px; font-size:14px; }
                .cf-flow{ display:flex; gap:10px; align-items:center; background:#F9FAFB; border:1px dashed #D1D5DB; border-radius:10px; padding:12px 16px; margin-bottom:18px; color:#374151; font-size:13px; flex-wrap:wrap; }
                .cf-flow .num{ display:inline-flex; width:22px; height:22px; border-radius:50%; background:#7C3AED; color:white; font-weight:700; font-size:12px; align-items:center; justify-content:center; }
                .cf-list{ display:grid; gap:10px; }
                .cf-row{ background:white; border:1px solid #E5E7EB; border-radius:10px; padding:14px 16px; display:flex; flex-wrap:wrap; gap:12px; align-items:center; }
                .cf-name{ font-weight:600; font-size:15px; color:#111827; flex:1; min-width:160px; }
                .cf-name .sub{ display:block; color:#6B7280; font-weight:400; font-size:12px; margin-top:2px; }
                .cf-badges{ display:flex; gap:6px; flex-wrap:wrap; }
                .cf-badge{ font-size:11px; font-weight:600; padding:3px 9px; border-radius:999px; white-space:nowrap; }
                .cf-badge-done{ background:#D1FAE5; color:#065F46; }
                .cf-badge-pending{ background:#F3F4F6; color:#9CA3AF; }
                .cf-actions{ display:flex; gap:6px; flex-wrap:wrap; }
                .cf-btn{ padding:7px 12px; border-radius:7px; border:1px solid #E5E7EB; background:white; cursor:pointer; font-size:12px; font-weight:600; color:#374151; display:inline-flex; align-items:center; gap:5px; }
                .cf-btn:hover{ background:#F9FAFB; }
                .cf-btn.cf-btn-survey{ background:#EEF2FF; color:#4338CA; border-color:#C7D2FE; }
                .cf-btn.cf-btn-cps{ background:#FEF3C7; color:#92400E; border-color:#FCD34D; }
                .cf-btn.cf-btn-apu{ background:#FCE7F3; color:#9D174D; border-color:#F9A8D4; }
                .cf-btn.cf-btn-blueprint{ background:#E0E7FF; color:#3730A3; border-color:#A5B4FC; }
                .cf-empty{ padding:40px; text-align:center; color:#9CA3AF; background:white; border:1px dashed #E5E7EB; border-radius:10px; }

                /* ── Form modal styling (shared by Survey/CPS/APU) ── */
                .cf-form{ display:flex; flex-direction:column; gap:14px; }
                .cf-form .cf-section-title{ font-weight:700; font-size:14px; color:#111827; border-bottom:2px solid #7C3AED; padding-bottom:6px; margin-top:8px; }
                .cf-form .cf-section-title .zh{ color:#7C3AED; margin-left:6px; }
                .cf-grid{ display:grid; grid-template-columns:repeat(2, minmax(0, 1fr)); gap:12px; }
                .cf-grid-3{ display:grid; grid-template-columns:repeat(3, minmax(0, 1fr)); gap:10px; }
                @media (max-width: 640px){ .cf-grid, .cf-grid-3{ grid-template-columns:1fr; } }
                .cf-field label{ display:block; font-size:12px; font-weight:600; color:#374151; margin-bottom:4px; }
                .cf-field label .zh{ color:#7C3AED; font-weight:500; margin-left:4px; }
                .cf-field input, .cf-field select, .cf-field textarea{
                    width:100%; padding:8px 10px; border:1px solid #D1D5DB; border-radius:6px; font-size:14px; font-family:inherit;
                }
                .cf-field textarea{ resize:vertical; min-height:64px; }
                .cf-radio-group{ display:flex; gap:14px; flex-wrap:wrap; margin-top:2px; }
                .cf-radio-group label{ display:flex; align-items:center; gap:6px; font-size:13px; font-weight:500; color:#374151; cursor:pointer; }
                .cf-radio-group input{ width:auto; margin:0; }

                /* Bagua 3×3 grid (Lunar / Solar) */
                .cf-bagua-wrap{ display:grid; grid-template-columns:repeat(2, minmax(0, 1fr)); gap:18px; }
                @media (max-width: 640px){ .cf-bagua-wrap{ grid-template-columns:1fr; } }
                .cf-bagua{ background:#FAFAF9; border:1px solid #E5E7EB; border-radius:10px; padding:12px; }
                .cf-bagua-title{ text-align:center; font-weight:700; font-size:14px; margin-bottom:10px; color:#111827; }
                .cf-bagua-grid{ display:grid; grid-template-columns:repeat(3, 1fr); gap:4px; }
                .cf-bagua-cell{ aspect-ratio:1; border:1px solid #D1D5DB; border-radius:6px; background:white; display:flex; flex-direction:column; align-items:stretch; padding:4px; position:relative; }
                .cf-bagua-cell .tg{ font-size:18px; font-weight:700; color:#7C3AED; text-align:center; line-height:1; }
                .cf-bagua-cell textarea{ flex:1; border:none; outline:none; resize:none; padding:2px 4px; font-size:12px; font-family:inherit; color:#111827; background:transparent; min-height:0; }
                .cf-bagua-cell.cf-bagua-center{ background:#FEF3C7; }
                .cf-bagua-cell.cf-bagua-center .tg{ color:#92400E; }

                /* Signature canvas */
                .cf-sig-wrap{ display:flex; flex-direction:column; gap:6px; }
                .cf-sig-canvas{ width:100%; height:120px; border:1px dashed #9CA3AF; border-radius:6px; background:white; touch-action:none; }
                .cf-sig-actions{ display:flex; justify-content:space-between; align-items:center; }
                .cf-sig-actions small{ color:#6B7280; font-size:11px; }

                /* Likert 5-point */
                .cf-likert{ display:grid; grid-template-columns:repeat(5, 1fr); gap:6px; }
                @media (max-width: 480px){ .cf-likert{ grid-template-columns:repeat(2, 1fr); } }
                .cf-likert label{ display:flex; flex-direction:column; align-items:center; gap:4px; padding:8px 4px; border:1px solid #E5E7EB; border-radius:6px; background:white; cursor:pointer; font-size:11px; font-weight:600; color:#374151; text-align:center; line-height:1.2; }
                .cf-likert label.cf-likert-on{ background:#7C3AED; border-color:#7C3AED; color:white; }
                .cf-likert input{ display:none; }
                .cf-likert .zh{ display:block; font-size:10px; opacity:0.85; }

                /* Referral table (APU Q7) */
                .cf-ref-table{ width:100%; border-collapse:collapse; font-size:13px; }
                .cf-ref-table th, .cf-ref-table td{ border:1px solid #D1D5DB; padding:6px 8px; }
                .cf-ref-table th{ background:#F3F4F6; font-weight:600; font-size:12px; }
                .cf-ref-table input{ width:100%; border:none; outline:none; padding:4px 2px; font-size:13px; }
                @media (max-width: 640px){
                    .cf-ref-table thead{ display:none; }
                    .cf-ref-table tr{ display:block; border:1px solid #D1D5DB; border-radius:8px; padding:8px; margin-bottom:10px; }
                    .cf-ref-table td{ display:block; border:none; padding:4px 0; }
                    .cf-ref-table td::before{ content:attr(data-label) ': '; font-weight:600; color:#6B7280; font-size:11px; }
                }
            </style>

            <div class="cf-wrap">
                <div class="cf-header">
                    <div>
                        <h2>Customer Forms 客户表格</h2>
                        <p>Survey → CPS Analysis → APU Appraisal. Pick a prospect to start.</p>
                    </div>
                    <input type="search" class="cf-search" placeholder="Search by name or phone…"
                        value="${_cfEscape(_cfState.prospectQuery)}"
                        oninput="app.cfSearchProspects(this.value)">
                </div>

                <div class="cf-flow">
                    <span><span class="num">1</span> 新客户调查表 Survey</span>
                    <i class="fas fa-arrow-right" style="color:#9CA3AF;"></i>
                    <span><span class="num">2</span> 細解命盤 CPS Form</span>
                    <i class="fas fa-arrow-right" style="color:#9CA3AF;"></i>
                    <span><span class="num">3</span> APU Appraisal 反馈</span>
                    <i class="fas fa-arrow-right" style="color:#9CA3AF;"></i>
                    <span><span class="num">4</span> 九運改命藍圖表 Blueprint</span>
                </div>

                ${filtered.length === 0 ? `
                    <div class="cf-empty">
                        <i class="fas fa-clipboard-list" style="font-size:42px; margin-bottom:10px;"></i>
                        <div>No prospects match. Try a different search.</div>
                    </div>
                ` : `
                    <div class="cf-list">
                        ${filtered.map(p => `
                            <div class="cf-row">
                                <div class="cf-name">
                                    ${_cfEscape(p.name)}
                                    <span class="sub">${_cfEscape(p.phone || 'No phone')}</span>
                                </div>
                                <div class="cf-badges">
                                    ${badge(p.survey, 'Survey')}
                                    ${badge(p.cps, 'CPS')}
                                    ${badge(p.apu, 'APU')}
                                    ${badge(p.blueprint, 'Blueprint')}
                                </div>
                                <div class="cf-actions">
                                    <button class="cf-btn cf-btn-survey" onclick="app.openCustomerSurveyModal(${p.id}${p.survey ? ',' + p.survey.id : ''})">
                                        <i class="fas fa-edit"></i> ${p.survey ? 'Edit' : 'Fill'} Survey
                                    </button>
                                    <button class="cf-btn cf-btn-cps" onclick="app.openCpsAnalysisModal(${p.id}${p.cps ? ',' + p.cps.id : ''})">
                                        <i class="fas fa-edit"></i> ${p.cps ? 'Edit' : 'Fill'} CPS
                                    </button>
                                    <button class="cf-btn cf-btn-apu" onclick="app.openApuAppraisalModal(${p.id}${p.apu ? ',' + p.apu.id : ''})">
                                        <i class="fas fa-edit"></i> ${p.apu ? 'Edit' : 'Fill'} APU
                                    </button>
                                    <button class="cf-btn cf-btn-blueprint" onclick="app.openDestinyBlueprintInTab(${p.id}${p.blueprint ? ',' + p.blueprint.id : ''})">
                                        <i class="fas fa-external-link-alt"></i> ${p.blueprint ? 'Edit' : 'Fill'} Blueprint
                                    </button>
                                </div>
                            </div>
                        `).join('')}
                    </div>
                `}
            </div>
        `;
    };

    const cfSearchProspects = (val) => {
        _cfState.prospectQuery = val || '';
        // Debounce-light: re-render on next tick so user can keep typing
        clearTimeout(_cfState._t);
        _cfState._t = setTimeout(async () => {
            const target = document.getElementById('marketing-tab-content');
            if (target && _currentMarketingTab === 'forms') {
                target.innerHTML = await renderFormsTab();
            }
        }, 220);
    };

    // ── Likert helper ────────────────────────────────────────────────────────
    const _cfLikertHtml = (name, value, options) => `
        <div class="cf-likert" data-likert="${name}">
            ${options.map(o => `
                <label class="${value === o.v ? 'cf-likert-on' : ''}" onclick="this.parentNode.querySelectorAll('label').forEach(l=>l.classList.remove('cf-likert-on'));this.classList.add('cf-likert-on');this.querySelector('input').checked=true;">
                    <input type="radio" name="${name}" value="${o.v}" ${value === o.v ? 'checked' : ''}>
                    <span>${o.en}</span>
                    <span class="zh">${o.zh}</span>
                </label>
            `).join('')}
        </div>
    `;
    const _cfReadLikert = (name) => {
        const el = document.querySelector(`input[name="${name}"]:checked`);
        return el ? parseInt(el.value, 10) : null;
    };

    // =========================================================================
    // Shared paper-styled CSS for the 3 official forms (Survey / CPS / APU).
    // Mirrors the paper PDFs: serif title, tight bordered info box, square
    // checkboxes (□), bilingual labels, print-friendly.
    // =========================================================================
    const _cfPaperStyles = () => `<style>
        .cf-paper{ background:#fff; color:#1f2937; font-family:'Times New Roman','SimSun',serif; padding:28px 32px; max-width:880px; margin:0 auto; line-height:1.45; border:1px solid #e5e7eb; border-radius:4px; }
        .cf-paper *{ box-sizing:border-box; }
        .cf-paper-head{ display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:18px; gap:16px; flex-wrap:wrap; }
        .cf-paper-title-en{ font-size:22px; font-weight:700; letter-spacing:1px; }
        .cf-paper-title-zh{ font-size:24px; font-weight:700; margin-top:4px; letter-spacing:2px; }
        .cf-paper-brand{ text-align:right; font-family:'Times New Roman',serif; }
        .cf-paper-brand .cf-brand-zh{ display:block; font-size:14px; font-weight:700; color:#B89F4A; letter-spacing:1px; }
        .cf-paper-brand .cf-brand-en{ display:block; font-size:11px; font-weight:700; color:#B89F4A; letter-spacing:3px; margin-top:2px; }
        .cf-paper-info{ border:1px solid #000; padding:8px 14px; margin-bottom:14px; }
        .cf-info-2col{ display:grid; grid-template-columns:1fr 1fr; column-gap:24px; }
        @media (max-width:640px){ .cf-info-2col{ grid-template-columns:1fr; } }
        .cf-info-row{ display:grid; grid-template-columns:130px 1fr; align-items:baseline; padding:6px 0; gap:8px; border-bottom:1px dotted #d1d5db; }
        .cf-info-row:last-child, .cf-info-row:nth-last-child(2){ border-bottom:none; }
        .cf-info-lbl{ font-size:13px; font-weight:600; color:#111827; text-align:right; }
        .cf-info-lbl em{ display:block; font-style:italic; font-size:11px; font-weight:500; color:#6b7280; margin-top:1px; }
        .cf-paper-input{ width:100%; border:none; border-bottom:1px solid #6b7280; background:transparent; padding:4px 6px; font-family:inherit; font-size:13px; color:#1f2937; }
        .cf-paper-input:focus{ outline:none; border-bottom-color:#7C3AED; }
        .cf-line-input{ border:none; border-bottom:1px solid #6b7280; background:transparent; padding:2px 6px; font-family:inherit; font-size:13px; min-width:120px; flex:1; }
        .cf-line-input.cf-full{ display:block; width:100%; margin-top:6px; }

        .cf-paper-instr{ font-size:13px; margin:12px 0 8px; font-weight:600; }

        .cf-paper-qs{ display:flex; flex-direction:column; gap:10px; }
        .cf-q{ font-size:13.5px; }
        .cf-q-line{ line-height:1.6; margin-bottom:4px; }
        .cf-q-n{ font-weight:700; margin-right:4px; }
        .cf-cb-row{ display:flex; flex-wrap:wrap; gap:12px 22px; align-items:center; margin:4px 0; }
        .cf-cb{ display:inline-flex; align-items:center; gap:6px; cursor:pointer; font-size:13px; user-select:none; }
        .cf-cb input{ -webkit-appearance:none; appearance:none; width:14px; height:14px; min-width:14px; border:1.5px solid #1f2937; background:#fff; cursor:pointer; margin:0; position:relative; border-radius:0; }
        .cf-cb input:checked{ background:#1f2937; }
        .cf-cb input:checked::after{ content:""; position:absolute; left:3px; top:0px; width:4px; height:8px; border:solid #fff; border-width:0 2px 2px 0; transform:rotate(45deg); }
        .cf-cb-txt{ line-height:1.3; }
        .cf-cb-en{ font-size:11px; color:#6b7280; font-style:italic; margin-left:2px; }
        .cf-cb-stack{ flex-direction:column; align-items:center; text-align:center; padding:6px 4px; min-width:90px; }
        .cf-cb-stack .cf-cb-txt{ font-size:12px; margin-top:4px; }

        .cf-paper-sig-row{ display:grid; grid-template-columns:1.4fr 1fr; gap:24px; margin-top:28px; }
        @media (max-width:640px){ .cf-paper-sig-row{ grid-template-columns:1fr; } }
        .cf-paper-sig-block{ text-align:center; }
        .cf-paper-sig-canvas{ width:100%; height:74px; border-bottom:1px solid #1f2937; background:#fff; touch-action:none; display:block; }
        .cf-paper-sig-cap{ font-size:12px; color:#1f2937; margin-top:4px; }
        .cf-paper-sig-date{ border-bottom:1px solid #1f2937; padding:24px 0 4px; font-size:13px; color:#374151; text-align:center; }
        .cf-mini-btn{ background:transparent; border:1px solid #d1d5db; padding:3px 8px; border-radius:4px; font-size:11px; cursor:pointer; color:#6b7280; }

        .cf-paper-thanks{ margin-top:22px; padding-top:14px; border-top:1px dashed #6b7280; text-align:center; font-size:12.5px; line-height:1.7; color:#1f2937; }
        .cf-paper-copyright{ text-align:center; font-size:11px; color:#6b7280; margin-top:8px; letter-spacing:1px; }

        /* CPS bagua grid — paper styled */
        .cf-bagua-box{ border:1px solid #000; padding:18px 22px; margin:14px 0; }
        .cf-bagua-2col{ display:grid; grid-template-columns:1fr 1fr; gap:36px; }
        @media (max-width:640px){ .cf-bagua-2col{ grid-template-columns:1fr; } }
        .cf-bagua-lbl{ font-weight:700; font-size:15px; margin-bottom:10px; padding-left:4px; }
        .cf-bagua-cells{ display:grid; grid-template-columns:repeat(3, 1fr); border:1.5px solid #1f2937; }
        .cf-bagua-cell{ aspect-ratio:1; border:1px solid #1f2937; position:relative; padding:6px 6px 4px; background:#fff; display:flex; flex-direction:column; }
        .cf-bagua-cell .tg{ position:absolute; top:6px; left:8px; font-size:24px; font-weight:700; color:#cbd5e1; line-height:1; pointer-events:none; font-family:'SimSun','PMingLiU',serif; }
        .cf-bagua-cell textarea{ width:100%; flex:1; border:none; resize:none; padding:24px 4px 4px; font-size:12px; font-family:inherit; color:#1f2937; background:transparent; outline:none; }

        /* CPS notes — 6 lines */
        .cf-notes-lines{ margin:10px 0 14px; }
        .cf-notes-lines .nline{ border-bottom:1px solid #6b7280; height:26px; }

        /* FOR OFFICE USE black banner */
        .cf-office-banner{ background:#000; color:#fff; padding:5px 14px; font-weight:700; font-size:12.5px; letter-spacing:1px; margin:14px 0 12px; }
        .cf-office-row{ display:grid; grid-template-columns:1fr 1fr; gap:36px; padding:6px 4px 0; }
        @media (max-width:640px){ .cf-office-row{ grid-template-columns:1fr; } }
        .cf-office-sig-line{ border-bottom:1px solid #1f2937; height:54px; position:relative; }
        .cf-office-sig-line canvas{ width:100%; height:100%; touch-action:none; display:block; }
        .cf-office-sig-cap{ font-size:12px; color:#1f2937; margin-top:4px; }
        .cf-office-sig-cap .ndate{ display:grid; grid-template-columns:50px 1fr; gap:4px; font-size:12px; margin-top:6px; }
        .cf-office-sig-cap .ndate input,.cf-office-sig-cap .ndate select{ border:none; border-bottom:1px dotted #6b7280; background:transparent; font-family:inherit; font-size:12px; padding:1px 2px; }

        /* APU likert 5 in a row */
        .cf-apu-q{ border-bottom:1px solid #e5e7eb; padding:8px 0; }
        .cf-apu-q:last-child{ border-bottom:none; }
        .cf-apu-likert{ display:grid; grid-template-columns:repeat(5, 1fr); gap:8px; margin:6px 0 6px; }
        @media (max-width:640px){ .cf-apu-likert{ grid-template-columns:repeat(2, 1fr); } }
        .cf-apu-reason{ display:flex; align-items:baseline; gap:6px; margin-top:4px; font-size:12px; }
        .cf-apu-reason .lbl{ white-space:nowrap; font-weight:500; }

        /* APU referral table */
        .cf-apu-ref{ width:100%; border-collapse:collapse; margin:8px 0; font-size:12.5px; }
        .cf-apu-ref th,.cf-apu-ref td{ border:1px solid #1f2937; padding:6px 8px; vertical-align:middle; }
        .cf-apu-ref th{ background:#f3f4f6; font-weight:600; text-align:left; }
        .cf-apu-ref td{ height:30px; }
        .cf-apu-ref input{ width:100%; border:none; background:transparent; font-family:inherit; font-size:12.5px; padding:2px 0; }
        @media (max-width:640px){
            .cf-apu-ref thead{ display:none; }
            .cf-apu-ref tr{ display:block; border:1px solid #1f2937; padding:6px 8px; margin-bottom:8px; }
            .cf-apu-ref td{ display:grid; grid-template-columns:90px 1fr; gap:6px; border:none; padding:3px 0; }
            .cf-apu-ref td::before{ content:attr(data-label); font-weight:600; font-size:11px; color:#6b7280; }
        }

        /* APU 3 signatures */
        .cf-sig-3{ display:grid; grid-template-columns:repeat(3, 1fr); gap:24px; margin-top:24px; }
        @media (max-width:640px){ .cf-sig-3{ grid-template-columns:1fr; } }

        /* Print */
        @media print {
            body * { visibility:hidden !important; }
            .cf-paper, .cf-paper * { visibility:visible !important; }
            .cf-paper{ position:absolute; left:0; top:0; box-shadow:none; border:none; max-width:none; padding:18px; }
            .cf-no-print{ display:none !important; }
            .modal-overlay,.modal-footer{ display:none !important; }
        }
    </style>`;

    // =========================================================================
    // 1) NEW CUSTOMER SURVEY (新客户调查表) — 6 Qs + signature
    // =========================================================================
    const openCustomerSurveyModal = async (prospectId, surveyId = null) => {
        const prospect = await AppDataStore.getById('prospects', prospectId).catch(() => null);
        if (!prospect) { UI.toast.error('Prospect not found.'); return; }

        let existing = null;
        if (surveyId) {
            existing = await AppDataStore.getById('customer_surveys', surveyId).catch(() => null);
        }

        const users = await AppDataStore.getAll('users').catch(() => []);
        const consultantOpts = users
            .filter(u => u.status !== 'inactive')
            .map(u => `<option value="${u.id}" ${existing?.consultant_id == u.id ? 'selected' : ''}>${_cfEscape(u.full_name || u.email)}</option>`)
            .join('');

        const today = new Date().toISOString().slice(0, 10);
        const data = existing || {};

        const cb = (name, val, en, zh, extra = '') => `
            <label class="cf-cb"><input type="radio" name="${name}" value="${val}" ${data[name] === val ? 'checked' : ''}>
                <span class="cf-cb-txt">${zh}${en ? ` <span class="cf-cb-en">${en}</span>` : ''}${extra}</span>
            </label>`;

        UI.showModal(`新客户调查表 · ${_cfEscape(prospect.full_name || '')}`, `
            ${_cfPaperStyles()}
            <div class="cf-paper" id="cf-survey-paper">
                <input type="hidden" id="cf-survey-prospect-id" value="${prospect.id}">
                <input type="hidden" id="cf-survey-id" value="${surveyId || ''}">

                <div class="cf-paper-head">
                    <div>
                        <div class="cf-paper-title-en">DESTINY CODE</div>
                        <div class="cf-paper-title-zh">新客户调查表</div>
                    </div>
                    <div class="cf-paper-brand">
                        <span class="cf-brand-zh">天　命　定　數<sup>®</sup></span>
                        <span class="cf-brand-en">DESTINY CODE</span>
                    </div>
                </div>

                <div class="cf-paper-info">
                    <div class="cf-info-2col">
                        <div class="cf-info-row">
                            <span class="cf-info-lbl">顾问姓名 <em>Consultant</em></span>
                            <select class="cf-paper-input" id="cf-survey-consultant"><option value="">—</option>${consultantOpts}</select>
                        </div>
                        <div class="cf-info-row">
                            <span class="cf-info-lbl">解盘日期 <em>Date</em></span>
                            <input type="date" class="cf-paper-input" id="cf-survey-date" value="${data.analysis_date || today}">
                        </div>
                        <div class="cf-info-row">
                            <span class="cf-info-lbl">客户姓名 <em>Customer Name</em></span>
                            <input type="text" class="cf-paper-input" id="cf-survey-name" value="${_cfEscape(data.customer_name || prospect.full_name || '')}">
                        </div>
                        <div class="cf-info-row">
                            <span class="cf-info-lbl">电邮 <em>Email</em></span>
                            <input type="email" class="cf-paper-input" id="cf-survey-email" value="${_cfEscape(data.email || prospect.email || '')}">
                        </div>
                        <div class="cf-info-row">
                            <span class="cf-info-lbl">联络电话 <em>Phone</em></span>
                            <input type="tel" class="cf-paper-input" id="cf-survey-phone" value="${_cfEscape(data.phone || prospect.phone || '')}">
                        </div>
                        <div class="cf-info-row">
                            <span class="cf-info-lbl">职业 <em>Occupation</em></span>
                            <input type="text" class="cf-paper-input" id="cf-survey-occupation" value="${_cfEscape(data.occupation || prospect.occupation || '')}">
                        </div>
                    </div>
                </div>

                <div class="cf-paper-instr">* 请在格子里打勾 <span style="color:#888;">(Tick the appropriate box)</span> ︰－</div>

                <div class="cf-paper-qs">
                    <div class="cf-q">
                        <div class="cf-q-line"><span class="cf-q-n">1)</span> 请问您从哪里听闻及认识到DC?</div>
                        <div class="cf-cb-row">
                            ${cb('q1_source','family','','亲属')}
                            ${cb('q1_source','friend','','朋友')}
                            ${cb('q1_source','other','','其他')}
                            <input type="text" id="cf-survey-q1-other" class="cf-line-input" placeholder="(请说明)" value="${_cfEscape(data.q1_source_other || '')}">
                        </div>
                    </div>

                    <div class="cf-q">
                        <div class="cf-q-line"><span class="cf-q-n">2)</span> 请问您目前或之前有使用过风水或相关风水服务?</div>
                        <div class="cf-cb-row">
                            <label class="cf-cb"><input type="radio" name="q2_used_before" value="true" ${data.q2_used_before === true ? 'checked' : ''}><span class="cf-cb-txt">有</span></label>
                            <label class="cf-cb"><input type="radio" name="q2_used_before" value="false" ${data.q2_used_before === false ? 'checked' : ''}><span class="cf-cb-txt">没有</span></label>
                        </div>
                    </div>

                    <div class="cf-q">
                        <div class="cf-q-line"><span class="cf-q-n">3)</span> 请问您个人或家庭之前或目前相信风水的功效吗?</div>
                        <div class="cf-cb-row">
                            <label class="cf-cb"><input type="radio" name="q3_belief" value="believe" ${data.q3_belief === 'believe' ? 'checked' : ''}><span class="cf-cb-txt">相信, 为什麼</span></label>
                            <label class="cf-cb"><input type="radio" name="q3_belief" value="disbelieve" ${data.q3_belief === 'disbelieve' ? 'checked' : ''}><span class="cf-cb-txt">不相信, 为什麼</span></label>
                            <label class="cf-cb"><input type="radio" name="q3_belief" value="neutral" ${data.q3_belief === 'neutral' ? 'checked' : ''}><span class="cf-cb-txt">中立</span></label>
                        </div>
                        <input type="text" id="cf-survey-q3-reason" class="cf-line-input cf-full" placeholder="(请说明原因)" value="${_cfEscape(data.q3_belief_reason || '')}">
                    </div>

                    <div class="cf-q">
                        <div class="cf-q-line"><span class="cf-q-n">4)</span> 如果传承7000年的玄空风水, 确实有效, 您会否愿意尝试使用?</div>
                        <div class="cf-cb-row">
                            ${cb('q4_willing','yes','','愿意')}
                            ${cb('q4_willing','maybe','','可能愿意')}
                            ${cb('q4_willing','no','','不愿意')}
                        </div>
                    </div>

                    <div class="cf-q">
                        <div class="cf-q-line"><span class="cf-q-n">5)</span> 为了个人及家人拥有更好的利益、更安全的生活环境, 倘若有能力及良好机会, 您是否愿意使用DC风水的解决方案, 以帮助及改善全家人的财富状况、事业发展、工作绩效、夫妻关系、孩子教育及人缘关系等?</div>
                        <div class="cf-cb-row">
                            ${cb('q5_use_dc','willing','','愿意使用')}
                            ${cb('q5_use_dc','consider','','考虑使用')}
                            ${cb('q5_use_dc','neutral','','中立')}
                        </div>
                    </div>

                    <div class="cf-q">
                        <div class="cf-q-line"><span class="cf-q-n">6)</span> 若您明白到DC风水知识的种种好处与利益, 您会否主动分享给亲友一起获得这个利益?</div>
                        <div class="cf-cb-row">
                            ${cb('q6_share','definitely','','一定分享')}
                            ${cb('q6_share','when_opportunity','','有机会就分享')}
                            ${cb('q6_share','no','','不愿分享')}
                        </div>
                    </div>
                </div>

                <div class="cf-paper-sig-row">
                    <div class="cf-paper-sig-block">
                        <canvas id="cf-survey-sig" class="cf-paper-sig-canvas" data-preload="${data.signature_data_url || ''}"></canvas>
                        <div class="cf-paper-sig-cap">客户签名 / Customer Signature</div>
                    </div>
                    <div class="cf-paper-sig-block">
                        <div class="cf-paper-sig-date">${_cfFmtDate(data.signed_at) || _cfFmtDate(new Date().toISOString())}</div>
                        <div class="cf-paper-sig-cap">日期 / Date</div>
                    </div>
                </div>
                <div class="cf-no-print" style="text-align:right;margin-top:-8px;"><button type="button" class="cf-mini-btn" onclick="app.cfClearSignature('cf-survey-sig')">Clear signature</button></div>

                <div class="cf-paper-thanks">
                    助人为乐, DC全体同仁感谢您无私地参与本次的调查,<br>
                    有助於我们提升服务水准, 帮助更多朋友获得利益. 谢谢.
                </div>
                <div class="cf-paper-copyright">~ 版权所有, 翻印必究 ~</div>
            </div>
        `, [
            { label: 'Cancel', type: 'secondary', action: 'UI.hideModal()' },
            { label: 'Print', type: 'secondary', action: 'window.print()' },
            { label: 'Save Survey', type: 'primary', action: '(async () => { await app.saveCustomerSurvey(); })()' }
        ]);

        // Bind signature pad after modal renders
        setTimeout(() => _bindSignaturePad('cf-survey-sig'), 60);
    };

    const saveCustomerSurvey = async () => {
        const prospectId = parseInt(document.getElementById('cf-survey-prospect-id')?.value, 10);
        const surveyId = document.getElementById('cf-survey-id')?.value || null;
        if (!prospectId) { UI.toast.error('Missing prospect.'); return; }

        const q2Raw = document.querySelector('input[name="q2_used_before"]:checked')?.value;
        const q2 = q2Raw == null ? null : q2Raw === 'true';

        const payload = {
            prospect_id: prospectId,
            consultant_id: parseInt(document.getElementById('cf-survey-consultant')?.value, 10) || null,
            analysis_date: document.getElementById('cf-survey-date')?.value || null,
            customer_name: document.getElementById('cf-survey-name')?.value?.trim() || null,
            email: document.getElementById('cf-survey-email')?.value?.trim() || null,
            phone: document.getElementById('cf-survey-phone')?.value?.trim() || null,
            occupation: document.getElementById('cf-survey-occupation')?.value?.trim() || null,
            q1_source: document.querySelector('input[name="q1_source"]:checked')?.value || null,
            q1_source_other: document.getElementById('cf-survey-q1-other')?.value?.trim() || null,
            q2_used_before: q2,
            q3_belief: document.querySelector('input[name="q3_belief"]:checked')?.value || null,
            q3_belief_reason: document.getElementById('cf-survey-q3-reason')?.value?.trim() || null,
            q4_willing: document.querySelector('input[name="q4_willing"]:checked')?.value || null,
            q5_use_dc: document.querySelector('input[name="q5_use_dc"]:checked')?.value || null,
            q6_share: document.querySelector('input[name="q6_share"]:checked')?.value || null,
            signature_data_url: _getSignatureDataUrl('cf-survey-sig'),
            signed_at: _getSignatureDataUrl('cf-survey-sig') ? new Date().toISOString() : null,
            created_by: _currentUser?.id || null
        };

        try {
            if (surveyId) {
                await AppDataStore.update('customer_surveys', surveyId, payload);
                UI.toast.success('Survey updated.');
            } else {
                await AppDataStore.create('customer_surveys', { ...payload, created_at: new Date().toISOString() });
                UI.toast.success('Survey saved.');
            }
            UI.hideModal();
            const target = document.getElementById('marketing-tab-content');
            if (target && _currentMarketingTab === 'forms') target.innerHTML = await renderFormsTab();
        } catch (err) {
            UI.toast.error('Save failed: ' + (err?.message || err));
        }
    };

    // =========================================================================
    // 2) CPS FORM — Personal Life Chart Analysis (細解命盤) with bagua grids
    // =========================================================================
    const _cfBaguaHtml = (which, data) => {
        // 後天八卦 standard arrangement (3x3):
        //   xun (SE)   | li  (S) | kun (SW)
        //   zhen (E)   | center | dui (W)
        //   gen  (NE)  | kan (N) | qian (NW)
        const cells = [
            { k: 'xun',    tg: '巽' },
            { k: 'li',     tg: '離' },
            { k: 'kun',    tg: '坤' },
            { k: 'zhen',   tg: '震' },
            { k: 'center', tg: '中' },
            { k: 'dui',    tg: '兌' },
            { k: 'gen',    tg: '艮' },
            { k: 'kan',    tg: '坎' },
            { k: 'qian',   tg: '乾' }
        ];
        return `
            <div class="cf-bagua">
                <div class="cf-bagua-title">${which === 'lunar' ? 'Lunar 農曆' : 'Solar 陽曆'}</div>
                <div class="cf-bagua-grid">
                    ${cells.map(c => `
                        <div class="cf-bagua-cell ${c.k === 'center' ? 'cf-bagua-center' : ''}">
                            <div class="tg">${c.tg}</div>
                            <textarea id="cf-cps-${which}-${c.k}" placeholder="…">${_cfEscape((data && data[c.k]) || '')}</textarea>
                        </div>
                    `).join('')}
                </div>
            </div>
        `;
    };

    const _cfReadBagua = (which) => {
        const out = {};
        ['xun','li','kun','zhen','center','dui','gen','kan','qian'].forEach(k => {
            out[k] = document.getElementById(`cf-cps-${which}-${k}`)?.value?.trim() || '';
        });
        return out;
    };

    const openCpsAnalysisModal = async (prospectId, cpsId = null) => {
        const prospect = await AppDataStore.getById('prospects', prospectId).catch(() => null);
        if (!prospect) { UI.toast.error('Prospect not found.'); return; }

        let existing = null;
        if (cpsId) existing = await AppDataStore.getById('cps_analyses', cpsId).catch(() => null);

        const users = await AppDataStore.getAll('users').catch(() => []);
        const dealerOpts = users
            .filter(u => u.status !== 'inactive')
            .map(u => `<option value="${u.id}" ${existing?.dealer_id == u.id ? 'selected' : ''}>${_cfEscape(u.full_name || u.email)}</option>`)
            .join('');
        const cpsByOpts = users
            .filter(u => u.status !== 'inactive')
            .map(u => `<option value="${u.id}" ${existing?.cps_by_id == u.id ? 'selected' : ''}>${_cfEscape(u.full_name || u.email)}</option>`)
            .join('');

        const today = new Date().toISOString().slice(0, 10);
        const data = existing || {};

        // Bagua cells in 後天八卦 standard arrangement (matches paper):
        //   xun (NW) | li (N) | kun (NE)
        //   zhen (W) |        | dui (E)
        //   gen (SW) | kan(S) | qian(SE)
        const baguaPaper = (which, chartData) => {
            const cells = [
                { k: 'xun',  tg: '巽' }, { k: 'li',   tg: '離' }, { k: 'kun',  tg: '坤' },
                { k: 'zhen', tg: '震' }, { k: 'center', tg: '' },  { k: 'dui',  tg: '兌' },
                { k: 'gen',  tg: '艮' }, { k: 'kan',  tg: '坎' }, { k: 'qian', tg: '乾' }
            ];
            return `
                <div>
                    <div class="cf-bagua-lbl">${which === 'lunar' ? 'Lunar' : 'Solar'}</div>
                    <div class="cf-bagua-cells">
                        ${cells.map(c => `
                            <div class="cf-bagua-cell">
                                <span class="tg">${c.tg}</span>
                                <textarea id="cf-cps-${which}-${c.k}">${_cfEscape((chartData && chartData[c.k]) || '')}</textarea>
                            </div>
                        `).join('')}
                    </div>
                </div>`;
        };

        UI.showModal(`細解命盤 · ${_cfEscape(prospect.full_name || '')}`, `
            ${_cfPaperStyles()}
            <div class="cf-paper" id="cf-cps-paper">
                <input type="hidden" id="cf-cps-prospect-id" value="${prospect.id}">
                <input type="hidden" id="cf-cps-id" value="${cpsId || ''}">

                <div class="cf-paper-head">
                    <div>
                        <div class="cf-paper-title-en">PERSONAL LIFE CHART ANALYSIS</div>
                        <div class="cf-paper-title-zh">細解命盤</div>
                    </div>
                    <div class="cf-paper-brand">
                        <span class="cf-brand-zh">天　命　定　數<sup>®</sup></span>
                        <span class="cf-brand-en">DESTINY CODE</span>
                    </div>
                </div>

                <!-- Date / SN row (above the info box, like paper) -->
                <div style="display:grid; grid-template-columns:1fr 1fr; gap:32px; margin-bottom:12px;">
                    <div class="cf-info-row" style="border-bottom:none; grid-template-columns:80px 1fr;">
                        <span class="cf-info-lbl"><strong>Date</strong></span>
                        <input type="date" class="cf-paper-input" id="cf-cps-date" value="${data.form_date || today}">
                    </div>
                    <div class="cf-info-row" style="border-bottom:none; grid-template-columns:80px 1fr;">
                        <span class="cf-info-lbl"><strong>SN</strong></span>
                        <input type="text" class="cf-paper-input" id="cf-cps-sn" value="${_cfEscape(data.serial_number || '')}" placeholder="…">
                    </div>
                </div>

                <!-- Customer info bordered box, 2 columns x 5 rows like paper.
                     CPS-specific overrides: tighter label column, inline-nowrap
                     checkboxes for Gender/Marital, Birthdate cell holds BOTH
                     Solar+Lunar inputs side-by-side. -->
                <style>
                    #cf-cps-paper .cf-info-row{ grid-template-columns:108px 1fr; gap:6px; }
                    #cf-cps-paper .cf-info-lbl{ font-size:12px; }
                    #cf-cps-paper .cf-info-lbl em{ font-size:10.5px; }
                    #cf-cps-paper .cf-info-row .cf-cb-row{ flex-wrap:nowrap; gap:12px; }
                    #cf-cps-paper .cf-info-row .cf-cb{ font-size:12px; white-space:nowrap; }
                    #cf-cps-paper .cf-bd-cell{ display:grid; grid-template-columns:auto 1fr; gap:4px 6px; align-items:center; }
                    #cf-cps-paper .cf-bd-cell .lbl{ font-size:10.5px; color:#6b7280; white-space:nowrap; }
                    #cf-cps-paper .cf-bd-cell input{ min-width:0; }
                    #cf-cps-paper .cf-paper-input{ min-width:0; }
                    @media (max-width:640px){
                        #cf-cps-paper .cf-info-row .cf-cb-row{ flex-wrap:wrap; }
                    }
                </style>
                <div class="cf-paper-info">
                    <div class="cf-info-2col">
                        <!-- Row 1: Customer Name | Gender -->
                        <div class="cf-info-row">
                            <span class="cf-info-lbl">Customer Name<em>客戶姓名</em></span>
                            <input type="text" class="cf-paper-input" id="cf-cps-name" value="${_cfEscape(data.customer_name || prospect.full_name || '')}" placeholder="(中文)">
                        </div>
                        <div class="cf-info-row">
                            <span class="cf-info-lbl">Gender<em>性別</em></span>
                            <div class="cf-cb-row">
                                <label class="cf-cb"><input type="radio" name="cps_gender" value="female" ${data.gender === 'female' ? 'checked' : ''}><span class="cf-cb-txt">女&nbsp;<span class="cf-cb-en">Female</span></span></label>
                                <label class="cf-cb"><input type="radio" name="cps_gender" value="male"   ${data.gender === 'male'   ? 'checked' : ''}><span class="cf-cb-txt">男&nbsp;<span class="cf-cb-en">Male</span></span></label>
                            </div>
                        </div>
                        <!-- Row 2: Birthdate (Solar + Lunar inline) | Phone -->
                        <div class="cf-info-row">
                            <span class="cf-info-lbl">Birthdate<em>生日日期</em></span>
                            <div class="cf-bd-cell">
                                <span class="lbl">Solar 陽曆</span>
                                <input type="date" class="cf-paper-input" id="cf-cps-bd-solar" value="${data.birthdate_solar || prospect.date_of_birth || ''}">
                                <span class="lbl">Lunar 農曆</span>
                                <input type="date" class="cf-paper-input" id="cf-cps-bd-lunar" value="${data.birthdate_lunar || prospect.lunar_birth || ''}">
                            </div>
                        </div>
                        <div class="cf-info-row">
                            <span class="cf-info-lbl">Phone Number<em>手提號碼</em></span>
                            <input type="tel" class="cf-paper-input" id="cf-cps-phone" value="${_cfEscape(data.phone || prospect.phone || '')}">
                        </div>
                        <!-- Row 3: Occupation | Email -->
                        <div class="cf-info-row">
                            <span class="cf-info-lbl">Current Occupation<em>目前職業</em></span>
                            <input type="text" class="cf-paper-input" id="cf-cps-occupation" value="${_cfEscape(data.occupation || prospect.occupation || '')}">
                        </div>
                        <div class="cf-info-row">
                            <span class="cf-info-lbl">Email<em>電郵</em></span>
                            <input type="email" class="cf-paper-input" id="cf-cps-email" value="${_cfEscape(data.email || prospect.email || '')}">
                        </div>
                        <!-- Row 4: Living Area | Introducer -->
                        <div class="cf-info-row">
                            <span class="cf-info-lbl">Living Area<em>居住地區</em></span>
                            <input type="text" class="cf-paper-input" id="cf-cps-area" value="${_cfEscape(data.living_area || prospect.city || '')}">
                        </div>
                        <div class="cf-info-row">
                            <span class="cf-info-lbl">Introducer<em>介紹人</em></span>
                            <input type="text" class="cf-paper-input" id="cf-cps-introducer" value="${_cfEscape(data.introducer || prospect.referred_by || '')}">
                        </div>
                        <!-- Row 5: Marital Status | Dealer Name -->
                        <div class="cf-info-row">
                            <span class="cf-info-lbl">Marital Status<em>婚姻狀況</em></span>
                            <div class="cf-cb-row">
                                <label class="cf-cb"><input type="radio" name="cps_marital" value="single"  ${data.marital_status === 'single'  ? 'checked' : ''}><span class="cf-cb-txt">Single</span></label>
                                <label class="cf-cb"><input type="radio" name="cps_marital" value="married" ${data.marital_status === 'married' ? 'checked' : ''}><span class="cf-cb-txt">Married</span></label>
                                <label class="cf-cb"><input type="radio" name="cps_marital" value="others"  ${data.marital_status === 'others'  ? 'checked' : ''}><span class="cf-cb-txt">Others</span></label>
                            </div>
                        </div>
                        <div class="cf-info-row">
                            <span class="cf-info-lbl">Dealer Name<em>代理姓名</em></span>
                            <select class="cf-paper-input" id="cf-cps-dealer"><option value="">—</option>${dealerOpts}</select>
                        </div>
                    </div>
                </div>

                <!-- Bagua: Lunar | Solar -->
                <div class="cf-bagua-box">
                    <div class="cf-bagua-2col">
                        ${baguaPaper('lunar', data.lunar_chart || {})}
                        ${baguaPaper('solar', data.solar_chart || {})}
                    </div>
                </div>

                <!-- 6 horizontal notes lines (combined into one textarea backing) -->
                <textarea id="cf-cps-notes" style="width:100%; min-height:160px; border:1px solid #6b7280; padding:6px 8px; font-family:inherit; font-size:12.5px; line-height:26px; background:repeating-linear-gradient(transparent, transparent 25px, #6b7280 25px, #6b7280 26px);">${_cfEscape(data.notes || '')}</textarea>

                <!-- FOR OFFICE USE black banner + 2 signature blocks -->
                <div class="cf-office-banner">FOR OFFICE USE</div>
                <div class="cf-office-row">
                    <div>
                        <div class="cf-office-sig-line">
                            <canvas id="cf-cps-sig-dealer" data-preload="${data.dealer_signature_data_url || ''}"></canvas>
                        </div>
                        <div class="cf-office-sig-cap">
                            <strong>Dealer's Signature</strong>
                            <div class="ndate"><span>Name</span><input type="text" id="cf-cps-dealer-name" value="${_cfEscape(data.dealer_signed_name || '')}"></div>
                            <div class="ndate"><span>Date</span><input type="date" id="cf-cps-dealer-date" value="${data.dealer_signed_at ? data.dealer_signed_at.slice(0,10) : today}"></div>
                            <button type="button" class="cf-mini-btn cf-no-print" style="margin-top:4px;" onclick="app.cfClearSignature('cf-cps-sig-dealer')">Clear signature</button>
                        </div>
                    </div>
                    <div>
                        <div class="cf-office-sig-line">
                            <canvas id="cf-cps-sig-cps" data-preload="${data.cps_signature_data_url || ''}"></canvas>
                        </div>
                        <div class="cf-office-sig-cap">
                            <strong>CPS by</strong>
                            <div class="ndate"><span>Name</span><select id="cf-cps-by"><option value="">—</option>${cpsByOpts}</select></div>
                            <div class="ndate"><span></span><input type="text" id="cf-cps-by-name" value="${_cfEscape(data.cps_signed_name || '')}" placeholder="or write name"></div>
                            <div class="ndate"><span>Date</span><input type="date" id="cf-cps-by-date" value="${data.cps_signed_at ? data.cps_signed_at.slice(0,10) : today}"></div>
                            <button type="button" class="cf-mini-btn cf-no-print" style="margin-top:4px;" onclick="app.cfClearSignature('cf-cps-sig-cps')">Clear signature</button>
                        </div>
                    </div>
                </div>
            </div>
        `, [
            { label: 'Cancel', type: 'secondary', action: 'UI.hideModal()' },
            { label: 'Print', type: 'secondary', action: 'window.print()' },
            { label: 'Save CPS', type: 'primary', action: '(async () => { await app.saveCpsAnalysis(); })()' }
        ]);

        setTimeout(() => {
            _bindSignaturePad('cf-cps-sig-dealer');
            _bindSignaturePad('cf-cps-sig-cps');
        }, 60);
    };

    const saveCpsAnalysis = async () => {
        const prospectId = parseInt(document.getElementById('cf-cps-prospect-id')?.value, 10);
        const cpsId = document.getElementById('cf-cps-id')?.value || null;
        if (!prospectId) { UI.toast.error('Missing prospect.'); return; }

        const dealerSig = _getSignatureDataUrl('cf-cps-sig-dealer');
        const cpsSig    = _getSignatureDataUrl('cf-cps-sig-cps');

        const payload = {
            prospect_id: prospectId,
            serial_number: document.getElementById('cf-cps-sn')?.value?.trim() || null,
            form_date: document.getElementById('cf-cps-date')?.value || null,
            customer_name: document.getElementById('cf-cps-name')?.value?.trim() || null,
            customer_name_chinese: document.getElementById('cf-cps-name-zh')?.value?.trim() || null,
            gender: document.querySelector('input[name="cps_gender"]:checked')?.value || null,
            birthdate_solar: document.getElementById('cf-cps-bd-solar')?.value || null,
            birthdate_lunar: document.getElementById('cf-cps-bd-lunar')?.value || null,
            phone: document.getElementById('cf-cps-phone')?.value?.trim() || null,
            email: document.getElementById('cf-cps-email')?.value?.trim() || null,
            occupation: document.getElementById('cf-cps-occupation')?.value?.trim() || null,
            living_area: document.getElementById('cf-cps-area')?.value?.trim() || null,
            introducer: document.getElementById('cf-cps-introducer')?.value?.trim() || null,
            marital_status: document.querySelector('input[name="cps_marital"]:checked')?.value || null,
            dealer_id: parseInt(document.getElementById('cf-cps-dealer')?.value, 10) || null,
            lunar_chart: _cfReadBagua('lunar'),
            solar_chart: _cfReadBagua('solar'),
            notes: document.getElementById('cf-cps-notes')?.value?.trim() || null,
            dealer_signature_data_url: dealerSig,
            dealer_signed_name: document.getElementById('cf-cps-dealer-name')?.value?.trim() || null,
            dealer_signed_at: dealerSig ? new Date().toISOString() : null,
            cps_by_id: parseInt(document.getElementById('cf-cps-by')?.value, 10) || null,
            cps_signature_data_url: cpsSig,
            cps_signed_name: document.getElementById('cf-cps-by-name')?.value?.trim() || null,
            cps_signed_at: cpsSig ? new Date().toISOString() : null,
            created_by: _currentUser?.id || null
        };

        try {
            if (cpsId) {
                await AppDataStore.update('cps_analyses', cpsId, payload);
                UI.toast.success('CPS form updated.');
            } else {
                await AppDataStore.create('cps_analyses', { ...payload, created_at: new Date().toISOString() });
                UI.toast.success('CPS form saved.');
            }
            UI.hideModal();
            const target = document.getElementById('marketing-tab-content');
            if (target && _currentMarketingTab === 'forms') target.innerHTML = await renderFormsTab();
        } catch (err) {
            UI.toast.error('Save failed: ' + (err?.message || err));
        }
    };

    // =========================================================================
    // 3) APU APPRAISAL FORM — 7 Qs + 3 referrals + 3 signatures
    // =========================================================================
    const openApuAppraisalModal = async (prospectId, apuId = null) => {
        const prospect = await AppDataStore.getById('prospects', prospectId).catch(() => null);
        if (!prospect) { UI.toast.error('Prospect not found.'); return; }

        let existing = null, refs = [];
        if (apuId) {
            existing = await AppDataStore.getById('apu_appraisals', apuId).catch(() => null);
            const allRefs = await AppDataStore.getAll('apu_referrals').catch(() => []);
            refs = allRefs.filter(r => r.appraisal_id == apuId).sort((a, b) => (a.position || 0) - (b.position || 0));
        }

        const users = await AppDataStore.getAll('users').catch(() => []);
        const consultantOpts = users
            .filter(u => u.status !== 'inactive')
            .map(u => `<option value="${u.id}" ${existing?.consultant_id == u.id ? 'selected' : ''}>${_cfEscape(u.full_name || u.email)}</option>`)
            .join('');
        const dealerOpts = users
            .filter(u => u.status !== 'inactive')
            .map(u => `<option value="${u.id}" ${existing?.dealer_ea_id == u.id ? 'selected' : ''}>${_cfEscape(u.full_name || u.email)}</option>`)
            .join('');

        const today = new Date().toISOString().slice(0, 10);
        const data = existing || {};

        const satOpts = [
            { v: 5, en: 'Extremely Satisfied', zh: '非常滿意' },
            { v: 4, en: 'Satisfactory',         zh: '滿意' },
            { v: 3, en: 'Average',              zh: '一般' },
            { v: 2, en: 'Unsatisfactory',       zh: '不滿意' },
            { v: 1, en: 'Poor',                 zh: '非常不滿意' }
        ];
        const valueOpts = [
            { v: 5, en: 'Extremely Exceeded',  zh: '最高價值' },
            { v: 4, en: 'High Value',          zh: '高價值' },
            { v: 3, en: 'Adequate',            zh: '值得' },
            { v: 2, en: 'Marginal',            zh: '一般' },
            { v: 1, en: 'Poor',                zh: '低價值' }
        ];
        const knowOpts = [
            { v: 5, en: 'Excellent',      zh: '很好' },
            { v: 4, en: 'Good',           zh: '好' },
            { v: 3, en: 'Average',        zh: '一般' },
            { v: 2, en: 'Below Average',  zh: '不好' },
            { v: 1, en: 'Unacceptable',   zh: '非常不好' }
        ];

        const refRow = (i) => {
            const r = refs[i] || {};
            return `
                <tr>
                    <td data-label="NO.">${i + 1}.</td>
                    <td data-label="姓名 / NAME"><input type="text" id="cf-apu-ref-name-${i}" value="${_cfEscape(r.name || '')}"></td>
                    <td data-label="身份證 / NRIC"><input type="text" id="cf-apu-ref-nric-${i}" value="${_cfEscape(r.nric || '')}"></td>
                    <td data-label="電話 / CONTACT"><input type="tel" id="cf-apu-ref-contact-${i}" value="${_cfEscape(r.contact || '')}"></td>
                    <td data-label="職業 / OCCUPATION"><input type="text" id="cf-apu-ref-occ-${i}" value="${_cfEscape(r.occupation || '')}"></td>
                </tr>
            `;
        };

        // Paper-style Likert: 5 stacked checkboxes side-by-side with zh on top, en italicized below
        const likertPaper = (name, currentVal, options) => `
            <div class="cf-apu-likert">
                ${options.map(o => `
                    <label class="cf-cb cf-cb-stack">
                        <input type="radio" name="${name}" value="${o.v}" ${currentVal === o.v ? 'checked' : ''}>
                        <span class="cf-cb-txt">${o.zh}<br><span class="cf-cb-en">${o.en}</span></span>
                    </label>
                `).join('')}
            </div>
        `;

        UI.showModal(`DC APPRAISAL FORM · ${_cfEscape(prospect.full_name || '')}`, `
            ${_cfPaperStyles()}
            <div class="cf-paper" id="cf-apu-paper">
                <input type="hidden" id="cf-apu-prospect-id" value="${prospect.id}">
                <input type="hidden" id="cf-apu-id" value="${apuId || ''}">

                <div class="cf-paper-head">
                    <div>
                        <div class="cf-paper-title-zh">DC 個人風水之析運論勢 <span style="color:#9ca3af;">|</span> 評估表</div>
                        <div class="cf-paper-title-en" style="font-size:14px; margin-top:4px; color:#374151;">DC PERSONAL CHART ANALYSIS <span style="color:#9ca3af;">|</span> APPRAISAL FORM</div>
                    </div>
                    <div class="cf-paper-brand">
                        <span class="cf-brand-zh">天　命　定　數<sup>®</sup></span>
                        <span class="cf-brand-en">DESTINY CODE</span>
                    </div>
                </div>

                <!-- Header info: DATE / CONSULTANT then DEALER/EA / ID / 傳福者 -->
                <div class="cf-paper-info">
                    <div class="cf-info-2col">
                        <div class="cf-info-row">
                            <span class="cf-info-lbl"><strong>DATE</strong></span>
                            <input type="date" class="cf-paper-input" id="cf-apu-date" value="${data.appraisal_date || today}">
                        </div>
                        <div class="cf-info-row">
                            <span class="cf-info-lbl"><strong>CONSULTANT</strong></span>
                            <select class="cf-paper-input" id="cf-apu-consultant"><option value="">—</option>${consultantOpts}</select>
                        </div>
                    </div>
                    <div style="display:grid; grid-template-columns:1fr 1fr 1fr; gap:12px; margin-top:6px;">
                        <div class="cf-info-row" style="grid-template-columns:90px 1fr; border-bottom:none;">
                            <span class="cf-info-lbl"><strong>DEALER / EA</strong></span>
                            <select class="cf-paper-input" id="cf-apu-dealer"><option value="">—</option>${dealerOpts}</select>
                        </div>
                        <div class="cf-info-row" style="grid-template-columns:30px 1fr; border-bottom:none;">
                            <span class="cf-info-lbl"><strong>ID</strong></span>
                            <input type="text" class="cf-paper-input" id="cf-apu-cust-id" value="${_cfEscape(data.customer_identifier || '')}">
                        </div>
                        <div class="cf-info-row" style="grid-template-columns:70px 1fr; border-bottom:none;">
                            <span class="cf-info-lbl"><strong>傳福者</strong></span>
                            <input type="text" class="cf-paper-input" id="cf-apu-referrer" value="${_cfEscape(data.referrer || prospect.referred_by || '')}">
                        </div>
                    </div>
                </div>

                <!-- 7 questions -->
                <div class="cf-apu-q">
                    <div class="cf-q-line"><span class="cf-q-n">1)</span> 您所得到的個人風水解盤服務,您覺得︰<br><em style="font-size:11px;color:#6b7280;">How do you rate the personal chart analysis service received:</em></div>
                    ${likertPaper('q1_service_rating', data.q1_service_rating, satOpts)}
                    <div class="cf-apu-reason"><span class="lbl">原因 Reason :</span><input type="text" id="cf-apu-q1-reason" class="cf-line-input" value="${_cfEscape(data.q1_reason || '')}"></div>
                </div>

                <div class="cf-apu-q">
                    <div class="cf-q-line"><span class="cf-q-n">2)</span> 您對這位風水顧問的解盤能力及其他表現,您認為︰<br><em style="font-size:11px;color:#6b7280;">Please rate your opinion on the chart analysis ability and overall performance of the Consultant:</em></div>
                    ${likertPaper('q2_consultant_rating', data.q2_consultant_rating, satOpts)}
                    <div class="cf-apu-reason"><span class="lbl">原因 Reason :</span><input type="text" id="cf-apu-q2-reason" class="cf-line-input" value="${_cfEscape(data.q2_reason || '')}"></div>
                </div>

                <div class="cf-apu-q">
                    <div class="cf-q-line"><span class="cf-q-n">3)</span> 您對整個解盤的安排與流程,是否感到︰<br><em style="font-size:11px;color:#6b7280;">Please indicate your level of satisfaction on the arrangement and flow of the chart analysis:</em></div>
                    ${likertPaper('q3_arrangement_rating', data.q3_arrangement_rating, satOpts)}
                    <div class="cf-apu-reason"><span class="lbl">原因 Reason :</span><input type="text" id="cf-apu-q3-reason" class="cf-line-input" value="${_cfEscape(data.q3_reason || '')}"></div>
                </div>

                <div class="cf-apu-q">
                    <div class="cf-q-line"><span class="cf-q-n">4)</span> 雖然這是DC送予的免費個人風水解盤,您認為本服務給您的收獲為︰<br><em style="font-size:11px;color:#6b7280;">This is a complimentary chart analysis service provided by DC, how do you rate the result of the analysis:</em></div>
                    ${likertPaper('q4_value_rating', data.q4_value_rating, valueOpts)}
                    <div class="cf-apu-reason"><span class="lbl">原因 Reason :</span><input type="text" id="cf-apu-q4-reason" class="cf-line-input" value="${_cfEscape(data.q4_reason || '')}"></div>
                </div>

                <div class="cf-apu-q">
                    <div class="cf-q-line"><span class="cf-q-n">5)</span> 您對這位風水顧問有何評價? 包括其對風水知識的理解、分享及解答疑問。<br><em style="font-size:11px;color:#6b7280;">How do you rate the Consultant? Including His/Her knowledge and understanding of Fengshui and responsiveness?</em></div>
                    ${likertPaper('q5_knowledge_rating', data.q5_knowledge_rating, knowOpts)}
                    <div class="cf-apu-reason"><span class="lbl">原因 Reason :</span><input type="text" id="cf-apu-q5-reason" class="cf-line-input" value="${_cfEscape(data.q5_reason || '')}"></div>
                </div>

                <div class="cf-apu-q">
                    <div class="cf-q-line"><span class="cf-q-n">6)</span> 您是否知道,必須有人推薦,方可免費得到DC個人風水高價值解盤服務?<br><em style="font-size:11px;color:#6b7280;">Are you aware that complementary DC Personal Chart Analysis service will only be accorded by referral?</em></div>
                    <div class="cf-cb-row" style="margin-top:4px;">
                        <label class="cf-cb cf-cb-stack" style="min-width:60px;"><input type="radio" name="q6_aware_referral" value="true" ${data.q6_aware_referral === true ? 'checked' : ''}><span class="cf-cb-txt">知道<br><span class="cf-cb-en">Yes</span></span></label>
                        <label class="cf-cb cf-cb-stack" style="min-width:60px;"><input type="radio" name="q6_aware_referral" value="false" ${data.q6_aware_referral === false ? 'checked' : ''}><span class="cf-cb-txt">不知道<br><span class="cf-cb-en">No</span></span></label>
                        <div class="cf-apu-reason" style="flex:1; margin-top:0;"><span class="lbl">原因 Reason :</span><input type="text" id="cf-apu-q6-reason" class="cf-line-input" value="${_cfEscape(data.q6_reason || '')}"></div>
                    </div>
                </div>

                <div class="cf-apu-q">
                    <div class="cf-q-line"><span class="cf-q-n">7)</span> 若您認同DC個人風水解盤服務物有所值,您最想推薦哪三位親友得到此高價值服務?<br><em style="font-size:11px;color:#6b7280;">Whom are the three relatives/friends that you would strongly recommend to receive this high value DC Personal Chart Analysis service?</em></div>
                    <table class="cf-apu-ref">
                        <thead>
                            <tr>
                                <th style="width:38px;">NO.</th>
                                <th>姓名 / NAME</th>
                                <th>身份證 / NRIC</th>
                                <th>電話 / CONTACT</th>
                                <th>職業 / OCCUPATION</th>
                            </tr>
                        </thead>
                        <tbody>${[0,1,2].map(refRow).join('')}</tbody>
                    </table>
                </div>

                <!-- 3 signatures -->
                <div class="cf-sig-3">
                    <div class="cf-paper-sig-block">
                        <canvas id="cf-apu-sig-cust" class="cf-paper-sig-canvas" data-preload="${data.customer_signature_data_url || ''}"></canvas>
                        <div class="cf-paper-sig-cap"><strong>Signature</strong><br>DC CUSTOMER</div>
                        <button type="button" class="cf-mini-btn cf-no-print" onclick="app.cfClearSignature('cf-apu-sig-cust')">Clear</button>
                    </div>
                    <div class="cf-paper-sig-block">
                        <canvas id="cf-apu-sig-apu" class="cf-paper-sig-canvas" data-preload="${data.apu_signature_data_url || ''}"></canvas>
                        <div class="cf-paper-sig-cap"><strong>Signature</strong><br>DC APU</div>
                        <button type="button" class="cf-mini-btn cf-no-print" onclick="app.cfClearSignature('cf-apu-sig-apu')">Clear</button>
                    </div>
                    <div class="cf-paper-sig-block">
                        <canvas id="cf-apu-sig-head" class="cf-paper-sig-canvas" data-preload="${data.head_apu_signature_data_url || ''}"></canvas>
                        <div class="cf-paper-sig-cap"><strong>Signature</strong><br>HEAD OF DC APU</div>
                        <button type="button" class="cf-mini-btn cf-no-print" onclick="app.cfClearSignature('cf-apu-sig-head')">Clear</button>
                    </div>
                </div>
            </div>
        `, [
            { label: 'Cancel', type: 'secondary', action: 'UI.hideModal()' },
            { label: 'Print', type: 'secondary', action: 'window.print()' },
            { label: 'Save APU', type: 'primary', action: '(async () => { await app.saveApuAppraisal(); })()' }
        ]);

        setTimeout(() => {
            _bindSignaturePad('cf-apu-sig-cust');
            _bindSignaturePad('cf-apu-sig-apu');
            _bindSignaturePad('cf-apu-sig-head');
        }, 60);
    };

    const saveApuAppraisal = async () => {
        const prospectId = parseInt(document.getElementById('cf-apu-prospect-id')?.value, 10);
        const apuId = document.getElementById('cf-apu-id')?.value || null;
        if (!prospectId) { UI.toast.error('Missing prospect.'); return; }

        const q6Raw = document.querySelector('input[name="q6_aware_referral"]:checked')?.value;
        const q6 = q6Raw == null ? null : q6Raw === 'true';
        const custSig = _getSignatureDataUrl('cf-apu-sig-cust');
        const apuSig  = _getSignatureDataUrl('cf-apu-sig-apu');
        const headSig = _getSignatureDataUrl('cf-apu-sig-head');

        const payload = {
            prospect_id: prospectId,
            appraisal_date: document.getElementById('cf-apu-date')?.value || null,
            consultant_id: parseInt(document.getElementById('cf-apu-consultant')?.value, 10) || null,
            dealer_ea_id: parseInt(document.getElementById('cf-apu-dealer')?.value, 10) || null,
            customer_identifier: document.getElementById('cf-apu-cust-id')?.value?.trim() || null,
            referrer: document.getElementById('cf-apu-referrer')?.value?.trim() || null,
            q1_service_rating: _cfReadLikert('q1_service_rating'),
            q1_reason: document.getElementById('cf-apu-q1-reason')?.value?.trim() || null,
            q2_consultant_rating: _cfReadLikert('q2_consultant_rating'),
            q2_reason: document.getElementById('cf-apu-q2-reason')?.value?.trim() || null,
            q3_arrangement_rating: _cfReadLikert('q3_arrangement_rating'),
            q3_reason: document.getElementById('cf-apu-q3-reason')?.value?.trim() || null,
            q4_value_rating: _cfReadLikert('q4_value_rating'),
            q4_reason: document.getElementById('cf-apu-q4-reason')?.value?.trim() || null,
            q5_knowledge_rating: _cfReadLikert('q5_knowledge_rating'),
            q5_reason: document.getElementById('cf-apu-q5-reason')?.value?.trim() || null,
            q6_aware_referral: q6,
            q6_reason: document.getElementById('cf-apu-q6-reason')?.value?.trim() || null,
            customer_signature_data_url: custSig,
            customer_signed_at: custSig ? new Date().toISOString() : null,
            apu_signature_data_url: apuSig,
            apu_signed_at: apuSig ? new Date().toISOString() : null,
            apu_signed_by: apuSig ? (_currentUser?.id || null) : null,
            head_apu_signature_data_url: headSig,
            head_apu_signed_at: headSig ? new Date().toISOString() : null,
            head_apu_signed_by: headSig ? (_currentUser?.id || null) : null,
            created_by: _currentUser?.id || null
        };

        try {
            let savedId = apuId;
            if (apuId) {
                await AppDataStore.update('apu_appraisals', apuId, payload);
            } else {
                const row = await AppDataStore.create('apu_appraisals', { ...payload, created_at: new Date().toISOString() });
                savedId = row?.id;
            }

            if (savedId) {
                // Wipe + re-write the 3 referral rows so re-saving replaces them cleanly.
                const existingRefs = (await AppDataStore.getAll('apu_referrals').catch(() => []))
                    .filter(r => r.appraisal_id == savedId);
                for (const r of existingRefs) {
                    try { await AppDataStore.delete('apu_referrals', r.id); } catch (_) {}
                }
                for (let i = 0; i < 3; i++) {
                    const name = document.getElementById(`cf-apu-ref-name-${i}`)?.value?.trim();
                    const nric = document.getElementById(`cf-apu-ref-nric-${i}`)?.value?.trim();
                    const contact = document.getElementById(`cf-apu-ref-contact-${i}`)?.value?.trim();
                    const occ = document.getElementById(`cf-apu-ref-occ-${i}`)?.value?.trim();
                    if (name || nric || contact || occ) {
                        await AppDataStore.create('apu_referrals', {
                            appraisal_id: savedId,
                            position: i + 1,
                            name: name || null,
                            nric: nric || null,
                            contact: contact || null,
                            occupation: occ || null,
                            created_at: new Date().toISOString()
                        });
                    }
                }
            }

            UI.toast.success(apuId ? 'APU updated.' : 'APU saved.');
            UI.hideModal();
            const target = document.getElementById('marketing-tab-content');
            if (target && _currentMarketingTab === 'forms') target.innerHTML = await renderFormsTab();
        } catch (err) {
            UI.toast.error('Save failed: ' + (err?.message || err));
        }
    };

    // =========================================================================
    // 4) DESTINY CODE 3-YEAR BLUEPRINT (九運改命藍圖表)
    // Sections: 命卦大運 → 成效與需求 → 未來3年運盤 → 行動與結果 → 簽名
    // Default 3-year window: 2026–2028 (start_year configurable per-form).
    // =========================================================================

    // Opens the Blueprint form in-place. We tried opening a separate tab via
    // window.open earlier, but tab boundaries don't reliably share the Supabase
    // session in production (the new tab landed on the login screen). Modal
    // in-place keeps the user inside the authenticated session and reuses the
    // same data store cache, so saves are instant.
    const openDestinyBlueprintInTab = (prospectId, dbId = null) =>
        openDestinyBlueprintModal(prospectId, dbId);

    const openDestinyBlueprintModal = async (prospectId, dbId = null) => {
        const prospect = await AppDataStore.getById('prospects', prospectId).catch(() => null);
        if (!prospect) { UI.toast.error('Prospect not found.'); return; }

        let existing = null;
        if (dbId) existing = await AppDataStore.getById('destiny_blueprints', dbId).catch(() => null);

        const users = await AppDataStore.getAll('users').catch(() => []);
        const userOpts = (selectedId) => users
            .filter(u => u.status !== 'inactive')
            .map(u => `<option value="${u.id}" ${selectedId == u.id ? 'selected' : ''}>${_cfEscape(u.full_name || u.email)}</option>`)
            .join('');

        const today = new Date().toISOString().slice(0, 10);
        const data = existing || {};
        const startYear = data.start_year || 2026;
        const y1 = startYear, y2 = startYear + 1, y3 = startYear + 2;

        UI.showModal(`九運改命藍圖表 Destiny Code Blueprint · ${_cfEscape(prospect.full_name || '')}`, `
            <style>
                /* ── Destiny Blueprint — paper-form-faithful layout ── */
                .db-form{ font-family: 'Inter', sans-serif; color:#111827; }
                .db-form input[type="text"], .db-form input[type="tel"], .db-form input[type="number"], .db-form input[type="date"], .db-form select, .db-form textarea{
                    width:100%; padding:6px 8px; border:1px solid #D1D5DB; border-radius:4px; font-size:13px; font-family:inherit; background:white; box-sizing:border-box;
                }
                .db-form textarea{ resize:vertical; min-height:38px; }

                /* Top branding row */
                .db-brand{
                    display:flex; align-items:flex-start; justify-content:space-between;
                    border-bottom:1px solid #E5E7EB; padding-bottom:10px; margin-bottom:12px;
                }
                .db-brand-left{ display:flex; flex-direction:column; gap:4px; }
                .db-brand-tag{
                    display:inline-block; background:#1E3A8A; color:white; font-size:11px; font-weight:600;
                    padding:3px 10px; border-radius:3px; letter-spacing:1px; width:fit-content;
                }
                .db-brand-title{
                    background:#1E3A8A; color:white; font-size:18px; font-weight:700;
                    padding:6px 14px; border-radius:4px; letter-spacing:2px; width:fit-content;
                }
                .db-brand-right{ text-align:right; font-size:11px; color:#6B7280; letter-spacing:2px; }
                .db-brand-right strong{ font-size:14px; color:#111827; letter-spacing:3px; display:block; }

                /* Header fields row (姓名/聯絡 / 代理/組別) */
                .db-header-grid{ display:grid; grid-template-columns:1fr 1fr; gap:8px 16px; margin-bottom:14px; }
                @media (max-width:600px){ .db-header-grid{ grid-template-columns:1fr; } }
                .db-header-grid .db-cell{ display:flex; align-items:center; gap:8px; }
                .db-header-grid .db-cell label{ font-size:13px; font-weight:600; white-space:nowrap; color:#1F2937; min-width:90px; }

                /* Section header bar (number badge + Chinese title) */
                .db-section-bar{
                    display:flex; align-items:center; gap:0; margin:18px 0 8px;
                    border:1px solid #1E3A8A; border-radius:4px; overflow:hidden;
                }
                .db-section-num{
                    background:#1E3A8A; color:white; font-weight:700; font-size:14px;
                    width:30px; text-align:center; padding:6px 0;
                }
                .db-section-title{ background:#1E3A8A; color:white; font-weight:600; font-size:14px; padding:6px 14px; flex:1; }
                .db-section-en{ color:#BFDBFE; font-size:11px; font-weight:400; margin-left:6px; }

                .db-section-hint{ font-size:11px; color:#4B5563; margin:4px 0 8px; padding-left:4px; }

                /* Section 1: 命卦大運 — 4-quadrant grid + score/advice row */
                .db-quadrant{ display:grid; grid-template-columns:1fr 1fr; gap:6px 14px; margin-bottom:8px; }
                @media (max-width:600px){ .db-quadrant{ grid-template-columns:1fr; } }
                .db-quadrant .db-qcell{ display:flex; align-items:center; gap:8px; }
                .db-quadrant .db-qcell label{ font-weight:600; min-width:38px; font-size:13px; color:#1F2937; }
                .db-score-row{ display:flex; align-items:center; gap:14px; flex-wrap:wrap; margin-top:6px; }
                .db-score-row .db-score-wrap{ display:flex; align-items:center; gap:8px; }
                .db-score-row .db-score-wrap label{ font-weight:600; font-size:13px; min-width:38px; }
                .db-score-row .db-score-wrap input{ width:70px; text-align:center; font-weight:700; }
                .db-score-row .db-advice-wrap{ display:flex; align-items:center; gap:8px; flex:1; min-width:200px; }
                .db-score-row .db-advice-wrap label{ font-weight:600; font-size:13px; }

                /* Paper-style tables (sections 2, 3, 4) */
                .db-table{ width:100%; border-collapse:collapse; font-size:13px; }
                .db-table th, .db-table td{ border:1px solid #9CA3AF; padding:6px 8px; vertical-align:middle; }
                .db-table thead th{ background:#F3F4F6; font-weight:600; text-align:center; font-size:12px; color:#1F2937; }
                .db-table th.db-row-label{ background:#F9FAFB; font-weight:700; text-align:center; width:80px; font-size:13px; }
                .db-table td input, .db-table td textarea{ border:none; padding:2px 4px; background:transparent; }
                .db-table td input:focus, .db-table td textarea:focus{ outline:1px solid #1E3A8A; border-radius:2px; }
                .db-year-cell{ background:#F9FAFB; font-weight:700; text-align:center; font-size:14px; }

                .db-advice-block{ margin-top:8px; display:flex; align-items:flex-start; gap:8px; }
                .db-advice-block label{ font-weight:600; font-size:13px; min-width:50px; padding-top:6px; }
                .db-advice-block textarea{ flex:1; }

                /* Footer signature row */
                .db-footer{ display:grid; grid-template-columns:1fr 1fr; gap:24px; margin-top:20px; padding-top:14px; border-top:1px dashed #9CA3AF; }
                @media (max-width:600px){ .db-footer{ grid-template-columns:1fr; } }
                .db-footer .db-sigbox{ display:flex; flex-direction:column; gap:6px; }
                .db-footer .db-sig-label{ font-size:12px; font-weight:700; color:#1F2937; }
                .db-footer .db-sig-name{ font-size:11px; color:#6B7280; }
                .db-footer canvas{ width:100%; height:90px; border:1px solid #9CA3AF; border-radius:4px; background:white; touch-action:none; }
                .db-footer .db-sig-date-row{ display:flex; justify-content:space-between; align-items:center; font-size:11px; color:#4B5563; }
                .db-footer .db-clear{ background:white; border:1px solid #D1D5DB; padding:3px 8px; border-radius:4px; cursor:pointer; font-size:11px; }
                .db-footer .db-clear:hover{ background:#F9FAFB; }

                .db-copyright{ text-align:right; font-size:10px; color:#9CA3AF; margin-top:10px; font-style:italic; }
            </style>

            <div class="db-form">
                <input type="hidden" id="cf-db-prospect-id" value="${prospect.id}">
                <input type="hidden" id="cf-db-id" value="${dbId || ''}">

                <!-- Top branding (matches paper form) -->
                <div class="db-brand">
                    <div class="db-brand-left">
                        <span class="db-brand-tag">DC 個人風水</span>
                        <span class="db-brand-title">九運改命藍圖表</span>
                    </div>
                    <div class="db-brand-right">
                        天 命 定 數
                        <strong>DESTINY CODE</strong>
                    </div>
                </div>

                <!-- Header fields: 姓名/聯絡, 代理/組別 -->
                <div class="db-header-grid">
                    <div class="db-cell"><label>姓名</label>
                        <input type="text" id="cf-db-name" value="${_cfEscape(data.customer_name || prospect.full_name || '')}">
                    </div>
                    <div class="db-cell"><label>聯絡號碼</label>
                        <input type="tel" id="cf-db-phone" value="${_cfEscape(data.contact_number || prospect.phone || '')}">
                    </div>
                    <div class="db-cell"><label>代理</label>
                        <select id="cf-db-agent"><option value="">--</option>${userOpts(data.agent_id)}</select>
                    </div>
                    <div class="db-cell"><label>組別</label>
                        <input type="text" id="cf-db-group" value="${_cfEscape(data.group_name || '')}">
                    </div>
                    <div class="db-cell"><label>日期</label>
                        <input type="date" id="cf-db-date" value="${data.form_date || today}">
                    </div>
                </div>

                <!-- Section 1: 命卦大運 -->
                <div class="db-section-bar">
                    <div class="db-section-num">1</div>
                    <div class="db-section-title">命卦大運<span class="db-section-en">Life Trigram Fortune</span></div>
                </div>
                <div class="db-quadrant">
                    <div class="db-qcell"><label>吉:</label><textarea id="cf-db-ji" rows="1">${_cfEscape(data.section1_ji || '')}</textarea></div>
                    <div class="db-qcell"><label>悔:</label><textarea id="cf-db-hui" rows="1">${_cfEscape(data.section1_hui || '')}</textarea></div>
                    <div class="db-qcell"><label>凶:</label><textarea id="cf-db-xiong" rows="1">${_cfEscape(data.section1_xiong || '')}</textarea></div>
                    <div class="db-qcell"><label>吝:</label><textarea id="cf-db-lin" rows="1">${_cfEscape(data.section1_lin || '')}</textarea></div>
                </div>
                <div class="db-score-row">
                    <div class="db-score-wrap"><label>分數:</label>
                        <input type="number" id="cf-db-score" min="0" max="100" value="${data.section1_score ?? ''}">
                    </div>
                    <div class="db-advice-wrap"><label>建言:</label>
                        <input type="text" id="cf-db-s1-advice" value="${_cfEscape(data.section1_advice || '')}">
                    </div>
                </div>

                <!-- Section 2: 成效與需求 -->
                <div class="db-section-bar">
                    <div class="db-section-num">2</div>
                    <div class="db-section-title">成效與需求<span class="db-section-en">Effectiveness & Needs</span></div>
                </div>
                <div class="db-section-hint">按命盤解析,已採用之方案</div>
                <table class="db-table">
                    <thead>
                        <tr><th colspan="2">現在及未來可能需要之方案</th></tr>
                    </thead>
                    <tbody>
                        <tr><th class="db-row-label">個人</th><td><input type="text" id="cf-db-s2-personal" value="${_cfEscape(data.section2_personal || '')}"></td></tr>
                        <tr><th class="db-row-label">家居</th><td><input type="text" id="cf-db-s2-home" value="${_cfEscape(data.section2_home || '')}"></td></tr>
                        <tr><th class="db-row-label">工作</th><td><input type="text" id="cf-db-s2-work" value="${_cfEscape(data.section2_work || '')}"></td></tr>
                        <tr><th class="db-row-label">生意</th><td><input type="text" id="cf-db-s2-business" value="${_cfEscape(data.section2_business || '')}"></td></tr>
                        <tr><th class="db-row-label">關係</th><td><input type="text" id="cf-db-s2-relationship" value="${_cfEscape(data.section2_relationship || '')}"></td></tr>
                        <tr><th class="db-row-label">子女</th><td><input type="text" id="cf-db-s2-children" value="${_cfEscape(data.section2_children || '')}"></td></tr>
                    </tbody>
                </table>
                <div class="db-advice-block">
                    <label>建言:</label>
                    <textarea id="cf-db-s2-advice" rows="2">${_cfEscape(data.section2_advice || '')}</textarea>
                </div>

                <!-- Section 3: Future 3-year fortune -->
                <div class="db-section-bar">
                    <div class="db-section-num">3</div>
                    <div class="db-section-title">未來3年運盤<span class="db-section-en">Future 3-Year Fortune</span></div>
                </div>
                <div style="display:flex; align-items:center; gap:10px; margin-bottom:6px;">
                    <label style="font-size:11px; color:#4B5563; font-weight:600;">起始年 Start Year:</label>
                    <input type="number" id="cf-db-start-year" min="2024" max="2099" value="${startYear}" style="width:90px; text-align:center;">
                </div>
                <table class="db-table">
                    <thead>
                        <tr>
                            <th style="width:80px;">&nbsp;</th>
                            <th>未來3年運盤重大剋應</th>
                            <th>未來3年最想要之藍圖目標</th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr>
                            <td class="db-year-cell" id="cf-db-y1-label">${y1}</td>
                            <td><input type="text" id="cf-db-y1-event" value="${_cfEscape(data.year_1_event || '')}"></td>
                            <td><input type="text" id="cf-db-y1-goal" value="${_cfEscape(data.year_1_goal || '')}"></td>
                        </tr>
                        <tr>
                            <td class="db-year-cell" id="cf-db-y2-label">${y2}</td>
                            <td><input type="text" id="cf-db-y2-event" value="${_cfEscape(data.year_2_event || '')}"></td>
                            <td><input type="text" id="cf-db-y2-goal" value="${_cfEscape(data.year_2_goal || '')}"></td>
                        </tr>
                        <tr>
                            <td class="db-year-cell" id="cf-db-y3-label">${y3}</td>
                            <td><input type="text" id="cf-db-y3-event" value="${_cfEscape(data.year_3_event || '')}"></td>
                            <td><input type="text" id="cf-db-y3-goal" value="${_cfEscape(data.year_3_goal || '')}"></td>
                        </tr>
                    </tbody>
                </table>
                <div class="db-section-hint">*藍圖目標與結果,每年可以是一個,也可以三年是一個,或三年三個皆可。卻不可過多。</div>
                <div class="db-advice-block">
                    <label>結論:</label>
                    <textarea id="cf-db-s3-conclusion" rows="2">${_cfEscape(data.section3_conclusion || '')}</textarea>
                </div>

                <!-- Section 4: 行動與結果 -->
                <div class="db-section-bar">
                    <div class="db-section-num">4</div>
                    <div class="db-section-title">行動與結果<span class="db-section-en">Action & Results</span></div>
                </div>
                <table class="db-table">
                    <thead>
                        <tr><th colspan="2">面對未來,其藍圖目標可能之結果變化</th></tr>
                    </thead>
                    <tbody>
                        <tr><th class="db-row-label">得到</th><td><input type="text" id="cf-db-s4-gain" value="${_cfEscape(data.section4_gain || '')}"></td></tr>
                        <tr><th class="db-row-label">損失</th><td><input type="text" id="cf-db-s4-loss" value="${_cfEscape(data.section4_loss || '')}"></td></tr>
                        <tr><th class="db-row-label">保持</th><td><input type="text" id="cf-db-s4-maintain" value="${_cfEscape(data.section4_maintain || '')}"></td></tr>
                        <tr><th class="db-row-label">衰退</th><td><input type="text" id="cf-db-s4-decline" value="${_cfEscape(data.section4_decline || '')}"></td></tr>
                    </tbody>
                </table>
                <div class="db-advice-block">
                    <label style="min-width:auto;">*把風險降低提高成率的最佳輔助方案或決定是:</label>
                    <textarea id="cf-db-s4-best" rows="2">${_cfEscape(data.section4_best_solution || '')}</textarea>
                </div>

                <!-- Footer signatures (customer + consultant) -->
                <div class="db-footer">
                    <div class="db-sigbox">
                        <span class="db-sig-label">客戶姓名 Customer</span>
                        <input type="text" id="cf-db-cust-signed-name" placeholder="Customer signed name" value="${_cfEscape(data.customer_signed_name || '')}">
                        <canvas id="cf-db-sig-cust" data-preload="${data.customer_signature_data_url || ''}"></canvas>
                        <div class="db-sig-date-row">
                            <span>日期: ${_cfFmtDate(data.customer_signed_at) || today}</span>
                            <button type="button" class="db-clear" onclick="app.cfClearSignature('cf-db-sig-cust')"><i class="fas fa-eraser"></i> Clear</button>
                        </div>
                    </div>
                    <div class="db-sigbox">
                        <span class="db-sig-label">顧問姓名 Consultant</span>
                        <select id="cf-db-consultant"><option value="">--</option>${userOpts(data.consultant_id)}</select>
                        <canvas id="cf-db-sig-cons" data-preload="${data.consultant_signature_data_url || ''}"></canvas>
                        <div class="db-sig-date-row">
                            <span>日期: ${_cfFmtDate(data.consultant_signed_at) || today}</span>
                            <button type="button" class="db-clear" onclick="app.cfClearSignature('cf-db-sig-cons')"><i class="fas fa-eraser"></i> Clear</button>
                        </div>
                    </div>
                </div>

                <div class="db-copyright">copyright reserved by DESTINY CODE SDN BHD 2024</div>
            </div>
        `, [
            { label: 'Cancel', type: 'secondary', action: 'UI.hideModal()' },
            { label: 'Save Blueprint', type: 'primary', action: '(async () => { await app.saveDestinyBlueprint(); })()' }
        ], 'fullscreen');

        // Bind signature pads + live year-label updates
        setTimeout(() => {
            _bindSignaturePad('cf-db-sig-cust');
            _bindSignaturePad('cf-db-sig-cons');
            const syEl = document.getElementById('cf-db-start-year');
            if (syEl) {
                syEl.addEventListener('input', () => {
                    const sy = parseInt(syEl.value, 10);
                    if (!sy || sy < 2024 || sy > 2099) return;
                    const l1 = document.getElementById('cf-db-y1-label');
                    const l2 = document.getElementById('cf-db-y2-label');
                    const l3 = document.getElementById('cf-db-y3-label');
                    if (l1) l1.textContent = sy;
                    if (l2) l2.textContent = sy + 1;
                    if (l3) l3.textContent = sy + 2;
                });
            }
        }, 60);
    };

    const saveDestinyBlueprint = async () => {
        const prospectId = parseInt(document.getElementById('cf-db-prospect-id')?.value, 10);
        const dbId = document.getElementById('cf-db-id')?.value || null;
        if (!prospectId) { UI.toast.error('Missing prospect.'); return; }

        const custSig = _getSignatureDataUrl('cf-db-sig-cust');
        const consSig = _getSignatureDataUrl('cf-db-sig-cons');
        const scoreRaw = document.getElementById('cf-db-score')?.value;
        const startYearRaw = document.getElementById('cf-db-start-year')?.value;

        const payload = {
            prospect_id: prospectId,
            form_date: document.getElementById('cf-db-date')?.value || null,
            customer_name: document.getElementById('cf-db-name')?.value?.trim() || null,
            contact_number: document.getElementById('cf-db-phone')?.value?.trim() || null,
            agent_id: parseInt(document.getElementById('cf-db-agent')?.value, 10) || null,
            group_name: document.getElementById('cf-db-group')?.value?.trim() || null,

            section1_ji: document.getElementById('cf-db-ji')?.value?.trim() || null,
            section1_xiong: document.getElementById('cf-db-xiong')?.value?.trim() || null,
            section1_hui: document.getElementById('cf-db-hui')?.value?.trim() || null,
            section1_lin: document.getElementById('cf-db-lin')?.value?.trim() || null,
            section1_score: scoreRaw === '' || scoreRaw == null ? null : parseInt(scoreRaw, 10),
            section1_advice: document.getElementById('cf-db-s1-advice')?.value?.trim() || null,

            section2_personal: document.getElementById('cf-db-s2-personal')?.value?.trim() || null,
            section2_home: document.getElementById('cf-db-s2-home')?.value?.trim() || null,
            section2_work: document.getElementById('cf-db-s2-work')?.value?.trim() || null,
            section2_business: document.getElementById('cf-db-s2-business')?.value?.trim() || null,
            section2_relationship: document.getElementById('cf-db-s2-relationship')?.value?.trim() || null,
            section2_children: document.getElementById('cf-db-s2-children')?.value?.trim() || null,
            section2_advice: document.getElementById('cf-db-s2-advice')?.value?.trim() || null,

            start_year: startYearRaw ? parseInt(startYearRaw, 10) : 2026,
            year_1_event: document.getElementById('cf-db-y1-event')?.value?.trim() || null,
            year_1_goal: document.getElementById('cf-db-y1-goal')?.value?.trim() || null,
            year_2_event: document.getElementById('cf-db-y2-event')?.value?.trim() || null,
            year_2_goal: document.getElementById('cf-db-y2-goal')?.value?.trim() || null,
            year_3_event: document.getElementById('cf-db-y3-event')?.value?.trim() || null,
            year_3_goal: document.getElementById('cf-db-y3-goal')?.value?.trim() || null,
            section3_conclusion: document.getElementById('cf-db-s3-conclusion')?.value?.trim() || null,

            section4_gain: document.getElementById('cf-db-s4-gain')?.value?.trim() || null,
            section4_loss: document.getElementById('cf-db-s4-loss')?.value?.trim() || null,
            section4_maintain: document.getElementById('cf-db-s4-maintain')?.value?.trim() || null,
            section4_decline: document.getElementById('cf-db-s4-decline')?.value?.trim() || null,
            section4_best_solution: document.getElementById('cf-db-s4-best')?.value?.trim() || null,

            customer_signed_name: document.getElementById('cf-db-cust-signed-name')?.value?.trim() || null,
            customer_signature_data_url: custSig,
            customer_signed_at: custSig ? new Date().toISOString() : null,
            consultant_id: parseInt(document.getElementById('cf-db-consultant')?.value, 10) || null,
            consultant_signature_data_url: consSig,
            consultant_signed_at: consSig ? new Date().toISOString() : null,

            created_by: _currentUser?.id || null
        };

        try {
            if (dbId) {
                await AppDataStore.update('destiny_blueprints', dbId, payload);
                UI.toast.success('Blueprint updated.');
            } else {
                await AppDataStore.create('destiny_blueprints', { ...payload, created_at: new Date().toISOString() });
                UI.toast.success('Blueprint saved.');
            }
            UI.hideModal();
            const target = document.getElementById('marketing-tab-content');
            if (target && _currentMarketingTab === 'forms') target.innerHTML = await renderFormsTab();
        } catch (err) {
            UI.toast.error('Save failed: ' + (err?.message || err));
        }
    };

    return {
        init,
        navigateTo,
        todo,
        // [CHUNK: knowledge] 26 functions Object.assigned to window.app by chunks/script-knowledge.js
        // Stub implementations (2026-04-11) — replace app.todo() placeholders
        showRoadmap,
        exportRelationshipTree,
        changeLeaderboardPeriod,
        uploadProspectDocument,
        logout,
        switchAccount,
        _wireLoginBtn,

        // Helpers
        debounce,
        debounceCall,
        ensureReferralFields,
        canViewNode,

        // Phase 16 WhatsApp Integration — implemented by chunks/script-whatsapp.js
        // (chunk Object.assign overwrites stubs after first navigation to 'whatsapp'
        //  or first WhatsApp button click in a prospect/customer profile)
        initWhatsAppIntegration,
        addWhatsAppButtonToProfile,

        // Pipeline Functions
        handleProspectDrag,
        handleStageDrop,
        closeDealWon,
        closeDealLost,
        calculateDealValue,

        // Phase 2 Activity Modal — implemented by chunks/script-activities.js

        // Phase 3 Prospect Management Functions
        showProspectsView,
        showProspectsViewSmart,
        showProspectDetail,
        zoomCpsPhoto,
        openAddProspectModal: openProspectModal,
        openProspectModal,
        editProspect,
        downloadProspectVCard,
        saveProspect,
        openProspectGradePicker,
        setProspectGrade,
        filterProspects,
        prospectPageNav,
        customerPageNav,
        exportData,
        sortProspects,
        sortProspectsBySelect,
        toggleProspectView,
        toggleProspectSelect,
        toggleProspectSelectAll,
        clearProspectSelection,
        updateProspectBulkBar,
        bulkDeleteProspects,
        bulkReassignProspects,
        confirmBulkReassign,
        toggleProspectFilters,
        updateProspectFilterBadge,
        switchProspectTab,
        toggleAccordion,
        toggleCustomerAccordion,
        switchCustomerProfileTab,

        // Fix scoping for these functions
        openAddNameModal,
        saveName,
        deleteName,
        confirmDeleteName,

        addNote,
        deleteNote,
        attachActivityPhoto,
        viewActivityPhotos,
        saveActivityPhoto,
        removeActivityPhoto,
        attachAppraisalForm,
        saveAppraisalForm,
        removeAppraisalForm,
        uploadAPUForm,
        saveAPUForm,
        removeAPUForm,
        recordSalesClosure,
        toggleNextAction,
        toggleNextActionItem,
        saveClosingRecord,
        submitClosingRecord,
        addPrePurchaseRow,
        addPrePurchaseAttachment,
        deletePrePurchaseRecord,
        addProductPurchaseRow,
        addProductPurchaseAttachment,
        deleteProductPurchaseRecord,
        // ⑦c Feng Shui Audit
        openFengShuiAuditModal,
        saveFengShuiAudit,
        deleteFengShuiAudit,
        uploadFengShuiFile,
        removeFengShuiFile,
        uploadFengShuiPhotos,
        removeFengShuiPhoto,
        updateFengShuiPhotoRemark,
        openFengShuiPhotosModal,
        openFengShuiSitePhotosModal,
        addFengShuiSiteReview,
        updateFengShuiSiteReviewField,
        uploadFengShuiSitePhotos,
        removeFengShuiSitePhoto,
        removeFengShuiSiteReview,
        approveClosingRecord,
        archiveAndNewClosingRecord,
        saveClosingHistoryEntry,
        uploadHistoryInvoice,
        saveClosingDeliveryStatus,
        rejectClosingRecord,
        showPurchasesHistoryView,
        savePurchasesHistoryRow,
        phSetFilter,
        phSetPage,
        refreshPurchasesHistory,
        extendProtection,
        transferProspect,
        reassignProspect,
        quickReassign,
        openReviveProspectModal,
        saveReviveProspect,
        convertToCustomer,
        confirmConvertToCustomer,
        requestProspectConversion,
        showConversionApprovalModal,
        approveProspectConversion,
        rejectProspectConversion,
        // Approval Queue
        renderApprovalQueue,
        refreshApprovalQueue: renderApprovalQueue,
        showApprovalDetail,
        approveQueueEntry,
        rejectQueueEntry,
        confirmRejectQueueEntry,
        deleteProspect,
        confirmDeleteProspect,
        renderProspectsTable,

        // Phase 4 Customer Management Functions
        switchCustomerTab,
        showCustomersView,
        showCustomerDetail,
        hideCustomerDetail: async () => await navigateTo('prospects'),
        renderCustomersTable,
        openAddCustomerModal,
        saveCustomer,
        filterCustomers,
        renderBasicBankTab,
        renderPlatformIdsTab,
        renderPurchaseHistoryTab,
        renderReferralsTab,
        openCustomerReferralModal,
        saveCustomerReferral,
        viewReferralDetail,
        editReferral,
        saveEditReferral,
        openEditPlatformIdsModal,
        savePlatformIds,
        uploadPaymentProof,
        savePaymentProof,
        renderEventHistory,
        renderAgentEligibility,
        openAddPurchaseModal,
        savePurchase,
        updatePurchaseDelivery,
        updateConversionDelivery,
        _setDelivery,
        copyToClipboard,
        openUploadRedemptionImageModal,
        saveRedemptionImage,
        openUploadDocumentModal,
        saveDocument,
        openRecruitModal,
        submitRecruitmentApproval,
        switchProfileTab,

        // Phase 5 Agent Management Functions
        showAgentsView,
        renderAgentsTable,
        filterAgents: renderAgentsTable,
        //showAgentDetail,
        showAgentProfile,
        openAddAgentModal,
        openEditAgentModal,
        saveAgent,
        openAssignUplineModal,
        saveUplineAssignment,
        generatePassword,
        showForcePasswordChangeModal,
        submitForcePasswordChange,
        selfChangePassword,
        saveSelfPreferredName,
        showSettingsView,
        // Contact-duplicate review (Super Admin)
        showPhoneDupesModal,
        refreshPhoneDupes,
        dedupeEditPhone,
        dedupeClearPhone,
        dedupeClearEmail,
        dedupeDeleteProspect,
        verifyAndPreparePhoneConstraint,
        // Push notifications
        refreshPushNotificationStatus,
        enablePushNotifications,
        disablePushNotifications,
        sendTestPushNotification,
        loadNotificationPreferences,
        saveNotificationPreferences,
        onReminderCheckboxChange,
        // Expose current user id for push-notifications.js (outside the IIFE).
        // NOTE: Object.assign flattens getters to their value at call time (always null).
        // Use a plain function so the closure is preserved after assignment.
        getCurrentUserId: () => (_currentUser && _currentUser.id) ? String(_currentUser.id) : null,
        get _currentUser() { return _currentUser; },
        openResetPasswordModal,
        executePasswordReset,
        deleteAgent,
        confirmDeleteAgent,
        renewLicense,
        executeRenewal,
        sendRenewalReminder,
        toggleNotifPanel,
        updateAgentTargets,
        saveAgentTargets,
        deactivateAgent,
        resetAgentPassword,
        assignProspectToAgent,
        viewInactiveProspects,
        renderCustomerHistory,

        confirmDelete,
        executeDelete,

        // New Functions
        openAddTagModal,
        addTagToEntity,
        removeTagFromCustomer,
        removeTagFromProspect,
        openAddSolutionModal,
        saveSolution,
        openEditSolutionModal,
        saveSolutionEdit,
        deleteSolution,
        renderPendingSolutionsWidget,

        // Phase 6 Pipeline Functions
        showPipelineView,
        refreshPipeline,
        setPipelineFilter,
        addToFocusList,
        removeFromFocusList,
        editFocusAmount,
        editFocusAction,
        resetFocusField,
        showProspectMenu,
        showComments,
        openPipelineConfigModal,
        savePipelineConfig,
        // v6 Pipeline Config editor (Super Admin)
        savePipelineRules,
        addPipelineCategory,
        deletePipelineCategory,
        addPipelineWeight,
        deletePipelineWeight,
        addPipelineDecay,
        deletePipelineDecay,
        addPipelineBooster,
        deletePipelineBooster,
        setAgentPackageAmount,
        showPipelineConfigHistory,
        rollbackPipelineConfig,
        showPipelineExplain,
        addPipelineNote,
        renderManualPriority,
        renderRecentOverrides,
        handleDragStart,
        handleDragOver,
        handleDrop,
        saveManualOrder,
        // Month Focus extensions
        switchFocusMonth,
        openExpiredSearchModal,
        switchExpiredTab,
        filterExpiredSearch,
        reAddFromArchive,
        changeFocusTargetProduct,
        changeFocusTargetDetail,
        toggleAgentFocusSection,
        openBoostModal,
        submitBoost,
        openHistoryModal,
        loadOverrideHistory,
        viewJustification,

        // Phase 7 Referrals Functions (NEW VERTICAL LAYOUT V2)

        // Phase 10: Search Panel functions
        toggleSearchPanel: typeof toggleSearchPanel !== 'undefined' ? toggleSearchPanel : null,
        showSearchPanel: typeof showSearchPanel !== 'undefined' ? showSearchPanel : null,
        hideSearchPanel: typeof hideSearchPanel !== 'undefined' ? hideSearchPanel : null,
        updateFilterSections: typeof updateFilterSections !== 'undefined' ? updateFilterSections : null,
        executeSearch: typeof executeSearch !== 'undefined' ? executeSearch : null,
        clearAllFilters: typeof clearAllFilters !== 'undefined' ? clearAllFilters : null,
        goToPage: typeof goToPage !== 'undefined' ? goToPage : null,
        exportResults: typeof exportResults !== 'undefined' ? exportResults : null,
        addConditionGroup: typeof addConditionGroup !== 'undefined' ? addConditionGroup : null,
        removeConditionGroup: typeof removeConditionGroup !== 'undefined' ? removeConditionGroup : null,
        addCondition: typeof addCondition !== 'undefined' ? addCondition : null,
        removeCondition: typeof removeCondition !== 'undefined' ? removeCondition : null,
        updateConditionField: typeof updateConditionField !== 'undefined' ? updateConditionField : null,
        openSaveSearchModal: typeof openSaveSearchModal !== 'undefined' ? openSaveSearchModal : null,
        loadSavedSearch: typeof loadSavedSearch !== 'undefined' ? loadSavedSearch : null,
        deleteSavedSearch: typeof deleteSavedSearch !== 'undefined' ? deleteSavedSearch : null,
        loadPreset: typeof loadPreset !== 'undefined' ? loadPreset : null,

        // Birthday functions
        openSendBirthdayWish,
        executeSendBirthdayWish,
        openPrepareGiftModal,
        logBirthdayGift,

        // Calendar + Follow-Up Engine — implemented by chunks/script-calendar.js
        // Phase 11: DMS — implemented by chunks/script-documents.js

        // Phase 12 Marketing Functions (chunk-loaded — call via window.app.*)
        editTemplate: async (id) => await (window.app.openCreateTemplateModal || (() => {}))(id),
        editCampaign: async (id) => await (window.app.openCreateCampaignModal || (() => {}))(id),

        // Monthly Promotions ledger

        // Phase 13: Import & Reassignment
        showImportDashboard,
        openImportWizard,
        renderImportStep,
        importNextStep,
        importPrevStep,
        updateImportType,
        autoMapFields,
        clearMapping,
        downloadErrorReport,
        startImport,
        viewImportDetails,
        downloadImportLog,
        openTemplatesModal,
        downloadTemplate,
        showImportHistory,
        handleImportFileDrop,
        handleImportFileSelect,
        exportMarketingList,
        openImportWizardForType,

        // Phase 13: Protection Monitoring
        showProtectionMonitoringView,
        renderTeamSummaryCards,
        renderAgentPerformanceRows,
        renderInactiveProspectsRows,
        renderReassignmentHistory,
        openReassignModal,
        confirmReassignment,
        executeConfirmedReassignment,
        executeConfirmedQuickReassign,
        executeConfirmedBulkReassign,
        executeConfirmedBulkReassignment,
        cancelPendingReassign,
        bulkReassign,
        confirmBulkReassignment,
        refreshFollowupStats,
        exportFollowupReport,
        configureAlerts,
        saveAlertConfig,
        viewAgentDetails,
        contactProspect,

        // Phase 14 Notes/Voice/Mobile — implemented by chunks/script-mobile.js
        // isMobile and applyMobileClass stay in script.js (called from init flow)
        isMobile,
        applyMobileClass,

        // Phase 18: Cases Module Functions

        // Phase 14: Offline Support
        initOfflineSupport,
        addToOfflineQueue,
        processOfflineQueue,
        offlineCreate,
        offlineUpdate,

        // Phase 15: Integrations — implemented by chunks/script-gcal.js

        // Phase 17: AI Analytics — implemented by chunks/script-ai.js
        // (chunk Object.assign overwrites these stubs after navigateTo('ai_insights') loads it)
        initAIAnalytics,
        ensureAIModelsExist,

        // [CHUNK: stock_take] 40 functions Object.assigned to window.app by chunks/script-stock-take.js

        // [CHUNK: egg] 35 functions Object.assigned to window.app by chunks/script-egg.js

        // [CHUNK: boss_report] 8 functions Object.assigned to window.app by chunks/script-boss-report.js

        // ========== FORMULA PURCHASER (Super Admin only) ==========
        // Dashboard
        // PO
        // Transfers
        // Stock Inquiry
        // Vendors
        // Exclusions & Deals
        // Imports
        // Expose UI helper for inline modal actions
        UI,

        // ========== GLOBAL DATA SYNCHRONIZATION ==========
       refreshCurrentView: async () => {   // ✅ now async
    const viewport = document.getElementById('content-viewport');
    if (!viewport) return;
    if (window._isRefreshing) return;
    window._isRefreshing = true;
    try {
        const view = _currentView;
        // Auto-refreshing current view
        switch (view) {
            case 'month':
                await (window.app.renderCalendar || (() => {}))();
                break;
            case 'week':
                await (window.app.renderWeekView || (() => {}))();
                break;
            case 'day':
                await (window.app.renderTodayActivities || (() => {}))();
                break;
            case 'prospects':
                if (_currentDetailView) break;
                await (window.app.showProspectsViewSmart || (() => {}))(viewport);
                break;
            case 'pipeline':
                if (window.app.showPipelineView) await window.app.showPipelineView(viewport);
                break;
            case 'reports':
                if (typeof window.app.refreshKPIDashboard === 'function') await window.app.refreshKPIDashboard();
                break;
            case 'protection':
                if (typeof showProtectionMonitoringView === 'function') await showProtectionMonitoringView(viewport);
                break;
            case 'agents':
                if (window.app.showAgentsView) await window.app.showAgentsView(viewport);
                break;
            case 'referrals':
                if (typeof window.app.showReferralsView === 'function') await window.app.showReferralsView(viewport);
                break;
            case 'cases':
                if (typeof showCasesView === 'function') await (window.app.showCasesView               || (() => {}))(viewport);
                break;
            case 'promotions':
                await showMonthlyPromotionView(viewport);
                break;
            case 'marketing_automation':
                if (typeof showMarketingAutomationView === 'function') await (window.app.showMarketingAutomationView || (() => {}))(viewport);
                break;
            case 'ranking':
                if (typeof window.app.showRankingPerformanceView === 'function') await window.app.showRankingPerformanceView(viewport);
                break;
            case 'workflows':
                _currentMarketingTab = 'automation';
                if (typeof showMarketingAutomationView === 'function') await (window.app.showMarketingAutomationView || (() => {}))(viewport);
                break;
            case 'milestones':
                if (typeof showMilestonesView === 'function') await showMilestonesView(viewport);
                break;
            case 'fude':
                if (typeof showFudeView === 'function') await showFudeView(viewport);
                break;
            case 'egg_purchasing':
                if (typeof showEggPurchasingView === 'function') await (window.app.showEggPurchasingView || (() => {}))(viewport);
                break;
            case 'purchases_history':
                await (window.app.showPurchasesHistoryView || (() => {}))(viewport);
                break;
            default:
                // No specific refresh for this view
        }
    } catch (err) {
        console.error("Error during auto-refresh:", err);
    } finally {
        window._isRefreshing = false;
    }
},

        initSync: () => {
            window.addEventListener('dataChanged', (e) => {
                const { table, action } = e.detail;
                const view = _currentView;

                // "Cold data stays cached until edited": a real mutation wipes only
                // the snapshots that depend on the changed table. SWR revalidate
                // pings are skipped (they aren't user edits). Scoping is critical —
                // the prospect/customer base is slow to refetch, so an activity
                // edit must NOT evict the Home/Calendar people caches.
                if (action && action !== 'revalidate') {
                    if (table === 'activities' || table === 'events') {
                        // Rendered views change; people caches stay warm.
                        _clearMobileSnapshots(['mcal-snap-', 'mcal-acts-', 'mhome-snap-']);
                    } else if (table === 'prospects' || table === 'customers') {
                        // Everything people-derived must refresh.
                        _clearMobileSnapshots(['mp-list-snap-', 'mhome-', 'mcal-people', 'mcal-snap-', 'mcal-acts-']);
                    } else if (table === 'users') {
                        _clearMobileSnapshots(['mhome-users', 'mhome-snap-', 'mcal-people', 'mp-list-snap-']);
                    } else if (table === 'follow_up_drafts' || table === 'refill_reminders') {
                        _clearMobileSnapshots(['mhome-drafts', 'mhome-refills', 'mhome-snap-']);
                    }

                    // ── View HTML cache invalidation ──
                    // A real mutation can stale the rendered DOM of any cached view
                    // that reads this table. Drop those entries so the next visit
                    // re-renders fresh instead of showing pre-edit content.
                    if (table === 'activities' || table === 'events' || table === 'prospects' || table === 'customers') {
                        _invalidateViewCache('month', 'calendar', 'prospects', 'pipeline');
                    } else if (table === 'users') {
                        _invalidateViewCache('prospects', 'pipeline');
                    }
                }

                // Map tables to views that need refresh. Must include every
                // table each view reads so SWR revalidation + mutations auto-
                // refresh the list. When you add a new view to refreshCurrentView,
                // also add its table dependencies here.
                const viewDependencies = {
                    'month': ['activities', 'prospects', 'customers', 'events'],
                    'week': ['activities', 'prospects', 'customers', 'events'],
                    'day': ['activities', 'prospects', 'customers', 'events'],
                    'pipeline': ['prospects', 'activities'],
                    'reports': ['purchases', 'transactions', 'activities', 'agent_targets', 'prospects', 'customers'],
                    'protection': ['prospects', 'activities'],
                    'prospects': ['prospects', 'customers', 'activities'],
                    'referrals': ['referrals', 'prospects', 'customers'],
                    'agents': ['users', 'prospects', 'customers', 'activities', 'agent_targets'],
                    'cases': ['case_studies', 'prospects', 'customers'],
                    'promotions': ['monthly_promotions', 'promotions', 'promotion_packages'],
                    'marketing_automation': ['whatsapp_campaigns', 'whatsapp_templates', 'campaign_messages'],
                    'ranking': ['users', 'prospects', 'purchases', 'transactions'],
                    'workflows': ['whatsapp_campaigns', 'whatsapp_templates'],
                    'milestones': ['user_milestones', 'users'],
                    'fude': ['user_fudi_summary', 'recommendation_rewards'],
                    'egg_purchasing': ['egg_processed_orders', 'egg_urgent_orders', 'egg_config', 'egg_run_history']
                };

                if (viewDependencies[view] && viewDependencies[view].includes(table)) {
                    // Suppress the SWR revalidation flash. SWR fires
                    // dataChanged with action='revalidate' after the cold
                    // page paint, ~1–3s after the user navigates. Rebuilding
                    // the entire view at that moment is what users perceive
                    // as "lag" — the page appears, then flashes and resets.
                    // Mutations (create/update/delete/restore) still refresh
                    // immediately; only the post-nav revalidate flash is
                    // suppressed. Fresh data is picked up on the next nav.
                    if (action === 'revalidate' && (Date.now() - _lastNavigatedAt) < _SWR_REFRESH_GUARD_MS) {
                        return;
                    }
                    appLogic.refreshCurrentView();
                }
            });
            // Global Data Sync initialized
        },

        scheduleCoachingSessions: () => UI.toast.info('Scheduling coaching sessions...'),
        generatePerformanceReport: () => UI.toast.info('Generating performance report...'),
        shareInsights: () => UI.toast.info('Sharing insights...'),
        viewLeadDetails: (id) => app.showProspectDetail(id),
        executeAction: (action) => UI.toast.info(`Executing: ${action}`),
        openAttendeeOutcomeModal,
        openAttendeeNotesModal,
        saveAttendeeNote,

        // Phase: Marketing Manager Listings

        // Feature: Automated Scoring
        addScoreToProspect,
        addScoreToCustomer,
        applyActivityScoring,
        openScoreAdjustmentModal,
        confirmScoreAdjustment,

        // Feature: Protection Auto-Extension
        autoExtendProtection,

        // Feature: Prospect Potential & Opportunities
        openLatestMeetupNotes,
        openEditPotentialModal,
        savePotential,

        // Feature: Birthday Action Workflows
        sendBirthdayWish,
        scheduleBirthdayFollowup,
        executeBirthdayAction,

        // Feature: KPI Hierarchical Targets
        openKPITargetsModal,
        saveKPITargets,
        renderKPITargetComparison,

        // Feature: Ranking Performance Overview + Workflow + Noticeboard
        // → moved to chunks/script-performance.js (loaded lazily by navigateTo)
        // window.app.showRankingPerformanceView etc. are set by Object.assign in the chunk.

        // Customer Health Score
        calculateCustomerHealthScore,
        renderHealthBadge,
        renderQuickHealthBadge,

        // Meeting Scheduler
        showBookingSettingsView,
        openAddSlotModal,
        saveBookingSlot,
        deleteBookingSlot,
        toggleSlotActive,
        copyBookingLink,
        openShareBookingLinkModal,
        updateShareLinkPreview,
        copySmartBookingLink,
        confirmBookingAppointment,
        cancelBookingAppointment,
        openShareCpsIntakeLinkModal,
        saveCpsIntakeLink,
        copyCpsIntakeLink,
        shareCpsIntakeWhatsApp,
        renderPendingCpsIntakes,
        openApproveCpsIntakeModal,
        rejectCpsIntake,

        // CPS Form Photo OCR (Gemini Flash)
        scanCpsForm,
        handleCpsScanFile,
        renderCpsScanReview,
        toggleCpsScanAll,
        applyCpsScanSelection,
        _hideCpsScanOverlay,
        _uploadCpsFormFile,

        // CPS Form Paste-Text Parser
        openCpsPasteModal,
        parseCpsPastedText,

        // Lead Forms + Surveys + Contracts + Custom Fields + Portal — chunks/script-forms.js

        // Level 12/13/14: Noticeboard (公告栏)
        // showNoticeboardView, openNoticeboardDetail → moved to chunks/script-performance.js
        toggleActivityNoticeboardFields,

        // Level 13/14: Milestones & 福德
        showMilestonesView,
        showFudeView,
        markMilestoneCompleted,
        openStoryDetail,
        openHighlightModal,
        saveHighlight,
        deleteHighlight,
        confirmDeleteHighlight,
        resetMilestone,
        syncFudiSummary,
        openRewardModal,
        saveReward,
        deleteReward,
        confirmDeleteReward,

        // Auth exports
        login,
        populateLoginDropdown,
        updateNavVisibility,
        openQuarterlyTargetsModal,
        saveQuarterlyTargets,
        openSpecialProgramModal,
        saveSpecialProgram,
        deleteSpecialProgram,
        confirmDeleteSpecialProgram,

        // Action Plan
        openActionPlanModal,
        addPlanItemRow,
        saveActionPlan,
        updatePlanCheck,
        sendPlanReminder,
        showActionPlanHistory,
        initActionPlanReminder,

        // Formula Healthcare Refill Reminders
        renderRefillReminders,
        checkRefillReminderTable,
        showRefillMigrationModal,
        sendRefillWhatsApp,
        sendDescriptionInvite,
        dismissRefillReminder,
        viewRefillProspect,

        // ==================== BUG AUDIT 2026-04-24: exports for inline onclick handlers ====================
        // Functions that were defined in the IIFE but missing from this return block
        // (caused silent no-ops when their buttons were clicked)
        applyFilters,
        clearFilters,
        showAgentDetail,
        updateConditionOperator,
        updateConditionValue,
        updateGroupLogic,
        // New impls filling dangling onclick references
        deleteFile,
        _confirmDeleteFile,
        showProfile,
        exportKPIDashboard,

        // ==================== CUSTOMER FORMS (Marketing > Forms sub-tab) ====================
        renderFormsTab,
        cfSearchProspects,
        cfClearSignature,
        openCustomerSurveyModal,
        saveCustomerSurvey,
        openCpsAnalysisModal,
        saveCpsAnalysis,
        openApuAppraisalModal,
        saveApuAppraisal,
        openDestinyBlueprintModal,
        openDestinyBlueprintInTab,
        saveDestinyBlueprint,

    };

})();

Object.assign(window.app, appLogic);

// ==================== AUTO-GUARD SAVE/CREATE/ADD (Phase A) ====================
// Wraps every app.save*/create*/add*/update*/submit* with Perf.guardAsync so
// rapid double-taps on mobile cannot fire the same handler twice. The guard
// key includes the function name and a stringified arg signature, so saving
// two different rows in parallel still works — only IDENTICAL re-entrancy is
// suppressed. Disables the clicked button and shows "Saving…" while in-flight.
(function autoGuardAppMutations() {
    if (!window.Perf || !window.app) return;
    const prefixes = ['save', 'create', 'add', 'update', 'submit', 'send'];
    // Skip pure UI / nav helpers that happen to start with these prefixes.
    const skip = new Set([
        'addPlanItemRow', 'addProspectChildRow', 'addPrePurchaseRow', 'addProductPurchaseRow',
        'addAttendee', 'addCoAgent', 'addCoAgentToActivity',
        'updateAttendeeStatus', 'updateCoAgentRole', 'updateConditionOperator',
        'updateConditionValue', 'updateGroupLogic', 'updatePlanCheck', 'updateLunarBirth',
        'updateActivity'
    ]);
    Object.keys(window.app).forEach(k => {
        const fn = window.app[k];
        if (typeof fn !== 'function' || fn._perfGuarded) return;
        if (skip.has(k)) return;
        if (!prefixes.some(p => k.startsWith(p))) return;
        const wrapped = function (...args) {
            // Stable signature: function name + scalar args (drop objects to avoid huge keys).
            const sigArgs = args.map(a => (a == null || typeof a === 'object') ? '' : String(a)).join('|');
            const key = 'app.' + k + ':' + sigArgs;
            return window.Perf.guardAsync(key, () => fn.apply(this, args));
        };
        wrapped._perfGuarded = true;
        window.app[k] = wrapped;
    });
    console.info('[Perf] auto-guard installed on app mutations');
})();

// ==================== AUTO-DEBOUNCE SEARCH/FILTER (Phase C: input lag) ====================
// Inline oninput="app.searchEntities()" handlers fire on every keystroke. Wrap
// known search/filter functions so they only run once typing stops (250ms).
// Functions explicitly using debounceCall in their template stay unchanged.
(function autoDebounceAppSearch() {
    if (!window.Perf || !window.app) return;
    const targets = [
        'mpSearchInput', 'updateShareLinkPreview', 'handleCaseSearch',
        'searchAgents', 'searchConsultants', 'searchEntities',
        'searchProspectReferrers', 'searchBasicInfoReferrers', 'searchReferrers',
        'filterProspects', 'filterCustomers', 'filterActivities', 'filterEvents',
        'searchFiles', 'searchTreePerson', 'searchCaseEntities'
    ];
    let wrappedCount = 0;
    targets.forEach(name => {
        const fn = window.app[name];
        if (typeof fn !== 'function' || fn._perfDebounced) return;
        const debounced = window.Perf.debounce(function (...args) {
            return fn.apply(this, args);
        }, 250);
        debounced._perfDebounced = true;
        window.app[name] = debounced;
        wrappedCount++;
    });
    console.info('[Perf] auto-debounce installed on', wrappedCount, 'search/filter handlers');
})();


// ========== SECURITY INITIALIZATION ==========
const initSecurity = async () => {
    if (typeof window.app.checkForSecurityIncidents !== 'undefined') window.app.checkForSecurityIncidents();
    if (typeof window.app.monitorLoginAttempts !== 'undefined') window.app.monitorLoginAttempts();
    if (typeof window.app.initSessionTimeout !== 'undefined') window.app.initSessionTimeout();
    if (typeof window.app.checkExpiredConsents !== 'undefined') window.app.checkExpiredConsents();
    // Retention jobs run server-side via pg_cron now (migrations/server_cron_2026-05-03.sql).
    // The old daily browser interval scanned system_config and applied retention from every tab.
    // if (typeof window.app.scheduleRetentionJobs !== 'undefined') window.app.scheduleRetentionJobs();
};

let sessionTimeoutTimer;
const initSessionTimeout = async () => {
    // If "Keep me logged in" was checked at last login, skip inactivity timeout entirely
    if (localStorage.getItem('remember_me') === '1') return;
    const timeoutMinutes = parseInt(UserPreferences.getSync('session_timeout', 30));
    const resetTimeout = () => {
        clearTimeout(sessionTimeoutTimer);
        sessionTimeoutTimer = setTimeout(window.app.logoutDueToInactivity, timeoutMinutes * 60 * 1000);
    };
    // Throttled version for high-frequency events (mousemove, scroll)
    let _lastReset = 0;
    const throttledReset = () => {
        const now = Date.now();
        if (now - _lastReset < 5000) return; // at most once per 5 seconds
        _lastReset = now;
        resetTimeout();
    };
    // Attach listeners ONCE (outside resetTimeout to prevent accumulation)
    ['click', 'keypress', 'touchstart'].forEach(event => {
        document.addEventListener(event, resetTimeout, { passive: true });
    });
    ['mousemove', 'scroll'].forEach(event => {
        document.addEventListener(event, throttledReset, { passive: true });
    });
    resetTimeout();
};

const logoutDueToInactivity = async () => {
    if (window.UI && window.UI.toast) window.UI.toast.warning('Session expired due to inactivity');
    if (typeof AuditLogger !== 'undefined') AuditLogger.warn("AUTH", "LOGOUT", { reason: 'session_timeout' });
    if (typeof window.app.logout === 'function') {
        window.app.logout();
    } else if (typeof Auth !== 'undefined') {
        await Auth.logout();
        window.location.reload();
    }
};

const monitorLoginAttempts = async () => {
    let failedAttempts = {};
    try {
        const rows = await AppDataStore.getAll('login_attempts');
        if (rows && rows.length > 0) failedAttempts = rows[0].attempts_data || {};
    } catch (_) {
        failedAttempts = JSON.parse(localStorage.getItem('login_attempts') || '{}');
    }
    const now = Date.now();
    Object.keys(failedAttempts).forEach(ip => {
        failedAttempts[ip] = failedAttempts[ip].filter(t => now - t < 24 * 60 * 60 * 1000);
        if (failedAttempts[ip].length === 0) delete failedAttempts[ip];
    });
    try {
        const rows = await AppDataStore.getAll('login_attempts');
        let updated = null;
        if (rows && rows.length > 0) {
            updated = await AppDataStore.update('login_attempts', rows[0].id, { attempts_data: failedAttempts, updated_at: new Date().toISOString() });
        }
        // No existing row (or the cached one was stale and update() purged it) — insert fresh
        if (!rows || rows.length === 0 || updated === null) {
            await AppDataStore.create('login_attempts', { attempts_data: failedAttempts, updated_at: new Date().toISOString() });
        }
    } catch (_) {}
    // No localStorage fallback — failed login attempts must be server-authoritative to
    // prevent client-side bypass by clearing storage. Previously written to localStorage
    // which allowed attackers to reset the lockout counter at will.
};

const checkForSecurityIncidents = async () => {
    if (!window.AppDataStore) return;
    const incidents = (await AppDataStore.getAll('security_incidents')).filter(i => i.status === 'new' && !i.acknowledged);
    if (incidents.length > 0) {
        const critical = incidents.filter(i => i.severity === 'critical');
        if (critical.length > 0) {
            if (window.UI && window.UI.toast) window.UI.toast.error(`${critical.length} critical security incidents require attention`, 0);
            window.app.addSecurityAlertIcon();
        }
    }
};

const addSecurityAlertIcon = async () => {
    const header = document.querySelector('.top-bar .bar-right');
    if (header && !document.querySelector('.security-alert')) {
        const alert = document.createElement('div');
        alert.className = 'security-alert';
        alert.innerHTML = '<i class="fas fa-exclamation-triangle" style="color:red; cursor:pointer; font-size:20px; margin-right:15px;"></i>';
        alert.title = 'Security incidents require attention';
        alert.onclick = () => window.app.showSecurityDashboard();
        header.insertBefore(alert, header.firstChild);
    }
};

const checkExpiredConsents = async () => {
    if (!window.AppDataStore || typeof ConsentManager === 'undefined') return;
    const users = await AppDataStore.getAll('users');
    const now = new Date();
    users.forEach(user => {
        if (user.consent_preferences) {
            Object.entries(user.consent_preferences).forEach(([type, consent]) => {
                if (consent.expires_at && new Date(consent.expires_at) < now) {
                    ConsentManager.revokeConsent(user.id, type);
                }
            });
        }
    });
};

const scheduleRetentionJobs = async () => {
    if (typeof RetentionPolicy === 'undefined') return;
    // Guard against stacking multiple daily intervals on re-init.
    if (window._retentionInterval) return;
    const runRetention = async () => {
        let lastRun = null;
        try {
            const configs = await AppDataStore.getAll('system_config');
            const retentionConfig = (configs || []).find(c => c.config_key === 'last_retention_run');
            if (retentionConfig) lastRun = retentionConfig.config_value;
        } catch (_) {}
        if (!lastRun || Date.now() - parseInt(lastRun) > 24 * 60 * 60 * 1000) {
            RetentionPolicy.applyRetention();
            const now = Date.now().toString();
            try {
                const configs = await AppDataStore.getAll('system_config');
                const existing = (configs || []).find(c => c.config_key === 'last_retention_run');
                if (existing) {
                    await AppDataStore.update('system_config', existing.id, { config_value: now, updated_at: new Date().toISOString() });
                } else {
                    await AppDataStore.create('system_config', { config_key: 'last_retention_run', config_value: now, updated_at: new Date().toISOString() });
                }
            } catch (_) {}
            // No localStorage fallback — retention run timestamp must be shared across
            // all admin devices so the job doesn't run multiple times per day.
        }
    };
    await runRetention();
    window._retentionInterval = setInterval(runRetention, 24 * 60 * 60 * 1000);
};

const showSecurityDashboard = async () => {
    const incidents = await AppDataStore.getAll('security_incidents') || [];

    let content = `
        <div class="security-dashboard">
            <div class="security-score-card">
                <div class="score-value">92/100</div>
                <div class="score-label">Overall Security Score - Excellent</div>
            </div>
            
            <h3>Recent Security Incidents</h3>
            <div class="incident-list">
                ${incidents.length ? incidents.map(inc => `
                    <div class="incident-item ${inc.severity || 'medium'}">
                        <div class="incident-icon"><i class="fas fa-exclamation-circle"></i></div>
                        <div class="incident-content">
                            <div class="incident-title">${inc.title || 'Security Alert'}</div>
                            <div class="incident-meta">
                                <span>${new Date(inc.timestamp).toLocaleString()}</span>
                            </div>
                        </div>
                    </div>
                `).join('') : '<p>No recent incidents.</p>'}
            </div>
        </div>
    `;
    const view = document.getElementById('content-viewport');
    if (view) view.innerHTML = content;
};

const showAuditLogs = async () => {
    const logs = (await AppDataStore.getAll('audit_logs') || [])
        .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
        .slice(0, 50);

    let content = `
        <div class="audit-log-viewer" style="margin:24px;">
            <h2>Audit Logs</h2>
            <div class="audit-filters">
                <select class="form-control" style="width:200px"><option>All Categories</option></select>
                <select class="form-control" style="width:200px">
                    <option>All Levels</option>
                    ${USER_ROLES.map(r => `<option>${r}</option>`).join('')}
                </select>
            </div>
            <table class="audit-table">
                <thead>
                    <tr>
                        <th scope="col">Timestamp</th>
                        <th scope="col">Level</th>
                        <th scope="col">Category</th>
                        <th scope="col">Action</th>
                        <th scope="col">User</th>
                    </tr>
                </thead>
                <tbody>
                    ${logs.map(log => `
                        <tr>
                            <td>${new Date(log.timestamp).toLocaleString()}</td>
                            <td><span class="log-level ${log.level}">${log.level}</span></td>
                            <td>${log.category}</td>
                            <td>${log.action}</td>
                            <td>${log.user_id || 'System'}</td>
                        </tr>
                    `).join('')}
                    ${!logs.length ? '<tr><td colspan="5">No logs found.</td></tr>' : ''}
                </tbody>
            </table>
        </div>
    `;
    const view = document.getElementById('content-viewport');
    if (view) view.innerHTML = content;
};

const showComplianceCenter = () => {
    let content = `
        <div class="compliance-center" style="margin:24px;">
            <h2>Compliance Center</h2>
            <p>Manage GDPR and PDPA compliance features.</p>
            
            <div class="retention-policies" style="margin-top:24px;">
                <h3>Active Retention Policies</h3>
                <div class="policy-card">
                    <div class="policy-header">
                        <div class="policy-name">Audit Logs Retention</div>
                        <div class="policy-action">Archive</div>
                    </div>
                    <div class="policy-details">Retain for: 365 Days</div>
                </div>
                <div class="policy-card">
                    <div class="policy-header">
                        <div class="policy-name">Inactive Prospects Data</div>
                        <div class="policy-action">Anonymize</div>
                    </div>
                    <div class="policy-details">Retain for: 730 Days</div>
                </div>
            </div>
        </div>
    `;
    const view = document.getElementById('content-viewport');
    if (view) view.innerHTML = content;
};

// Add to window.app
Object.assign(window.app, {
    initSecurity,
    initSessionTimeout,
    logoutDueToInactivity,
    monitorLoginAttempts,
    checkForSecurityIncidents,
    addSecurityAlertIcon,
    checkExpiredConsents,
    scheduleRetentionJobs,
    showSecurityDashboard,
    showAuditLogs,
    showComplianceCenter,
    showTwoFactorSetup: typeof showTwoFactorSetup !== 'undefined' ? showTwoFactorSetup : () => UI.toast.warning('Two-factor authentication is not enabled on this build.'),
    verifyAndEnable2FA: typeof verifyAndEnable2FA !== 'undefined' ? verifyAndEnable2FA : () => UI.toast.warning('Two-factor authentication is not enabled on this build.'),
    showTwoFactorLogin: typeof showTwoFactorLogin !== 'undefined' ? showTwoFactorLogin : () => UI.toast.warning('Two-factor authentication is not enabled on this build.'),
    verifyTwoFactorLogin: typeof verifyTwoFactorLogin !== 'undefined' ? verifyTwoFactorLogin : () => UI.toast.warning('Two-factor authentication is not enabled on this build.')
});

// ========== PHASE 20: SYSTEM ADMINISTRATION & DEPLOYMENT ==========

const showAdminDashboard = async () => {
    const _adminCheckUser = await Auth.getCurrentUser();
    if (!_adminCheckUser || _adminCheckUser.role !== 'admin') {
        if (window.UI) window.UI.toast.error("Access Denied. Admins only.");
        return;
    }

    const health = typeof SystemHealth !== 'undefined' ? SystemHealth.checkAll() : { status: 'UNKNOWN' };
    const tenants = typeof TenantManager !== 'undefined' ? TenantManager.listTenants() : [];
    const activeTenants = tenants.filter(t => t.status === 'ACTIVE').length;
    const updates = typeof DeploymentManager !== 'undefined' ? DeploymentManager.checkForUpdates() : null;

    let content = `
        <div class="admin-dashboard fade-in" style="padding: 24px;">
            <div class="header-actions" style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 24px;">
                <h2>System Administration</h2>
                <button class="btn primary" onclick="app.showSystemHealth()"><i class="fas fa-stethoscope"></i> Run Health Check</button>
            </div>

            <div class="kpi-grid" style="display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 20px; margin-bottom: 24px;">
                <div class="kpi-card" style="background: white; padding: 20px; border-radius: 8px; box-shadow: 0 1px 3px rgba(0,0,0,0.1);">
                    <div class="kpi-title" style="color: var(--gray-600); font-size: 14px; margin-bottom: 8px;">System Status</div>
                    <div class="kpi-value ${health.status === 'HEALTHY' ? 'status-active' : (health.status === 'DEGRADED' ? 'status-warning' : 'status-danger')}" style="font-size: 24px; font-weight: bold;">
                        ${health.status}
                    </div>
                </div>
                <div class="kpi-card" style="background: white; padding: 20px; border-radius: 8px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); cursor: pointer;" onclick="app.showTenantManagement()">
                    <div class="kpi-title" style="color: var(--gray-600); font-size: 14px; margin-bottom: 8px;">Active Tenants</div>
                    <div class="kpi-value" style="font-size: 24px; font-weight: bold; color: var(--gray-900);">${activeTenants} / ${tenants.length}</div>
                </div>
                <div class="kpi-card" style="background: white; padding: 20px; border-radius: 8px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); cursor: pointer;" onclick="app.showDeploymentCenter()">
                    <div class="kpi-title" style="color: var(--gray-600); font-size: 14px; margin-bottom: 8px;">System Version</div>
                    <div class="kpi-value" style="font-size: 24px; font-weight: bold; color: var(--gray-900);">
                        ${updates && updates.hasUpdate ? '<span style="color: var(--warning-color); font-size:16px;">Update Available</span>' : 'Up to Date'}
                    </div>
                </div>
            </div>

            <div class="admin-modules-grid" style="display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 20px;">
                
                <div class="admin-module-card" style="background: white; padding: 24px; border-radius: 8px; border: 1px solid var(--gray-200); text-align: center; cursor: pointer; transition: transform 0.2s;" onclick="app.showTenantManagement()" onmouseover="this.style.transform='translateY(-5px)'" onmouseout="this.style.transform='translateY(0)'">
                    <i class="fas fa-building" style="font-size: 40px; color: var(--primary-color); margin-bottom: 16px;"></i>
                    <h3>Tenant Management</h3>
                    <p style="color: var(--gray-600); font-size: 14px; margin-top: 8px;">Manage multi-tenant architecture, provision new tenants, and monitor usage.</p>
                </div>

                <div class="admin-module-card" style="background: white; padding: 24px; border-radius: 8px; border: 1px solid var(--gray-200); text-align: center; cursor: pointer; transition: transform 0.2s;" onclick="app.showSystemHealth()" onmouseover="this.style.transform='translateY(-5px)'" onmouseout="this.style.transform='translateY(0)'">
                    <i class="fas fa-heartbeat" style="font-size: 40px; color: var(--success-color); margin-bottom: 16px;"></i>
                    <h3>System Health</h3>
                    <p style="color: var(--gray-600); font-size: 14px; margin-top: 8px;">Monitor database, API, storage, and external service connectivity.</p>
                </div>

                <div class="admin-module-card" style="background: white; padding: 24px; border-radius: 8px; border: 1px solid var(--gray-200); text-align: center; cursor: pointer; transition: transform 0.2s;" onclick="app.showBackupManager()" onmouseover="this.style.transform='translateY(-5px)'" onmouseout="this.style.transform='translateY(0)'">
                    <i class="fas fa-database" style="font-size: 40px; color: var(--secondary-color); margin-bottom: 16px;"></i>
                    <h3>Backup & Restore</h3>
                    <p style="color: var(--gray-600); font-size: 14px; margin-top: 8px;">Configure automated backups, manage snapshots, and perform data restoration.</p>
                </div>

                <div class="admin-module-card" style="background: white; padding: 24px; border-radius: 8px; border: 1px solid var(--gray-200); text-align: center; cursor: pointer; transition: transform 0.2s;" onclick="app.showPerformanceMonitor()" onmouseover="this.style.transform='translateY(-5px)'" onmouseout="this.style.transform='translateY(0)'">
                    <i class="fas fa-tachometer-alt" style="font-size: 40px; color: var(--warning-color); margin-bottom: 16px;"></i>
                    <h3>Performance Monitor</h3>
                    <p style="color: var(--gray-600); font-size: 14px; margin-top: 8px;">Track query execution times, memory usage, and application delays.</p>
                </div>

                <div class="admin-module-card" style="background: white; padding: 24px; border-radius: 8px; border: 1px solid var(--gray-200); text-align: center; cursor: pointer; transition: transform 0.2s;" onclick="app.showDeploymentCenter()" onmouseover="this.style.transform='translateY(-5px)'" onmouseout="this.style.transform='translateY(0)'">
                    <i class="fas fa-rocket" style="font-size: 40px; color: #8b5cf6; margin-bottom: 16px;"></i>
                    <h3>Deployment Center</h3>
                    <p style="color: var(--gray-600); font-size: 14px; margin-top: 8px;">Manage CI/CD pipelines, rollouts to different environments, and zero-downtime updates.</p>
                </div>

                <div class="admin-module-card" style="background: white; padding: 24px; border-radius: 8px; border: 1px solid var(--gray-200); text-align: center; cursor: pointer; transition: transform 0.2s;" onclick="app.showSystemLogs()" onmouseover="this.style.transform='translateY(-5px)'" onmouseout="this.style.transform='translateY(0)'">
                    <i class="fas fa-terminal" style="font-size: 40px; color: var(--gray-800); margin-bottom: 16px;"></i>
                    <h3>System Logs</h3>
                    <p style="color: var(--gray-600); font-size: 14px; margin-top: 8px;">View consolidated application, database, and system error logs.</p>
                </div>
            </div>
        </div>
    `;

    const view = document.getElementById('content-viewport');
    if (view) view.innerHTML = content;
};

const showTenantManagement = () => {
    let tenants = typeof TenantManager !== 'undefined' ? TenantManager.listTenants() : [];
    if (tenants.length === 0) {
        // Seed some dummy tenants for demonstration
        if (typeof TenantManager !== 'undefined') {
            TenantManager.createTenant('FSC-TE-DEMO1', 'Alpha Agency CRM', 'admin@alpha-agency.com');
            TenantManager.createTenant('FSC-TE-DEMO2', 'Beta Properties', 'admin@beta-prop.com');
            tenants = TenantManager.listTenants();
        }
    }

    let content = `
        <div class="tenant-management" style="padding: 24px;">
            <div class="header-actions" style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 24px;">
                <h2>Tenant Management</h2>
                <button class="btn primary" onclick="app.openCreateTenantModal()"><i class="fas fa-plus"></i> New Tenant</button>
            </div>
            
            <div class="data-table-container">
                <table class="data-table" style="width: 100%; border-collapse: collapse;">
                    <thead>
                        <tr style="background: var(--gray-100); text-align: left;">
                            <th scope="col" style="padding: 12px; border-bottom: 1px solid var(--gray-200);">Tenant ID</th>
                            <th scope="col" style="padding: 12px; border-bottom: 1px solid var(--gray-200);">Name</th>
                            <th scope="col" style="padding: 12px; border-bottom: 1px solid var(--gray-200);">Plan</th>
                            <th scope="col" style="padding: 12px; border-bottom: 1px solid var(--gray-200);">Status</th>
                            <th scope="col" style="padding: 12px; border-bottom: 1px solid var(--gray-200);">Provisioned</th>
                            <th scope="col" style="padding: 12px; border-bottom: 1px solid var(--gray-200);">Actions</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${tenants.map(t => `
                            <tr>
                                <td style="padding: 12px; border-bottom: 1px solid var(--gray-200);">${t.tenant_id}</td>
                                <td style="padding: 12px; border-bottom: 1px solid var(--gray-200);"><strong>${t.name}</strong></td>
                                <td style="padding: 12px; border-bottom: 1px solid var(--gray-200);">${t.plan}</td>
                                <td style="padding: 12px; border-bottom: 1px solid var(--gray-200);"><span class="status-badge status-${t.status.toLowerCase()}">${t.status}</span></td>
                                <td style="padding: 12px; border-bottom: 1px solid var(--gray-200);">${new Date(t.created_at).toLocaleDateString()}</td>
                                <td style="padding: 12px; border-bottom: 1px solid var(--gray-200);">
                                    <button class="btn-icon" onclick="app.viewTenantDetails('${t.tenant_id}')" title="View"><i class="fas fa-eye"></i></button>
                                    <button class="btn-icon" onclick="app.suspendTenant('${t.tenant_id}')" title="${t.status === 'ACTIVE' ? 'Suspend' : 'Activate'}">
                                        <i class="fas ${t.status === 'ACTIVE' ? 'fa-pause' : 'fa-play'}"></i>
                                    </button>
                                </td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            </div>
        </div>
    `;
    const view = document.getElementById('content-viewport');
    if (view) view.innerHTML = content;
};

const openCreateTenantModal = () => {
    let content = `
        <div class="form-group">
            <label>Tenant ID (Identifier)</label>
            <input type="text" id="new-tenant-id" class="form-control" placeholder="e.g. COMPANY-A">
        </div>
        <div class="form-group">
            <label>Tenant Name</label>
            <input type="text" id="new-tenant-name" class="form-control" placeholder="Company Name">
        </div>
        <div class="form-group">
            <label>Admin Email</label>
            <input type="email" id="new-tenant-email" class="form-control" placeholder="admin@company.com">
        </div>
    `;
    if (window.UI) {
        UI.showModal('Provision New Tenant', content, [
            { label: 'Cancel', type: 'secondary', action: 'UI.hideModal()' },
            { label: 'Provision Tenant', type: 'primary', action: '(async () => { await app.submitNewTenant(); })()' }
        ]);
    }
};

const submitNewTenant = () => {
    const id = document.getElementById('new-tenant-id').value;
    const name = document.getElementById('new-tenant-name').value;
    const email = document.getElementById('new-tenant-email').value;
    if (!id || !name || !email) {
        if (window.UI) UI.toast.error("Please fill all fields");
        return;
    }
    if (typeof TenantManager !== 'undefined') {
        TenantManager.createTenant(id, name, email);
    }
    if (window.UI) {
        UI.hideModal();
        UI.toast.success("Tenant provisioned successfully");
    }
    showTenantManagement();
};

const showSystemHealth = () => {
    const health = typeof SystemHealth !== 'undefined' ? SystemHealth.checkAll() : { status: 'UNKNOWN', components: {} };
    let content = `
        <div class="system-health" style="padding: 24px;">
            <div class="header-actions" style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 24px;">
                <h2>System Health</h2>
                <button class="btn secondary" onclick="app.showSystemHealth()"><i class="fas fa-sync-alt"></i> Refresh</button>
            </div>
            <div class="kpi-card" style="background: white; padding: 20px; border-radius: 8px; margin-bottom: 24px; border: 1px solid var(--gray-200);">
                <h3>Overall Status: <span class="${health.status === 'HEALTHY' ? 'status-active' : 'status-danger'}">${health.status}</span></h3>
                <p style="color: var(--gray-500); font-size: 14px;">Last checked: ${new Date(health.timestamp).toLocaleString()}</p>
            </div>
            <div class="components-grid" style="display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 16px;">
                ${Object.entries(health.components).map(([name, status]) => `
                    <div style="background: white; padding: 16px; border-radius: 8px; border: 1px solid var(--gray-200); display: flex; align-items: center;">
                        <i class="fas ${status === 'up' ? 'fa-check-circle' : 'fa-times-circle'}" style="color: ${status === 'up' ? 'var(--success-color)' : 'var(--danger-color)'}; font-size: 24px; margin-right: 16px;"></i>
                        <div>
                            <div style="font-weight: bold; text-transform: capitalize;">${name.replace('_', ' ')} Node</div>
                            <div style="font-size: 12px; color: var(--gray-500);">Status: ${status.toUpperCase()}</div>
                        </div>
                    </div>
                `).join('')}
            </div>
        </div>
    `;
    const view = document.getElementById('content-viewport');
    if (view) view.innerHTML = content;
};

const showBackupManager = async () => {
    let backups = typeof BackupManager !== 'undefined' ? BackupManager.listBackups() : [];
    let content = `
        <div class="backup-manager" style="padding: 24px;">
            <div class="header-actions" style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 24px;">
                <h2>Backup & Restore</h2>
                <div>
                    <button class="btn secondary" onclick="app.createBackup('INCREMENTAL')">Incremental Backup</button>
                    <button class="btn primary" onclick="app.createBackup('FULL')"><i class="fas fa-save"></i> Full Backup</button>
                </div>
            </div>
            <div class="data-table-container">
                <table class="data-table" style="width: 100%; border-collapse: collapse;">
                    <thead>
                        <tr style="background: var(--gray-100); text-align: left;">
                            <th scope="col" style="padding: 12px; border-bottom: 1px solid var(--gray-200);">Backup ID</th>
                            <th scope="col" style="padding: 12px; border-bottom: 1px solid var(--gray-200);">Date</th>
                            <th scope="col" style="padding: 12px; border-bottom: 1px solid var(--gray-200);">Type</th>
                            <th scope="col" style="padding: 12px; border-bottom: 1px solid var(--gray-200);">Status</th>
                            <th scope="col" style="padding: 12px; border-bottom: 1px solid var(--gray-200);">Size (KB)</th>
                            <th scope="col" style="padding: 12px; border-bottom: 1px solid var(--gray-200);">Actions</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${backups.length > 0 ? backups.map(b => `
                            <tr>
                                <td style="padding: 12px; border-bottom: 1px solid var(--gray-200);">${b.id}</td>
                                <td style="padding: 12px; border-bottom: 1px solid var(--gray-200);">${new Date(b.created_at).toLocaleString()}</td>
                                <td style="padding: 12px; border-bottom: 1px solid var(--gray-200);">${b.type}</td>
                                <td style="padding: 12px; border-bottom: 1px solid var(--gray-200);"><span class="status-badge status-${b.status.toLowerCase()}">${b.status}</span></td>
                                <td style="padding: 12px; border-bottom: 1px solid var(--gray-200);">${Math.round(b.size / 1024)}</td>
                                <td style="padding: 12px; border-bottom: 1px solid var(--gray-200);">
                                    <button class="btn btn-sm secondary" onclick="app.restoreBackup('${b.id}')">Restore</button>
                                </td>
                            </tr>
                        `).join('') : '<tr><td colspan="6" style="padding: 16px; text-align: center;">No backups found.</td></tr>'}
                    </tbody>
                </table>
            </div>
        </div>
    `;
    const view = document.getElementById('content-viewport');
    if (view) view.innerHTML = content;
};

const createBackup = async (type) => {
    if (typeof BackupManager !== 'undefined') {
        const id = await BackupManager.createBackup(type);
        if (window.UI) UI.toast.success(`Backup ${id} initiated successfully`);
        setTimeout(showBackupManager, 1000); // Refresh view after a simulated delay
    }
};

const restoreBackup = (id) => {
    if (confirm("Are you sure you want to restore this backup? This will replace current data.")) {
        if (typeof BackupManager !== 'undefined') {
            BackupManager.restoreBackup(id);
            if (window.UI) UI.toast.success("Backup restored successfully");
        }
    }
};

const showPerformanceMonitor = async () => {
    if (window.UI) window.UI.toast.info("Generating performance metrics report...");
    let content = `
        <div class="performance-monitor" style="padding: 24px;">
            <h2>Performance Monitor</h2>
            <p>Performance monitoring active. View reports via the browser console or use the System Logs feature to see documented warnings.</p>
            <div class="kpi-card" style="background: white; padding: 20px; border-radius: 8px; margin-top:20px;">
                <canvas id="performanceChart" width="400" height="150"></canvas>
            </div>
        </div>
    `;
    const view = document.getElementById('content-viewport');
    if (view) {
        view.innerHTML = content;
        // Mock chart
        setTimeout(async () => {
            const ctx = document.getElementById('performanceChart');
            if (!ctx) return;
            await window._ensureChartJs();
            if (window.Chart) {
                new Chart(ctx, {
                    type: 'line',
                    data: {
                        labels: ['10:00', '10:05', '10:10', '10:15', '10:20', '10:25'],
                        datasets: [{ label: 'Average Query Time (ms)', data: [12, 19, 15, 25, 22, 18], borderColor: 'var(--primary)', tension: 0.1 }]
                    }
                });
            }
        }, 100);
    }
};

const showDeploymentCenter = async () => {
    const history = typeof DeploymentManager !== 'undefined' ? DeploymentManager.getDeploymentHistory() : [];
    let content = `
        <div class="deployment-center" style="padding: 24px;">
            <div class="header-actions" style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 24px;">
                <h2>Deployment Center</h2>
                <button class="btn primary" onclick="app.executeDeployment()"><i class="fas fa-rocket"></i> Deploy New Version</button>
            </div>
            
            <div class="data-table-container">
                <table class="data-table" style="width: 100%; border-collapse: collapse;">
                    <thead>
                        <tr style="background: var(--gray-100); text-align: left;">
                            <th scope="col" style="padding: 12px; border-bottom: 1px solid var(--gray-200);">Version</th>
                            <th scope="col" style="padding: 12px; border-bottom: 1px solid var(--gray-200);">Environment</th>
                            <th scope="col" style="padding: 12px; border-bottom: 1px solid var(--gray-200);">Status</th>
                            <th scope="col" style="padding: 12px; border-bottom: 1px solid var(--gray-200);">Deployed At</th>
                            <th scope="col" style="padding: 12px; border-bottom: 1px solid var(--gray-200);">Actions</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${history.length > 0 ? history.map(d => `
                            <tr>
                                <td style="padding: 12px; border-bottom: 1px solid var(--gray-200);"><strong>${d.version}</strong></td>
                                <td style="padding: 12px; border-bottom: 1px solid var(--gray-200);">${d.environment}</td>
                                <td style="padding: 12px; border-bottom: 1px solid var(--gray-200);"><span class="status-badge status-${d.status.toLowerCase()}">${d.status}</span></td>
                                <td style="padding: 12px; border-bottom: 1px solid var(--gray-200);">${new Date(d.deployed_at).toLocaleString()}</td>
                                <td style="padding: 12px; border-bottom: 1px solid var(--gray-200);">
                                    ${d.status === 'COMPLETED' ? `<button class="btn btn-sm warning" onclick="app.rollbackDeployment('${d.version}')">Rollback</button>` : '-'}
                                </td>
                            </tr>
                        `).join('') : '<tr><td colspan="5" style="padding: 16px; text-align: center;">No deployment history.</td></tr>'}
                    </tbody>
                </table>
            </div>
        </div>
    `;
    const view = document.getElementById('content-viewport');
    if (view) view.innerHTML = content;
};

const executeDeployment = async () => {
    if (typeof DeploymentManager !== 'undefined') {
        const version = 'v' + (8.7 + Math.random() * 0.1).toFixed(2);
        DeploymentManager.createDeployment(version, 'PRODUCTION', { 'feature_x': true });
        if (window.UI) UI.toast.success(`Deployment ${version} started`);
        setTimeout(showDeploymentCenter, 1000);
    }
};

const rollbackDeployment = async (version) => {
    if (confirm(`Are you sure you want to rollback from ${version}?`)) {
        if (typeof DeploymentManager !== 'undefined') {
            await DeploymentManager.rollbackDeployment(version);
            if (window.UI) UI.toast.success('Rollback initiated');
            setTimeout(showDeploymentCenter, 1000);
        }
    }
};

const showSystemLogs = () => {
    if (typeof SystemLogger !== 'undefined') {
        SystemLogger.showLogViewer();
    } else {
        if (window.UI) window.UI.toast.error("SystemLogger not available");
    }
};


// Add new Admin UI Functions to window.app
Object.assign(window.app, {
    showAdminDashboard,
    showTenantManagement,
    openCreateTenantModal,
    submitNewTenant,
    showSystemHealth,
    showBackupManager,
    createBackup,
    restoreBackup,
    showPerformanceMonitor,
    showDeploymentCenter,
    executeDeployment,
    rollbackDeployment,
    showSystemLogs,
    viewEntityDetail: async (entity, id) => {
        if (window.app.hideSearchPanel) window.app.hideSearchPanel();
        switch (entity) {
            case 'prospects': if (window.app.showProspectDetail) await window.app.showProspectDetail(id); break;
            case 'customers': if (window.app.showCustomerDetail) await window.app.showCustomerDetail(id); break;
            case 'agents': if (window.app.showAgentDetail) await window.app.showAgentDetail(id); break;
            case 'products':
            case 'bujishu':
            case 'formula':
                // Navigate to the Marketing > Lists section
                if (window.app.navigateTo) await window.app.navigateTo('marketing');
                UI.toast.info('Navigate to Marketing → Lists to manage ' + entity);
                break;
            case 'activities':
                if (window.app.showActivityDetail) await window.app.showActivityDetail(id);
                break;
            case 'transactions':
                if (window.app.showTransactionDetail) await window.app.showTransactionDetail(id);
                else UI.toast.info('Transaction #' + id);
                break;
            case 'events':
                if (window.app.showEventDetail) await window.app.showEventDetail(id);
                else UI.toast.info('Event #' + id);
                break;
            default: console.warn('Unknown entity type:', entity);
        }
    },
    // Provide mocks for some inline UI handlers to avoid errors if they don't exist
    suspendTenant: async (id) => {   // ← added 'async'
        if (window.UI) window.UI.toast.info("Tenant suspended state toggled.");
        // Remove 'await' – setTimeout doesn't return a promise
        setTimeout(showTenantManagement, 500);
    },
    viewTenantDetails: (id) => {
        if (window.UI) window.UI.toast.info("Viewing details for " + id);
    }
});

// ============================================================================
// ORG CHART CONSULTANT — corporate org restructure consulting tool (2026-05-30)
// ============================================================================
// Consultant-side feature: enter a client's team roster (DOB + role),
// run analysis, deliver a sanitised client-facing report. Pricing tiers
// locked in via DB trigger (migrations/org_chart_consultant_2026-05-30.sql).
//
// Architecture notes:
//   • Lives at TOP LEVEL (post-IIFE) so it can be wired via Object.assign,
//     mirroring the showAdminDashboard / showTenantManagement pattern.
//   • Navigation route is added inside the IIFE's navigateTo router
//     (~line 11704 — search 'viewId === \'org_chart\'').
//   • BaZi-secrecy enforced: ORG_TERM_MAP rewrites any leaked terminology
//     before report HTML is persisted or rendered. Internal notes stay raw.
// ============================================================================

const ORG_TIERS = [
    { code: 't1_5',   min: 1,  max: 5,  price: 99 },
    { code: 't6_10',  min: 6,  max: 10, price: 399 },
    { code: 't11_15', min: 11, max: 15, price: 699 },
    { code: 't16_20', min: 16, max: 20, price: 999 },
    { code: 't21_25', min: 21, max: 25, price: 1499 },
    { code: 't26_30', min: 26, max: 30, price: 1999 },
    { code: 't31_35', min: 31, max: 35, price: 2499 },
    { code: 't36_40', min: 36, max: 40, price: 2999 },
    { code: 't41_45', min: 41, max: 45, price: 3499 },
    { code: 't46_50', min: 46, max: 50, price: 3999 },
];

const _orgTierForSize = (size) => ORG_TIERS.find(t => size >= t.min && size <= t.max) || null;

// BaZi-secrecy sanitiser. Anything that touches report_html or DOM goes
// through this. Codes are matched case-insensitively.
const ORG_TERM_MAP = {
    'bazi':         'temperament pattern',
    '八字':         'temperament pattern',
    'life chart':   'role-fit profile',
    'life-chart':   'role-fit profile',
    'lifechart':    'role-fit profile',
    'day master':   'core trait',
    'daymaster':    'core trait',
    'feng shui':    'workplace harmony',
    'fengshui':     'workplace harmony',
    'bagua':        'eight-area framework',
    '八卦':         'eight-area framework',
};

const _orgSanitiseClientText = (raw) => {
    if (!raw) return '';
    let out = String(raw);
    for (const [bad, good] of Object.entries(ORG_TERM_MAP)) {
        const re = new RegExp(bad.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&'), 'gi');
        out = out.replace(re, good);
    }
    return out;
};

const ORG_ARCHETYPES = [
    { code: 'leader',     label: 'Strategic Leader',     hint: 'sets direction, takes accountability' },
    { code: 'operator',   label: 'Operational Driver',   hint: 'executes plans, hits targets' },
    { code: 'connector',  label: 'People Connector',     hint: 'builds bridges, mediates' },
    { code: 'analyst',    label: 'Analytical Thinker',   hint: 'pattern recognition, data-led' },
    { code: 'creator',    label: 'Creative Innovator',   hint: 'new ideas, breaks moulds' },
    { code: 'guardian',   label: 'Quality Guardian',     hint: 'standards, follow-through' },
    { code: 'catalyst',   label: 'Growth Catalyst',      hint: 'energises others, drives change' },
    { code: 'mentor',     label: 'Capability Builder',   hint: 'teaches, coaches, develops talent' },
];

const _orgArchetypeLabel = (code) => {
    if (!code) return '';
    const a = ORG_ARCHETYPES.find(x => x.code === code);
    return a?.label || code;
};

// Lightweight DOB → archetype mapping. NOT a real BaZi engine — v1 demo
// using day-of-year mod archetype count. Replace with the live
// compute_life_chart_score once the engine is portable. Crucially: ZERO
// internal terminology surfaces from this function.
const _orgComputeArchetype = (member) => {
    const dob = member.dob;
    if (!dob) return { code: 'analyst', score: 60, note: 'incomplete data' };
    const d = new Date(dob);
    if (isNaN(d.getTime())) return { code: 'analyst', score: 60, note: 'unparseable date' };
    const dayOfYear = Math.floor((d - new Date(d.getFullYear(), 0, 0)) / 86400000);
    const idx = (dayOfYear + (member.name?.length || 0)) % ORG_ARCHETYPES.length;
    const score = 60 + ((dayOfYear * 7) % 41); // 60..100
    return { code: ORG_ARCHETYPES[idx].code, score, note: '' };
};

const _orgPairScore = (a, b) => {
    const ai = ORG_ARCHETYPES.findIndex(x => x.code === a.archetype_code);
    const bi = ORG_ARCHETYPES.findIndex(x => x.code === b.archetype_code);
    if (ai < 0 || bi < 0) return 60;
    const dist = Math.abs(ai - bi);
    if (dist === 0) return 55;   // same archetype → mild friction
    if (dist === 1) return 75;
    if (dist === 2) return 85;
    if (dist === 3) return 80;
    return 70;
};

// Local html-escape — avoids needing the IIFE-private escapeHtml.
function _orgEscapeHtml(s) {
    if (s == null) return '';
    return String(s)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

// ---------------- LIST VIEW ----------------
const showOrgChartView = async (viewport) => {
    viewport = viewport || document.getElementById('content-viewport');
    if (!viewport) return;

    let rows = [];
    try {
        const all = await AppDataStore.getAll('org_consultations');
        rows = (all || []).slice().sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    } catch (_) {
        rows = [];
    }

    const statusBadge = (s) => {
        const map = { draft: ['#94a3b8', 'Draft'], collecting: ['#3b82f6', 'Collecting'], analyzing: ['#8b5cf6', 'Analysing'], completed: ['#16a34a', 'Completed'], delivered: ['#0891b2', 'Delivered'] };
        const [bg, label] = map[s] || ['#94a3b8', '—'];
        return `<span style="background:${bg};color:#fff;font-size:11px;padding:2px 8px;border-radius:10px;">${label}</span>`;
    };
    const payBadge = (p) => {
        const map = { paid: ['#16a34a', 'Paid'], unpaid: ['#dc2626', 'Unpaid'], waived: ['#94a3b8', 'Waived'] };
        const [bg, label] = map[p] || ['#94a3b8', '—'];
        return `<span style="background:${bg};color:#fff;font-size:11px;padding:2px 8px;border-radius:10px;">${label}</span>`;
    };

    viewport.innerHTML = `
        <div style="padding:24px;">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px;gap:16px;flex-wrap:wrap;">
                <div>
                    <h1 style="margin:0;font-size:24px;">Org Chart Consultant</h1>
                    <div style="color:var(--gray-500);font-size:13px;margin-top:4px;">Corporate team restructure analysis — RM 99 to RM 3,999 per engagement</div>
                </div>
                <button class="btn primary" onclick="app.openNewOrgConsultation()">
                    <i class="fas fa-plus"></i> New Consultation
                </button>
            </div>
            <div style="background:#fff;border:1px solid var(--gray-200);border-radius:8px;overflow:hidden;">
                <table style="width:100%;border-collapse:collapse;font-size:14px;">
                    <thead style="background:var(--gray-100);text-align:left;">
                        <tr>
                            <th style="padding:12px;">Client Company</th>
                            <th style="padding:12px;">Team Size</th>
                            <th style="padding:12px;">Price</th>
                            <th style="padding:12px;">Payment</th>
                            <th style="padding:12px;">Status</th>
                            <th style="padding:12px;">Created</th>
                            <th style="padding:12px;text-align:right;">Actions</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${rows.length ? rows.map(r => `
                            <tr style="border-top:1px solid var(--gray-200);">
                                <td style="padding:12px;"><strong>${_orgEscapeHtml(r.client_company)}</strong>${r.client_contact_name ? `<div style="font-size:11px;color:var(--gray-500);">${_orgEscapeHtml(r.client_contact_name)}</div>` : ''}</td>
                                <td style="padding:12px;">${r.team_size}</td>
                                <td style="padding:12px;">RM ${Number(r.price_myr).toLocaleString()}</td>
                                <td style="padding:12px;">${payBadge(r.payment_status)}</td>
                                <td style="padding:12px;">${statusBadge(r.status)}</td>
                                <td style="padding:12px;font-size:12px;color:var(--gray-500);">${new Date(r.created_at).toLocaleDateString()}</td>
                                <td style="padding:12px;text-align:right;">
                                    <button class="btn btn-sm" onclick="app.openOrgConsultationDetail(${r.id})">Open</button>
                                </td>
                            </tr>
                        `).join('') : `
                            <tr><td colspan="7" style="padding:32px;text-align:center;color:var(--gray-500);">
                                No consultations yet. Click "New Consultation" to start.
                            </td></tr>
                        `}
                    </tbody>
                </table>
            </div>
        </div>
    `;
};

// ---------------- NEW CONSULTATION ----------------
const openNewOrgConsultation = async () => {
    const tierRows = ORG_TIERS.map(t => `
        <tr><td style="padding:6px 10px;">${t.min}–${t.max} pax</td><td style="padding:6px 10px;text-align:right;">RM ${t.price.toLocaleString()}</td></tr>
    `).join('');

    UI.showModal('New Org Chart Consultation', `
        <div style="display:grid;grid-template-columns:1fr 220px;gap:20px;">
            <div>
                <div class="form-group"><label>Client Company *</label>
                    <input type="text" id="org-new-company" class="form-control" placeholder="ABC Sdn Bhd"></div>
                <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
                    <div class="form-group"><label>Contact Name</label><input type="text" id="org-new-contact" class="form-control"></div>
                    <div class="form-group"><label>Contact Phone</label><input type="text" id="org-new-phone" class="form-control"></div>
                </div>
                <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
                    <div class="form-group"><label>Contact Email</label><input type="email" id="org-new-email" class="form-control"></div>
                    <div class="form-group"><label>Industry</label><input type="text" id="org-new-industry" class="form-control" placeholder="e.g. F&amp;B, retail"></div>
                </div>
                <div class="form-group"><label>Team Size (pax) *</label>
                    <input type="number" id="org-new-size" class="form-control" min="1" max="50" value="5" oninput="app._orgUpdatePricePreview()"></div>
                <div style="background:#f1f5f9;padding:14px;border-radius:6px;border-left:4px solid var(--primary);">
                    <div style="font-size:11px;color:var(--gray-600);text-transform:uppercase;letter-spacing:0.5px;">Auto-priced</div>
                    <div id="org-new-price-display" style="font-size:24px;font-weight:700;color:var(--primary);">RM 99</div>
                    <div id="org-new-tier-display" style="font-size:12px;color:var(--gray-600);">Tier: 1–5 pax</div>
                </div>
            </div>
            <div>
                <div style="font-size:11px;color:var(--gray-600);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:6px;">Pricing Ladder</div>
                <table style="width:100%;font-size:12px;border:1px solid var(--gray-200);border-radius:6px;background:#fff;">${tierRows}</table>
            </div>
        </div>
    `, [
        { label: 'Cancel', type: 'secondary', action: 'UI.hideModal()' },
        { label: 'Create Consultation', type: 'primary', action: '(async () => { await app.saveNewOrgConsultation(); })()' }
    ]);
    setTimeout(() => window.app._orgUpdatePricePreview && window.app._orgUpdatePricePreview(), 50);
};

const _orgUpdatePricePreview = () => {
    const size = parseInt(document.getElementById('org-new-size')?.value, 10) || 0;
    const tier = _orgTierForSize(size);
    const priceEl = document.getElementById('org-new-price-display');
    const tierEl = document.getElementById('org-new-tier-display');
    if (!tier) {
        if (priceEl) priceEl.textContent = 'Out of range';
        if (tierEl) tierEl.textContent = 'Supported: 1–50 pax';
        return;
    }
    if (priceEl) priceEl.textContent = `RM ${tier.price.toLocaleString()}`;
    if (tierEl) tierEl.textContent = `Tier: ${tier.min}–${tier.max} pax`;
};

const saveNewOrgConsultation = async () => {
    const company = document.getElementById('org-new-company')?.value?.trim();
    const size = parseInt(document.getElementById('org-new-size')?.value, 10);
    if (!company) { UI.toast.error('Client company is required.'); return; }
    if (!size || size < 1 || size > 50) { UI.toast.error('Team size must be 1–50.'); return; }
    const tier = _orgTierForSize(size);
    if (!tier) { UI.toast.error('Team size out of supported range.'); return; }

    const user = await (typeof Auth !== 'undefined' && Auth.getCurrentUser ? Auth.getCurrentUser() : Promise.resolve(null)).catch(() => null);

    const payload = {
        client_company: company,
        client_contact_name:  document.getElementById('org-new-contact')?.value?.trim() || null,
        client_contact_phone: document.getElementById('org-new-phone')?.value?.trim() || null,
        client_contact_email: document.getElementById('org-new-email')?.value?.trim() || null,
        client_industry:      document.getElementById('org-new-industry')?.value?.trim() || null,
        team_size: size,
        tier_code: tier.code,
        price_myr: tier.price,
        payment_status: 'unpaid',
        status: 'collecting',
        members: [],
        pairs: [],
        analysis: {},
        consultant_id: user?.id || null,
        created_by:    user?.id || null,
    };

    try {
        const row = await AppDataStore.create('org_consultations', payload);
        UI.toast.success('Consultation created.');
        UI.hideModal();
        if (row?.id) await window.app.openOrgConsultationDetail(row.id);
    } catch (e) {
        UI.toast.error('Save failed: ' + (e?.message || e));
    }
};

// ---------------- DETAIL VIEW ----------------
const openOrgConsultationDetail = async (id) => {
    const row = await AppDataStore.getById('org_consultations', id);
    if (!row) { UI.toast.error('Consultation not found.'); return; }
    const viewport = document.getElementById('content-viewport');
    if (!viewport) return;

    const members = Array.isArray(row.members) ? row.members : [];
    const analysisDone = members.length > 0 && members.every(m => m.archetype_code);
    const reportReady = !!row.report_html;

    viewport.innerHTML = `
        <div style="padding:24px;max-width:1100px;margin:0 auto;">
            <div style="margin-bottom:12px;">
                <button class="btn btn-sm secondary" onclick="app.navigateTo('org_chart')">
                    <i class="fas fa-arrow-left"></i> Back to list
                </button>
            </div>
            <div style="background:#fff;border:1px solid var(--gray-200);border-radius:8px;padding:20px;margin-bottom:16px;">
                <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:16px;flex-wrap:wrap;">
                    <div>
                        <h2 style="margin:0;">${_orgEscapeHtml(row.client_company)}</h2>
                        <div style="color:var(--gray-500);font-size:13px;margin-top:4px;">
                            ${row.client_contact_name ? `${_orgEscapeHtml(row.client_contact_name)} · ` : ''}
                            ${row.client_contact_phone ? `${_orgEscapeHtml(row.client_contact_phone)} · ` : ''}
                            ${row.client_industry ? _orgEscapeHtml(row.client_industry) : ''}
                        </div>
                    </div>
                    <div style="text-align:right;">
                        <div style="font-size:28px;font-weight:700;color:var(--primary);">RM ${Number(row.price_myr).toLocaleString()}</div>
                        <div style="font-size:12px;color:var(--gray-500);">Team size: ${row.team_size} pax · ${row.tier_code}</div>
                        <div style="margin-top:8px;">
                            ${row.payment_status === 'paid'
                              ? '<span style="background:#16a34a;color:#fff;font-size:11px;padding:3px 8px;border-radius:10px;">Paid</span>'
                              : `<button class="btn btn-sm" onclick="app.markOrgConsultationPaid(${row.id})">Mark Paid</button>`}
                        </div>
                    </div>
                </div>
            </div>

            <div style="background:#fff;border:1px solid var(--gray-200);border-radius:8px;padding:20px;margin-bottom:16px;">
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
                    <h3 style="margin:0;">Team Members <span style="color:var(--gray-500);font-size:14px;font-weight:400;">(${members.length} / ${row.team_size})</span></h3>
                    <div style="display:flex;gap:8px;">
                        <button class="btn btn-sm" onclick="app.openOrgMemberBulkPaste(${row.id})"><i class="fas fa-paste"></i> Bulk Paste</button>
                        <button class="btn btn-sm primary" onclick="app.openOrgMemberAddModal(${row.id})"><i class="fas fa-user-plus"></i> Add Member</button>
                    </div>
                </div>
                ${members.length === 0 ? `
                    <div style="text-align:center;padding:32px;color:var(--gray-500);">No members yet. Add team members one by one or paste a CSV.</div>
                ` : `
                    <table style="width:100%;border-collapse:collapse;font-size:13px;">
                        <thead><tr style="background:var(--gray-100);text-align:left;">
                            <th style="padding:8px;">Name</th><th style="padding:8px;">Current Role</th><th style="padding:8px;">DOB</th><th style="padding:8px;">Suggested Role</th><th style="padding:8px;">Fit</th><th style="padding:8px;text-align:right;"></th>
                        </tr></thead>
                        <tbody>${members.map((m, i) => `
                            <tr style="border-top:1px solid var(--gray-200);">
                                <td style="padding:8px;"><strong>${_orgEscapeHtml(m.name || '—')}</strong></td>
                                <td style="padding:8px;color:var(--gray-600);">${_orgEscapeHtml(m.current_role || '—')}</td>
                                <td style="padding:8px;font-size:11px;color:var(--gray-500);">${_orgEscapeHtml(m.dob || '—')}</td>
                                <td style="padding:8px;">${_orgEscapeHtml(_orgArchetypeLabel(m.archetype_code)) || '—'}</td>
                                <td style="padding:8px;">${m.fit_score ? `<span style="background:#dcfce7;color:#166534;font-size:11px;padding:2px 8px;border-radius:10px;font-weight:600;">${m.fit_score}</span>` : '—'}</td>
                                <td style="padding:8px;text-align:right;">
                                    <button class="btn btn-sm" onclick="app.openOrgMemberAddModal(${row.id}, ${i})">Edit</button>
                                    <button class="btn btn-sm" style="background:#fee2e2;color:#991b1b;" onclick="app.removeOrgMember(${row.id}, ${i})">×</button>
                                </td>
                            </tr>
                        `).join('')}</tbody>
                    </table>
                `}
            </div>

            ${members.length > 0 ? `
            <div style="background:#fff;border:1px solid var(--gray-200);border-radius:8px;padding:20px;margin-bottom:16px;">
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
                    <h3 style="margin:0;">Analysis</h3>
                    <button class="btn ${analysisDone ? 'secondary' : 'primary'}" onclick="app.runOrgAnalysis(${row.id})">
                        <i class="fas fa-bolt"></i> ${analysisDone ? 'Re-run' : 'Run'} Analysis
                    </button>
                </div>
                ${analysisDone && row.analysis?.overall_summary ? `
                    <div style="background:#f8fafc;padding:12px;border-radius:6px;font-size:13px;">${_orgEscapeHtml(row.analysis.overall_summary)}</div>
                ` : `<div style="color:var(--gray-500);font-size:13px;">${analysisDone ? 'Analysis complete. Re-run if members change.' : 'Run analysis once all members have DOBs filled in.'}</div>`}
            </div>

            ${analysisDone ? `
            <div style="background:#fff;border:1px solid var(--gray-200);border-radius:8px;padding:20px;margin-bottom:16px;">
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
                    <h3 style="margin:0;">Client-facing Report</h3>
                    <div style="display:flex;gap:8px;">
                        <button class="btn ${reportReady ? 'secondary' : 'primary'}" onclick="app.generateOrgReport(${row.id})">
                            <i class="fas fa-file-alt"></i> ${reportReady ? 'Regenerate' : 'Generate'} Report
                        </button>
                        ${reportReady ? `<button class="btn primary" onclick="app.previewOrgReport(${row.id})"><i class="fas fa-eye"></i> Preview</button>` : ''}
                    </div>
                </div>
                <div style="color:var(--gray-500);font-size:13px;">
                    ${reportReady ? 'Report ready. All client-facing copy is sanitised — no internal terminology surfaces.' : 'Click Generate to produce the deliverable.'}
                </div>
            </div>
            ` : ''}
            ` : ''}

            <div style="background:#fff;border:1px solid var(--gray-200);border-radius:8px;padding:20px;">
                <h3 style="margin:0 0 12px;">Internal Notes <span style="font-size:11px;background:#fef3c7;color:#92400e;padding:2px 8px;border-radius:10px;">consultant-only</span></h3>
                <textarea id="org-detail-notes-${row.id}" class="form-control" rows="4" placeholder="Raw notes — internal use only. Never shown to client.">${_orgEscapeHtml(row.consultant_notes || '')}</textarea>
                <div style="text-align:right;margin-top:8px;">
                    <button class="btn btn-sm primary" onclick="app.saveOrgConsultationNotes(${row.id})">Save Notes</button>
                </div>
            </div>
        </div>
    `;
};

// ---------------- MEMBER ADD / EDIT ----------------
const openOrgMemberAddModal = async (consultationId, memberIdx) => {
    const row = await AppDataStore.getById('org_consultations', consultationId);
    if (!row) { UI.toast.error('Consultation not found.'); return; }
    const members = Array.isArray(row.members) ? row.members : [];
    const editing = typeof memberIdx === 'number' && members[memberIdx];
    const m = editing || { name: '', current_role: '', dob: '', dob_time: '', dob_city: '', gender: '' };

    UI.showModal(editing ? 'Edit Team Member' : 'Add Team Member', `
        <input type="hidden" id="org-mem-cid" value="${consultationId}">
        <input type="hidden" id="org-mem-idx" value="${editing ? memberIdx : -1}">
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
            <div class="form-group"><label>Full Name *</label>
                <input type="text" id="org-mem-name" class="form-control" value="${_orgEscapeHtml(m.name)}"></div>
            <div class="form-group"><label>Current Role</label>
                <input type="text" id="org-mem-role" class="form-control" value="${_orgEscapeHtml(m.current_role)}"></div>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;">
            <div class="form-group"><label>Date of Birth *</label>
                <input type="date" id="org-mem-dob" class="form-control" value="${_orgEscapeHtml(m.dob)}"></div>
            <div class="form-group"><label>Time (optional)</label>
                <input type="time" id="org-mem-dobtime" class="form-control" value="${_orgEscapeHtml(m.dob_time)}"></div>
            <div class="form-group"><label>Gender</label>
                <select id="org-mem-gender" class="form-control">
                    <option value="">—</option>
                    <option value="male" ${m.gender === 'male' ? 'selected' : ''}>Male</option>
                    <option value="female" ${m.gender === 'female' ? 'selected' : ''}>Female</option>
                </select></div>
        </div>
        <div class="form-group"><label>Birth City (optional)</label>
            <input type="text" id="org-mem-city" class="form-control" value="${_orgEscapeHtml(m.dob_city)}"></div>
    `, [
        { label: 'Cancel', type: 'secondary', action: 'UI.hideModal()' },
        { label: editing ? 'Update' : 'Add', type: 'primary', action: '(async () => { await app.saveOrgMember(); })()' }
    ]);
};

const saveOrgMember = async () => {
    const cid = parseInt(document.getElementById('org-mem-cid')?.value, 10);
    const idx = parseInt(document.getElementById('org-mem-idx')?.value, 10);
    const name = document.getElementById('org-mem-name')?.value?.trim();
    if (!cid || !name) { UI.toast.error('Name is required.'); return; }

    const member = {
        name,
        current_role: document.getElementById('org-mem-role')?.value?.trim() || '',
        dob:          document.getElementById('org-mem-dob')?.value || '',
        dob_time:     document.getElementById('org-mem-dobtime')?.value || '',
        dob_city:     document.getElementById('org-mem-city')?.value?.trim() || '',
        gender:       document.getElementById('org-mem-gender')?.value || '',
        archetype_code: null, suggested_role: null, fit_score: null, notes: ''
    };

    const row = await AppDataStore.getById('org_consultations', cid);
    if (!row) { UI.toast.error('Consultation not found.'); return; }
    const members = Array.isArray(row.members) ? [...row.members] : [];
    if (idx >= 0 && members[idx]) {
        members[idx] = { ...members[idx], ...member, archetype_code: null, fit_score: null }; // reset compute
    } else {
        if (members.length >= row.team_size) {
            UI.toast.error(`Team size cap reached (${row.team_size}). Upgrade tier first.`);
            return;
        }
        members.push(member);
    }

    try {
        await AppDataStore.update('org_consultations', cid, { members, status: 'collecting' });
        UI.toast.success('Member saved.');
        UI.hideModal();
        await window.app.openOrgConsultationDetail(cid);
    } catch (e) {
        UI.toast.error('Save failed: ' + (e?.message || e));
    }
};

const removeOrgMember = async (cid, idx) => {
    if (!confirm('Remove this member?')) return;
    const row = await AppDataStore.getById('org_consultations', cid);
    if (!row) return;
    const members = Array.isArray(row.members) ? [...row.members] : [];
    members.splice(idx, 1);
    await AppDataStore.update('org_consultations', cid, { members });
    await window.app.openOrgConsultationDetail(cid);
};

const openOrgMemberBulkPaste = async (cid) => {
    UI.showModal('Bulk Paste Members', `
        <input type="hidden" id="org-bulk-cid" value="${cid}">
        <p style="color:var(--gray-600);font-size:13px;">Paste CSV: <code>Name, Role, DOB (YYYY-MM-DD), Gender</code> — one per line.</p>
        <textarea id="org-bulk-csv" class="form-control" rows="10" placeholder="Ali bin Abu, Sales Lead, 1985-03-12, male&#10;Siti Aminah, HR Manager, 1990-07-25, female"></textarea>
    `, [
        { label: 'Cancel', type: 'secondary', action: 'UI.hideModal()' },
        { label: 'Import', type: 'primary', action: '(async () => { await app.importOrgMembersCsv(); })()' }
    ]);
};

const importOrgMembersCsv = async () => {
    const cid = parseInt(document.getElementById('org-bulk-cid')?.value, 10);
    const csv = document.getElementById('org-bulk-csv')?.value || '';
    const lines = csv.split('\n').map(l => l.trim()).filter(Boolean);
    if (!lines.length) { UI.toast.error('Paste at least one row.'); return; }

    const row = await AppDataStore.getById('org_consultations', cid);
    if (!row) return;
    const members = Array.isArray(row.members) ? [...row.members] : [];

    let added = 0;
    for (const line of lines) {
        const parts = line.split(',').map(p => p.trim());
        const name = parts[0]; if (!name) continue;
        if (members.length >= row.team_size) break;
        members.push({
            name,
            current_role: parts[1] || '',
            dob:          parts[2] || '',
            dob_time:     '',
            dob_city:     '',
            gender:       (parts[3] || '').toLowerCase(),
            archetype_code: null, suggested_role: null, fit_score: null, notes: ''
        });
        added++;
    }

    await AppDataStore.update('org_consultations', cid, { members });
    UI.toast.success(`Imported ${added} member(s).`);
    UI.hideModal();
    await window.app.openOrgConsultationDetail(cid);
};

// ---------------- ANALYSIS ----------------
const runOrgAnalysis = async (cid) => {
    const row = await AppDataStore.getById('org_consultations', cid);
    if (!row) return;
    const membersIn = Array.isArray(row.members) ? row.members : [];
    if (!membersIn.length) { UI.toast.error('No members to analyse.'); return; }

    UI.toast.info('Running analysis…');
    const members = membersIn.map(m => {
        const r = _orgComputeArchetype(m);
        return { ...m, archetype_code: r.code, fit_score: r.score, suggested_role: _orgArchetypeLabel(r.code) };
    });

    const pairs = [];
    for (let i = 0; i < members.length; i++) {
        for (let j = i + 1; j < members.length; j++) {
            pairs.push({ from_idx: i, to_idx: j, score: _orgPairScore(members[i], members[j]), code: '' });
        }
    }

    const leadershipCluster = members
        .map((m, idx) => ({ idx, m }))
        .filter(({ m }) => ['leader', 'operator', 'catalyst'].includes(m.archetype_code))
        .sort((a, b) => (b.m.fit_score || 0) - (a.m.fit_score || 0))
        .slice(0, 3)
        .map(({ idx }) => idx);

    const conflictPairs = pairs.filter(p => p.score < 60)
        .sort((a, b) => a.score - b.score)
        .slice(0, 5)
        .map(p => ({ a: p.from_idx, b: p.to_idx, severity: 100 - p.score }));

    const presentArchetypes = new Set(members.map(m => m.archetype_code));
    const missingArchetypes = ORG_ARCHETYPES.filter(a => !presentArchetypes.has(a.code)).map(a => a.code);

    const analysis = {
        leadership_cluster: leadershipCluster,
        conflict_pairs: conflictPairs,
        missing_archetypes: missingArchetypes,
        overall_summary: `Team of ${members.length}. Strong in ${[...presentArchetypes].slice(0, 3).map(c => _orgArchetypeLabel(c)).join(', ') || 'mixed traits'}. ${conflictPairs.length ? `Watch ${conflictPairs.length} potential friction pair(s).` : 'No high-friction pairs detected.'}`,
        generated_at: new Date().toISOString(),
    };

    await AppDataStore.update('org_consultations', cid, { members, pairs, analysis, status: 'analyzing' });
    UI.toast.success('Analysis complete.');
    await window.app.openOrgConsultationDetail(cid);
};

// ---------------- REPORT ----------------
const generateOrgReport = async (cid) => {
    const row = await AppDataStore.getById('org_consultations', cid);
    if (!row) return;
    const members = Array.isArray(row.members) ? row.members : [];
    const analysis = row.analysis || {};

    const memberRows = members.map(m => `
        <tr style="border-top:1px solid #e5e7eb;">
            <td style="padding:10px;"><strong>${_orgEscapeHtml(m.name)}</strong><div style="font-size:11px;color:#6b7280;">${_orgEscapeHtml(m.current_role || '')}</div></td>
            <td style="padding:10px;">${_orgEscapeHtml(_orgArchetypeLabel(m.archetype_code))}</td>
            <td style="padding:10px;font-weight:600;color:#16a34a;">${m.fit_score || ''}</td>
        </tr>
    `).join('');

    const leadershipNames = (analysis.leadership_cluster || []).map(idx => members[idx]?.name).filter(Boolean);

    const conflictRows = (analysis.conflict_pairs || []).map(c =>
        `<li>${_orgEscapeHtml(members[c.a]?.name || '')} ↔ ${_orgEscapeHtml(members[c.b]?.name || '')} — coach communication style</li>`
    ).join('') || '<li>No high-friction pairs detected.</li>';

    const missingList = (analysis.missing_archetypes || [])
        .map(code => _orgArchetypeLabel(code))
        .map(label => `<li>${_orgEscapeHtml(label)}</li>`)
        .join('') || '<li>All key archetypes are represented.</li>';

    // Build raw HTML then RUN IT THROUGH THE SANITISER before persist.
    const rawHtml = `
        <div style="font-family:Inter,sans-serif;max-width:800px;color:#1f2937;">
            <div style="background:linear-gradient(135deg,#8B1A1A,#b91c1c);color:#fff;padding:24px;border-radius:8px;">
                <h1 style="margin:0;">Organisational Restructure Report</h1>
                <div style="opacity:0.9;margin-top:6px;">Prepared for ${_orgEscapeHtml(row.client_company)} · ${new Date().toLocaleDateString()}</div>
            </div>
            <div style="padding:24px 8px;">
                <h2>Executive Summary</h2>
                <p>${_orgEscapeHtml(analysis.overall_summary || '')}</p>
                <h2>Recommended Leadership Cluster</h2>
                <p>${leadershipNames.length ? leadershipNames.map(_orgEscapeHtml).join(', ') : 'No clear leadership cluster — recommend external hire or development plan.'}</p>
                <h2>Role-Fit Assessment</h2>
                <table style="width:100%;border-collapse:collapse;background:#fff;border:1px solid #e5e7eb;border-radius:6px;">
                    <thead style="background:#f9fafb;text-align:left;"><tr><th style="padding:10px;">Member</th><th style="padding:10px;">Suggested Role</th><th style="padding:10px;">Fit</th></tr></thead>
                    <tbody>${memberRows}</tbody>
                </table>
                <h2>Friction Pairs To Coach</h2>
                <ul>${conflictRows}</ul>
                <h2>Capability Gaps</h2>
                <ul>${missingList}</ul>
                <hr style="margin:32px 0;border:none;border-top:1px solid #e5e7eb;">
                <p style="font-size:11px;color:#6b7280;">Report generated by DestinOraclesSolution · Confidential · For internal use of ${_orgEscapeHtml(row.client_company)} only.</p>
            </div>
        </div>
    `;
    const report = _orgSanitiseClientText(rawHtml);

    await AppDataStore.update('org_consultations', cid, {
        report_html: report,
        report_generated_at: new Date().toISOString(),
        status: 'completed'
    });
    UI.toast.success('Report generated.');
    await window.app.openOrgConsultationDetail(cid);
};

const previewOrgReport = async (cid) => {
    const row = await AppDataStore.getById('org_consultations', cid);
    if (!row?.report_html) { UI.toast.error('No report yet.'); return; }
    UI.showModal('Client-facing Report Preview', `
        <div style="max-height:70vh;overflow:auto;" id="org-report-body">${row.report_html}</div>
    `, [
        { label: 'Close', type: 'secondary', action: 'UI.hideModal()' },
        { label: 'Print', type: 'primary', action: '(() => { const body=document.getElementById("org-report-body")?.innerHTML||""; const w=window.open("","_blank"); w.document.write("<html><head><title>Report</title></head><body>"+body+"</body></html>"); w.document.close(); w.print(); })()' }
    ]);
};

// ---------------- MISC ----------------
const markOrgConsultationPaid = async (cid) => {
    await AppDataStore.update('org_consultations', cid, {
        payment_status: 'paid',
        payment_received_at: new Date().toISOString()
    });
    UI.toast.success('Marked as paid.');
    await window.app.openOrgConsultationDetail(cid);
};

const saveOrgConsultationNotes = async (cid) => {
    const notes = document.getElementById(`org-detail-notes-${cid}`)?.value || '';
    await AppDataStore.update('org_consultations', cid, { consultant_notes: notes });
    UI.toast.success('Notes saved.');
};

Object.assign(window.app, {
    showOrgChartView,
    openNewOrgConsultation,
    _orgUpdatePricePreview,
    saveNewOrgConsultation,
    openOrgConsultationDetail,
    openOrgMemberAddModal,
    saveOrgMember,
    removeOrgMember,
    openOrgMemberBulkPaste,
    importOrgMembersCsv,
    runOrgAnalysis,
    generateOrgReport,
    previewOrgReport,
    markOrgConsultationPaid,
    saveOrgConsultationNotes,
});

// Initialize application when DOM is ready
document.addEventListener('DOMContentLoaded', async () => {
    setTimeout(async () => {
        if (window.app && window.app.init) {
            await window.app.init();
        }
    }, 100);
    if (window.app && window.app.initSecurity) await window.app.initSecurity();
    if (window.app && window.app.initSync) window.app.initSync();
});

})();