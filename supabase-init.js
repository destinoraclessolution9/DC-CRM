// Supabase client init — runs synchronously after supabase-js library loads.
// Security note (2026-04-21): service_role key removed; all queries use the
// anon key + per-user Supabase auth session. RLS enforces access control.
//
// Mobile persistence (2026-05-26): explicit auth config so a re-install or
// PWA cold-boot finds the session intact. iOS Safari & Android Chrome both
// retain localStorage across sessions as long as the user isn't in private
// mode; the refresh token (default 30-day TTL — set higher in the Supabase
// Auth dashboard if desired) is auto-rotated each time getUser/getSession
// is called.
window.SUPABASE_URL = 'https://remuwhxvzkzjtgbzqjaa.supabase.co';
// Single source of truth for the auth-session localStorage key. Consumed here
// (storageKey), in script.js (offline session-resume) and data.js
// (hasLiveSession + the storage-prune PROTECTED set) so the three can never
// drift — a past drift left offline-resume reading a non-existent 'sb-*-auth-token'
// key, locking users out during a 521/offline blip.
window.SUPABASE_AUTH_STORAGE_KEY = 'fs-crm-auth-v1';

// Guard against the supabase-js library failing to load (CDN block, weak signal,
// service-worker cache miss). Without this guard the next line crashed with
// "Cannot read properties of undefined (reading 'createClient')" and left
// window.supabase undefined — every later Auth.login call then threw
// "Cannot read properties of undefined (reading 'auth')". The library is now
// self-hosted (libs/supabase-js-*.min.js) so this should never fire, but the
// flag is the last line of defense so the login screen can show a clear
// "refresh the page" message instead of leaking the cryptic internal error.
if (typeof window.supabase === 'undefined' || typeof window.supabase.createClient !== 'function') {
    window._SUPABASE_LIB_FAILED = true;
    console.error('[supabase-init] supabase-js library did not load. Check libs/supabase-js-*.min.js is reachable.');
} else {
    window._supabaseFactory = window.supabase;
    window.supabase = window.supabase.createClient(
        window.SUPABASE_URL,
        'sb_publishable_XVWyiw5j1lnEErQUTV4XWg_lQcCIAjX',
        {
            auth: {
                persistSession: true,
                autoRefreshToken: true,
                detectSessionInUrl: true,
                storage: window.localStorage,
                // Stable namespaced key — survives Phase D service-worker cache clears.
                storageKey: window.SUPABASE_AUTH_STORAGE_KEY,
                flowType: 'pkce'
            }
        }
    );
}
