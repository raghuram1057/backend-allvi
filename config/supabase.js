const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY; // Use the correct explicit key name

if (!supabaseUrl || !supabaseAnonKey || !supabaseServiceRoleKey) {
    throw new Error("Missing Supabase configuration environment variables inside the backend instance.");
}

// Client 1: Standard client for client-side matching actions (Respects RLS)
const supabase = createClient(supabaseUrl, supabaseAnonKey,{
    auth: {
        persistSession: false,
        autoRefreshToken: false
    }
});

// Client 2: Administrative superuser client (Bypasses RLS completely)
const supabaseAdmin = createClient(supabaseUrl, supabaseServiceRoleKey, {
    auth: {
        persistSession: false,
        autoRefreshToken: false
    }
});

module.exports = { 
    supabase, 
    supabaseAdmin 
};