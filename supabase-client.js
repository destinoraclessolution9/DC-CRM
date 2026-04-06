// supabase-client.js
(function() {
    // Wait a short time to ensure the library is loaded
    setTimeout(function() {
        if (typeof window.supabase !== 'undefined' && typeof window.supabase.createClient === 'function') {
            // Save the factory BEFORE replacing it so DataStore can create a service-role client later.
            window._supabaseFactory = window.supabase;
            window.supabase = window.supabase.createClient(
                window.SUPABASE_URL,
                window.SUPABASE_ANON_KEY
            );
            console.log('Supabase client initialized');
        } else {
            console.error('Supabase library not loaded or createClient missing. Check network.');
        }
    }, 0);
})();