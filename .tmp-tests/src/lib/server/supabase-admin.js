"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.firstEnv = firstEnv;
exports.getSupabaseUrl = getSupabaseUrl;
exports.getSupabaseAnonKey = getSupabaseAnonKey;
exports.getSupabaseServiceRoleKey = getSupabaseServiceRoleKey;
exports.createSupabaseAdminClient = createSupabaseAdminClient;
exports.createSupabaseRlsClient = createSupabaseRlsClient;
const supabase_js_1 = require("@supabase/supabase-js");
function firstEnv(...keys) {
    for (const key of keys) {
        const value = process.env[key];
        if (value && value.trim().length > 0) {
            return value;
        }
    }
    return null;
}
function getSupabaseUrl() {
    const value = firstEnv('NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_URL');
    if (!value) {
        throw new Error('Missing Supabase URL environment variable.');
    }
    return value;
}
function getSupabaseAnonKey() {
    const value = firstEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'SUPABASE_ANON_KEY');
    if (!value) {
        throw new Error('Missing Supabase anon key environment variable.');
    }
    return value;
}
function getSupabaseServiceRoleKey() {
    const value = firstEnv('SUPABASE_SERVICE_ROLE_KEY', 'SERVICE_ROLE_KEY');
    if (!value) {
        throw new Error('Missing Supabase service role key environment variable.');
    }
    return value;
}
function createSupabaseAdminClient() {
    return (0, supabase_js_1.createClient)(getSupabaseUrl(), getSupabaseServiceRoleKey(), {
        auth: {
            persistSession: false,
            autoRefreshToken: false,
            detectSessionInUrl: false,
        },
    });
}
function createSupabaseRlsClient(accessToken) {
    return (0, supabase_js_1.createClient)(getSupabaseUrl(), getSupabaseAnonKey(), {
        global: {
            headers: {
                Authorization: `Bearer ${accessToken}`,
            },
        },
        auth: {
            persistSession: false,
            autoRefreshToken: false,
            detectSessionInUrl: false,
        },
    });
}
