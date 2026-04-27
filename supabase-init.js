// Supabase client init — runs synchronously after supabase-js library loads.
// Security note (2026-04-21): service_role key removed; all queries use the
// anon key + per-user Supabase auth session. RLS enforces access control.
window.SUPABASE_URL = 'https://remuwhxvzkzjtgbzqjaa.supabase.co';
window._supabaseFactory = window.supabase;
window.supabase = window.supabase.createClient(
    window.SUPABASE_URL,
    'sb_publishable_XVWyiw5j1lnEErQUTV4XWg_lQcCIAjX'
);
