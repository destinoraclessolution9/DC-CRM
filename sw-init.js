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

    // When the SW activates a new version it sends SW_ACTIVATED — reload
    // immediately so the page picks up the new index.html + fixed chunks.
    if (navigator.serviceWorker) {
        navigator.serviceWorker.addEventListener('message', function (evt) {
            if (evt.data && evt.data.type === 'SW_ACTIVATED') {
                console.info('[SW] new version activated (' + evt.data.version + '), reloading…');
                window.location.reload();
            }
        });
    }
})();
