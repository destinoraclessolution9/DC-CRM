// supabase-client.js
if (typeof window.supabase !== 'undefined' && typeof window.supabase.createClient === 'function') {
    const supabaseClient = window.supabase.createClient(
        window.SUPABASE_URL,
        window.SUPABASE_ANON_KEY
    );
    window.supabase = supabaseClient;
    console.log('Supabase client initialized');
} else {
    console.error('Supabase library not loaded or createClient missing. Check network.');
}