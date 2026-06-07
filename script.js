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

    // ========== ADVANCED SEARCH + FILTER PANEL (Phase 5D) ==========
    // [CHUNK: search] ~1725 lines extracted to chunks/script-search.js
    // Loaded on-demand when user first opens the search panel.
    const ensureReferralFields  = async () => (window.app.ensureReferralFields  || (() => {}))();
    const toggleSearchPanel     = async () => (window.app.toggleSearchPanel     || (() => {}))();
    const hideSearchPanel       =       () => (window.app.hideSearchPanel       || (() => {}))();
    const showSearchPanel       = async () => (window.app.showSearchPanel       || (() => {}))();
    // ==================== PHASE 14: NOTES + VOICE + MOBILE ====================
    // [CHUNK: mobile] ~2258 lines extracted to chunks/script-mobile.js
    // Loaded eagerly at startup on mobile; lazily on desktop for mobile views.
    // initMobileApp(), renderMobileBottomNav() etc. registered via Object.assign.

    // isMobile and applyMobileClass stay in script.js — both called early in init
    // before the mobile chunk has a chance to load on desktop.
    // ==================== PHASE 14: MOBILE FUNCTIONS ====================

    const isMobile = () => window.innerWidth <= 768;
    // Applies/removes the is-mobile body class. Defined here so init() can call it
    // immediately. The mobile chunk redefines it with the full version (which also
    // calls closeMobileDrawer); this stub handles the common early-boot path.
    const applyMobileClass = () => {
        if (isMobile()) {
            document.body.classList.add('is-mobile');
        } else {
            document.body.classList.remove('is-mobile');
            (window.app.closeMobileDrawer || (() => {}))();
        }
    };
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
        let retried = 0;   // transient (network) — re-queued, will retry
        let dropped = 0;   // permanent (API/permission) — not re-queued
        for (const item of queue) {
            try {
                if (item.action.startsWith('create_')) {
                    await AppDataStore.create(item.action.replace('create_', ''), item.data);
                } else if (item.action.startsWith('update_')) {
                    await AppDataStore.update(item.action.replace('update_', ''), item.data.id, item.data);
                }
                success++;
            } catch (e) {
                const msg = e?.message || '';
                // Distinguish transient (network down) from permanent (RLS deny, FK, etc.)
                const isNetwork = /Failed to fetch|NetworkError|OFFLINE|network|timeout/i.test(msg);
                if (isNetwork) {
                    retried++;
                    _offlineQueue.push(item); // will retry on next reconnect
                } else {
                    dropped++;
                    console.error('[offline-queue] Dropped item (permanent error):', e, item);
                }
            }
        }
        localStorage.setItem('offline_queue', JSON.stringify(_offlineQueue));
        updateOfflineIndicator();

        if (dropped > 0) UI.toast.error(`${dropped} offline change${dropped === 1 ? '' : 's'} couldn't be saved (permission or server error) and ${dropped === 1 ? 'was' : 'were'} removed from the queue.`);
        if (retried > 0) UI.toast.warning(`${retried} change${retried === 1 ? '' : 's'} still offline — will retry when connection improves.`);
        if (success > 0 && retried === 0 && dropped === 0) UI.toast.success(`Synced ${success} offline action${success === 1 ? '' : 's'} successfully.`);
        else if (success > 0) UI.toast.info(`Synced ${success} of ${success + retried + dropped} offline action${success === 1 ? '' : 's'}.`);
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
        const _l12 = ['calendar', 'prospects', 'referrals', 'pipeline', 'promotions', 'cases', 'reports', 'documents', 'knowledge', 'settings', 'fude', 'milestones', 'order-form-extract'];
        const levelPermissions = {
            1: ['calendar', 'prospects', 'referrals', 'pipeline', 'promotions', 'marketing-automation', 'marketing-lists', 'cases', 'purchases_history', 'agents', 'performance', 'reports', 'risk', 'admin', 'protection', 'documents', 'knowledge', 'import', 'integrations', 'settings', 'fude', 'milestones', 'noticeboard', 'custom_fields', 'egg-purchasing', 'standard-functions', 'formula-purchaser', 'stock-take', 'boss-report', 'org-chart', 'ai-insights', 'security', 'workflows', 'lead_forms', 'surveys', 'contracts', 'booking_settings', 'order-form-extract'],
            2: ['calendar', 'prospects', 'referrals', 'pipeline', 'promotions', 'marketing-automation', 'marketing-lists', 'cases', 'agents', 'performance', 'reports', 'risk', 'admin', 'protection', 'documents', 'knowledge', 'import', 'integrations', 'settings', 'fude', 'milestones', 'noticeboard', 'custom_fields', 'org-chart', 'ai-insights', 'security', 'lead_forms', 'surveys', 'contracts', 'booking_settings', 'order-form-extract'],
            3: ['calendar', 'prospects', 'referrals', 'pipeline', 'promotions', 'cases', 'performance', 'reports', 'protection', 'documents', 'knowledge', 'settings', 'fude', 'order-form-extract'],
            4: ['calendar', 'prospects', 'referrals', 'pipeline', 'promotions', 'cases', 'performance', 'reports', 'protection', 'documents', 'knowledge', 'settings', 'fude', 'order-form-extract'],
            5: _l12, 6: _l12, 7: _l12, 8: _l12, 9: _l12, 10: _l12,
            11: ['calendar', 'prospects', 'referrals', 'promotions', 'cases', 'knowledge', 'settings', 'fude', 'milestones'],
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
            'cases', 'documents', 'knowledge', 'import', 'promotions', 'marketing-automation', 'marketing-lists',
            'performance', 'reports', 'risk', 'admin',
            // Phase 17/19 dropdowns + gated tools — previously missing from this list,
            // causing them to stay permanently hidden for all roles after #28 hide-by-default fix.
            'ai-insights', 'security', 'workflows',
            'integrations', 'settings', 'milestones', 'fude', 'noticeboard',
            'custom_fields', 'egg-purchasing', 'standard-functions', 'formula-purchaser',
            'purchases_history', 'stock-take', 'boss-report', 'org-chart',
            'lead_forms', 'surveys', 'contracts', 'booking_settings',
            'order-form-extract',
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
        } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
            if (emailErrEl) { emailErrEl.textContent = 'Please enter a valid email address.'; emailErrEl.style.display = 'block'; }
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
            // _autoSubscribePush lives in the activities lazy chunk — call via window.app
            window.app?._autoSubscribePush?.();

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
        // initGoogleIntegration lives in the gcal lazy chunk; it self-inits when
        // that chunk loads, so skip the bare call here to avoid a ReferenceError.
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
            (window.app.ensureReferralFields || (() => {}))(),
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
        window.app?._autoSubscribePush?.();

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
        (window.app._initNotifBell || (() => {}))();

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

    // ========== NOTIFICATION BELL + HEALTH + SCHEDULER + CPS ==========
    // [CHUNK: cps] ~1310 lines extracted to chunks/script-cps.js
    const _initNotifBell          = () => (window.app._initNotifBell          || (() => {}))();
    const getViewPhase            = (v) => (window.app.getViewPhase            || ((v)=>'?'))(v);
    const openApproveCpsIntakeModal = async (id) => (window.app.openApproveCpsIntakeModal || (() => {}))(id);
    const showBookingSettingsView  = async (vp) => (window.app.showBookingSettingsView   || (() => {}))(vp);
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
        'home':                 { src: 'chunks/script-mobile.min.js',      minLevel: null, exactLevels: null },
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
        'booking_settings':     { src: 'chunks/script-cps.min.js',          minLevel: null, exactLevels: null },
        // Phase 5A: Notifications + CPS + Scheduler
        'cps_intake':           { src: 'chunks/script-cps.min.js',         minLevel: null, exactLevels: null },
        // Phase 5D: Advanced Search + Filter Panel
        'search':               { src: 'chunks/script-search.min.js',      minLevel: null, exactLevels: null },
        // Phase 5B+C: Admin + Org Chart (Super Admin only)
        'admin':                { src: 'chunks/script-admin.min.js',        minLevel: null, exactLevels: [1] },
        'security':             { src: 'chunks/script-admin.min.js',        minLevel: null, exactLevels: [1] },
        'org_chart':            { src: 'chunks/script-org.min.js',          minLevel: null, exactLevels: [1, 2] },
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
        'order_form_extract':   { src: 'chunks/script-order-form-extract.min.js', minLevel: null, exactLevels: null },
        // Phase 6A: Journey System — 5-year automated follow-up (2026-06-06)
        'journey':              { src: 'chunks/script-journey.min.js',    minLevel: null, exactLevels: null },
        // Modal-bound chunks (not tied to a view — underscore prefix prevents nav matching)
        '_activities':          { src: 'chunks/script-activities.min.js', minLevel: null, exactLevels: null },
    };

    // Eager chunk loader — after login, execute every permitted chunk so all
    // functions are in memory before the user taps anything (same feel as the
    // old monolithic script.js).
    //
    // Two-tier to avoid blocking Supabase data at login:
    //   Tier 1 (immediate) — 6 highest-traffic chunks start right away.
    //             async=true means each executes as soon as it downloads,
    //             without blocking other tasks.
    //   Tier 2 (3 s delay) — remaining chunks load after the dashboard data
    //             has had time to fetch from Supabase. Loading all 25+ scripts
    //             at once on login was saturating the main-thread task queue
    //             and causing Supabase fetch callbacks to time out.
    let _predictivePrefetchRan = false;
    const _runPredictivePrefetch = () => {
        if (_predictivePrefetchRan || !_currentUser) return;
        _predictivePrefetchRan = true;
        try {
            const lvl  = _getUserLevel(_currentUser);
            const seen = new Set();
            const _load = (src) => { if (!seen.has(src)) { seen.add(src); _loadChunkOnce(src); } };

            // Tier 1 — immediate: the views agents open most
            [
                'chunks/script-mobile.min.js',
                'chunks/script-prospects.min.js',
                'chunks/script-calendar.min.js',
                'chunks/script-pipeline.min.js',
                'chunks/script-activities.min.js',
                'chunks/script-cps.min.js',
                'chunks/script-forms.min.js',
            ].forEach(_load);

            // Tier 2 — after 3 s: everything else, Supabase data is loaded by then
            setTimeout(() => {
                for (const def of Object.values(_CHUNK_VIEWS)) {
                    const ok = !def.exactLevels || def.exactLevels.includes(lvl);
                    if (ok) _load(def.src);
                }
            }, 3000);
        } catch (e) { console.warn('eager chunk load failed', e); }
    };

    // In-flight promises keyed by chunk src URL — ensures each chunk is fetched once.
    const _chunkInFlight = new Map();
    const _loadChunkOnce = (src) => {
        if (_chunkInFlight.has(src)) return _chunkInFlight.get(src);
        const p = new Promise((resolve) => {
            const s = document.createElement('script');
            const manifest = window.__ASSET_MANIFEST || {};
            s.src = manifest[src] || src;
            s.async = true;
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

    // Hover prefetch: called when the user's pointer enters a sidebar nav item.
    // Starts loading the chunk immediately so by the time they click (~200ms later)
    // the fetch is already in-flight or complete — zero extra wait.
    // Safe to call for views with no chunk (def is undefined → no-op).
    const _prefetchChunkForView = (viewId) => {
        if (!viewId) return;
        const def = _CHUNK_VIEWS[viewId];
        if (def) _loadChunkOnce(def.src);
    };

    // Delegated pointerover listener: covers all current and future nav items
    // without touching index.html. Fires on desktop hover AND on first touch
    // on mobile (giving a head start before the click event fires).
    document.addEventListener('pointerover', (e) => {
        const el = e.target.closest('.sb-nav-item[data-view], .nav-links [data-view]');
        if (el) _prefetchChunkForView(el.dataset.view);
    }, { passive: true });

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
            order_form_extract: 'Order Form Extract',
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
        } else if (viewId === 'order_form_extract') {
            _currentView = 'order_form_extract';
            await (window.app.showOrderFormExtractView || (() => {}))(viewport);
        } else if (viewId === 'journey') {
            _currentView = 'journey';
            await (window.app.showAgentJourneyDashboard || (() => {}))(viewport);
        } else {
            viewport.innerHTML = `
                <div class="placeholder-view">
                    <h1>${viewId.toUpperCase()}</h1>
                    <p>Phase ${(window.app.getViewPhase || (() => '?'))(viewId)} Implementation: ${viewId} module interface.</p>
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
        // Setter for test injection (ci/browser-test.js) and future admin impersonation.
        // Production auth still goes through Auth.login() → the login handler sets
        // _currentUser directly; this setter is an alternate path.
        set cu(v) { _currentUser = v; },
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

        // ── Cache timestamps (shared with calendar + activities chunks) ──
        get vcts()  { return _venuesCacheTs; },
        set vcts(v) { _venuesCacheTs = v; },
        get pcts()  { return _productsCacheTs; },
        set pcts(v) { _productsCacheTs = v; },

        // ── Prospect referrer selection (shared: prospects ↔ activities) ─
        get sprr()  { return _selectedProspectReferrer; },
        set sprr(v) { _selectedProspectReferrer = v; },

        // ── Referral tree state (shared: fude ↔ referrals) ──────────────
        get ctd()   { return _currentTreeData; },
        set ctd(v)  { _currentTreeData = v; },
        get lbp()   { return _leaderboardPeriod; },
        set lbp(v)  { _leaderboardPeriod = v; },
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

    // Placeholder for unimplemented features — shows a "coming soon" toast.
    // Referenced by buttons that haven't been wired up yet (app.todo('Feature Name')).
    const todo = (name) => UI.toast.warning(`${name || 'This feature'} is coming soon.`);

    // ── Stub forwarding functions for chunk-implemented features ─────────────
    // These must be defined in the IIFE scope so `return { showRoadmap, ... }` doesn't
    // throw ReferenceError on load. The fude / referrals / prospects chunks override
    // window.app with their real implementations via Object.assign after loading.
    const showRoadmap             = (...a) => (window.app.showRoadmap             || todo.bind(null, 'Roadmap'))(...a);
    const exportRelationshipTree  = (...a) => (window.app.exportRelationshipTree  || todo.bind(null, 'Export Tree'))(...a);
    const changeLeaderboardPeriod = (...a) => (window.app.changeLeaderboardPeriod || todo.bind(null, 'Leaderboard'))(...a);
    const uploadProspectDocument  = (...a) => (window.app.uploadProspectDocument  || todo.bind(null, 'Upload Doc'))(...a);





    // ── Auto-generated forwarding stubs (ci/patch-stubs.js, 2026-06-06) ─────────
    // Every name in the return statement must be defined in the IIFE scope.
    // Pattern: async so the stub always returns a Promise (safe for .catch() chains).
    // Identity check prevents infinite recursion: after Object.assign, window.app.fn
    // IS this stub. Once a chunk overrides it, window.app.fn !== stub → real fn runs.
    const handleProspectDrag = async (...a) => { const _r = window.app.handleProspectDrag; if (_r && _r !== handleProspectDrag) return _r(...a); };
    const handleStageDrop = async (...a) => { const _r = window.app.handleStageDrop; if (_r && _r !== handleStageDrop) return _r(...a); };
    const closeDealWon = async (...a) => { const _r = window.app.closeDealWon; if (_r && _r !== closeDealWon) return _r(...a); };
    const closeDealLost = async (...a) => { const _r = window.app.closeDealLost; if (_r && _r !== closeDealLost) return _r(...a); };
    const calculateDealValue = async (...a) => { const _r = window.app.calculateDealValue; if (_r && _r !== calculateDealValue) return _r(...a); };
    const showProspectsView = async (...a) => { const _r = window.app.showProspectsView; if (_r && _r !== showProspectsView) return _r(...a); };
    const showProspectsViewSmart = async (...a) => { const _r = window.app.showProspectsViewSmart; if (_r && _r !== showProspectsViewSmart) return _r(...a); };
    const zoomCpsPhoto = async (...a) => { const _r = window.app.zoomCpsPhoto; if (_r && _r !== zoomCpsPhoto) return _r(...a); };
    const openProspectModal = async (...a) => { const _r = window.app.openProspectModal; if (_r && _r !== openProspectModal) return _r(...a); };
    const editProspect = async (...a) => { const _r = window.app.editProspect; if (_r && _r !== editProspect) return _r(...a); };
    const downloadProspectVCard = async (...a) => { const _r = window.app.downloadProspectVCard; if (_r && _r !== downloadProspectVCard) return _r(...a); };
    const saveProspect = async (...a) => { const _r = window.app.saveProspect; if (_r && _r !== saveProspect) return _r(...a); };
    const openProspectGradePicker = async (...a) => { const _r = window.app.openProspectGradePicker; if (_r && _r !== openProspectGradePicker) return _r(...a); };
    const setProspectGrade = async (...a) => { const _r = window.app.setProspectGrade; if (_r && _r !== setProspectGrade) return _r(...a); };
    const filterProspects = async (...a) => { const _r = window.app.filterProspects; if (_r && _r !== filterProspects) return _r(...a); };
    const prospectPageNav = async (...a) => { const _r = window.app.prospectPageNav; if (_r && _r !== prospectPageNav) return _r(...a); };
    const customerPageNav = async (...a) => { const _r = window.app.customerPageNav; if (_r && _r !== customerPageNav) return _r(...a); };
    const exportData = async (...a) => { const _r = window.app.exportData; if (_r && _r !== exportData) return _r(...a); };
    const sortProspects = async (...a) => { const _r = window.app.sortProspects; if (_r && _r !== sortProspects) return _r(...a); };
    const sortProspectsBySelect = async (...a) => { const _r = window.app.sortProspectsBySelect; if (_r && _r !== sortProspectsBySelect) return _r(...a); };
    const toggleProspectView = async (...a) => { const _r = window.app.toggleProspectView; if (_r && _r !== toggleProspectView) return _r(...a); };
    const toggleProspectSelect = async (...a) => { const _r = window.app.toggleProspectSelect; if (_r && _r !== toggleProspectSelect) return _r(...a); };
    const toggleProspectSelectAll = async (...a) => { const _r = window.app.toggleProspectSelectAll; if (_r && _r !== toggleProspectSelectAll) return _r(...a); };
    const clearProspectSelection = async (...a) => { const _r = window.app.clearProspectSelection; if (_r && _r !== clearProspectSelection) return _r(...a); };
    const updateProspectBulkBar = async (...a) => { const _r = window.app.updateProspectBulkBar; if (_r && _r !== updateProspectBulkBar) return _r(...a); };
    const bulkDeleteProspects = async (...a) => { const _r = window.app.bulkDeleteProspects; if (_r && _r !== bulkDeleteProspects) return _r(...a); };
    const bulkReassignProspects = async (...a) => { const _r = window.app.bulkReassignProspects; if (_r && _r !== bulkReassignProspects) return _r(...a); };
    const confirmBulkReassign = async (...a) => { const _r = window.app.confirmBulkReassign; if (_r && _r !== confirmBulkReassign) return _r(...a); };
    const toggleProspectFilters = async (...a) => { const _r = window.app.toggleProspectFilters; if (_r && _r !== toggleProspectFilters) return _r(...a); };
    const updateProspectFilterBadge = async (...a) => { const _r = window.app.updateProspectFilterBadge; if (_r && _r !== updateProspectFilterBadge) return _r(...a); };
    const switchProspectTab = async (...a) => { const _r = window.app.switchProspectTab; if (_r && _r !== switchProspectTab) return _r(...a); };
    const toggleAccordion = async (...a) => { const _r = window.app.toggleAccordion; if (_r && _r !== toggleAccordion) return _r(...a); };
    const toggleCustomerAccordion = async (...a) => { const _r = window.app.toggleCustomerAccordion; if (_r && _r !== toggleCustomerAccordion) return _r(...a); };
    const switchCustomerProfileTab = async (...a) => { const _r = window.app.switchCustomerProfileTab; if (_r && _r !== switchCustomerProfileTab) return _r(...a); };
    const addNote = async (...a) => { const _r = window.app.addNote; if (_r && _r !== addNote) return _r(...a); };
    const deleteNote = async (...a) => { const _r = window.app.deleteNote; if (_r && _r !== deleteNote) return _r(...a); };
    const attachActivityPhoto = async (...a) => { const _r = window.app.attachActivityPhoto; if (_r && _r !== attachActivityPhoto) return _r(...a); };
    const viewActivityPhotos = async (...a) => { const _r = window.app.viewActivityPhotos; if (_r && _r !== viewActivityPhotos) return _r(...a); };
    const saveActivityPhoto = async (...a) => { const _r = window.app.saveActivityPhoto; if (_r && _r !== saveActivityPhoto) return _r(...a); };
    const removeActivityPhoto = async (...a) => { const _r = window.app.removeActivityPhoto; if (_r && _r !== removeActivityPhoto) return _r(...a); };
    const attachAppraisalForm = async (...a) => { const _r = window.app.attachAppraisalForm; if (_r && _r !== attachAppraisalForm) return _r(...a); };
    const saveAppraisalForm = async (...a) => { const _r = window.app.saveAppraisalForm; if (_r && _r !== saveAppraisalForm) return _r(...a); };
    const removeAppraisalForm = async (...a) => { const _r = window.app.removeAppraisalForm; if (_r && _r !== removeAppraisalForm) return _r(...a); };
    const uploadAPUForm = async (...a) => { const _r = window.app.uploadAPUForm; if (_r && _r !== uploadAPUForm) return _r(...a); };
    const saveAPUForm = async (...a) => { const _r = window.app.saveAPUForm; if (_r && _r !== saveAPUForm) return _r(...a); };
    const removeAPUForm = async (...a) => { const _r = window.app.removeAPUForm; if (_r && _r !== removeAPUForm) return _r(...a); };
    const recordSalesClosure = async (...a) => { const _r = window.app.recordSalesClosure; if (_r && _r !== recordSalesClosure) return _r(...a); };
    const toggleNextAction = async (...a) => { const _r = window.app.toggleNextAction; if (_r && _r !== toggleNextAction) return _r(...a); };
    const toggleNextActionItem = async (...a) => { const _r = window.app.toggleNextActionItem; if (_r && _r !== toggleNextActionItem) return _r(...a); };
    const saveClosingRecord = async (...a) => { const _r = window.app.saveClosingRecord; if (_r && _r !== saveClosingRecord) return _r(...a); };
    const submitClosingRecord = async (...a) => { const _r = window.app.submitClosingRecord; if (_r && _r !== submitClosingRecord) return _r(...a); };
    const addPrePurchaseRow = async (...a) => { const _r = window.app.addPrePurchaseRow; if (_r && _r !== addPrePurchaseRow) return _r(...a); };
    const addPrePurchaseAttachment = async (...a) => { const _r = window.app.addPrePurchaseAttachment; if (_r && _r !== addPrePurchaseAttachment) return _r(...a); };
    const deletePrePurchaseRecord = async (...a) => { const _r = window.app.deletePrePurchaseRecord; if (_r && _r !== deletePrePurchaseRecord) return _r(...a); };
    const addProductPurchaseRow = async (...a) => { const _r = window.app.addProductPurchaseRow; if (_r && _r !== addProductPurchaseRow) return _r(...a); };
    const addProductPurchaseAttachment = async (...a) => { const _r = window.app.addProductPurchaseAttachment; if (_r && _r !== addProductPurchaseAttachment) return _r(...a); };
    const deleteProductPurchaseRecord = async (...a) => { const _r = window.app.deleteProductPurchaseRecord; if (_r && _r !== deleteProductPurchaseRecord) return _r(...a); };
    const openFengShuiAuditModal = async (...a) => { const _r = window.app.openFengShuiAuditModal; if (_r && _r !== openFengShuiAuditModal) return _r(...a); };
    const saveFengShuiAudit = async (...a) => { const _r = window.app.saveFengShuiAudit; if (_r && _r !== saveFengShuiAudit) return _r(...a); };
    const deleteFengShuiAudit = async (...a) => { const _r = window.app.deleteFengShuiAudit; if (_r && _r !== deleteFengShuiAudit) return _r(...a); };
    const uploadFengShuiFile = async (...a) => { const _r = window.app.uploadFengShuiFile; if (_r && _r !== uploadFengShuiFile) return _r(...a); };
    const removeFengShuiFile = async (...a) => { const _r = window.app.removeFengShuiFile; if (_r && _r !== removeFengShuiFile) return _r(...a); };
    const uploadFengShuiPhotos = async (...a) => { const _r = window.app.uploadFengShuiPhotos; if (_r && _r !== uploadFengShuiPhotos) return _r(...a); };
    const removeFengShuiPhoto = async (...a) => { const _r = window.app.removeFengShuiPhoto; if (_r && _r !== removeFengShuiPhoto) return _r(...a); };
    const updateFengShuiPhotoRemark = async (...a) => { const _r = window.app.updateFengShuiPhotoRemark; if (_r && _r !== updateFengShuiPhotoRemark) return _r(...a); };
    const openFengShuiPhotosModal = async (...a) => { const _r = window.app.openFengShuiPhotosModal; if (_r && _r !== openFengShuiPhotosModal) return _r(...a); };
    const openFengShuiSitePhotosModal = async (...a) => { const _r = window.app.openFengShuiSitePhotosModal; if (_r && _r !== openFengShuiSitePhotosModal) return _r(...a); };
    const addFengShuiSiteReview = async (...a) => { const _r = window.app.addFengShuiSiteReview; if (_r && _r !== addFengShuiSiteReview) return _r(...a); };
    const updateFengShuiSiteReviewField = async (...a) => { const _r = window.app.updateFengShuiSiteReviewField; if (_r && _r !== updateFengShuiSiteReviewField) return _r(...a); };
    const uploadFengShuiSitePhotos = async (...a) => { const _r = window.app.uploadFengShuiSitePhotos; if (_r && _r !== uploadFengShuiSitePhotos) return _r(...a); };
    const removeFengShuiSitePhoto = async (...a) => { const _r = window.app.removeFengShuiSitePhoto; if (_r && _r !== removeFengShuiSitePhoto) return _r(...a); };
    const removeFengShuiSiteReview = async (...a) => { const _r = window.app.removeFengShuiSiteReview; if (_r && _r !== removeFengShuiSiteReview) return _r(...a); };
    const approveClosingRecord = async (...a) => { const _r = window.app.approveClosingRecord; if (_r && _r !== approveClosingRecord) return _r(...a); };
    const archiveAndNewClosingRecord = async (...a) => { const _r = window.app.archiveAndNewClosingRecord; if (_r && _r !== archiveAndNewClosingRecord) return _r(...a); };
    const saveClosingHistoryEntry = async (...a) => { const _r = window.app.saveClosingHistoryEntry; if (_r && _r !== saveClosingHistoryEntry) return _r(...a); };
    const uploadHistoryInvoice = async (...a) => { const _r = window.app.uploadHistoryInvoice; if (_r && _r !== uploadHistoryInvoice) return _r(...a); };
    const saveClosingDeliveryStatus = async (...a) => { const _r = window.app.saveClosingDeliveryStatus; if (_r && _r !== saveClosingDeliveryStatus) return _r(...a); };
    const rejectClosingRecord = async (...a) => { const _r = window.app.rejectClosingRecord; if (_r && _r !== rejectClosingRecord) return _r(...a); };
    const savePurchasesHistoryRow = async (...a) => { const _r = window.app.savePurchasesHistoryRow; if (_r && _r !== savePurchasesHistoryRow) return _r(...a); };
    const phSetFilter = async (...a) => { const _r = window.app.phSetFilter; if (_r && _r !== phSetFilter) return _r(...a); };
    const phSetPage = async (...a) => { const _r = window.app.phSetPage; if (_r && _r !== phSetPage) return _r(...a); };
    const refreshPurchasesHistory = async (...a) => { const _r = window.app.refreshPurchasesHistory; if (_r && _r !== refreshPurchasesHistory) return _r(...a); };
    const extendProtection = async (...a) => { const _r = window.app.extendProtection; if (_r && _r !== extendProtection) return _r(...a); };
    const transferProspect = async (...a) => { const _r = window.app.transferProspect; if (_r && _r !== transferProspect) return _r(...a); };
    const reassignProspect = async (...a) => { const _r = window.app.reassignProspect; if (_r && _r !== reassignProspect) return _r(...a); };
    const quickReassign = async (...a) => { const _r = window.app.quickReassign; if (_r && _r !== quickReassign) return _r(...a); };
    const openReviveProspectModal = async (...a) => { const _r = window.app.openReviveProspectModal; if (_r && _r !== openReviveProspectModal) return _r(...a); };
    const saveReviveProspect = async (...a) => { const _r = window.app.saveReviveProspect; if (_r && _r !== saveReviveProspect) return _r(...a); };
    const convertToCustomer = async (...a) => { const _r = window.app.convertToCustomer; if (_r && _r !== convertToCustomer) return _r(...a); };
    const confirmConvertToCustomer = async (...a) => { const _r = window.app.confirmConvertToCustomer; if (_r && _r !== confirmConvertToCustomer) return _r(...a); };
    const requestProspectConversion = async (...a) => { const _r = window.app.requestProspectConversion; if (_r && _r !== requestProspectConversion) return _r(...a); };
    const showConversionApprovalModal = async (...a) => { const _r = window.app.showConversionApprovalModal; if (_r && _r !== showConversionApprovalModal) return _r(...a); };
    const approveProspectConversion = async (...a) => { const _r = window.app.approveProspectConversion; if (_r && _r !== approveProspectConversion) return _r(...a); };
    const rejectProspectConversion = async (...a) => { const _r = window.app.rejectProspectConversion; if (_r && _r !== rejectProspectConversion) return _r(...a); };
    const renderApprovalQueue = async (...a) => { const _r = window.app.renderApprovalQueue; if (_r && _r !== renderApprovalQueue) return _r(...a); };
    const showApprovalDetail = async (...a) => { const _r = window.app.showApprovalDetail; if (_r && _r !== showApprovalDetail) return _r(...a); };
    const approveQueueEntry = async (...a) => { const _r = window.app.approveQueueEntry; if (_r && _r !== approveQueueEntry) return _r(...a); };
    const rejectQueueEntry = async (...a) => { const _r = window.app.rejectQueueEntry; if (_r && _r !== rejectQueueEntry) return _r(...a); };
    const confirmRejectQueueEntry = async (...a) => { const _r = window.app.confirmRejectQueueEntry; if (_r && _r !== confirmRejectQueueEntry) return _r(...a); };
    const deleteProspect = async (...a) => { const _r = window.app.deleteProspect; if (_r && _r !== deleteProspect) return _r(...a); };
    const confirmDeleteProspect = async (...a) => { const _r = window.app.confirmDeleteProspect; if (_r && _r !== confirmDeleteProspect) return _r(...a); };
    const renderProspectsTable = async (...a) => { const _r = window.app.renderProspectsTable; if (_r && _r !== renderProspectsTable) return _r(...a); };
    const switchCustomerTab = async (...a) => { const _r = window.app.switchCustomerTab; if (_r && _r !== switchCustomerTab) return _r(...a); };
    const showCustomersView = async (...a) => { const _r = window.app.showCustomersView; if (_r && _r !== showCustomersView) return _r(...a); };
    const renderCustomersTable = async (...a) => { const _r = window.app.renderCustomersTable; if (_r && _r !== renderCustomersTable) return _r(...a); };
    const openAddCustomerModal = async (...a) => { const _r = window.app.openAddCustomerModal; if (_r && _r !== openAddCustomerModal) return _r(...a); };
    const saveCustomer = async (...a) => { const _r = window.app.saveCustomer; if (_r && _r !== saveCustomer) return _r(...a); };
    const filterCustomers = async (...a) => { const _r = window.app.filterCustomers; if (_r && _r !== filterCustomers) return _r(...a); };
    const renderBasicBankTab = async (...a) => { const _r = window.app.renderBasicBankTab; if (_r && _r !== renderBasicBankTab) return _r(...a); };
    const renderPlatformIdsTab = async (...a) => { const _r = window.app.renderPlatformIdsTab; if (_r && _r !== renderPlatformIdsTab) return _r(...a); };
    const renderPurchaseHistoryTab = async (...a) => { const _r = window.app.renderPurchaseHistoryTab; if (_r && _r !== renderPurchaseHistoryTab) return _r(...a); };
    const renderReferralsTab = async (...a) => { const _r = window.app.renderReferralsTab; if (_r && _r !== renderReferralsTab) return _r(...a); };
    const openCustomerReferralModal = async (...a) => { const _r = window.app.openCustomerReferralModal; if (_r && _r !== openCustomerReferralModal) return _r(...a); };
    const saveCustomerReferral = async (...a) => { const _r = window.app.saveCustomerReferral; if (_r && _r !== saveCustomerReferral) return _r(...a); };
    const viewReferralDetail = async (...a) => { const _r = window.app.viewReferralDetail; if (_r && _r !== viewReferralDetail) return _r(...a); };
    const editReferral = async (...a) => { const _r = window.app.editReferral; if (_r && _r !== editReferral) return _r(...a); };
    const saveEditReferral = async (...a) => { const _r = window.app.saveEditReferral; if (_r && _r !== saveEditReferral) return _r(...a); };
    const openEditPlatformIdsModal = async (...a) => { const _r = window.app.openEditPlatformIdsModal; if (_r && _r !== openEditPlatformIdsModal) return _r(...a); };
    const savePlatformIds = async (...a) => { const _r = window.app.savePlatformIds; if (_r && _r !== savePlatformIds) return _r(...a); };
    const uploadPaymentProof = async (...a) => { const _r = window.app.uploadPaymentProof; if (_r && _r !== uploadPaymentProof) return _r(...a); };
    const savePaymentProof = async (...a) => { const _r = window.app.savePaymentProof; if (_r && _r !== savePaymentProof) return _r(...a); };
    const renderEventHistory = async (...a) => { const _r = window.app.renderEventHistory; if (_r && _r !== renderEventHistory) return _r(...a); };
    const renderAgentEligibility = async (...a) => { const _r = window.app.renderAgentEligibility; if (_r && _r !== renderAgentEligibility) return _r(...a); };
    const openAddPurchaseModal = async (...a) => { const _r = window.app.openAddPurchaseModal; if (_r && _r !== openAddPurchaseModal) return _r(...a); };
    const savePurchase = async (...a) => { const _r = window.app.savePurchase; if (_r && _r !== savePurchase) return _r(...a); };
    const updatePurchaseDelivery = async (...a) => { const _r = window.app.updatePurchaseDelivery; if (_r && _r !== updatePurchaseDelivery) return _r(...a); };
    const updateConversionDelivery = async (...a) => { const _r = window.app.updateConversionDelivery; if (_r && _r !== updateConversionDelivery) return _r(...a); };
    const _setDelivery = async (...a) => { const _r = window.app._setDelivery; if (_r && _r !== _setDelivery) return _r(...a); };
    const copyToClipboard = async (...a) => { const _r = window.app.copyToClipboard; if (_r && _r !== copyToClipboard) return _r(...a); };
    const openUploadRedemptionImageModal = async (...a) => { const _r = window.app.openUploadRedemptionImageModal; if (_r && _r !== openUploadRedemptionImageModal) return _r(...a); };
    const saveRedemptionImage = async (...a) => { const _r = window.app.saveRedemptionImage; if (_r && _r !== saveRedemptionImage) return _r(...a); };
    const openUploadDocumentModal = async (...a) => { const _r = window.app.openUploadDocumentModal; if (_r && _r !== openUploadDocumentModal) return _r(...a); };
    const saveDocument = async (...a) => { const _r = window.app.saveDocument; if (_r && _r !== saveDocument) return _r(...a); };
    const openRecruitModal = async (...a) => { const _r = window.app.openRecruitModal; if (_r && _r !== openRecruitModal) return _r(...a); };
    const submitRecruitmentApproval = async (...a) => { const _r = window.app.submitRecruitmentApproval; if (_r && _r !== submitRecruitmentApproval) return _r(...a); };
    const switchProfileTab = async (...a) => { const _r = window.app.switchProfileTab; if (_r && _r !== switchProfileTab) return _r(...a); };
    const renderAgentsTable = async (...a) => { const _r = window.app.renderAgentsTable; if (_r && _r !== renderAgentsTable) return _r(...a); };
    const showAgentProfile = async (...a) => { const _r = window.app.showAgentProfile; if (_r && _r !== showAgentProfile) return _r(...a); };
    const openAddAgentModal = async (...a) => { const _r = window.app.openAddAgentModal; if (_r && _r !== openAddAgentModal) return _r(...a); };
    const openEditAgentModal = async (...a) => { const _r = window.app.openEditAgentModal; if (_r && _r !== openEditAgentModal) return _r(...a); };
    const saveAgent = async (...a) => { const _r = window.app.saveAgent; if (_r && _r !== saveAgent) return _r(...a); };
    const openAssignUplineModal = async (...a) => { const _r = window.app.openAssignUplineModal; if (_r && _r !== openAssignUplineModal) return _r(...a); };
    const saveUplineAssignment = async (...a) => { const _r = window.app.saveUplineAssignment; if (_r && _r !== saveUplineAssignment) return _r(...a); };
    const generatePassword = async (...a) => { const _r = window.app.generatePassword; if (_r && _r !== generatePassword) return _r(...a); };
    const submitForcePasswordChange = async (...a) => { const _r = window.app.submitForcePasswordChange; if (_r && _r !== submitForcePasswordChange) return _r(...a); };
    const selfChangePassword = async (...a) => { const _r = window.app.selfChangePassword; if (_r && _r !== selfChangePassword) return _r(...a); };
    const saveSelfPreferredName = async (...a) => { const _r = window.app.saveSelfPreferredName; if (_r && _r !== saveSelfPreferredName) return _r(...a); };
    const showSettingsView = async (...a) => { const _r = window.app.showSettingsView; if (_r && _r !== showSettingsView) return _r(...a); };
    const showPhoneDupesModal = async (...a) => { const _r = window.app.showPhoneDupesModal; if (_r && _r !== showPhoneDupesModal) return _r(...a); };
    const refreshPhoneDupes = async (...a) => { const _r = window.app.refreshPhoneDupes; if (_r && _r !== refreshPhoneDupes) return _r(...a); };
    const dedupeEditPhone = async (...a) => { const _r = window.app.dedupeEditPhone; if (_r && _r !== dedupeEditPhone) return _r(...a); };
    const dedupeClearPhone = async (...a) => { const _r = window.app.dedupeClearPhone; if (_r && _r !== dedupeClearPhone) return _r(...a); };
    const dedupeClearEmail = async (...a) => { const _r = window.app.dedupeClearEmail; if (_r && _r !== dedupeClearEmail) return _r(...a); };
    const dedupeDeleteProspect = async (...a) => { const _r = window.app.dedupeDeleteProspect; if (_r && _r !== dedupeDeleteProspect) return _r(...a); };
    const verifyAndPreparePhoneConstraint = async (...a) => { const _r = window.app.verifyAndPreparePhoneConstraint; if (_r && _r !== verifyAndPreparePhoneConstraint) return _r(...a); };
    const refreshPushNotificationStatus = async (...a) => { const _r = window.app.refreshPushNotificationStatus; if (_r && _r !== refreshPushNotificationStatus) return _r(...a); };
    const enablePushNotifications = async (...a) => { const _r = window.app.enablePushNotifications; if (_r && _r !== enablePushNotifications) return _r(...a); };
    const disablePushNotifications = async (...a) => { const _r = window.app.disablePushNotifications; if (_r && _r !== disablePushNotifications) return _r(...a); };
    const sendTestPushNotification = async (...a) => { const _r = window.app.sendTestPushNotification; if (_r && _r !== sendTestPushNotification) return _r(...a); };
    const loadNotificationPreferences = async (...a) => { const _r = window.app.loadNotificationPreferences; if (_r && _r !== loadNotificationPreferences) return _r(...a); };
    const saveNotificationPreferences = async (...a) => { const _r = window.app.saveNotificationPreferences; if (_r && _r !== saveNotificationPreferences) return _r(...a); };
    const onReminderCheckboxChange = async (...a) => { const _r = window.app.onReminderCheckboxChange; if (_r && _r !== onReminderCheckboxChange) return _r(...a); };
    const openResetPasswordModal = async (...a) => { const _r = window.app.openResetPasswordModal; if (_r && _r !== openResetPasswordModal) return _r(...a); };
    const executePasswordReset = async (...a) => { const _r = window.app.executePasswordReset; if (_r && _r !== executePasswordReset) return _r(...a); };
    const deleteAgent = async (...a) => { const _r = window.app.deleteAgent; if (_r && _r !== deleteAgent) return _r(...a); };
    const confirmDeleteAgent = async (...a) => { const _r = window.app.confirmDeleteAgent; if (_r && _r !== confirmDeleteAgent) return _r(...a); };
    const renewLicense = async (...a) => { const _r = window.app.renewLicense; if (_r && _r !== renewLicense) return _r(...a); };
    const executeRenewal = async (...a) => { const _r = window.app.executeRenewal; if (_r && _r !== executeRenewal) return _r(...a); };
    const sendRenewalReminder = async (...a) => { const _r = window.app.sendRenewalReminder; if (_r && _r !== sendRenewalReminder) return _r(...a); };
    const toggleNotifPanel = async (...a) => { const _r = window.app.toggleNotifPanel; if (_r && _r !== toggleNotifPanel) return _r(...a); };
    const updateAgentTargets = async (...a) => { const _r = window.app.updateAgentTargets; if (_r && _r !== updateAgentTargets) return _r(...a); };
    const saveAgentTargets = async (...a) => { const _r = window.app.saveAgentTargets; if (_r && _r !== saveAgentTargets) return _r(...a); };
    const deactivateAgent = async (...a) => { const _r = window.app.deactivateAgent; if (_r && _r !== deactivateAgent) return _r(...a); };
    const resetAgentPassword = async (...a) => { const _r = window.app.resetAgentPassword; if (_r && _r !== resetAgentPassword) return _r(...a); };
    const assignProspectToAgent = async (...a) => { const _r = window.app.assignProspectToAgent; if (_r && _r !== assignProspectToAgent) return _r(...a); };
    const viewInactiveProspects = async (...a) => { const _r = window.app.viewInactiveProspects; if (_r && _r !== viewInactiveProspects) return _r(...a); };
    const renderCustomerHistory = async (...a) => { const _r = window.app.renderCustomerHistory; if (_r && _r !== renderCustomerHistory) return _r(...a); };
    const confirmDelete = async (...a) => { const _r = window.app.confirmDelete; if (_r && _r !== confirmDelete) return _r(...a); };
    const executeDelete = async (...a) => { const _r = window.app.executeDelete; if (_r && _r !== executeDelete) return _r(...a); };
    const openAddTagModal = async (...a) => { const _r = window.app.openAddTagModal; if (_r && _r !== openAddTagModal) return _r(...a); };
    const addTagToEntity = async (...a) => { const _r = window.app.addTagToEntity; if (_r && _r !== addTagToEntity) return _r(...a); };
    const removeTagFromCustomer = async (...a) => { const _r = window.app.removeTagFromCustomer; if (_r && _r !== removeTagFromCustomer) return _r(...a); };
    const removeTagFromProspect = async (...a) => { const _r = window.app.removeTagFromProspect; if (_r && _r !== removeTagFromProspect) return _r(...a); };
    const openAddSolutionModal = async (...a) => { const _r = window.app.openAddSolutionModal; if (_r && _r !== openAddSolutionModal) return _r(...a); };
    const saveSolution = async (...a) => { const _r = window.app.saveSolution; if (_r && _r !== saveSolution) return _r(...a); };
    const openEditSolutionModal = async (...a) => { const _r = window.app.openEditSolutionModal; if (_r && _r !== openEditSolutionModal) return _r(...a); };
    const saveSolutionEdit = async (...a) => { const _r = window.app.saveSolutionEdit; if (_r && _r !== saveSolutionEdit) return _r(...a); };
    const deleteSolution = async (...a) => { const _r = window.app.deleteSolution; if (_r && _r !== deleteSolution) return _r(...a); };
    const renderPendingSolutionsWidget = async (...a) => { const _r = window.app.renderPendingSolutionsWidget; if (_r && _r !== renderPendingSolutionsWidget) return _r(...a); };
    const showPipelineView = async (...a) => { const _r = window.app.showPipelineView; if (_r && _r !== showPipelineView) return _r(...a); };
    const refreshPipeline = async (...a) => { const _r = window.app.refreshPipeline; if (_r && _r !== refreshPipeline) return _r(...a); };
    const setPipelineFilter = async (...a) => { const _r = window.app.setPipelineFilter; if (_r && _r !== setPipelineFilter) return _r(...a); };
    const addToFocusList = async (...a) => { const _r = window.app.addToFocusList; if (_r && _r !== addToFocusList) return _r(...a); };
    const removeFromFocusList = async (...a) => { const _r = window.app.removeFromFocusList; if (_r && _r !== removeFromFocusList) return _r(...a); };
    const editFocusAmount = async (...a) => { const _r = window.app.editFocusAmount; if (_r && _r !== editFocusAmount) return _r(...a); };
    const editFocusAction = async (...a) => { const _r = window.app.editFocusAction; if (_r && _r !== editFocusAction) return _r(...a); };
    const resetFocusField = async (...a) => { const _r = window.app.resetFocusField; if (_r && _r !== resetFocusField) return _r(...a); };
    const showProspectMenu = async (...a) => { const _r = window.app.showProspectMenu; if (_r && _r !== showProspectMenu) return _r(...a); };
    const showComments = async (...a) => { const _r = window.app.showComments; if (_r && _r !== showComments) return _r(...a); };
    const openPipelineConfigModal = async (...a) => { const _r = window.app.openPipelineConfigModal; if (_r && _r !== openPipelineConfigModal) return _r(...a); };
    const savePipelineConfig = async (...a) => { const _r = window.app.savePipelineConfig; if (_r && _r !== savePipelineConfig) return _r(...a); };
    const savePipelineRules = async (...a) => { const _r = window.app.savePipelineRules; if (_r && _r !== savePipelineRules) return _r(...a); };
    const addPipelineCategory = async (...a) => { const _r = window.app.addPipelineCategory; if (_r && _r !== addPipelineCategory) return _r(...a); };
    const deletePipelineCategory = async (...a) => { const _r = window.app.deletePipelineCategory; if (_r && _r !== deletePipelineCategory) return _r(...a); };
    const addPipelineWeight = async (...a) => { const _r = window.app.addPipelineWeight; if (_r && _r !== addPipelineWeight) return _r(...a); };
    const deletePipelineWeight = async (...a) => { const _r = window.app.deletePipelineWeight; if (_r && _r !== deletePipelineWeight) return _r(...a); };
    const addPipelineDecay = async (...a) => { const _r = window.app.addPipelineDecay; if (_r && _r !== addPipelineDecay) return _r(...a); };
    const deletePipelineDecay = async (...a) => { const _r = window.app.deletePipelineDecay; if (_r && _r !== deletePipelineDecay) return _r(...a); };
    const addPipelineBooster = async (...a) => { const _r = window.app.addPipelineBooster; if (_r && _r !== addPipelineBooster) return _r(...a); };
    const deletePipelineBooster = async (...a) => { const _r = window.app.deletePipelineBooster; if (_r && _r !== deletePipelineBooster) return _r(...a); };
    const setAgentPackageAmount = async (...a) => { const _r = window.app.setAgentPackageAmount; if (_r && _r !== setAgentPackageAmount) return _r(...a); };
    const showPipelineConfigHistory = async (...a) => { const _r = window.app.showPipelineConfigHistory; if (_r && _r !== showPipelineConfigHistory) return _r(...a); };
    const rollbackPipelineConfig = async (...a) => { const _r = window.app.rollbackPipelineConfig; if (_r && _r !== rollbackPipelineConfig) return _r(...a); };
    const showPipelineExplain = async (...a) => { const _r = window.app.showPipelineExplain; if (_r && _r !== showPipelineExplain) return _r(...a); };
    const addPipelineNote = async (...a) => { const _r = window.app.addPipelineNote; if (_r && _r !== addPipelineNote) return _r(...a); };
    const renderManualPriority = async (...a) => { const _r = window.app.renderManualPriority; if (_r && _r !== renderManualPriority) return _r(...a); };
    const renderRecentOverrides = async (...a) => { const _r = window.app.renderRecentOverrides; if (_r && _r !== renderRecentOverrides) return _r(...a); };
    const handleDragStart = async (...a) => { const _r = window.app.handleDragStart; if (_r && _r !== handleDragStart) return _r(...a); };
    const handleDragOver = async (...a) => { const _r = window.app.handleDragOver; if (_r && _r !== handleDragOver) return _r(...a); };
    const handleDrop = async (...a) => { const _r = window.app.handleDrop; if (_r && _r !== handleDrop) return _r(...a); };
    const saveManualOrder = async (...a) => { const _r = window.app.saveManualOrder; if (_r && _r !== saveManualOrder) return _r(...a); };
    const switchFocusMonth = async (...a) => { const _r = window.app.switchFocusMonth; if (_r && _r !== switchFocusMonth) return _r(...a); };
    const openExpiredSearchModal = async (...a) => { const _r = window.app.openExpiredSearchModal; if (_r && _r !== openExpiredSearchModal) return _r(...a); };
    const switchExpiredTab = async (...a) => { const _r = window.app.switchExpiredTab; if (_r && _r !== switchExpiredTab) return _r(...a); };
    const filterExpiredSearch = async (...a) => { const _r = window.app.filterExpiredSearch; if (_r && _r !== filterExpiredSearch) return _r(...a); };
    const reAddFromArchive = async (...a) => { const _r = window.app.reAddFromArchive; if (_r && _r !== reAddFromArchive) return _r(...a); };
    const changeFocusTargetProduct = async (...a) => { const _r = window.app.changeFocusTargetProduct; if (_r && _r !== changeFocusTargetProduct) return _r(...a); };
    const changeFocusTargetDetail = async (...a) => { const _r = window.app.changeFocusTargetDetail; if (_r && _r !== changeFocusTargetDetail) return _r(...a); };
    const toggleAgentFocusSection = async (...a) => { const _r = window.app.toggleAgentFocusSection; if (_r && _r !== toggleAgentFocusSection) return _r(...a); };
    const openBoostModal = async (...a) => { const _r = window.app.openBoostModal; if (_r && _r !== openBoostModal) return _r(...a); };
    const submitBoost = async (...a) => { const _r = window.app.submitBoost; if (_r && _r !== submitBoost) return _r(...a); };
    const openHistoryModal = async (...a) => { const _r = window.app.openHistoryModal; if (_r && _r !== openHistoryModal) return _r(...a); };
    const loadOverrideHistory = async (...a) => { const _r = window.app.loadOverrideHistory; if (_r && _r !== loadOverrideHistory) return _r(...a); };
    const viewJustification = async (...a) => { const _r = window.app.viewJustification; if (_r && _r !== viewJustification) return _r(...a); };
    const openSendBirthdayWish = async (...a) => { const _r = window.app.openSendBirthdayWish; if (_r && _r !== openSendBirthdayWish) return _r(...a); };
    const executeSendBirthdayWish = async (...a) => { const _r = window.app.executeSendBirthdayWish; if (_r && _r !== executeSendBirthdayWish) return _r(...a); };
    const openPrepareGiftModal = async (...a) => { const _r = window.app.openPrepareGiftModal; if (_r && _r !== openPrepareGiftModal) return _r(...a); };
    const logBirthdayGift = async (...a) => { const _r = window.app.logBirthdayGift; if (_r && _r !== logBirthdayGift) return _r(...a); };
    const openImportWizard = async (...a) => { const _r = window.app.openImportWizard; if (_r && _r !== openImportWizard) return _r(...a); };
    const renderImportStep = async (...a) => { const _r = window.app.renderImportStep; if (_r && _r !== renderImportStep) return _r(...a); };
    const importNextStep = async (...a) => { const _r = window.app.importNextStep; if (_r && _r !== importNextStep) return _r(...a); };
    const importPrevStep = async (...a) => { const _r = window.app.importPrevStep; if (_r && _r !== importPrevStep) return _r(...a); };
    const updateImportType = async (...a) => { const _r = window.app.updateImportType; if (_r && _r !== updateImportType) return _r(...a); };
    const autoMapFields = async (...a) => { const _r = window.app.autoMapFields; if (_r && _r !== autoMapFields) return _r(...a); };
    const clearMapping = async (...a) => { const _r = window.app.clearMapping; if (_r && _r !== clearMapping) return _r(...a); };
    const downloadErrorReport = async (...a) => { const _r = window.app.downloadErrorReport; if (_r && _r !== downloadErrorReport) return _r(...a); };
    const startImport = async (...a) => { const _r = window.app.startImport; if (_r && _r !== startImport) return _r(...a); };
    const viewImportDetails = async (...a) => { const _r = window.app.viewImportDetails; if (_r && _r !== viewImportDetails) return _r(...a); };
    const downloadImportLog = async (...a) => { const _r = window.app.downloadImportLog; if (_r && _r !== downloadImportLog) return _r(...a); };
    const openTemplatesModal = async (...a) => { const _r = window.app.openTemplatesModal; if (_r && _r !== openTemplatesModal) return _r(...a); };
    const downloadTemplate = async (...a) => { const _r = window.app.downloadTemplate; if (_r && _r !== downloadTemplate) return _r(...a); };
    const showImportHistory = async (...a) => { const _r = window.app.showImportHistory; if (_r && _r !== showImportHistory) return _r(...a); };
    const handleImportFileDrop = async (...a) => { const _r = window.app.handleImportFileDrop; if (_r && _r !== handleImportFileDrop) return _r(...a); };
    const handleImportFileSelect = async (...a) => { const _r = window.app.handleImportFileSelect; if (_r && _r !== handleImportFileSelect) return _r(...a); };
    const exportMarketingList = async (...a) => { const _r = window.app.exportMarketingList; if (_r && _r !== exportMarketingList) return _r(...a); };
    const openImportWizardForType = async (...a) => { const _r = window.app.openImportWizardForType; if (_r && _r !== openImportWizardForType) return _r(...a); };
    const renderTeamSummaryCards = async (...a) => { const _r = window.app.renderTeamSummaryCards; if (_r && _r !== renderTeamSummaryCards) return _r(...a); };
    const renderAgentPerformanceRows = async (...a) => { const _r = window.app.renderAgentPerformanceRows; if (_r && _r !== renderAgentPerformanceRows) return _r(...a); };
    const renderInactiveProspectsRows = async (...a) => { const _r = window.app.renderInactiveProspectsRows; if (_r && _r !== renderInactiveProspectsRows) return _r(...a); };
    const renderReassignmentHistory = async (...a) => { const _r = window.app.renderReassignmentHistory; if (_r && _r !== renderReassignmentHistory) return _r(...a); };
    const openReassignModal = async (...a) => { const _r = window.app.openReassignModal; if (_r && _r !== openReassignModal) return _r(...a); };
    const confirmReassignment = async (...a) => { const _r = window.app.confirmReassignment; if (_r && _r !== confirmReassignment) return _r(...a); };
    const executeConfirmedReassignment = async (...a) => { const _r = window.app.executeConfirmedReassignment; if (_r && _r !== executeConfirmedReassignment) return _r(...a); };
    const executeConfirmedQuickReassign = async (...a) => { const _r = window.app.executeConfirmedQuickReassign; if (_r && _r !== executeConfirmedQuickReassign) return _r(...a); };
    const executeConfirmedBulkReassign = async (...a) => { const _r = window.app.executeConfirmedBulkReassign; if (_r && _r !== executeConfirmedBulkReassign) return _r(...a); };
    const executeConfirmedBulkReassignment = async (...a) => { const _r = window.app.executeConfirmedBulkReassignment; if (_r && _r !== executeConfirmedBulkReassignment) return _r(...a); };
    const cancelPendingReassign = async (...a) => { const _r = window.app.cancelPendingReassign; if (_r && _r !== cancelPendingReassign) return _r(...a); };
    const bulkReassign = async (...a) => { const _r = window.app.bulkReassign; if (_r && _r !== bulkReassign) return _r(...a); };
    const confirmBulkReassignment = async (...a) => { const _r = window.app.confirmBulkReassignment; if (_r && _r !== confirmBulkReassignment) return _r(...a); };
    const refreshFollowupStats = async (...a) => { const _r = window.app.refreshFollowupStats; if (_r && _r !== refreshFollowupStats) return _r(...a); };
    const exportFollowupReport = async (...a) => { const _r = window.app.exportFollowupReport; if (_r && _r !== exportFollowupReport) return _r(...a); };
    const configureAlerts = async (...a) => { const _r = window.app.configureAlerts; if (_r && _r !== configureAlerts) return _r(...a); };
    const saveAlertConfig = async (...a) => { const _r = window.app.saveAlertConfig; if (_r && _r !== saveAlertConfig) return _r(...a); };
    const viewAgentDetails = async (...a) => { const _r = window.app.viewAgentDetails; if (_r && _r !== viewAgentDetails) return _r(...a); };
    const contactProspect = async (...a) => { const _r = window.app.contactProspect; if (_r && _r !== contactProspect) return _r(...a); };
    const openAttendeeOutcomeModal = async (...a) => { const _r = window.app.openAttendeeOutcomeModal; if (_r && _r !== openAttendeeOutcomeModal) return _r(...a); };
    const openAttendeeNotesModal = async (...a) => { const _r = window.app.openAttendeeNotesModal; if (_r && _r !== openAttendeeNotesModal) return _r(...a); };
    const saveAttendeeNote = async (...a) => { const _r = window.app.saveAttendeeNote; if (_r && _r !== saveAttendeeNote) return _r(...a); };
    const addScoreToProspect = async (...a) => { const _r = window.app.addScoreToProspect; if (_r && _r !== addScoreToProspect) return _r(...a); };
    const addScoreToCustomer = async (...a) => { const _r = window.app.addScoreToCustomer; if (_r && _r !== addScoreToCustomer) return _r(...a); };
    const applyActivityScoring = async (...a) => { const _r = window.app.applyActivityScoring; if (_r && _r !== applyActivityScoring) return _r(...a); };
    const openScoreAdjustmentModal = async (...a) => { const _r = window.app.openScoreAdjustmentModal; if (_r && _r !== openScoreAdjustmentModal) return _r(...a); };
    const confirmScoreAdjustment = async (...a) => { const _r = window.app.confirmScoreAdjustment; if (_r && _r !== confirmScoreAdjustment) return _r(...a); };
    const autoExtendProtection = async (...a) => { const _r = window.app.autoExtendProtection; if (_r && _r !== autoExtendProtection) return _r(...a); };
    const openLatestMeetupNotes = async (...a) => { const _r = window.app.openLatestMeetupNotes; if (_r && _r !== openLatestMeetupNotes) return _r(...a); };
    const openEditPotentialModal = async (...a) => { const _r = window.app.openEditPotentialModal; if (_r && _r !== openEditPotentialModal) return _r(...a); };
    const savePotential = async (...a) => { const _r = window.app.savePotential; if (_r && _r !== savePotential) return _r(...a); };
    const sendBirthdayWish = async (...a) => { const _r = window.app.sendBirthdayWish; if (_r && _r !== sendBirthdayWish) return _r(...a); };
    const scheduleBirthdayFollowup = async (...a) => { const _r = window.app.scheduleBirthdayFollowup; if (_r && _r !== scheduleBirthdayFollowup) return _r(...a); };
    const executeBirthdayAction = async (...a) => { const _r = window.app.executeBirthdayAction; if (_r && _r !== executeBirthdayAction) return _r(...a); };
    const openKPITargetsModal = async (...a) => { const _r = window.app.openKPITargetsModal; if (_r && _r !== openKPITargetsModal) return _r(...a); };
    const saveKPITargets = async (...a) => { const _r = window.app.saveKPITargets; if (_r && _r !== saveKPITargets) return _r(...a); };
    const renderKPITargetComparison = async (...a) => { const _r = window.app.renderKPITargetComparison; if (_r && _r !== renderKPITargetComparison) return _r(...a); };
    const calculateCustomerHealthScore = async (...a) => { const _r = window.app.calculateCustomerHealthScore; if (_r && _r !== calculateCustomerHealthScore) return _r(...a); };
    const renderHealthBadge = async (...a) => { const _r = window.app.renderHealthBadge; if (_r && _r !== renderHealthBadge) return _r(...a); };
    const renderQuickHealthBadge = async (...a) => { const _r = window.app.renderQuickHealthBadge; if (_r && _r !== renderQuickHealthBadge) return _r(...a); };
    const openAddSlotModal = async (...a) => { const _r = window.app.openAddSlotModal; if (_r && _r !== openAddSlotModal) return _r(...a); };
    const saveBookingSlot = async (...a) => { const _r = window.app.saveBookingSlot; if (_r && _r !== saveBookingSlot) return _r(...a); };
    const deleteBookingSlot = async (...a) => { const _r = window.app.deleteBookingSlot; if (_r && _r !== deleteBookingSlot) return _r(...a); };
    const toggleSlotActive = async (...a) => { const _r = window.app.toggleSlotActive; if (_r && _r !== toggleSlotActive) return _r(...a); };
    const copyBookingLink = async (...a) => { const _r = window.app.copyBookingLink; if (_r && _r !== copyBookingLink) return _r(...a); };
    const openShareBookingLinkModal = async (...a) => { const _r = window.app.openShareBookingLinkModal; if (_r && _r !== openShareBookingLinkModal) return _r(...a); };
    const updateShareLinkPreview = async (...a) => { const _r = window.app.updateShareLinkPreview; if (_r && _r !== updateShareLinkPreview) return _r(...a); };
    const copySmartBookingLink = async (...a) => { const _r = window.app.copySmartBookingLink; if (_r && _r !== copySmartBookingLink) return _r(...a); };
    const confirmBookingAppointment = async (...a) => { const _r = window.app.confirmBookingAppointment; if (_r && _r !== confirmBookingAppointment) return _r(...a); };
    const cancelBookingAppointment = async (...a) => { const _r = window.app.cancelBookingAppointment; if (_r && _r !== cancelBookingAppointment) return _r(...a); };
    const openShareCpsIntakeLinkModal = async (...a) => { const _r = window.app.openShareCpsIntakeLinkModal; if (_r && _r !== openShareCpsIntakeLinkModal) return _r(...a); };
    const saveCpsIntakeLink = async (...a) => { const _r = window.app.saveCpsIntakeLink; if (_r && _r !== saveCpsIntakeLink) return _r(...a); };
    const copyCpsIntakeLink = async (...a) => { const _r = window.app.copyCpsIntakeLink; if (_r && _r !== copyCpsIntakeLink) return _r(...a); };
    const shareCpsIntakeWhatsApp = async (...a) => { const _r = window.app.shareCpsIntakeWhatsApp; if (_r && _r !== shareCpsIntakeWhatsApp) return _r(...a); };
    const renderPendingCpsIntakes = async (...a) => { const _r = window.app.renderPendingCpsIntakes; if (_r && _r !== renderPendingCpsIntakes) return _r(...a); };
    const rejectCpsIntake = async (...a) => { const _r = window.app.rejectCpsIntake; if (_r && _r !== rejectCpsIntake) return _r(...a); };
    const scanCpsForm = async (...a) => { const _r = window.app.scanCpsForm; if (_r && _r !== scanCpsForm) return _r(...a); };
    const handleCpsScanFile = async (...a) => { const _r = window.app.handleCpsScanFile; if (_r && _r !== handleCpsScanFile) return _r(...a); };
    const renderCpsScanReview = async (...a) => { const _r = window.app.renderCpsScanReview; if (_r && _r !== renderCpsScanReview) return _r(...a); };
    const toggleCpsScanAll = async (...a) => { const _r = window.app.toggleCpsScanAll; if (_r && _r !== toggleCpsScanAll) return _r(...a); };
    const applyCpsScanSelection = async (...a) => { const _r = window.app.applyCpsScanSelection; if (_r && _r !== applyCpsScanSelection) return _r(...a); };
    const _hideCpsScanOverlay = async (...a) => { const _r = window.app._hideCpsScanOverlay; if (_r && _r !== _hideCpsScanOverlay) return _r(...a); };
    const _uploadCpsFormFile = async (...a) => { const _r = window.app._uploadCpsFormFile; if (_r && _r !== _uploadCpsFormFile) return _r(...a); };
    const openCpsPasteModal = async (...a) => { const _r = window.app.openCpsPasteModal; if (_r && _r !== openCpsPasteModal) return _r(...a); };
    const parseCpsPastedText = async (...a) => { const _r = window.app.parseCpsPastedText; if (_r && _r !== parseCpsPastedText) return _r(...a); };
    const toggleActivityNoticeboardFields = async (...a) => { const _r = window.app.toggleActivityNoticeboardFields; if (_r && _r !== toggleActivityNoticeboardFields) return _r(...a); };
    const markMilestoneCompleted = async (...a) => { const _r = window.app.markMilestoneCompleted; if (_r && _r !== markMilestoneCompleted) return _r(...a); };
    const openStoryDetail = async (...a) => { const _r = window.app.openStoryDetail; if (_r && _r !== openStoryDetail) return _r(...a); };
    const openHighlightModal = async (...a) => { const _r = window.app.openHighlightModal; if (_r && _r !== openHighlightModal) return _r(...a); };
    const saveHighlight = async (...a) => { const _r = window.app.saveHighlight; if (_r && _r !== saveHighlight) return _r(...a); };
    const deleteHighlight = async (...a) => { const _r = window.app.deleteHighlight; if (_r && _r !== deleteHighlight) return _r(...a); };
    const confirmDeleteHighlight = async (...a) => { const _r = window.app.confirmDeleteHighlight; if (_r && _r !== confirmDeleteHighlight) return _r(...a); };
    const resetMilestone = async (...a) => { const _r = window.app.resetMilestone; if (_r && _r !== resetMilestone) return _r(...a); };
    const syncFudiSummary = async (...a) => { const _r = window.app.syncFudiSummary; if (_r && _r !== syncFudiSummary) return _r(...a); };
    const openRewardModal = async (...a) => { const _r = window.app.openRewardModal; if (_r && _r !== openRewardModal) return _r(...a); };
    const saveReward = async (...a) => { const _r = window.app.saveReward; if (_r && _r !== saveReward) return _r(...a); };
    const deleteReward = async (...a) => { const _r = window.app.deleteReward; if (_r && _r !== deleteReward) return _r(...a); };
    const confirmDeleteReward = async (...a) => { const _r = window.app.confirmDeleteReward; if (_r && _r !== confirmDeleteReward) return _r(...a); };
    const openQuarterlyTargetsModal = async (...a) => { const _r = window.app.openQuarterlyTargetsModal; if (_r && _r !== openQuarterlyTargetsModal) return _r(...a); };
    const saveQuarterlyTargets = async (...a) => { const _r = window.app.saveQuarterlyTargets; if (_r && _r !== saveQuarterlyTargets) return _r(...a); };
    const openSpecialProgramModal = async (...a) => { const _r = window.app.openSpecialProgramModal; if (_r && _r !== openSpecialProgramModal) return _r(...a); };
    const saveSpecialProgram = async (...a) => { const _r = window.app.saveSpecialProgram; if (_r && _r !== saveSpecialProgram) return _r(...a); };
    const deleteSpecialProgram = async (...a) => { const _r = window.app.deleteSpecialProgram; if (_r && _r !== deleteSpecialProgram) return _r(...a); };
    const confirmDeleteSpecialProgram = async (...a) => { const _r = window.app.confirmDeleteSpecialProgram; if (_r && _r !== confirmDeleteSpecialProgram) return _r(...a); };
    const openActionPlanModal = async (...a) => { const _r = window.app.openActionPlanModal; if (_r && _r !== openActionPlanModal) return _r(...a); };
    const addPlanItemRow = async (...a) => { const _r = window.app.addPlanItemRow; if (_r && _r !== addPlanItemRow) return _r(...a); };
    const saveActionPlan = async (...a) => { const _r = window.app.saveActionPlan; if (_r && _r !== saveActionPlan) return _r(...a); };
    const updatePlanCheck = async (...a) => { const _r = window.app.updatePlanCheck; if (_r && _r !== updatePlanCheck) return _r(...a); };
    const sendPlanReminder = async (...a) => { const _r = window.app.sendPlanReminder; if (_r && _r !== sendPlanReminder) return _r(...a); };
    const showActionPlanHistory = async (...a) => { const _r = window.app.showActionPlanHistory; if (_r && _r !== showActionPlanHistory) return _r(...a); };
    const initActionPlanReminder = async (...a) => { const _r = window.app.initActionPlanReminder; if (_r && _r !== initActionPlanReminder) return _r(...a); };
    const renderRefillReminders = async (...a) => { const _r = window.app.renderRefillReminders; if (_r && _r !== renderRefillReminders) return _r(...a); };
    const checkRefillReminderTable = async (...a) => { const _r = window.app.checkRefillReminderTable; if (_r && _r !== checkRefillReminderTable) return _r(...a); };
    const showRefillMigrationModal = async (...a) => { const _r = window.app.showRefillMigrationModal; if (_r && _r !== showRefillMigrationModal) return _r(...a); };
    const sendRefillWhatsApp = async (...a) => { const _r = window.app.sendRefillWhatsApp; if (_r && _r !== sendRefillWhatsApp) return _r(...a); };
    const sendDescriptionInvite = async (...a) => { const _r = window.app.sendDescriptionInvite; if (_r && _r !== sendDescriptionInvite) return _r(...a); };
    const dismissRefillReminder = async (...a) => { const _r = window.app.dismissRefillReminder; if (_r && _r !== dismissRefillReminder) return _r(...a); };
    const viewRefillProspect = async (...a) => { const _r = window.app.viewRefillProspect; if (_r && _r !== viewRefillProspect) return _r(...a); };
    const applyFilters = async (...a) => { const _r = window.app.applyFilters; if (_r && _r !== applyFilters) return _r(...a); };
    const clearFilters = async (...a) => { const _r = window.app.clearFilters; if (_r && _r !== clearFilters) return _r(...a); };
    const updateConditionOperator = async (...a) => { const _r = window.app.updateConditionOperator; if (_r && _r !== updateConditionOperator) return _r(...a); };
    const updateConditionValue = async (...a) => { const _r = window.app.updateConditionValue; if (_r && _r !== updateConditionValue) return _r(...a); };
    const updateGroupLogic = async (...a) => { const _r = window.app.updateGroupLogic; if (_r && _r !== updateGroupLogic) return _r(...a); };
    const deleteFile = async (...a) => { const _r = window.app.deleteFile; if (_r && _r !== deleteFile) return _r(...a); };
    const _confirmDeleteFile = async (...a) => { const _r = window.app._confirmDeleteFile; if (_r && _r !== _confirmDeleteFile) return _r(...a); };
    const showProfile = async (...a) => { const _r = window.app.showProfile; if (_r && _r !== showProfile) return _r(...a); };
    const exportKPIDashboard = async (...a) => { const _r = window.app.exportKPIDashboard; if (_r && _r !== exportKPIDashboard) return _r(...a); };
    const renderFormsTab = async (...a) => { const _r = window.app.renderFormsTab; if (_r && _r !== renderFormsTab) return _r(...a); };
    const cfSearchProspects = async (...a) => { const _r = window.app.cfSearchProspects; if (_r && _r !== cfSearchProspects) return _r(...a); };
    const cfClearSignature = async (...a) => { const _r = window.app.cfClearSignature; if (_r && _r !== cfClearSignature) return _r(...a); };
    const openCustomerSurveyModal = async (...a) => { const _r = window.app.openCustomerSurveyModal; if (_r && _r !== openCustomerSurveyModal) return _r(...a); };
    const saveCustomerSurvey = async (...a) => { const _r = window.app.saveCustomerSurvey; if (_r && _r !== saveCustomerSurvey) return _r(...a); };
    const openCpsAnalysisModal = async (...a) => { const _r = window.app.openCpsAnalysisModal; if (_r && _r !== openCpsAnalysisModal) return _r(...a); };
    const saveCpsAnalysis = async (...a) => { const _r = window.app.saveCpsAnalysis; if (_r && _r !== saveCpsAnalysis) return _r(...a); };
    const openApuAppraisalModal = async (...a) => { const _r = window.app.openApuAppraisalModal; if (_r && _r !== openApuAppraisalModal) return _r(...a); };
    const saveApuAppraisal = async (...a) => { const _r = window.app.saveApuAppraisal; if (_r && _r !== saveApuAppraisal) return _r(...a); };
    const openDestinyBlueprintModal = async (...a) => { const _r = window.app.openDestinyBlueprintModal; if (_r && _r !== openDestinyBlueprintModal) return _r(...a); };
    const openDestinyBlueprintInTab = async (...a) => { const _r = window.app.openDestinyBlueprintInTab; if (_r && _r !== openDestinyBlueprintInTab) return _r(...a); };
    const saveDestinyBlueprint = async (...a) => { const _r = window.app.saveDestinyBlueprint; if (_r && _r !== saveDestinyBlueprint) return _r(...a); };

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
        // Self-loading stub: eager-loader covers this after login, but if called
        // before it finishes (e.g. user clicks calendar cell immediately), the
        // stub loads the chunk then re-invokes the now-real function.
        openActivityModal: (...args) => _loadChunkOnce('chunks/script-activities.min.js').then(() => window.app.openActivityModal(...args)),

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

        // Phase 6A: Journey System — implemented by chunks/script-journey.js
        // (Object.assign after chunk load overrides these forwarding stubs)
        renderJourneyTab:          async (...a) => (window.app.renderJourneyTab           || (() => {}))(...a),
        markJourneyTouchpointDone: async (...a) => (window.app.markJourneyTouchpointDone  || (() => {}))(...a),
        skipJourneyTouchpoint:     async (...a) => (window.app.skipJourneyTouchpoint      || (() => {}))(...a),
        snoozeJourneyTouchpoint:   async (...a) => (window.app.snoozeJourneyTouchpoint    || (() => {}))(...a),
        executeSnooze:             async (...a) => (window.app.executeSnooze              || (() => {}))(...a),
        sendJourneyWhatsApp:       async (...a) => (window.app.sendJourneyWhatsApp        || (() => {}))(...a),
        switchJourneyTrackDisplay: async (...a) => (window.app.switchJourneyTrackDisplay  || (() => {}))(...a),
        switchJourneyTrack:        async (...a) => (window.app.switchJourneyTrack         || (() => {}))(...a),
        confirmSwitchJourneyTrack: async (...a) => (window.app.confirmSwitchJourneyTrack  || (() => {}))(...a),
        openSpawnTouchpointsModal: async (...a) => (window.app.openSpawnTouchpointsModal  || (() => {}))(...a),
        executeSpawnTouchpoints:   async (...a) => (window.app.executeSpawnTouchpoints    || (() => {}))(...a),
        showAgentJourneyDashboard: async (...a) => (window.app.showAgentJourneyDashboard  || (() => {}))(...a),
        showAgentJourneyLoad:      async (...a) => (window.app.showAgentJourneyLoad       || (() => {}))(...a),

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

        // [CHUNK: order_form_extract] showOrderFormExtractView + ofeHandleFile Object.assigned by chunks/script-order-form-extract.js

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


// Toggle login-page password visibility (called from index.html onclick="app.toggleLoginPassword(this)")
function toggleLoginPassword(btn) {
    const inp = document.getElementById('loginPassword');
    if (!inp) return;
    inp.type = inp.type === 'password' ? 'text' : 'password';
    const icon = btn.querySelector('i');
    if (icon) icon.className = 'fas ' + (inp.type === 'text' ? 'fa-eye-slash' : 'fa-eye');
}

// Export startup-critical security functions (dashboards moved to script-admin.js chunk)
Object.assign(window.app, {
    toggleLoginPassword,
    initSecurity,
    initSessionTimeout,
    logoutDueToInactivity,
    monitorLoginAttempts,
    checkForSecurityIncidents,
    addSecurityAlertIcon,
    checkExpiredConsents,
    scheduleRetentionJobs,
    // Security dashboards + Admin functions loaded lazily by script-admin.js chunk
    showSecurityDashboard:  () => (window.app._adminChunkLoaded ? window.app.showSecurityDashboard()  : window._loadChunk('chunks/script-admin.min.js').then(() => window.app.showSecurityDashboard())),
    showAuditLogs:          () => (window.app._adminChunkLoaded ? window.app.showAuditLogs()          : window._loadChunk('chunks/script-admin.min.js').then(() => window.app.showAuditLogs())),
    showComplianceCenter:   () => (window.app._adminChunkLoaded ? window.app.showComplianceCenter()   : window._loadChunk('chunks/script-admin.min.js').then(() => window.app.showComplianceCenter())),
    showAdminDashboard:     () => window._loadChunk('chunks/script-admin.min.js').then(() => window.app.showAdminDashboard()),
    _prefetchChunkForView,
    // Two-factor (defined in two-factor.min.js, loaded separately)
    showTwoFactorSetup:  typeof showTwoFactorSetup  !== 'undefined' ? showTwoFactorSetup  : () => UI?.toast?.warning('Two-factor setup not available.'),
    verifyAndEnable2FA:  typeof verifyAndEnable2FA  !== 'undefined' ? verifyAndEnable2FA  : () => UI?.toast?.warning('Two-factor not available.'),
    showTwoFactorLogin:  typeof showTwoFactorLogin  !== 'undefined' ? showTwoFactorLogin  : () => UI?.toast?.warning('Two-factor not available.'),
    verifyTwoFactorLogin: typeof verifyTwoFactorLogin !== 'undefined' ? verifyTwoFactorLogin : () => UI?.toast?.warning('Two-factor not available.'),
});

// ========== SECURITY DASHBOARD + SYSTEM ADMIN (Phase 5B) ==========
// [CHUNK: admin] ~547 lines extracted to chunks/script-admin.js
// Loaded on-demand: security/admin/system views. Super Admin only.
// ========== ORG CHART CONSULTANT (Phase 5C) ==========
// [CHUNK: org] ~688 lines extracted to chunks/script-org.js
// Loaded on-demand when navigating to org_chart view.

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
