// supabase-client.js
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
window.supabase = window.supabase.createClient(supabaseUrl, supabaseKey);