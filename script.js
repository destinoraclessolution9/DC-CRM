// Ensure app object exists globally - MUST BE FIRST LINE
window.app = window.app || {};
window.DataStore = window.AppDataStore; // Alias for backward compatibility

// God-object ownership registry (#1). Lazy chunks call
//   app.register('calendar', { renderCalendar, ... })
// instead of Object.assign(window.app, { ... }). Runtime effect is IDENTICAL —
// the methods land on window.app, preserving the inline onclick="app.fn(id)"
// contract — but each key's owning domain is recorded in app._registry and a
// cross-domain redefinition (the old silent last-loader-wins overwrite the
// audit flagged) now logs a warning. Defined here, before any chunk loads
// (script.js is deferred ahead of the lazy chunks), so it is always available.
// Phase 7: methods are ALSO mirrored under app._modules[domain][key] as the
// SAME reference (additive — app.fn is unchanged), giving an explicit, queryable
// module boundary without alias-wrapper `this`/identity/perf hazards.
window.app._registry = window.app._registry || {};
window.app._modules = window.app._modules || {};
window.app.register = function (domain, methods) {
    if (methods) {
        const ns = (window.app._modules[domain] = window.app._modules[domain] || {});
        for (const k of Object.keys(methods)) {
            const prev = window.app._registry[k];
            if (prev && prev !== domain) {
                try { console.warn('[app.register] "' + k + '" redefined: ' + prev + ' -> ' + domain); } catch (_) { /* intentional: console may be unavailable; redefinition still proceeds */ }
            }
            window.app._registry[k] = domain;
            ns[k] = methods[k]; // same reference as the flat app[k] — additive mirror, not a wrapper
        }
    }
    return Object.assign(window.app, methods || {});
};

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
                try { window._markOptimisticRetrying(); } catch (_) { /* intentional: optional UI overlay hook; drain proceeds without it */ }
            }
            // getAll triggers _autoSync which upserts queued records.
            for (const t of tables) {
                try { await window.AppDataStore.getAll(t); } catch (_) { /* intentional: per-table drain is best-effort; failed rows stay queued with ⚠ */ }
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
                    try { UI.toast.info('Already saving — please wait…'); } catch (_) { /* intentional: toast is cosmetic; re-entrancy guard still returns */ }
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
if (window.AppDataStore && !window.AppDataStore._patched) {
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
            try { await AppDataStore.delete('user_preferences', existing.id); } catch (_) { /* intentional: best-effort remote delete; local cache cleared regardless */ }
        }
        delete this._cache[key];
    },

    async _migrateFromLocalStorage(userId) {
        const migrations = [
            { lsKey: 'voice_settings', prefKey: 'voice_settings', parse: v => { try { return JSON.parse(v); } catch(_) { return null; /* intentional: JSON.parse fallback on corrupt value */ } } },
            { lsKey: `hidden_top_referrers_v2_${userId}`, prefKey: 'hidden_referrers', parse: v => { try { return JSON.parse(v); } catch(_) { return null; /* intentional: JSON.parse fallback on corrupt value */ } } },
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
            } catch (_) { /* intentional: best-effort per-key migration, skip on read/parse failure */ }
        }
        try { await this.save('_migrated', true); } catch (_) { /* intentional: best-effort migration-flag write */ }
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
    let _cpsPendingPhotoFiles = {}; // Pending photo files for CPS photo upload, keyed by prefix (e.g. {cps: File}). Written by script-cps.js via _state.cppf, consumed by script-activities.js saveActivity.
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
    // MEMO-3: bounded drop-in Map — reinsert refreshes recency, evict oldest over cap; a dropped entry just refetches.
    class _BoundedMap extends Map {
        set(k, v) { if (super.has(k)) super.delete(k); super.set(k, v); if (this.size > 500) super.delete(super.keys().next().value); return this; }
    }
    const _hotActivityCache = new _BoundedMap();
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
    // Disabled: every standalone "cacheable" view (prospects / calendar / month /
    // pipeline) is now a React island rendered with synthetic onClick handlers
    // (ProspectsTable/CalendarView/PipelineView .jsx). Snapshotting their innerHTML
    // and restoring it produces DEAD DOM — React's event delegation lives on the
    // root fiber, not in the serialized markup, so the restored table is fully
    // non-interactive. React re-mount over warm React-Query data is fast enough.
    // The machinery is kept for any future *vanilla* (inline-onclick) view.
    const _CACHEABLE_VIEWS = new Set();
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
    // Management = Level 1-4 (Super Admin, Marketing Manager, Senior Manager, Manager).
    // L4 "Manager" included per the role-system spec (owner-confirmed 2026-06-19);
    // Team Leaders are L5 and covered by isTeamLeaderOrAbove, not isManagement.
    const isManagement = (user) => _getUserLevel(user) <= 4;
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

    // Customer (L13) and Referrer (L14) role helpers — used by script-prospects.js
    // and script-cps.js via _utils.isCustomer / _utils.isReferrer.
    const isCustomer = (user) => _getUserLevel(user) === 13;
    const isReferrer  = (user) => _getUserLevel(user) === 14;
    Object.assign(window._crmUtils, { isCustomer, isReferrer });
    // Canonical referrer-or-customer membership (Wave 1.3): both sides already
    // resolve via _getUserLevel, so chunks folding their inline {l>=13&&l<=14}
    // onto this are byte-decision-identical.
    const isReferrerOrCustomer = (user) => { const l = _getUserLevel(user); return l >= 13 && l <= 14; };
    Object.assign(window._crmUtils, { isReferrerOrCustomer });

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
    // Atomic, race-free customer lifetime_value + total_purchases adjuster, shared by
    // the customers chunk (savePurchase/deletePurchase) and the approvals chunk
    // (approveQueueEntry/approveClosingRecord sales) so every purchase path mutates
    // LTV identically. One server-side UPDATE via the adjust_customer_ltv RPC (no
    // read-modify-write lost-update race — audit #16; symmetric add/delete — audit #8;
    // maintains total_purchases — audit #22). Falls back to an optimistic local update
    // that queues offline if the RPC is unreachable.
    Object.assign(window._crmUtils, {
        adjustCustomerLtv: async (customerId, amountDelta, countDelta) => {
            try {
                const { error } = await window.supabase.rpc('adjust_customer_ltv', {
                    p_customer_id: customerId, p_amount_delta: amountDelta, p_count_delta: countDelta,
                });
                if (!error) { try { AppDataStore.invalidateCache('customers'); } catch (_) { /* cache drop best-effort */ } return; }
            } catch (_) { /* offline / RPC unreachable -> optimistic local fallback below */ }
            try {
                const c = await AppDataStore.getById('customers', customerId);
                if (c) await AppDataStore.update('customers', customerId, {
                    lifetime_value: Math.max(0, (c.lifetime_value || 0) + amountDelta),
                    total_purchases: Math.max(0, (c.total_purchases || 0) + countDelta),
                });
            } catch (_) { /* best-effort: a failed LTV adjust must not abort the purchase write */ }
        },
    });

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
        const level = _getUserLevel(user);
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
        const _visitedCollect = new Set();
        const collect = (uid) => {
            const uidStr = String(uid);
            if (_visitedCollect.has(uidStr)) return; // cycle guard
            _visitedCollect.add(uidStr);
            result.push(uid);
            allUsers
                .filter(u => String(u.reporting_to) === uidStr &&
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
    Object.assign(window._crmUtils, {
        withTimeout:          (p,ms,fb,lbl) => withTimeout(p,ms,fb,lbl),
        getVisibleProspects:  ()            => getVisibleProspects(),
        getVisibleActivities: ()            => getVisibleActivities(),
    });

    // Check if current user can view a given prospect
    const canViewProspect = async (prospect) => {
        const user = _currentUser;
        if (!user) return false;
        const visibleIds = await getVisibleUserIds(user);
        if (visibleIds === 'all') return true;
        return visibleIds.includes(prospect.responsible_agent_id);
    };

    // Server-visibility scoping (getVisibleProspects/Customers) — ON by default.
    // Provably parity-equal to the legacy whole-table-then-filter (same visibleIds
    // drive the server `.in()` as the client `.includes()`), and a query error
    // auto-falls back. Instant kill-switch to force the legacy path:
    //   ?novis=1 in the URL · localStorage.crm_visibility_off='1' · window.__SERVER_VISIBILITY=false
    const _serverVisibilityOn = () => {
        try {
            if (window.__SERVER_VISIBILITY === false) return false;
            if (typeof location !== 'undefined' && /[?&]novis=1/.test(location.search || '')) return false;
            if (typeof localStorage !== 'undefined' && localStorage.getItem('crm_visibility_off') === '1') return false;
        } catch (_) { /* intentional: kill-switch probe; default ON when storage/location unreadable */ }
        return true;
    };

    // Staging gate for the EXTENDED visibility scoping (referrals + activities).
    // Honors the master kill-switch above, but defaults OFF until each is parity-
    // verified against live data, then flipped on. Force-on for verification with
    // window.__SERVER_VIS_EXT = true.
    const _serverVisExtOn = () => _serverVisibilityOn() && window.__SERVER_VIS_EXT === true;

    // Get all prospects visible to current user
    const getVisibleProspects = async () => {
        const user = _currentUser;
        if (!user) return [];
        const visibleIds = await getVisibleUserIds(user);
        // Scale-safe (ON by default; kill-switch ?novis=1 / crm_visibility_off): scoped (non-admin) users fetch only
        // prospects owned by a visible agent server-side (paged) instead of
        // downloading the whole table then filtering. Provable parity — the same
        // visibleIds drive `.in(responsible_agent_id, …)` as the client filter.
        // Any error / flag off / admin → exact legacy getAll-then-filter below.
        if (_serverVisibilityOn() && Array.isArray(visibleIds) && visibleIds.length) {
            try {
                const scoped = await AppDataStore.queryPaged('prospects', {
                    filters: { responsible_agent_id: visibleIds }, max: 200000,
                });
                if (Array.isArray(scoped)) return scoped;
            } catch (e) {
                console.warn('getVisibleProspects: server-scope query failed — full-table fallback', e);
            }
        }
        const all = await AppDataStore.getAll('prospects');
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
        const user = _currentUser;
        if (!user) return [];
        const visibleIds = await getVisibleUserIds(user);
        // Scale-safe (ON by default; kill-switch ?novis=1 / crm_visibility_off): scoped users fetch only customers
        // owned by a visible agent server-side (paged) via TWO scoped fetches
        // (responsible_agent_id OR legacy agent_id) merged + deduped — matching the
        // client OR filter. Any error / flag off / admin → legacy getAll-then-filter.
        if (_serverVisibilityOn() && Array.isArray(visibleIds) && visibleIds.length) {
            try {
                const [byResp, byAgent] = await Promise.all([
                    AppDataStore.queryPaged('customers', { filters: { responsible_agent_id: visibleIds }, max: 200000 }),
                    AppDataStore.queryPaged('customers', { filters: { agent_id: visibleIds }, max: 200000 }),
                ]);
                if (Array.isArray(byResp) && Array.isArray(byAgent)) {
                    const seen = new Set();
                    const out = [];
                    for (const c of [...byResp, ...byAgent]) {
                        const k = String(c.id);
                        if (!seen.has(k)) { seen.add(k); out.push(c); }
                    }
                    return out;
                }
            } catch (e) {
                console.warn('getVisibleCustomers: server-scope query failed — full-table fallback', e);
            }
        }
        const all = await AppDataStore.getAll('customers');
        if (visibleIds === 'all') return all;
        // Customers may store the owning agent on either responsible_agent_id (new) or agent_id (legacy)
        return all.filter(c => visibleIds.includes(c.responsible_agent_id) || visibleIds.includes(c.agent_id));
    };
    // Export permission-check helpers to _crmUtils so lazy chunks can resolve them.
    // canViewProspect/canViewCustomer/getVisibleCustomers are defined after the first
    // Object.assign block (line ~713) so they get their own Object.assign here.
    Object.assign(window._crmUtils, {
        canViewProspect:     (p) => canViewProspect(p),
        canViewCustomer:     (c) => canViewCustomer(c),
        getVisibleCustomers: ()  => getVisibleCustomers(),
    });

    // Role-based referral visibility:
    //   - Admin / Marketing Manager / Level 1-2: see every referral
    //   - Upline (Level 3-11): see referrals owned by themselves or anyone in their reporting subtree
    //   - Agent / Level 12+: see only referrals where they are the owning agent
    // A referral is considered "owned" by the agent tied to either side of it:
    //   - referrer is a user -> that user's id
    //   - referrer is a customer/prospect -> its responsible_agent_id
    //   - referred_prospect's responsible_agent_id
    const getVisibleReferrals = async () => {
        const user = _currentUser;
        if (!user) return [];
        const visibleIds = await getVisibleUserIds(user);
        if (visibleIds === 'all') return await AppDataStore.getAll('referrals');
        const visibleSet = new Set(visibleIds.map(String));
        const _ownerAgentOf = (id, type, prospectMap, customerMap) => {
            if (!id) return null;
            if (type === 'user') return String(id);
            if (type === 'customer') { const c = customerMap.get(String(id)); return c?.responsible_agent_id != null ? String(c.responsible_agent_id) : null; }
            const p = prospectMap.get(String(id));
            return p?.responsible_agent_id != null ? String(p.responsible_agent_id) : null;
        };
        const _filterRefs = (rows, prospectMap, customerMap) => (rows || []).filter(r => {
            const ro = _ownerAgentOf(r.referrer_id, r.referrer_type || 'prospect', prospectMap, customerMap);
            if (ro && visibleSet.has(ro)) return true;
            const rdo = _ownerAgentOf(r.referred_prospect_id, 'prospect', prospectMap, customerMap);
            if (rdo && visibleSet.has(rdo)) return true;
            return false;
        });

        // Scale-safe (flag-gated, staging): fetch only the VISIBLE prospects/customers
        // + only referrals that touch a visible entity id, instead of the whole
        // referrals + prospects + customers tables. Maps built from the visible
        // entities make _filterRefs exactly equivalent to the legacy full-map filter
        // (a referral via a non-visible entity's owner is never in visibleSet either
        // way). Any error / flag off → exact legacy whole-table path below.
        if (_serverVisibilityOn() && window.__SERVER_VIS_REF !== false && Array.isArray(visibleIds) && visibleIds.length) {
            try {
                const [visProspects, visCustomers] = await Promise.all([getVisibleProspects(), getVisibleCustomers()]);
                const prospectMap = new Map((visProspects || []).map(p => [String(p.id), p]));
                const customerMap = new Map((visCustomers || []).map(c => [String(c.id), c]));
                const unionIds = [...new Set([...visibleIds.map(String), ...prospectMap.keys(), ...customerMap.keys()])];
                const prospectIds = [...prospectMap.keys()];
                const scopeFields = [{ field: 'referrer_id', values: unionIds }];
                if (prospectIds.length) scopeFields.push({ field: 'referred_prospect_id', values: prospectIds });
                const res = await AppDataStore.queryAdvanced('referrals', { scopeFields, limit: 100000, countMode: null });
                if (res && Array.isArray(res.data)) return _filterRefs(res.data, prospectMap, customerMap);
            } catch (e) {
                console.warn('getVisibleReferrals: server-scope failed — full-table fallback', e);
            }
        }

        // Legacy exact path — whole tables.
        const all = await AppDataStore.getAll('referrals');
        const [allProspects, allCustomers] = await Promise.all([
            AppDataStore.getAll('prospects'),
            AppDataStore.getAll('customers')
        ]);
        return _filterRefs(all, new Map(allProspects.map(p => [String(p.id), p])), new Map(allCustomers.map(c => [String(c.id), c])));
    };
    // Export so lazy chunks (script-referrals.js) can call it cross-chunk.
    Object.assign(window._crmUtils, { getVisibleReferrals: () => getVisibleReferrals() });

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
        const user = _currentUser;
        if (isSystemAdmin(user)) return await AppDataStore.getAll('activities');
        const allUsersForVis = await AppDataStore.getAll('users');
        const canView = await buildActivityVisibilityChecker(allUsersForVis);

        // Scale-safe (flag-gated, staging): fetch only the candidate superset
        // (open/public ∪ lead∈visible ∪ I'm-a-co-agent) instead of the whole
        // activities table, then apply the SAME checker for exact parity — the
        // superset provably covers every activity canView passes. Any error / flag
        // off → exact legacy whole-table path below.
        if (_serverVisibilityOn() && window.__SERVER_VIS_ACT !== false && user) {
            try {
                const visibleIds = await getVisibleUserIds(user);
                const sel = AppDataStore._selectClauseForGetAll('activities');
                const parts = [
                    AppDataStore.queryAdvanced('activities', { scopeFields: [{ field: 'visibility', values: ['open', 'public'] }, { field: 'is_public', values: [true] }], select: sel, limit: 100000, countMode: null }),
                    (async () => { const { data, error } = await AppDataStore._readClient().from('activities').select(sel).contains('co_agents', JSON.stringify([{ id: user.id }])); if (error) throw error; return { data: data || [] }; })(),
                ];
                if (Array.isArray(visibleIds) && visibleIds.length) {
                    parts.push(AppDataStore.queryAdvanced('activities', { scopeField: 'lead_agent_id', scopeValues: visibleIds, select: sel, limit: 100000, countMode: null }));
                }
                const results = await Promise.all(parts);
                const byId = new Map();
                for (const res of results) for (const a of (res && res.data) || []) byId.set(String(a.id), a);
                // Strip locally-tombstoned rows (the co_agents .contains query bypasses
                // the shared read methods, so apply the same filter getAll uses).
                const candidates = AppDataStore._stripTombstones('activities', [...byId.values()]);
                return candidates.filter(canView);
            } catch (e) {
                console.warn('getVisibleActivities: server-scope failed — full-table fallback', e);
            }
        }
        const all = await AppDataStore.getAll('activities');
        return all.filter(canView);
    };

    // Check edit permission: Level 1-2 can edit anything;
    // Level 3-10 can edit their team's records; Level 11-14 own records only.
    const canEditProspect = async (prospect) => {
        const user = _currentUser;
        if (!user) return false;
        const level = _getUserLevel(user);
        // Levels 1-2: full edit access
        if (level <= 2) return true;
        // Levels 3-10: can edit team/subordinate records
        if (level <= 10) {
            const visibleIds = await getVisibleUserIds(user);
            if (visibleIds === 'all') return true;
            return visibleIds.some(id => String(id) === String(prospect.responsible_agent_id));
        }
        // Levels 11-14: own records only
        return String(prospect.responsible_agent_id) === String(user.id);
    };

    // Similar for customers, activities, etc. – you can add as needed.

    const canViewNode = async (personId, personType) => {
        const level = _getUserLevel(_currentUser);
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
    // Exposed for script-activities.js updateLunarBirth (lunar DOB auto-fill).
    Object.assign(window._crmUtils, { convertSolarToLunar: (d) => convertSolarToLunar(d) });
	const escapeHtml = (unsafe) => {
    if (unsafe === null || unsafe === undefined) return '';
    return String(unsafe)
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
    // Canonical CSV helpers (Wave 1.3): byte-identical to the per-chunk copies
    // they replace (injection-guard, quote-doubling, BOM + CRLF row join).
    const csvCell = (v) => { let s = String(v == null ? '' : v); if (/^[=+\-@]/.test(s)) s = "'" + s; return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
    const toCsv = (rows) => '﻿' + rows.map(r => r.map(csvCell).join(',')).join('\r\n');
    Object.assign(window._crmUtils, { csvCell, toCsv });

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
    // ensureReferralFields is ALSO exported in the app return object, so
    // app.ensureReferralFields IS this wrapper until the search chunk's
    // Object.assign replaces it — calling it blindly recursed into itself
    // (stack overflow in the bg-init task on every boot). Load the chunk,
    // then only delegate if the registration actually changed.
    const ensureReferralFields  = async () => {
        if (typeof window._loadChunk !== 'function') return;
        try { await window._loadChunk('chunks/script-search.min.js'); } catch (_) { return; /* intentional: bail if lazy chunk fails to load */ }
        const fn = window.app && window.app.ensureReferralFields;
        if (typeof fn === 'function' && fn !== ensureReferralFields) return fn();
    };
    // These three are ALSO exported in the app return object, so app.X IS this
    // wrapper until the search chunk's Object.assign replaces it. Calling the
    // bare `(window.app.X || noop)()` recursed into itself → stack overflow when
    // the header Search button is clicked before the (tier-2, 3s-delayed) search
    // chunk loads. Self-load the chunk, then delegate only if the real fn exists.
    const toggleSearchPanel     = async () => {
        if (typeof window._loadChunk === 'function') { try { await window._loadChunk('chunks/script-search.min.js'); } catch (_) { return; /* intentional: bail if lazy chunk fails to load */ } }
        const fn = window.app && window.app.toggleSearchPanel;
        if (typeof fn === 'function' && fn !== toggleSearchPanel) return fn();
    };
    const hideSearchPanel       = () => {
        const fn = window.app && window.app.hideSearchPanel;
        if (typeof fn === 'function' && fn !== hideSearchPanel) return fn();
    };
    const showSearchPanel       = async () => {
        if (typeof window._loadChunk === 'function') { try { await window._loadChunk('chunks/script-search.min.js'); } catch (_) { return; /* intentional: bail if lazy chunk fails to load */ } }
        const fn = window.app && window.app.showSearchPanel;
        if (typeof fn === 'function' && fn !== showSearchPanel) return fn();
    };
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
        } catch (e) { _offlineQueue = []; /* intentional: reset queue if saved JSON is corrupt */ }

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

    // Self-loading stub: inline onclick="app.openSendWhatsAppModal(...)" on the
    // customer-profile WhatsApp icon (prospects chunk, tier-1) is reachable before
    // the whatsapp chunk loads. Load it, then delegate to the real modal.
    const openSendWhatsAppModal = async (...a) => {
        if (typeof window._loadChunk === 'function') { try { await window._loadChunk('chunks/script-whatsapp.min.js'); } catch (_) { return; /* intentional: bail if lazy chunk fails to load */ } }
        const fn = window.app && window.app.openSendWhatsAppModal;
        if (typeof fn === 'function' && fn !== openSendWhatsAppModal) return fn(...a);
    };

    // Account / logout menu (top-nav avatar click, app-init.js). The real impl
    // lives in the L1/L2-only marketing chunk, but the menu must work for EVERY
    // role — self-load the chunk, then delegate. uploadProfilePhoto/loginAs are
    // reached only from inside the rendered menu, so the chunk is loaded by then.
    const toggleUserMenu = async (...a) => {
        if (typeof window._loadChunk === 'function') { try { await window._loadChunk('chunks/script-marketing.min.js'); } catch (_) { return; /* intentional: bail if lazy chunk fails to load */ } }
        const fn = window.app && window.app.toggleUserMenu;
        if (typeof fn === 'function' && fn !== toggleUserMenu) return fn(...a);
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
        // Derived from the VIEWS registry (single source of truth) — byte-identical
        // to the former hand-maintained literal (_l12 + the 1..15 nav-id arrays).
        const levelPermissions = _deriveLevelPermissions();

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

    // Shared-device hardening: wipe cached PII (table snapshots in localStorage
    // fs_crm_* and the crm-data-v1 Cache Storage tier) so a logged-out user's
    // customer/prospect data can't be read by the next person on the device.
    function _wipeCachedData() {
        try {
            for (let i = localStorage.length - 1; i >= 0; i--) {
                const k = localStorage.key(i);
                if (k && k.startsWith('fs_crm_')) localStorage.removeItem(k);
            }
        } catch (_) { /* intentional: best-effort cache wipe on logout */ }
        try { if (window.caches) caches.delete('crm-data-v1'); } catch (_) { /* intentional: best-effort Cache Storage wipe */ }
    }

    async function logout() {
        await Auth.logout();
        _currentUser = null;
        try { (window.app._clearMobileSnapshots || (() => {}))(); } catch (_) { /* intentional: best-effort cache wipe */ } // wipe per-user mobile Home/Calendar caches (shared-device leak)
        _wipeCachedData();   // wipe cached PII (fs_crm_* + crm-data-v1) on explicit logout
        try { localStorage.removeItem('remember_me'); } catch (_) { /* intentional: best-effort storage clear on logout */ } // clear "keep me logged in" on explicit logout
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
        try { (window.app._clearMobileSnapshots || (() => {}))(); } catch (_) { /* intentional: best-effort cache wipe */ } // wipe per-user mobile caches (shared-device leak)
        _wipeCachedData();   // wipe cached PII (fs_crm_* + crm-data-v1) on account switch
        try { localStorage.removeItem('remember_me'); } catch (_) { /* intentional: best-effort storage cleanup on account switch */ }
        try { localStorage.removeItem('remember_me_email'); } catch (_) { /* intentional: best-effort storage cleanup on account switch */ }
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

// Native MFA (Supabase auth.mfa / AAL2) login gate. Returns true if login may
// proceed, false if it must abort. ENROLLMENT-GATED + FAIL-OPEN by design:
// a user with no verified factor (everyone until they opt in) is never
// challenged, and any error in the detection path proceeds with login so a
// transient Supabase hiccup can never lock anyone out. Only a user who HAS a
// verified factor is required to enter a correct TOTP code.
async function _enforceMfaOnLogin() {
    let aal;
    try {
        const r = await window.supabase.auth.mfa.getAuthenticatorAssuranceLevel();
        aal = r && r.data;
    } catch (_) { return true; }                       // detection unavailable -> proceed
    if (!aal || aal.nextLevel !== 'aal2' || aal.currentLevel === 'aal2') return true; // no factor / already satisfied
    let factorId;
    try {
        const f = await window.supabase.auth.mfa.listFactors();
        const totp = (f && f.data && f.data.totp) || [];
        const v = totp.find(x => x.status === 'verified') || totp[0];
        factorId = v && v.id;
    } catch (_) { return true; }                        // can't list -> fail open
    if (!factorId) return true;                         // nextLevel claimed aal2 but no factor -> fail open
    for (let attempt = 0; attempt < 5; attempt++) {
        const code = await _promptMfaCode(attempt > 0);
        if (code === null) {                            // user cancelled
            try { await window.supabase.auth.signOut(); } catch (_) {}
            return false;
        }
        try {
            const res = await window.supabase.auth.mfa.challengeAndVerify({ factorId, code: String(code).trim() });
            if (res && !res.error) return true;         // verified -> AAL2
        } catch (_) { /* wrong code -> retry */ }
    }
    try { await window.supabase.auth.signOut(); } catch (_) {}
    if (window.UI && UI.toast) UI.toast.error('Too many incorrect codes. Please log in again.');
    return false;
}

// Self-contained TOTP prompt overlay (works on the login screen, no app-shell
// dependency). Resolves with the entered code, or null if cancelled.
function _promptMfaCode(isRetry) {
    return new Promise((resolve) => {
        const ov = document.createElement('div');
        ov.style.cssText = 'position:fixed;inset:0;z-index:99999;background:rgba(0,0,0,.5);display:flex;align-items:center;justify-content:center;padding:16px;';
        ov.innerHTML = '<div style="background:#fff;border-radius:12px;max-width:360px;width:100%;padding:24px;box-shadow:0 8px 32px rgba(0,0,0,.2);">'
            + '<h3 style="margin:0 0 8px;font-size:18px;">Two-Factor Verification</h3>'
            + '<p style="margin:0 0 14px;color:#6b7280;font-size:14px;">' + (isRetry ? 'Incorrect code — try again.' : 'Enter the 6-digit code from your authenticator app.') + '</p>'
            + '<input id="_mfa_code" inputmode="numeric" autocomplete="one-time-code" maxlength="6" placeholder="000000" style="width:100%;padding:12px;font-size:20px;letter-spacing:6px;text-align:center;border:1px solid #d1d5db;border-radius:8px;margin-bottom:14px;" />'
            + '<div style="display:flex;gap:8px;">'
            + '<button id="_mfa_cancel" style="flex:1;padding:10px;border:1px solid #d1d5db;background:#fff;border-radius:8px;cursor:pointer;">Cancel</button>'
            + '<button id="_mfa_verify" style="flex:1;padding:10px;border:none;background:#7c3aed;color:#fff;border-radius:8px;cursor:pointer;">Verify</button>'
            + '</div></div>';
        document.body.appendChild(ov);
        const done = (val) => { try { ov.remove(); } catch (_) {} resolve(val); };
        const inp = ov.querySelector('#_mfa_code');
        ov.querySelector('#_mfa_cancel').onclick = () => done(null);
        ov.querySelector('#_mfa_verify').onclick = () => done((inp.value || '').trim());
        inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') done((inp.value || '').trim()); });
        setTimeout(() => { try { inp.focus(); } catch (_) {} }, 50);
    });
}

function _wireLoginBtn() {
    const btn = document.getElementById('loginBtn');
    if (!btn || btn._supabaseSetup) return;
    btn._supabaseSetup = true;
    // Pre-fill email from last successful login (convenience only).
    // Guarded: on iOS Safari with Block-All-Cookies, even localStorage.getItem
    // can throw SecurityError, which would abort _wireLoginBtn before the
    // storage detector below ever runs — leaving the login button silently
    // unwired (btn._supabaseSetup was just set true, so the fallback retry
    // in app-init.js sees the flag and bails out).
    let rememberedEmail = null;
    try { rememberedEmail = localStorage.getItem('remember_me_email'); } catch (_) { /* intentional: prefill is optional; blank field when storage unreadable */ }
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
                try { localStorage.removeItem(k); } catch (_) { /* intentional: per-key best-effort purge; continue on failure */ }
            }
        } catch (_) { /* intentional: cache purge is best-effort; recoverable from server */ }
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
            return true; /* intentional: feature-detection — storage blocked if probe throws */
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

            // Native MFA (AAL2) gate. Only users with a verified TOTP factor are
            // challenged; everyone else proceeds unchanged. Aborts login (and
            // signs out) on cancel / repeated wrong codes. finally{} re-enables
            // the button.
            if (!(await _enforceMfaOnLogin())) {
                return;
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
                    // No explicit id — AppDataStore.create() generates a jittered id
                    // (Date.now()+random) so concurrent auto-creates never collide, and
                    // the large value still loses the sort tiebreak to admin ids (1-999).
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
                try { localStorage.removeItem(`fs_crm_${k}`); } catch (_) { /* intentional: best-effort SWR flush; in-memory invalidate below still runs */ }
                try { localStorage.removeItem(`fs_crm_${k}_last_sync`); } catch (_) { /* intentional: best-effort SWR flush */ }
            });
            AppDataStore.invalidateCache('prospects');
            AppDataStore.invalidateCache('__prospects_active_500');
            AppDataStore.invalidateCache('customers');
            AppDataStore.invalidateCache('users');
            await UserPreferences.load(profile.id);
            _runPredictivePrefetch();
            // Always keep users logged in — session persists until explicit logout.
            const _loginEmail = document.getElementById('loginEmail');
            try {
                localStorage.setItem('remember_me', '1');
                if (_loginEmail?.value) localStorage.setItem('remember_me_email', _loginEmail.value.trim().toLowerCase());
            } catch (e) {
                // setItem failed (quota or storage blocked). Make a single best-effort
                // attempt to free space and retry — each call individually guarded so
                // a broken localStorage can't throw out of the catch block and
                // mis-route us into the login-failed error path AFTER a successful login.
                try { localStorage.removeItem('offline_queue'); } catch (_) { /* intentional: best-effort space-free retry; must not throw out of catch */ }
                try { localStorage.setItem('remember_me', '1'); } catch (_) { /* intentional: best-effort retry; must not re-throw post-login */ }
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
            } else if (isMobile()) {
                // Mobile fresh-login path: load chunks, wire up the shell, then
                // directly render the home view. Bypass navigateTo/_withViewTransition
                // to avoid any silent-swallow on first paint.
                // 1. Remove boot skeleton immediately so the user never sees it after auth.
                document.getElementById('boot-skeleton-grid')?.remove();
                const _vp = document.getElementById('content-viewport');
                if (_vp) _vp.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:60vh;flex-direction:column;gap:12px;color:var(--primary,#800020)"><i class="fas fa-circle-notch fa-spin" style="font-size:28px"></i><span style="font-size:14px;opacity:.7">Loading…</span></div>';
                // 2. Load mobile chunk and wire the shell.
                try {
                    await window._loadChunk('chunks/script-mobile.min.js');
                    await (window.app.renderMobileBottomNav || (() => {}))();
                    (window.app.initSwipeActions || (() => {}))();
                    await (window.app.initPullToRefresh || (() => {}))();
                    await window._loadChunk('chunks/script-features2.min.js');
                } catch (mobileErr) {
                    console.warn('[mobile-init] chunk load failed on fresh login:', mobileErr);
                }
                // 3. Render home view directly, then let navigateTo take over for
                //    future navigation (sets _currentView, updates nav highlight, etc.)
                try {
                    if (window.app.showMobileHomeView && _vp) {
                        await window.app.showMobileHomeView(_vp);
                    }
                    await navigateTo('home'); // sets _currentView + bottom-nav highlight
                } catch (navErr) {
                    console.warn('[mobile-init] home view render failed:', navErr);
                    // Last resort: full navigateTo with reload
                    try { await navigateTo('home'); } catch (_) { /* intentional: last-resort fallback nav; nothing more to recover to */ }
                }
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
                    // A no-cors probe to the root only proves Cloudflare's EDGE is up,
                    // not the origin. Probe the auth endpoint with a real fetch: a
                    // 5xx (incl. Cloudflare 521-523 "origin down") means the BACKEND
                    // itself is down — restarting or overloaded — so the right advice
                    // is "wait", NOT "reinstall / open in Safari" (2026-06-16 incident).
                    let backendDown = false, edgeReachable = false;
                    try {
                        const probe = await Promise.race([
                            fetch(`${window.SUPABASE_URL}/auth/v1/health`, { cache: 'no-store' }),
                            new Promise((_, r) => setTimeout(() => r(new Error('t')), 5000))
                        ]);
                        edgeReachable = true;
                        if (probe && probe.status >= 500) backendDown = true;
                    } catch (_) {
                        // CORS-less error page or network drop — fall back to the root
                        // no-cors probe to tell "edge up" from "fully unreachable".
                        try {
                            await Promise.race([
                                fetch(window.SUPABASE_URL, { mode: 'no-cors' }),
                                new Promise((_, r) => setTimeout(() => r(new Error('t')), 4000))
                            ]);
                            edgeReachable = true;
                        } catch (_2) { edgeReachable = false; }
                    }
                    if (backendDown) {
                        networkErrText = 'The server is temporarily unavailable — it may be restarting or under heavy load. Please wait a minute or two and try again. You do not need to reinstall the app or switch browsers.';
                    } else if (edgeReachable) {
                        // Edge up + auth endpoint reachable → genuine client-side block.
                        networkErrText = 'Server is reachable but the login request was blocked. Try waiting a minute, then close and reopen the app — or open the site in your browser (not the home-screen icon).';
                    } else {
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
                try { localStorage.clear(); } catch (_) { /* intentional: best-effort wipe; reload follows regardless */ }
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
            //
            // Also: when the stored session token is expired, Supabase JS
            // automatically calls POST /auth/v1/token to refresh it. If the
            // auth server is unreachable that network call hangs indefinitely.
            // Wrap in a 6s timeout so a dead network shows the login screen
            // quickly instead of leaving the dark #app-loading spinner forever.
            const sessionResponse = await Promise.race([
                window.supabase.auth.getSession(),
                new Promise(resolve => setTimeout(
                    () => resolve({ data: { session: null }, error: new Error('getSession timeout') }),
                    6000
                ))
            ]);
            const session = (sessionResponse && sessionResponse.data && sessionResponse.data.session) || null;
            const authUser = session?.user ?? null;
            // MFA (AAL2) gate on session RESTORE — the fresh-login gate
            // (_enforceMfaOnLogin, called only on the Auth.login path) could be
            // bypassed by reloading the page after a session reached AAL1. Enforce
            // it here too. Fail-open (no verified factor / detection error -> proceed);
            // on cancel or too-many-wrong it has already signed out, so drop the user
            // to the login screen. Computed only when a session actually exists.
            const _restoreMfaFail = authUser ? !(await _enforceMfaOnLogin()) : false;
            if (_restoreMfaFail) {
                _currentUser = null;
            } else if (authUser) {
                // Fetch the full profile from the users table (has integer id + role),
                // same as the login flow – avoids using the raw Auth UUID as _currentUser.id.
                // Detect network errors so we don't sign out on a flaky connection.
                let profileMatches = [];
                let profileFetchFailed = false;
                try {
                    // Wrap in a 7s timeout — query() has no internal timeout and
                    // hangs forever when Supabase is unreachable, keeping #app-loading
                    // on screen indefinitely. The catch below handles the rejection
                    // by falling back to a minimal placeholder profile so the app
                    // continues instead of being stuck on the loading screen.
                    profileMatches = await Promise.race([
                        AppDataStore.query('users', { email: authUser.email }),
                        new Promise((_, reject) => setTimeout(
                            () => reject(new Error('Profile fetch timed out after 7s')), 7000
                        ))
                    ]);
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
                    // Ensure the inactivity-timer guard is always set for restored sessions,
                    // even if localStorage was partially cleared between visits.
                    try { localStorage.setItem('remember_me', '1'); } catch (_) { /* intentional: best-effort guard flag; session restore proceeds */ }
                    _runPredictivePrefetch();
                    // Flush stale SWR snapshots so the user always sees fresh data,
                    // not a cached view from a previous session that may pre-date reassignments.
                    _visibleUserIdsCache.clear();
                    ['prospects', '__prospects_active_500', 'customers', 'users'].forEach(k => {
                        try { localStorage.removeItem(`fs_crm_${k}`); } catch (_) { /* intentional: best-effort SWR flush; in-memory invalidate below still runs */ }
                        try { localStorage.removeItem(`fs_crm_${k}_last_sync`); } catch (_) { /* intentional: best-effort SWR flush */ }
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
                    try { localStorage.setItem('remember_me', '1'); } catch (_) { /* intentional: best-effort guard flag on minimal-profile fallback */ }
                } else {
                    // Auth session exists but no matching user profile in DB — force sign out
                    console.warn('No user profile found for the current session — signing out.');
                    await window.supabase.auth.signOut();
                    _currentUser = null;
                }
            } else {
                // getSession() returned null — token expired/timed-out or truly no session.
                // Before forcing the login screen, try restoring the session from the
                // Supabase localStorage token + the SWR user cache. This lets users whose
                // token refresh timed out (Supabase temporarily unreachable) stay in the
                // app in offline mode rather than being kicked to login when they can't
                // re-authenticate anyway.
                _currentUser = null;
                try {
                    if (localStorage.getItem('remember_me') === '1') {
                        // supabase-js persists the whole session under the configured
                        // storageKey (window.SUPABASE_AUTH_STORAGE_KEY = 'fs-crm-auth-v1').
                        // The old code scanned for an 'sb-<ref>-auth-token' key that a
                        // custom storageKey NEVER writes, so this offline-resume was dead
                        // and users were locked out during a 521/offline blip. Read the
                        // real key; keep the legacy scan only as a last-resort fallback.
                        const _sbKey = window.SUPABASE_AUTH_STORAGE_KEY || 'fs-crm-auth-v1';
                        let _sbData = JSON.parse(localStorage.getItem(_sbKey) || 'null');
                        if (!_sbData) {
                            const _legacy = Object.keys(localStorage).find(k => /^sb-.+-auth-token$/.test(k));
                            _sbData = _legacy ? JSON.parse(localStorage.getItem(_legacy) || 'null') : null;
                        }
                        const _offlineEmail = _sbData?.user?.email || _sbData?.currentSession?.user?.email;
                        if (_offlineEmail) {
                            const _rawUsers = localStorage.getItem('fs_crm_users');
                            const _allUsers = _rawUsers ? JSON.parse(_rawUsers) : [];
                            const _offlineUser = Array.isArray(_allUsers) && _allUsers.find(u => u.email === _offlineEmail);
                            if (_offlineUser) {
                                console.info('[init] Supabase offline — resuming from cache for:', _offlineEmail);
                                _currentUser = { ..._offlineUser, _offline: true };
                            }
                        }
                    }
                } catch (_offlineErr) {
                    // Cache read failed — fall through to login screen normally
                }
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
        Promise.resolve(typeof expireOldOverrides === 'function' ? expireOldOverrides() : undefined).catch(e => console.warn('expireOldOverrides failed:', e));
        Promise.resolve(typeof initAIAnalytics === 'function' ? initAIAnalytics() : undefined).catch(e => console.warn('initAIAnalytics failed:', e));

        // L13 (Customer) and L14 (Referrer) land on 福德; everyone else on calendar
        // Use _getUserLevel() to handle Chinese-only role names (改命客户, 准传福大使, etc.)
        const _initLevel = _getUserLevel(_currentUser);

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
            // event_attendees (Phase 6/2.7): the only referral-tree table not pre-warmed (also backs calendar); warming it = same SWR cache, zero behavior change.
            ['activities', 'prospects', 'customers', 'users',
             'products', 'events', 'names', 'referrals', 'purchases', 'event_attendees']
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
            (async () => { if (isMobile()) { await window._loadChunk('chunks/script-mobile.min.js'); await (window.app.renderMobileBottomNav || (() => {}))(); (window.app.initSwipeActions || (() => {}))(); await (window.app.initPullToRefresh || (() => {}))(); await window._loadChunk('chunks/script-features2.min.js'); await (window.app.initMobileApp || (() => {}))(); } })(),
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

        // Session inactivity timeout is owned by initSessionTimeout() (the canonical,
        // configurable [UserPreferences session_timeout, default 30 min], throttled,
        // audit-logged implementation, web-only). The cruder 60-min duplicate that
        // used to live here was superseded 2026-06-19 — keeping two timers risked
        // double-arming and conflicting logout toasts.
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
                    <input type="text" id="name-full" class="form-control" value="${escapeHtml(nameData?.full_name || '')}" required>
                </div>
                <div class="form-group">
                    <label>Date of Birth</label>
                    <input type="date" id="name-dob" class="form-control" value="${escapeHtml(nameData?.date_of_birth || '')}">
                </div>
                <div class="form-group">
                    <label>Notes</label>
                    <textarea id="name-notes" class="form-control" rows="2">${escapeHtml(nameData?.notes || '')}</textarea>
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

        try {
            if (nameId) {
                await AppDataStore.update('names', parseInt(nameId), data);
                UI.toast.success('Name updated successfully');
            } else {
                await AppDataStore.create('names', data);
                UI.toast.success('Name added successfully');
            }
        } catch (e) {
            UI.toast.error('Could not save name: ' + (e?.message || e));
            return; // Leave the modal open so the user can retry
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
        try {
            await AppDataStore.delete('names', nameId);
        } catch (e) {
            UI.hideModal();
            UI.toast.error('Could not delete name: ' + (e?.message || e));
            return;
        }
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
            return false; /* intentional: conflict-ignoring demo insert; caller treats false as "skipped" */
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
    // ── Unified view registry (single source of truth) ──────────────────
    // VIEWS is the ONE table that drives the three derived view tables below:
    //   _CHUNK_VIEWS (chunk-load gate), VIEW_TITLES (document title), and the
    //   levelPermissions nav-visibility map (derived in updateNavVisibility).
    // Previously these three drifted apart by hand; now each is computed from
    // VIEWS so a view is described in exactly one place. Per entry:
    //   chunk       — the chunks/<name>.min.js file (was _CHUNK_VIEWS.src)
    //   minLevel    — min role level for the chunk-load gate (was _CHUNK_VIEWS.minLevel)
    //   exactLevels — exact role levels for the chunk-load gate (was _CHUNK_VIEWS.exactLevels)
    //   navId       — dash-form nav id (the levelPermissions key space)
    //   navLevels   — levels whose nav shows this id; _VIEW_NO_NAV = no nav entry
    //                 (default-visible view); '@<viewId>' = share another view's set
    //   title       — document title (was VIEW_TITLES[viewId]); undefined = no title
    const _VIEW_NO_NAV = null;
    const VIEWS = {
        'home':                 { chunk: 'chunks/script-mobile.min.js',      minLevel: null, exactLevels: null, navId: 'home',                navLevels: _VIEW_NO_NAV, title: 'Home' },
        'calendar':             { chunk: 'chunks/script-calendar.min.js',    minLevel: null, exactLevels: null, navId: 'calendar',            navLevels: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11], title: 'Calendar' },
        'month':                { chunk: 'chunks/script-calendar.min.js',    minLevel: null, exactLevels: null, navId: 'calendar',            navLevels: '@calendar', title: 'Calendar' },
        'prospects':            { chunk: 'chunks/script-prospects.min.js',   minLevel: null, exactLevels: null, navId: 'prospects',           navLevels: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14], title: 'Prospects & Customers' },
        'customers':            { chunk: 'chunks/script-customers.min.js',   minLevel: null, exactLevels: null, navId: 'customers',           navLevels: _VIEW_NO_NAV, title: undefined },
        'agents':               { chunk: 'chunks/script-agents.min.js',      minLevel: null, exactLevels: null, navId: 'agents',              navLevels: [1, 2], title: 'Consultants' },
        'purchases_history':    { chunk: 'chunks/script-prospects.min.js',   minLevel: null, exactLevels: null, navId: 'purchases_history',   navLevels: [1], title: 'Purchases History' },
        'lead_forms':           { chunk: 'chunks/script-forms.min.js',       minLevel: null, exactLevels: null, navId: 'lead_forms',          navLevels: [1, 2], title: 'Lead Capture Forms' },
        'surveys':              { chunk: 'chunks/script-forms.min.js',       minLevel: null, exactLevels: null, navId: 'surveys',             navLevels: [1, 2], title: 'NPS Surveys' },
        'contracts':            { chunk: 'chunks/script-forms.min.js',       minLevel: null, exactLevels: null, navId: 'contracts',           navLevels: [1, 2], title: 'Contracts' },
        'custom_fields':        { chunk: 'chunks/script-forms.min.js',       minLevel: null, exactLevels: null, navId: 'custom_fields',       navLevels: [1, 2], title: 'Custom Fields' },
        'booking_settings':     { chunk: 'chunks/script-cps.min.js',          minLevel: null, exactLevels: null, navId: 'booking_settings',    navLevels: [1, 2], title: 'Booking Scheduler' },
        'cps_intake':           { chunk: 'chunks/script-cps.min.js',         minLevel: null, exactLevels: null, navId: 'cps_intake',          navLevels: _VIEW_NO_NAV, title: undefined },
        'search':               { chunk: 'chunks/script-search.min.js',      minLevel: null, exactLevels: null, navId: 'search',              navLevels: _VIEW_NO_NAV, title: undefined },
        'admin':                { chunk: 'chunks/script-admin.min.js',        minLevel: null, exactLevels: [1], navId: 'admin',               navLevels: [1, 2], title: 'Admin' },
        'security':             { chunk: 'chunks/script-admin.min.js',        minLevel: null, exactLevels: [1], navId: 'security',            navLevels: [1, 2], title: 'Security' },
        'org_chart':            { chunk: 'chunks/script-org.min.js',          minLevel: null, exactLevels: [1, 2], navId: 'org-chart',        navLevels: [1, 2], title: 'Org Chart Consultant' },
        'pipeline':             { chunk: 'chunks/script-pipeline.min.js',    minLevel: null, exactLevels: null, navId: 'pipeline',            navLevels: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10], title: 'Pipeline' },
        'import':               { chunk: 'chunks/script-import.min.js',      minLevel: null, exactLevels: null, navId: 'import',              navLevels: [1, 2], title: 'Import / Export' },
        'protection':           { chunk: 'chunks/script-import.min.js',      minLevel: null, exactLevels: null, navId: 'protection',          navLevels: [1, 2, 3, 4], title: 'Protection Monitoring' },
        'fude':                 { chunk: 'chunks/script-fude.min.js',        minLevel: null, exactLevels: null, navId: 'fude',                navLevels: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14], title: '福运相随' },
        'milestones':           { chunk: 'chunks/script-features2.min.js',   minLevel: null, exactLevels: null, navId: 'milestones',          navLevels: [1, 2, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14], title: 'Milestones' },
        'stock_take':           { chunk: 'chunks/script-stock-take.min.js',  minLevel: null, exactLevels: [1, 15], navId: 'stock-take',       navLevels: [1, 15], title: 'Stock Take' },
        'egg_purchasing':       { chunk: 'chunks/script-egg.min.js',         minLevel: null, exactLevels: [1], navId: 'egg-purchasing',       navLevels: [1], title: 'Egg Purchasing' },
        'boss_report':          { chunk: 'chunks/script-boss-report.min.js', minLevel: null, exactLevels: [1, 2], navId: 'boss-report',       navLevels: [1], title: 'Boss Report' },
        'knowledge':            { chunk: 'chunks/script-knowledge.min.js',   minLevel: null, exactLevels: null, navId: 'knowledge',           navLevels: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11], title: 'Knowledge HQ' },
        'formula_purchaser':    { chunk: 'chunks/script-formula.min.js',     minLevel: null, exactLevels: [1], navId: 'formula-purchaser',    navLevels: [1], title: 'Formula Purchaser' },
        'marketing_automation': { chunk: 'chunks/script-marketing.min.js',   minLevel: null, exactLevels: [1, 2], navId: 'marketing-automation', navLevels: [1, 2], title: 'Marketing Automation' },
        'marketing_lists':      { chunk: 'chunks/script-marketing.min.js',   minLevel: null, exactLevels: [1, 2], navId: 'marketing-lists',   navLevels: [1, 2], title: 'Marketing Lists' },
        'workflows':            { chunk: 'chunks/script-marketing.min.js',   minLevel: null, exactLevels: [1, 2], navId: 'workflows',         navLevels: [1], title: 'Workflow Automation' },
        'reports':              { chunk: 'chunks/script-reporting.min.js',   minLevel: null, exactLevels: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10], navId: 'reports', navLevels: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10], title: 'Reporting KPI' },
        'cases':                { chunk: 'chunks/script-cases.min.js',       minLevel: null, exactLevels: null, navId: 'cases',               navLevels: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11], title: 'Success Cases' },
        'referrals':            { chunk: 'chunks/script-referrals.min.js',   minLevel: null, exactLevels: null, navId: 'referrals',           navLevels: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 14], title: 'Referral Relationships' },
        'ranking':              { chunk: 'chunks/script-performance.min.js', minLevel: null, exactLevels: null, navId: 'ranking',             navLevels: _VIEW_NO_NAV, title: 'Ranking Performance' },
        'performance':          { chunk: 'chunks/script-performance.min.js', minLevel: null, exactLevels: null, navId: 'performance',         navLevels: [1, 2, 3, 4], title: 'Ranking Performance' },
        'noticeboard':          { chunk: 'chunks/script-performance.min.js',  minLevel: null, exactLevels: null, navId: 'noticeboard',        navLevels: [1, 2, 12, 13, 14], title: '公告栏 Noticeboard' },
        'whatsapp':             { chunk: 'chunks/script-whatsapp.min.js',    minLevel: 1,    exactLevels: [1, 2], navId: 'whatsapp',          navLevels: _VIEW_NO_NAV, title: undefined },
        'ai_insights':          { chunk: 'chunks/script-ai.min.js',          minLevel: 1,    exactLevels: [1, 2], navId: 'ai-insights',       navLevels: [1, 2], title: undefined },
        'documents':            { chunk: 'chunks/script-documents.min.js', minLevel: null, exactLevels: null, navId: 'documents',            navLevels: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10], title: 'Documents' },
        'integrations':         { chunk: 'chunks/script-gcal.min.js',       minLevel: 1,    exactLevels: null, navId: 'integrations',        navLevels: [1, 2], title: 'Integrations' },
        'order_form_extract':   { chunk: 'chunks/script-order-form-extract.min.js', minLevel: null, exactLevels: null, navId: 'order-form-extract', navLevels: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10], title: 'Order Form Extract' },
        'journey':              { chunk: 'chunks/script-journey.min.js',    minLevel: null, exactLevels: null, navId: 'journey',             navLevels: _VIEW_NO_NAV, title: undefined },
        'promotions':           { chunk: 'chunks/script-marketing.min.js',  minLevel: null, exactLevels: null, navId: 'promotions',          navLevels: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11], title: 'Monthly Promotion' },
        'settings':             { chunk: 'chunks/script-settings.min.js',   minLevel: null, exactLevels: null, navId: 'settings',            navLevels: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11], title: 'Settings' },
        '_activities':          { chunk: 'chunks/script-activities.min.js', minLevel: null, exactLevels: null, navId: '_activities',         navLevels: _VIEW_NO_NAV, title: undefined },
    };

    // Nav ids present in levelPermissions but with NO VIEWS entry (legacy /
    // dropdown-only items). Kept so the derived nav map stays byte-identical.
    const _VIEW_EXTRA_NAV = {
        'risk':               { navLevels: [1, 2] },
        'standard-functions': { navLevels: [1] },
    };

    // Canonical nav display order (= the level-1 ordering). Every level-1..11/15
    // nav array is a subsequence of this, so filtering by membership rebuilds each
    // byte-identically. Levels 12/13/14 reorder, hence _VIEW_NAV_ORDER_OVERRIDE.
    const _VIEW_NAV_ORDER = ['calendar', 'prospects', 'referrals', 'pipeline', 'promotions', 'marketing-automation', 'marketing-lists', 'cases', 'purchases_history', 'agents', 'performance', 'reports', 'risk', 'admin', 'protection', 'documents', 'knowledge', 'import', 'integrations', 'settings', 'fude', 'milestones', 'noticeboard', 'custom_fields', 'egg-purchasing', 'standard-functions', 'formula-purchaser', 'stock-take', 'boss-report', 'org-chart', 'ai-insights', 'security', 'workflows', 'lead_forms', 'surveys', 'contracts', 'booking_settings', 'order-form-extract'];
    const _VIEW_NAV_ORDER_OVERRIDE = {
        12: ['noticeboard', 'fude', 'milestones', 'prospects', 'referrals'],
        13: ['noticeboard', 'fude', 'milestones', 'prospects'],
        14: ['noticeboard', 'fude', 'milestones', 'prospects'],
    };

    // Title-only ids that have no VIEWS entry (aliases / legacy view ids that
    // still need a document title). Kept so VIEW_TITLES stays byte-identical.
    const _VIEW_EXTRA_TITLES = {
        standard_functions: 'Standard Functions',
        ai: 'AI Insights',
        risk: 'Attrition Risk',
        nps: 'NPS Surveys',
    };

    // ── Derivations: rebuild the three legacy tables from VIEWS (byte-identical
    // to the former hand-written literals; verified deep-equal). Consumer code is
    // unchanged — it still reads _CHUNK_VIEWS / VIEW_TITLES / levelPermissions.
    const _deriveChunkViews = () => {
        const out = {};
        for (const id in VIEWS) {
            const v = VIEWS[id];
            out[id] = { src: v.chunk, minLevel: v.minLevel, exactLevels: v.exactLevels };
        }
        return out;
    };
    const _deriveViewTitles = () => {
        const out = {};
        for (const id in VIEWS) { if (VIEWS[id].title !== undefined) out[id] = VIEWS[id].title; }
        for (const id in _VIEW_EXTRA_TITLES) out[id] = _VIEW_EXTRA_TITLES[id];
        return out;
    };
    const _deriveLevelPermissions = () => {
        const navLevelsByNav = {};
        for (const id in VIEWS) {
            const v = VIEWS[id];
            let lv = v.navLevels;
            if (lv === _VIEW_NO_NAV) continue;
            if (typeof lv === 'string' && lv.charAt(0) === '@') lv = VIEWS[lv.slice(1)].navLevels;
            if (!(v.navId in navLevelsByNav)) navLevelsByNav[v.navId] = lv;
        }
        for (const navId in _VIEW_EXTRA_NAV) {
            if (!(navId in navLevelsByNav)) navLevelsByNav[navId] = _VIEW_EXTRA_NAV[navId].navLevels;
        }
        const levels = new Set();
        for (const navId in navLevelsByNav) navLevelsByNav[navId].forEach((l) => levels.add(l));
        const out = {};
        [...levels].sort((a, b) => a - b).forEach((level) => {
            if (_VIEW_NAV_ORDER_OVERRIDE[level]) { out[level] = _VIEW_NAV_ORDER_OVERRIDE[level].slice(); return; }
            out[level] = _VIEW_NAV_ORDER.filter((navId) => navLevelsByNav[navId].includes(level));
        });
        return out;
    };

    const _CHUNK_VIEWS = _deriveChunkViews();

    // Declarative refresh map — the single source for refreshCurrentView (replaces
    // the parallel switch(_currentView)). Each entry re-renders its view in place
    // after a mutation; each mirrors its old switch case EXACTLY (same guard, same
    // args, same side-effects) and refreshCurrentView awaits the returned promise
    // (or a no-op when the fn isn't loaded). This is the seed of the unified view
    // registry — navigateTo's render dispatch + _CHUNK_VIEWS/title data fold in
    // here next (Wave 3.1 cont.).
    const _VIEW_REFRESH = {
        // Mobile uses a custom calendar DOM (.mcal) that the desktop
        // renderCalendar/renderWeekView/renderTodayActivities never touch, so on
        // mobile we must re-render the active mobile sub-view instead — otherwise
        // a deleted/created/edited activity lingers on screen until full re-nav.
        month:                (vp) => isMobile() ? (window.app.mcalRefreshActiveView || (() => {}))() : (window.app.renderCalendar || (() => {}))(),
        week:                 (vp) => isMobile() ? (window.app.mcalRefreshActiveView || (() => {}))() : (window.app.renderWeekView || (() => {}))(),
        day:                  (vp) => isMobile() ? (window.app.mcalRefreshActiveView || (() => {}))() : (window.app.renderTodayActivities || (() => {}))(),
        prospects:            (vp) => { if (_currentDetailView) return; return (window.app.showProspectsViewSmart || (() => {}))(vp); },
        pipeline:             (vp) => window.app.showPipelineView && window.app.showPipelineView(vp),
        reports:              (vp) => (typeof window.app.refreshKPIDashboard === 'function') && window.app.refreshKPIDashboard(),
        protection:           (vp) => window.app.showProtectionMonitoringView && window.app.showProtectionMonitoringView(vp),
        agents:               (vp) => window.app.showAgentsView && window.app.showAgentsView(vp),
        referrals:            (vp) => (typeof window.app.showReferralsView === 'function') && window.app.showReferralsView(vp),
        cases:                (vp) => window.app.showCasesView && window.app.showCasesView(vp),
        promotions:           (vp) => window.app.showMonthlyPromotionView && window.app.showMonthlyPromotionView(vp),
        marketing_automation: (vp) => window.app.showMarketingAutomationView && window.app.showMarketingAutomationView(vp),
        ranking:              (vp) => (typeof window.app.showRankingPerformanceView === 'function') && window.app.showRankingPerformanceView(vp),
        workflows:            (vp) => { _currentMarketingTab = 'automation'; return window.app.showMarketingAutomationView && window.app.showMarketingAutomationView(vp); },
        milestones:           (vp) => window.app.showMilestonesView && window.app.showMilestonesView(vp),
        fude:                 (vp) => window.app.showFudeView && window.app.showFudeView(vp),
        egg_purchasing:       (vp) => window.app.showEggPurchasingView && window.app.showEggPurchasingView(vp),
        purchases_history:    (vp) => (window.app.showPurchasesHistoryView || (() => {}))(vp),
    };

    // Declarative render map — the single source for navigateTo's view dispatch
    // (replaces the ~180-line if/else). Each fn sets _currentView and renders its
    // view, mirroring its old branch EXACTLY: mobile-vs-desktop branch, the three
    // fire-and-forget views (pipeline/reports/referrals — no await + .catch), the
    // inline authz gates (bounce to calendar + return), the settings no-await
    // quirk, and the org_chart loading fallback. Called from inside
    // _withViewTransition, so a gate's `return` exits the same callback the old
    // `return` did. Unknown viewId falls through to the placeholder (see navigateTo).
    const _VIEW_RENDER = {
        home:                 async (vp) => { _currentView = 'home'; await (window.app.showMobileHomeView || (() => {}))(vp); },
        calendar:             async (vp) => { _currentView = 'month'; if (isMobile()) { await (window.app.showMobileCalendarView || (() => {}))(vp); } else { await (window.app.showCalendarView || (() => {}))(vp); } },
        prospects:            async (vp) => { _currentView = 'prospects'; if (isMobile()) { await (window.app.showMobileProspectsView || (() => {}))(vp); } else { await (window.app.showProspectsView || (() => {}))(vp); } },
        pipeline:             async (vp) => { _currentView = 'pipeline'; (window.app.showPipelineView || (() => Promise.resolve()))(vp).catch(e => console.warn('pipeline failed:', e)); },
        agents:               async (vp) => { _currentView = 'agents'; await (window.app.showAgentsView || (() => {}))(vp); },
        promotions:           async (vp) => { _currentView = 'promotions'; await (window.app.showMonthlyPromotionView || (() => {}))(vp); },
        marketing_automation: async (vp) => { _currentView = 'marketing_automation'; await (window.app.showMarketingAutomationView || (() => {}))(vp); },
        reports:              async (vp) => { _currentView = 'reports'; (window.app.showKPIDashboard || (() => Promise.resolve()))(vp).catch(e => console.warn('KPI dashboard failed:', e)); },
        documents:            async (vp) => { _currentView = 'documents'; await (window.app.showDocumentManagementView || (() => {}))(vp); },
        protection:           async (vp) => { _currentView = 'protection'; await (window.app.showProtectionMonitoringView || (() => {}))(vp); },
        import:               async (vp) => { _currentView = 'import'; await (window.app.showImportDashboard || (() => {}))(vp); },
        integrations:         async (vp) => { _currentView = 'integrations'; await (window.app.showIntegrationHub || (() => {}))(vp); },
        referrals:            async (vp) => { _currentView = 'referrals'; (window.app.showReferralsView || (() => Promise.resolve()))(vp).catch(e => console.warn('referrals failed:', e)); },
        cases:                async (vp) => { _currentView = 'cases'; await (window.app.showCasesView || (() => {}))(vp); },
        marketing_lists:      async (vp) => { _currentView = 'marketing_lists'; await (window.app.showMarketingListsView || (() => {}))(vp); },
        ranking:              async (vp) => { _currentView = 'ranking'; await (window.app.showRankingPerformanceView || (() => {}))(vp); },
        workflows:            async (vp) => { _currentMarketingTab = 'automation'; _currentView = 'marketing_automation'; await (window.app.showMarketingAutomationView || (() => {}))(vp); },
        booking_settings:     async (vp) => { _currentView = 'booking_settings'; await (window.app.showBookingSettingsView || (() => {}))(vp); },
        lead_forms:           async (vp) => { _currentView = 'lead_forms'; await (window.app.showLeadFormsView || (() => {}))(vp); },
        surveys:              async (vp) => { _currentView = 'surveys'; await (window.app.showSurveysView || (() => {}))(vp); },
        contracts:            async (vp) => { _currentView = 'contracts'; await (window.app.showContractsView || (() => {}))(vp); },
        custom_fields:        async (vp) => { _currentView = 'custom_fields'; await (window.app.showCustomFieldsAdmin || (() => {}))(vp); },
        settings:             async (vp) => { _currentView = 'settings'; (window.app.showSettingsView || (() => {}))(vp); },
        milestones:           async (vp) => { _currentView = 'milestones'; await (window.app.showMilestonesView || (() => {}))(vp); },
        fude:                 async (vp) => { _currentView = 'fude'; await (window.app.showFudeView || (() => {}))(vp); },
        noticeboard:          async (vp) => { _currentView = 'noticeboard'; await (window.app.showNoticeboardView || (() => {}))(vp); },
        whatsapp:             async (vp) => { _currentView = 'whatsapp'; await (window.app.showWhatsAppIntegration || (() => {}))(vp); },
        ai_insights:          async (vp) => { _currentView = 'ai_insights'; await (window.app.showAIInsightsDashboard || (() => {}))(vp); },
        egg_purchasing:       async (vp) => { if (!isSystemAdmin(_currentUser)) { UI.toast.error('Super Admin only'); await navigateTo('calendar'); return; } _currentView = 'egg_purchasing'; await (window.app.showEggPurchasingView || (() => {}))(vp); },
        standard_functions:   async (vp) => { if (!isSystemAdmin(_currentUser)) { UI.toast.error('Super Admin only'); await navigateTo('calendar'); return; } _currentView = 'standard_functions'; await (window.app.showStandardFunctionsView || (() => {}))(vp); },
        formula_purchaser:    async (vp) => { if (!isSystemAdmin(_currentUser)) { UI.toast.error('Super Admin only'); await navigateTo('calendar'); return; } _currentView = 'formula_purchaser'; await (window.app.showFormulaPurchaserView || (() => {}))(vp); },
        purchases_history:    async (vp) => { _currentView = 'purchases_history'; await (window.app.showPurchasesHistoryView || (() => {}))(vp); },
        knowledge:            async (vp) => { _currentView = 'knowledge'; await (window.app.showKnowledgeView || (() => {}))(vp); },
        stock_take:           async (vp) => { if (!canAccessStockTake(_currentUser)) { UI.toast.error('Not permitted'); await navigateTo('calendar'); return; } _currentView = 'stock_take'; await (window.app.showStockTakeView || (() => {}))(vp); },
        boss_report:          async (vp) => { if (!isSystemAdmin(_currentUser)) { UI.toast.error('Super Admin only'); await navigateTo('calendar'); return; } _currentView = 'boss_report'; await (window.app.showBossReportView || (() => {}))(vp); },
        org_chart:            async (vp) => { const lvl = _currentUser ? _getUserLevel(_currentUser) : 99; if (lvl > 2) { UI.toast.error('Admin only'); await navigateTo('calendar'); return; } _currentView = 'org_chart'; if (typeof window.app?.showOrgChartView === 'function') { await window.app.showOrgChartView(vp); } else { vp.innerHTML = '<div style="padding:24px;color:var(--gray-500);">Org Chart Consultant module is loading…</div>'; } },
        order_form_extract:   async (vp) => { _currentView = 'order_form_extract'; await (window.app.showOrderFormExtractView || (() => {}))(vp); },
        journey:              async (vp) => { _currentView = 'journey'; await (window.app.showAgentJourneyDashboard || (() => {}))(vp); },
    };
    // Canonical-view aliases — secondary viewId shares the primary's render fn
    // (matches the old `viewId === 'a' || viewId === 'b'` branches).
    _VIEW_RENDER.month = _VIEW_RENDER.calendar;
    _VIEW_RENDER.performance = _VIEW_RENDER.ranking;
    _VIEW_RENDER.ai_prediction = _VIEW_RENDER.ai_insights;

    // Eager chunk loader — after login, execute every permitted chunk so all
    // functions are in memory before the user taps anything (same feel as the
    // old monolithic script.js).
    //
    // Two-tier to avoid blocking Supabase data at login:
    //   Tier 1 (immediate) — a conservative set of essential first-nav chunks
    //             start right away. async=true means each executes as soon as it
    //             downloads, without blocking other tasks. These back the views an
    //             agent is most likely to open first (prospects/customers/agents
    //             share one chunk, plus calendar, pipeline, performance — and the
    //             mobile shell so the first mobile paint isn't a cold load).
    //   (No Tier 2.) LOAD-1: the former Tier-2 idle pass iterated EVERY
    //             role-permitted chunk and prefetched all of them (~2.75 MB min
    //             per session), which defeated code-splitting. The default
    //             landing-view chunk for every role is already in the Tier-1 burst
    //             below — desktop lands on 'calendar' (script-calendar), mobile on
    //             'home' (script-mobile), force-password on 'settings'
    //             (script-settings), and all three are in the list — so there is
    //             nothing left for a Tier-2 pass to usefully pre-warm. Every other
    //             view now loads on demand via window._loadChunk on first nav,
    //             which is unchanged and remains the fallback so no view can fail
    //             to load.
    let _predictivePrefetchRan = false;
    const _runPredictivePrefetch = () => {
        if (_predictivePrefetchRan || !_currentUser) return;
        _predictivePrefetchRan = true;
        try {
            const seen = new Set();
            const _load = (src) => { if (!seen.has(src)) { seen.add(src); _loadChunkOnce(src); } };

            // Tier 1 — immediate: essential first-nav views. The
            // customers/agents/approvals/settings siblings back the first-nav
            // Customers/Agents screens and call each other across the file
            // boundary, so they must be in memory together right after login
            // (approvals has no VIEWS entry, so it would never warm otherwise).
            // This set also already contains every role's default landing chunk
            // (calendar / mobile / settings), so the single landing view is warm
            // immediately without prefetching the whole permitted set.
            //
            // LOAD-5: script-prospects (~446 KB) dropped from this eager burst —
            // it's NO role's default landing view, so pre-warming only bloated
            // login; it lazy-loads on first navigateTo('prospects'). Identical past first paint.
            [
                'chunks/script-mobile.min.js',
                'chunks/script-customers.min.js',
                'chunks/script-agents.min.js',
                'chunks/script-approvals.min.js',
                'chunks/script-settings.min.js',
                'chunks/script-calendar.min.js',
                'chunks/script-pipeline.min.js',
                'chunks/script-performance.min.js',
            ].forEach(_load);
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
            s.onload = () => {
                // Re-apply the double-submit guard + search debounce to functions
                // this chunk just registered. They run once at boot and only wrap
                // the forwarding stubs; without re-running, every chunk's real
                // save*/filter* impl ships UNGUARDED (duplicate-submit risk).
                try { window._autoGuardAppMutations && window._autoGuardAppMutations(); } catch (_) { /* intentional: optional post-load instrumentation hook */ }
                try { window._autoDebounceAppSearch && window._autoDebounceAppSearch(); } catch (_) { /* intentional: optional post-load instrumentation hook */ }
                resolve();
            };
            s.onerror = (e) => {
                // EVICT the failed entry so a later call retries instead of being
                // served this permanently-resolved "success". Without this, one
                // transient network blip leaves every delegating stub for this
                // chunk a silent no-op for the whole session.
                _chunkInFlight.delete(src);
                console.warn('[chunk] failed to load', src, e);
                // Version skew: a long-open tab still holds an OLD __ASSET_MANIFEST,
                // so the hashed chunk URL 404s after a new deploy — the feature would
                // be a silent no-op for the rest of the session. Reload ONCE (guarded
                // by a session flag so a genuine network failure can't loop) to pull a
                // fresh index + manifest. Only triggers for manifest-resolved (hashed)
                // chunks, i.e. real deploys, not ad-hoc/relative srcs.
                try {
                    const _resolved = (window.__ASSET_MANIFEST || {})[src];
                    if (_resolved && !sessionStorage.getItem('fs_chunk_skew_reloaded')) {
                        sessionStorage.setItem('fs_chunk_skew_reloaded', '1');
                        console.warn('[chunk] likely version skew after a deploy — reloading once to refresh the asset manifest');
                        location.reload();
                        return;
                    }
                } catch (_) { /* sessionStorage blocked (private mode) — fall through to the toast */ }
                try { if (window.UI?.toast?.error) window.UI.toast.error('A module failed to load — check your connection and try again.'); } catch (_) { /* intentional: toast is cosmetic; load already failed and resolves */ }
                resolve();
            };
            document.body.appendChild(s);
        });
        _chunkInFlight.set(src, p);
        return p;
    };
    // Build a self-loading delegating stub with a recursion guard. Loads `src`,
    // then calls the real window.app[name] ONLY if it is no longer this stub —
    // so a failed/incomplete chunk load can't make the stub re-invoke itself
    // forever (tab-freezing microtask/retry loop).
    const _lazyStub = (src, name) => {
        const stub = (...a) => _loadChunkOnce(src).then(() => {
            const r = window.app[name];
            if (typeof r === 'function' && r !== stub) return r(...a);
            console.warn(`[chunk] ${name} unavailable after loading ${src}`);
            return undefined;
        });
        return stub;
    };
    // Multi-chunk variant for handlers that need several chunks loaded first.
    const _lazyStubMulti = (srcs, name) => {
        const stub = (...a) => Promise.all(srcs.map(s => _loadChunkOnce(s))).then(() => {
            const r = window.app[name];
            if (typeof r === 'function' && r !== stub) return r(...a);
            console.warn(`[chunk] ${name} unavailable after loading ${srcs.join(', ')}`);
            return undefined;
        });
        return stub;
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

    // (Phase 8) _loadFeatures REMOVED — the legacy script-features.js monolith is
    // retired; all views are owned by their dedicated chunks (see _CHUNK_VIEWS +
    // the eager post-login chunk loader).

    // (Phase 9) _syncAllChunkUsers REMOVED — chunks no longer snapshot _currentUser;
    // they read window._appState.cu live (via _state.cu), so there is nothing to
    // re-sync. This also fixes the prior latent bug where 5 chunks shared the
    // window._syncProspectsUser key (only the last-loaded was ever re-synced).

    const navigateTo = async (viewId) => {
        UI.hideModal();
        // A11y: announce the view change to assistive tech via the shared polite
        // live region (UI.live). Defensive — it must NEVER block navigation.
        try { if (window.UI && UI.live) UI.live('Loading ' + String(viewId || '').replace(/_/g, ' ') + '…'); } catch (_) { /* intentional: route announcer is best-effort */ }
        // Cancel any in-flight Supabase reads tied to the OUTGOING view so
        // their late-arriving responses can't overwrite the new view's cache
        // ~800ms after navigation. AppDataStore catches AbortError internally
        // and returns []; no exception leaks here.
        // No-op if AppDataStore isn't ready yet (first navigate during boot).
        try { if (window.AppDataStore && typeof window.AppDataStore.abortInflight === 'function') {
            window.AppDataStore.abortInflight('navigate:' + viewId);
        } } catch (_) { /* intentional: abort is an optimization; navigation proceeds if it throws */ }
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
        // ── Non-core views ────────────────────────────────────────────────────
        // (Phase 8) The legacy script-features.js monolith was RETIRED — every
        // view is now owned by its dedicated chunk (loaded above via _CHUNK_VIEWS
        // + eagerly post-login), so there is no longer a features fallback to
        // fetch here. This also removes the prior load-order ambiguity where the
        // stale features bundle could re-register DMS/Knowledge handlers over the
        // maintained chunk versions depending on navigation order.
        // Stock Take v2 teardown — when leaving the stock_take view, stop the
        // Supabase realtime channel and any active camera stream so we don't
        // pin a websocket / camera handle in the background.
        if (_currentView === 'stock_take' && viewId !== 'stock_take') {
            try { if (typeof window.app?.stStopRealtime === 'function') await window.app.stStopRealtime(); } catch (e) { /* intentional: best-effort realtime teardown on view exit */ }
            try { if (typeof window.app?._stCancelScanner === 'function') await window.app._stCancelScanner(); } catch (e) { /* intentional: best-effort camera teardown on view exit */ }
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
        // Derived from the VIEWS registry (single source of truth) — byte-identical
        // to the former hand-maintained literal.
        const VIEW_TITLES = _deriveViewTitles();
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
                    setTimeout(() => (window.app.applyMobileTableLabels || (() => {}))(), 200);
                }
                return;
            }
        }

        await _withViewTransition(async () => {
        const _render = _VIEW_RENDER[viewId];
        if (_render) {
            await _render(viewport);
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
            setTimeout(() => (window.app.applyMobileTableLabels || (() => {}))(), 200);
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

        // ── Purchases-history cache (shared: prospects-core ↔ approvals) ──
        // Written/invalidated by approveProspectConversion / queue approvals in
        // the approvals chunk; read + populated by the purchases-history code in
        // the prospects-core chunk. Promoted from a chunk-local `let` so both
        // chunks see the same value across the file boundary (SEAM-3).
        get phc()   { return _purchasesHistoryCache; },
        set phc(v)  { _purchasesHistoryCache = v; },
        get phcts() { return _purchasesHistoryCacheTs; },
        set phcts(v){ _purchasesHistoryCacheTs = v; },

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
    const showProspectDetail      = async (...a) => { await _loadChunkOnce('chunks/script-prospects.min.js'); const _r = window.app.showProspectDetail;      if (_r && _r !== showProspectDetail)      return _r(...a); };
    const showCustomerDetail      = async (...a) => { await _loadChunkOnce('chunks/script-customers.min.js'); const _r = window.app.showCustomerDetail;      if (_r && _r !== showCustomerDetail)      return _r(...a); };
    const showPurchasesHistoryView = async (...a) => { await _loadChunkOnce('chunks/script-prospects.min.js'); const _r = window.app.showPurchasesHistoryView; if (_r && _r !== showPurchasesHistoryView) return _r(...a); };
    const showAgentsView          = async (...a) => { await _loadChunkOnce('chunks/script-agents.min.js'); const _r = window.app.showAgentsView;          if (_r && _r !== showAgentsView)          return _r(...a); };
    const showAgentDetail         = async (...a) => { await _loadChunkOnce('chunks/script-agents.min.js'); const _r = window.app.showAgentDetail;         if (_r && _r !== showAgentDetail)         return _r(...a); };
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
    const quickReassign = async (...a) => { if (typeof window._loadChunk === 'function') { try { await window._loadChunk('chunks/script-import.min.js'); } catch (_) { return; /* intentional: bail if lazy chunk fails to load */ } } const _r = window.app.quickReassign; if (_r && _r !== quickReassign) return _r(...a); };
    const openReviveProspectModal = async (...a) => { const _r = window.app.openReviveProspectModal; if (_r && _r !== openReviveProspectModal) return _r(...a); };
    const saveReviveProspect = async (...a) => { const _r = window.app.saveReviveProspect; if (_r && _r !== saveReviveProspect) return _r(...a); };
    const convertToCustomer = async (...a) => { const _r = window.app.convertToCustomer; if (_r && _r !== convertToCustomer) return _r(...a); };
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
    const toggleNotifPanel = async (...a) => { await _loadChunkOnce('chunks/script-cps.min.js'); const _r = window.app.toggleNotifPanel; if (_r && _r !== toggleNotifPanel) return _r(...a); };
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
    const openShareCpsIntakeLinkModal = async (...a) => { await _loadChunkOnce('chunks/script-cps.min.js'); const _r = window.app.openShareCpsIntakeLinkModal; if (_r && _r !== openShareCpsIntakeLinkModal) return _r(...a); };
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

    const goBackFromDetail = () => {
        const prev = window._appState.pvd;
        if (prev === 'calendar' || prev === 'month') {
            // navigateTo clears _currentDetailView internally
            navigateTo(prev);
        } else {
            // Clear _currentDetailView NOW so SWR background-sync can re-render
            // the prospects list — if we skip navigateTo, it never gets cleared.
            window._appState.cdv = null;
            const vp = document.getElementById('content-viewport');
            const fn = window.app.showProspectsViewSmart;
            // Fallback to navigateTo('prospects') in case script-mobile.js hasn't
            // loaded yet (e.g. desktop session that never visited the Home tab).
            if (fn) { fn(vp); } else { navigateTo('prospects'); }
        }
    };

    return {
        init,
        navigateTo,
        goBackFromDetail,
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
        openSendWhatsAppModal,
        toggleUserMenu,

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
        openActivityModal: _lazyStub('chunks/script-activities.min.js', 'openActivityModal'),

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
        // Safe self-loading stubs: use _loadChunkOnce so the chunk is loaded on first call,
        // then invoke the real function. The old `(window.app.X || (() => {}))(...a)` pattern
        // caused infinite recursion because window.app.X IS this stub before the chunk loads.
        renderJourneyTab:          _lazyStub('chunks/script-journey.min.js', 'renderJourneyTab'),
        markJourneyTouchpointDone: _lazyStub('chunks/script-journey.min.js', 'markJourneyTouchpointDone'),
        skipJourneyTouchpoint:     _lazyStub('chunks/script-journey.min.js', 'skipJourneyTouchpoint'),
        snoozeJourneyTouchpoint:   _lazyStub('chunks/script-journey.min.js', 'snoozeJourneyTouchpoint'),
        executeSnooze:             _lazyStub('chunks/script-journey.min.js', 'executeSnooze'),
        sendJourneyWhatsApp:       _lazyStub('chunks/script-journey.min.js', 'sendJourneyWhatsApp'),
        switchJourneyTrackDisplay: _lazyStub('chunks/script-journey.min.js', 'switchJourneyTrackDisplay'),
        switchJourneyTrack:        _lazyStub('chunks/script-journey.min.js', 'switchJourneyTrack'),
        confirmSwitchJourneyTrack: _lazyStub('chunks/script-journey.min.js', 'confirmSwitchJourneyTrack'),
        openSpawnTouchpointsModal: _lazyStub('chunks/script-journey.min.js', 'openSpawnTouchpointsModal'),
        executeSpawnTouchpoints:   _lazyStub('chunks/script-journey.min.js', 'executeSpawnTouchpoints'),
        showAgentJourneyDashboard: _lazyStub('chunks/script-journey.min.js', 'showAgentJourneyDashboard'),
        showAgentJourneyLoad:      _lazyStub('chunks/script-journey.min.js', 'showAgentJourneyLoad'),

        // Calendar + Follow-Up Engine — implemented by chunks/script-calendar.js
        // Self-loading stubs so these can be called from any view without the calendar chunk pre-loaded.
        // Both calendar AND activities chunks needed: calendar owns the modal/save,
        // activities owns collectPostMeetupNotesData / buildPostMeetupNotesBlock.
        openPostMeetupNotesModal: _lazyStubMulti(['chunks/script-calendar.min.js', 'chunks/script-activities.min.js'], 'openPostMeetupNotesModal'),
        savePostMeetupNotes:      _lazyStubMulti(['chunks/script-calendar.min.js', 'chunks/script-activities.min.js'], 'savePostMeetupNotes'),
        openMeetingOutcomeModal:  _lazyStub('chunks/script-calendar.min.js', 'openMeetingOutcomeModal'),
        saveMeetingOutcome:       _lazyStub('chunks/script-calendar.min.js', 'saveMeetingOutcome'),

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
        // Auto-refreshing current view via the declarative _VIEW_REFRESH map
        // (replaces the old switch on _currentView). Unlisted views = no-op,
        // matching the old `default` case.
        const _refresh = _VIEW_REFRESH[_currentView];
        if (_refresh) await _refresh(viewport);
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
                        (window.app._clearMobileSnapshots || (() => {}))(['mcal-snap-', 'mcal-acts-', 'mhome-snap-']);
                    } else if (table === 'prospects' || table === 'customers') {
                        // Everything people-derived must refresh.
                        (window.app._clearMobileSnapshots || (() => {}))(['mp-list-snap-', 'mhome-', 'mcal-people', 'mcal-snap-', 'mcal-acts-']);
                    } else if (table === 'users') {
                        (window.app._clearMobileSnapshots || (() => {}))(['mhome-users', 'mhome-snap-', 'mcal-people', 'mp-list-snap-']);
                    } else if (table === 'follow_up_drafts' || table === 'refill_reminders') {
                        (window.app._clearMobileSnapshots || (() => {}))(['mhome-drafts', 'mhome-refills', 'mhome-snap-']);
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
function autoGuardAppMutations() {
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
}
window._autoGuardAppMutations = autoGuardAppMutations;
autoGuardAppMutations();

// ==================== AUTO-DEBOUNCE SEARCH/FILTER (Phase C: input lag) ====================
// Inline oninput="app.searchEntities()" handlers fire on every keystroke. Wrap
// known search/filter functions so they only run once typing stops (250ms).
// Functions explicitly using debounceCall in their template stay unchanged.
function autoDebounceAppSearch() {
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
    if (wrappedCount) console.info('[Perf] auto-debounce installed on', wrappedCount, 'search/filter handlers');
}
window._autoDebounceAppSearch = autoDebounceAppSearch;
autoDebounceAppSearch();


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
    // Sessions always persist until explicit logout — skip the inactivity timer.
    // Guard 1: remember_me flag set at login. Guard 2: no user yet (called before
    // app.init() resolves — arming the timer pre-auth would fire on a valid session).
    // NOTE: `_currentUser` lives inside the appLogic IIFE — invisible here at module
    // scope. Reach it via window._appState.cu, which is a getter that proxies the
    // same binding. Without this, initSessionTimeout threw ReferenceError on every
    // initSecurity() call after login (silently — the unhandled-rejection didn't
    // surface to the UI, but the inactivity timer never armed).
    // Inactivity auto-logout applies to the WEB browser ONLY — never the installed
    // PWA / mobile app (standalone display mode), where a one-time login persists
    // (owner spec 2026-06-19). Decoupled from remember_me (which only governs
    // cross-restart session persistence, NOT the idle timeout) so a logged-in web
    // user is now actually protected by the timer that the remember_me gate had
    // silently disabled.
    const _isStandaloneApp = (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches)
        || window.navigator.standalone === true;
    if (_isStandaloneApp) return;
    if (!window._appState?.cu) return;
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
        // Legacy localStorage may hold "[object Object]" (a stringified object from
        // before the write was removed) — JSON.parse would throw; default to {}.
        try { failedAttempts = JSON.parse(localStorage.getItem('login_attempts') || '{}'); }
        catch (_e) { failedAttempts = {}; }
    }
    if (!failedAttempts || typeof failedAttempts !== 'object') failedAttempts = {};
    const now = Date.now();
    Object.keys(failedAttempts).forEach(ip => {
        const arr = Array.isArray(failedAttempts[ip]) ? failedAttempts[ip] : [];
        failedAttempts[ip] = arr.filter(t => now - t < 24 * 60 * 60 * 1000);
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
    } catch (e) { console.warn('[login_attempts] counter persist failed', e); /* intentional: best-effort prune-persist; lockout reads remain server-authoritative */ }
    // No localStorage fallback — failed login attempts must be server-authoritative to
    // prevent client-side bypass by clearing storage. Previously written to localStorage
    // which allowed attackers to reset the lockout counter at will.
};

const checkForSecurityIncidents = async () => {
    if (!window.AppDataStore) return;
    // Non-critical background monitor — never let a read glitch surface as an
    // unhandled rejection (the minified getAll can intermittently throw a
    // defineProperty TypeError under cold-load concurrency).
    try {
        const incidents = (await AppDataStore.getAll('security_incidents')).filter(i => i.status === 'new' && !i.acknowledged);
        if (incidents.length > 0) {
            const critical = incidents.filter(i => i.severity === 'critical');
            if (critical.length > 0) {
                if (window.UI && window.UI.toast) window.UI.toast.error(`${critical.length} critical security incidents require attention`, 0);
                window.app.addSecurityAlertIcon();
            }
        }
    } catch (e) {
        console.warn('checkForSecurityIncidents skipped:', e && e.message);
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
        } catch (_) { /* intentional: missing last-run read just causes retention to run (idempotent) */ }
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
            } catch (_) { /* intentional: best-effort timestamp write; worst case retention re-runs next cycle */ }
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

// Self-loading delegating stub (top-level scope) with a recursion guard: after
// loading `src`, call the real window.app[name] only if it's no longer this stub.
// Prevents an infinite retry loop when the chunk fails to load or doesn't export
// the name (the `?.` optional-chaining variants did NOT guard against this — the
// property is always defined because it IS the stub).
const _lazyAppStub = (src, name) => {
    const stub = (...a) => window._loadChunk(src).then(() => {
        const r = window.app[name];
        if (typeof r === 'function' && r !== stub) return r(...a);
        console.warn(`[chunk] ${name} unavailable after loading ${src}`);
        return undefined;
    });
    return stub;
};

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
    showSecurityDashboard:  _lazyAppStub('chunks/script-admin.min.js', 'showSecurityDashboard'),
    showAuditLogs:          _lazyAppStub('chunks/script-admin.min.js', 'showAuditLogs'),
    showComplianceCenter:   _lazyAppStub('chunks/script-admin.min.js', 'showComplianceCenter'),
    showAdminDashboard:     _lazyAppStub('chunks/script-admin.min.js', 'showAdminDashboard'),
    // Admin sub-menu items — must load chunk before calling (direct nav skips showAdminDashboard)
    showTenantManagement:    _lazyAppStub('chunks/script-admin.min.js', 'showTenantManagement'),
    showSystemHealth:        _lazyAppStub('chunks/script-admin.min.js', 'showSystemHealth'),
    showBackupManager:       _lazyAppStub('chunks/script-admin.min.js', 'showBackupManager'),
    showPerformanceMonitor:  _lazyAppStub('chunks/script-admin.min.js', 'showPerformanceMonitor'),
    showDeploymentCenter:    _lazyAppStub('chunks/script-admin.min.js', 'showDeploymentCenter'),
    showSystemLogs:          _lazyAppStub('chunks/script-admin.min.js', 'showSystemLogs'),
    // Mobile nav toggle — stub ensures hamburger works even before mobile chunk finishes loading
    toggleMobileNav: _lazyAppStub('chunks/script-mobile.min.js', 'toggleMobileNav'),
    // AI Insights — stubs load ai chunk on first click (Tier-2 prefetch at 3 s; user may click sooner)
    showAIInsightsDashboard:  _lazyAppStub('chunks/script-ai.min.js', 'showAIInsightsDashboard'),
    showLeadScoring:          _lazyAppStub('chunks/script-ai.min.js', 'showLeadScoring'),
    showSalesForecast:        _lazyAppStub('chunks/script-ai.min.js', 'showSalesForecast'),
    showChurnRiskAnalysis:    _lazyAppStub('chunks/script-ai.min.js', 'showChurnRiskAnalysis'),
    showPerformanceInsights:  _lazyAppStub('chunks/script-ai.min.js', 'showPerformanceInsights'),
    // _prefetchChunkForView is internal to the IIFE — used only by the pointerover
    // listener at script.js:2743. Removed from the export list because esbuild's
    // --keep-names option renames the const binding (to a short letter) but leaves
    // the shorthand reference here as the bare name, causing a ReferenceError on
    // bundle eval. Nothing outside the IIFE ever read `app._prefetchChunkForView`.
    // Two-factor (defined in two-factor.min.js, loaded separately)
    showTwoFactorSetup:  typeof showTwoFactorSetup  !== 'undefined' ? showTwoFactorSetup  : () => UI?.toast?.warning('Two-factor setup not available.'),
    verifyAndEnable2FA:  typeof verifyAndEnable2FA  !== 'undefined' ? verifyAndEnable2FA  : () => UI?.toast?.warning('Two-factor not available.'),
    showTwoFactorLogin:  typeof showTwoFactorLogin  !== 'undefined' ? showTwoFactorLogin  : () => UI?.toast?.warning('Two-factor not available.'),
    verifyTwoFactorLogin: typeof verifyTwoFactorLogin !== 'undefined' ? verifyTwoFactorLogin : () => UI?.toast?.warning('Two-factor not available.'),
    showBackupCodeLogin:  typeof showBackupCodeLogin  !== 'undefined' ? showBackupCodeLogin  : () => UI?.toast?.warning('Two-factor not available.'),
    verifyBackupCodeLogin: typeof verifyBackupCodeLogin !== 'undefined' ? verifyBackupCodeLogin : () => UI?.toast?.warning('Two-factor not available.'),
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
