// supabase-client.js
import { createClient } from '@supabase/supabase-js'

const supabaseUrl = window.SUPABASE_URL
const supabaseAnonKey = window.SUPABASE_ANON_KEY
export const supabase = createClient(supabaseUrl, supabaseAnonKey)