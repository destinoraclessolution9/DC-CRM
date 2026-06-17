// Service Worker initialisation — cleanup (v2) + registration.
// Extracted from index.html inline scripts (#15 SW cleanup refactor).
// Loaded as <script defer> so it runs after HTML parse, before DOMContentLoaded.
//
// Two responsibilities:
//   1. One-time cleanup of the legacy /service-worker.js + stale crm-cache-* caches.
//      Guarded by a localStorage sentinel so repeat visits return immediately.
//   2. Register /sw.js as the sole service worker and expose the registration
//      on window._swRegistration for push-notification subscription.

(async function () {
    if (!('serviceWorker' in navigator)) return;

    // ── Cleanup v2 (iOS Safari disk-cache fix) ────────────────────────────
    // See the full history comment that was previously inline in index.html.
    // Short version: we had two SWs racing for the same scope; the legacy one
    // had a caching bug that pinned users to stale assets. iOS Safari also has
    // a disk-cache layer that persists after SW unregister — location.replace
    // with a unique ?_swclean= querystring bypasses it.
    if (localStorage.getItem('crm_sw_cleanup_v2') !== 'done') {
        try {
            var regs = await navigator.serviceWorker.getRegistrations();
            var orphans = regs.filter(function (r) {
                var url = (r.active || r.waiting || r.installing || {}).scriptURL || '';
                return url.indexOf('/service-worker.js') !== -1;
            });
            var cacheNames = (typeof caches !== 'undefined' && caches.keys) ? await caches.keys() : [];
            var legacyCaches = cacheNames.filter(function (n) {
                return n.indexOf('crm-cache-') === 0 || n.indexOf('crm-runtime-') === 0;
            });
            // Sentinel set FIRST so partial failures can't loop.
            localStorage.setItem('crm_sw_cleanup_v2', 'done');
            if (orphans.length > 0 || legacyCaches.length > 0) {
                await Promise.all(orphans.map(function (r) { return r.unregister(); }));
                await Promise.all(legacyCaches.map(function (n) { return caches.delete(n); }));
                console.info('[crm] cleanup v2: removed ' + orphans.length + ' orphan SW + ' + legacyCaches.length + ' legacy cache(s)');
                var sep = location.search ? '&' : '?';
                location.replace(location.pathname + location.search + sep + '_swclean=' + Date.now());
                return;
            }
        } catch (e) {
            console.warn('[crm] SW cleanup v2 failed:', e);
        }
    }

    // ── Registration ───────────────────────────────────────────────────────
    // /sw.js is the SOLE service worker. Expose registration on
    // window._swRegistration so push-notifications.js can subscribe.
    window.addEventListener('load', function () {
        navigator.serviceWorker.register('/sw.js').then(function (reg) {
            console.info('[SW] registered, scope:', reg.scope);
            window._swRegistration = reg;
            // Proactively check for an updated SW on every load so phones
            // don't wait 24 h for the browser's automatic update check.
            reg.update().catch(function () {});
        }).catch(function (err) {
            console.warn('[SW] registration failed:', err);
        });
    });

    // When the SW activates a new version it sends SW_ACTIVATED.
    //
    // LOAD-3 fix: do NOT reload immediately. With ~3,000 concurrent users a
    // synchronized reload is a thundering herd against Vercel + Supabase login
    // (the documented HTTP 521 pattern) and it discards unsaved in-page work.
    // Instead we:
    //   1. Jitter — schedule the reload after a random 0–60 s spread so the
    //      fleet's reloads smear across a minute instead of one instant.
    //   2. Guard active edits — never reload while a modal is open or an
    //      input/textarea/select/contentEditable is focused; re-arm for a
    //      later random 30–60 s instead. (best-effort; never throws.)
    //   3. Single-timer — a module flag ensures repeated SW_ACTIVATED messages
    //      don't stack multiple pending reloads.
    //
    // Correctness is preserved: the new SW has already activated + claimed the
    // clients, so the very next navigation serves the new version regardless.
    // We're only choosing *when* (spread out / when safe) to force the refresh.
    var _swReloadArmed = false;

    function _swIsEditing() {
        try {
            // An open modal means the user is mid-task — defer.
            if (document.querySelector('.modal.open, [data-modal-open]')) return true;
            var el = document.activeElement;
            if (!el) return false;
            if (el.isContentEditable) return true;
            var tag = el.tagName;
            return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
        } catch (e) {
            // Best-effort: if anything goes wrong, assume NOT editing so we
            // don't get stuck never reloading.
            return false;
        }
    }

    function _swArmReload(version, delay) {
        if (_swReloadArmed) return;        // single-timer guard (idempotent)
        _swReloadArmed = true;
        setTimeout(function () {
            // If the user is actively editing, don't yank the page out from
            // under them — re-arm for another random 30–60 s and try again.
            if (_swIsEditing()) {
                _swReloadArmed = false;    // allow the re-arm below
                var retry = 30000 + Math.floor(Math.random() * 30000); // 30–60 s
                console.info('[SW] new version (' + version + ') ready, but user is editing — deferring reload ' + retry + 'ms');
                _swArmReload(version, retry);
                return;
            }
            console.info('[SW] new version activated (' + version + '), reloading now (jittered)…');
            try { window.location.reload(); } catch (e) { /* best-effort */ }
        }, delay);
    }

    if (navigator.serviceWorker) {
        navigator.serviceWorker.addEventListener('message', function (evt) {
            if (evt.data && evt.data.type === 'SW_ACTIVATED') {
                var delay = Math.floor(Math.random() * 60000); // 0–60 s jitter
                console.info('[SW] new version activated (' + evt.data.version + '), scheduling reload in ' + delay + 'ms (jittered)');
                _swArmReload(evt.data.version, delay);
            }
        });
    }
})();
