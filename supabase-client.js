// supabase-client.js
const supabaseUrl = window.SUPABASE_URL;
const supabaseAnonKey = window.SUPABASE_ANON_KEY;
window.supabase = window.supabase.createClient(supabaseUrl, supabaseAnonKey);