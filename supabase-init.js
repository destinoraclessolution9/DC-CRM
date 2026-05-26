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
            storageKey: 'fs-crm-auth-v1',
            flowType: 'pkce'
        }
    }
);
