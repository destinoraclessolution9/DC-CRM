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
        // Phase 4K-N: new operation chunks
        'pipeline':             { src: 'chunks/script-pipeline.min.js',    minLevel: null, exactLevels: null },
        'import':               { src: 'chunks/script-import.min.js',      minLevel: null, exactLevels: null },
        'protection':           { src: 'chunks/script-import.min.js',      minLevel: null, exactLevels: null },
        'fude':                 { src: 'chunks/script-fude.min.js',        minLevel: null, exactLevels: null },
        'milestones':           { src: 'chunks/script-features2.min.js',   minLevel: null, exactLevels: null },
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
    // [CHUNK: import] ~1986 lines extracted to chunks/script-import.js
    // Loaded on-demand by navigateTo() for import/protection views.

    const showImportDashboard = async (vp) => (window.app.showImportDashboard || (() => {}))(vp);
    const showProtectionMonitoringView = async (vp) => (window.app.showProtectionMonitoringView || (() => {}))(vp);
    // ========== PHASE 18: MOBILE APP & OFFLINE SYNC ==========
    // ========== FEATURE: AUTOMATED SCORING RULES ==========
    // ========== FEATURE: KPI HIERARCHICAL TARGETS ==========
    // ========== SPECIAL PROGRAM FIGHTING ==========
    // [CHUNK: features2] ~1596 lines extracted to chunks/script-features2.js
    const initMobileApp    = async () => (window.app.initMobileApp    || (() => {}))();
    const showMilestonesView = async (vp) => (window.app.showMilestonesView || (() => {}))(vp);
    // ========== LEVEL 13/14: 福德 VIEW + STORY + REWARD CRUD ==========
    // [CHUNK: fude] ~3217 lines extracted to chunks/script-fude.js
    const showFudeView = async (vp) => (window.app.showFudeView || (() => {}))(vp);

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
                if (window.app.showProtectionMonitoringView) await window.app.showProtectionMonitoringView(viewport);
                break;
            case 'agents':
                if (window.app.showAgentsView) await window.app.showAgentsView(viewport);
                break;
            case 'referrals':
                if (typeof window.app.showReferralsView === 'function') await window.app.showReferralsView(viewport);
                break;
            case 'cases':
                if (window.app.showCasesView) await window.app.showCasesView(viewport);
                break;
            case 'promotions':
                await showMonthlyPromotionView(viewport);
                break;
            case 'marketing_automation':
                if (window.app.showMarketingAutomationView) await window.app.showMarketingAutomationView(viewport);
                break;
            case 'ranking':
                if (typeof window.app.showRankingPerformanceView === 'function') await window.app.showRankingPerformanceView(viewport);
                break;
            case 'workflows':
                _currentMarketingTab = 'automation';
                if (window.app.showMarketingAutomationView) await window.app.showMarketingAutomationView(viewport);
                break;
            case 'milestones':
                if (window.app.showMilestonesView) await window.app.showMilestonesView(viewport);
                break;
            case 'fude':
                if (window.app.showFudeView) await window.app.showFudeView(viewport);
                break;
            case 'egg_purchasing':
                if (window.app.showEggPurchasingView) await window.app.showEggPurchasingView(viewport);
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

})();  // close const appLogic = (() => { ... })();

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