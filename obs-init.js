// Observability initialisation — env-gated front-end error tracking (Sentry).
// Loaded as <script defer> so it runs after HTML parse, before DOMContentLoaded.
//
// COMPLETE NO-OP until the owner sets a Vercel env var `SENTRY_DSN`:
// build.mjs injects window.__SENTRY_DSN (from process.env.SENTRY_DSN || '') and
// window.__APP_RELEASE (from VERCEL_GIT_COMMIT_SHA) into an inline <script> in
// index.html. When SENTRY_DSN is empty the DSN string is "" → this file returns
// immediately: no CDN fetch, no network, no console noise.
//
// Everything is wrapped in try/catch so a failure here can NEVER break page load.
// ES5-compatible (var/function only) to match sw-init.js.

(function () {
    try {
        var dsn = window.__SENTRY_DSN;
        // No-op unless an actual DSN string is present.
        if (!dsn || typeof dsn !== 'string') return;

        // beforeSend hook — best-effort strip of obvious PII. Never throws.
        function scrub(event) {
            try {
                if (!event) return event;

                // Drop request cookies entirely.
                if (event.request && event.request.cookies) {
                    delete event.request.cookies;
                }

                // Redact obvious PII keys (case-insensitive) anywhere inside
                // event.extra / event.contexts. Bounded-depth walk so a cyclic
                // or huge payload can't hang or overflow the stack.
                var SENSITIVE = /(email|phone|password|token)/i;

                function redact(obj, depth) {
                    if (!obj || typeof obj !== 'object' || depth > 6) return;
                    for (var key in obj) {
                        if (!Object.prototype.hasOwnProperty.call(obj, key)) continue;
                        var val = obj[key];
                        if (SENSITIVE.test(key)) {
                            obj[key] = '[redacted]';
                        } else if (val && typeof val === 'object') {
                            redact(val, depth + 1);
                        }
                    }
                }

                if (event.extra) redact(event.extra, 0);
                if (event.contexts) redact(event.contexts, 0);
            } catch (e) {
                // Best-effort only — never let scrubbing throw.
            }
            return event;
        }

        // Dynamically inject the official Sentry browser SDK from CDN.
        var src = 'https://browser.sentry-cdn.com/7.120.0/bundle.tracing.min.js';
        var s = document.createElement('script');
        s.src = src;
        s.crossOrigin = 'anonymous';
        // SRI: pin the exact 7.120.0 bundle so a compromised/MITM'd CDN response
        // can't execute arbitrary JS in the authed CRM origin. Hash computed from
        // the pinned bundle.tracing.min.js (sha384). Must be updated if `src` bumps.
        s.integrity = 'sha384-qcwbea4ny6qhrhRBPu+pNH1T7WSXwcaxP5mUNeYCnHiJ5BUfyFyJzB41byw7i8BV';
        s.onload = function () {
            try {
                if (!window.Sentry || typeof window.Sentry.init !== 'function') return;
                window.Sentry.init({
                    dsn: dsn,
                    release: window.__APP_RELEASE || undefined,
                    environment: 'production',
                    tracesSampleRate: 0.05,
                    replaysSessionSampleRate: 0,
                    beforeSend: scrub
                });
            } catch (e) {
                // Sentry.init failed — swallow; page load is unaffected.
            }
        };
        s.onerror = function () {
            // CDN unreachable — ignore; observability is best-effort.
        };
        (document.head || document.documentElement).appendChild(s);
    } catch (e) {
        // Any failure here must never break page load.
    }
})();
