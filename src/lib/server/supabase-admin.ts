import { createClient, type SupabaseClient } from '@supabase/supabase-js';

export function firstEnv(...keys: string[]): string | null {
  for (const key of keys) {
    const value = process.env[key];
    if (value && value.trim().length > 0) {
      return value;
    }
  }
  return null;
}

export function getSupabaseUrl(): string {
  const value = firstEnv('NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_URL');
  if (!value) {
    throw new Error('Missing Supabase URL environment variable.');
  }
  return value;
}

export function getSupabaseAnonKey(): string {
  const value = firstEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'SUPABASE_ANON_KEY');
  if (!value) {
    throw new Error('Missing Supabase anon key environment variable.');
  }
  return value;
}

export function getSupabaseServiceRoleKey(): string {
  const value = firstEnv('SUPABASE_SERVICE_ROLE_KEY', 'SERVICE_ROLE_KEY');
  if (!value) {
    throw new Error('Missing Supabase service role key environment variable.');
  }
  return value;
}

export function createSupabaseAdminClient(): SupabaseClient {
  return createClient(getSupabaseUrl(), getSupabaseServiceRoleKey(), {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
}

export function createSupabaseRlsClient(accessToken: string): SupabaseClient {
  return createClient(getSupabaseUrl(), getSupabaseAnonKey(), {
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

