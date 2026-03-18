import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';
import { requireUserFromRequest } from '@/app/api/proxy/_supabase-auth';
import {
  createSupabaseRlsClient,
  getSupabaseAnonKey,
  getSupabaseUrl,
} from '@/lib/server/supabase-admin';

export const runtime = 'nodejs';

type FeatureFlagScope = 'global' | 'org' | 'user';

type FeatureFlagApiRow = {
  id: string;
  key: string;
  enabled: boolean;
  category: string;
  description: string;
  scope: FeatureFlagScope;
  org_id: string | null;
  user_id: string | null;
  config: Record<string, unknown>;
  updated_at: string;
};

function isSchemaDriftError(error: any): boolean {
  const code = String(error?.code || '').trim();
  const message = String(error?.message || '').toLowerCase();
  return (
    code === '42P01' ||
    code === '42703' ||
    (message.includes('relation') && message.includes('does not exist')) ||
    (message.includes('column') && message.includes('does not exist'))
  );
}

function normalizeScope(value: unknown): FeatureFlagScope {
  const raw = String(value || '').trim().toLowerCase();
  if (raw === 'org') return 'org';
  if (raw === 'user') return 'user';
  return 'global';
}

function normalizeConfig(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function normalizeCanonicalRow(row: any): FeatureFlagApiRow | null {
  const key = String(row?.key || '').trim();
  if (!key) return null;

  return {
    id: String(row?.id || key),
    key,
    enabled: row?.enabled === true || row?.is_enabled === true,
    category: String(row?.category || 'billing').trim() || 'billing',
    description: typeof row?.description === 'string' ? row.description : '',
    scope: normalizeScope(row?.scope),
    org_id: typeof row?.org_id === 'string' ? row.org_id : null,
    user_id: typeof row?.user_id === 'string' ? row.user_id : null,
    config: normalizeConfig(row?.config),
    updated_at: typeof row?.updated_at === 'string'
      ? row.updated_at
      : new Date().toISOString(),
  };
}

function normalizeLegacyRow(row: any): FeatureFlagApiRow | null {
  const key = String(row?.key || '').trim();
  if (!key) return null;

  return {
    id: `legacy-${key}`,
    key,
    enabled: row?.enabled === true || row?.is_enabled === true,
    category: 'billing',
    description: typeof row?.description === 'string' ? row.description : '',
    scope: 'global',
    org_id: null,
    user_id: null,
    config: normalizeConfig(row?.value),
    updated_at: typeof row?.updated_at === 'string'
      ? row.updated_at
      : new Date().toISOString(),
  };
}

async function loadFeatureFlagRows(supabase: SupabaseClient) {
  const { data, error } = await supabase
    .from('feature_flags')
    .select('id,key,enabled,category,description,scope,org_id,user_id,config,updated_at')
    .order('updated_at', { ascending: false });

  if (!error) {
    return (data || [])
      .map((row) => normalizeCanonicalRow(row))
      .filter((row): row is FeatureFlagApiRow => row !== null);
  }

  if (!isSchemaDriftError(error)) {
    throw error;
  }

  const { data: legacyData, error: legacyError } = await supabase
    .from('au_feature_flags')
    .select('key,is_enabled,enabled,description,value,updated_at')
    .order('updated_at', { ascending: false });

  if (legacyError) {
    if (isSchemaDriftError(legacyError)) return [];
    throw legacyError;
  }

  return (legacyData || [])
    .map((row) => normalizeLegacyRow(row))
    .filter((row): row is FeatureFlagApiRow => row !== null);
}

export async function GET(req: NextRequest) {
  const requestId = crypto.randomUUID();

  try {
    const auth = await requireUserFromRequest(req);
    const supabase = auth.ok
      ? createSupabaseRlsClient(auth.accessToken)
      : createClient(getSupabaseUrl(), getSupabaseAnonKey(), {
          auth: {
            persistSession: false,
            autoRefreshToken: false,
            detectSessionInUrl: false,
          },
        });

    const rows = await loadFeatureFlagRows(supabase);

    return NextResponse.json(
      { rows, requestId },
      {
        status: 200,
        headers: { 'Cache-Control': 'no-store' },
      },
    );
  } catch (error: any) {
    console.error('[api/feature-flags] unexpected error', {
      requestId,
      message: String(error?.message || error),
      stack: String(error?.stack || ''),
    });

    return NextResponse.json(
      {
        code: 'feature_flags_fetch_failed',
        message: String(error?.message || 'Failed to fetch feature flags.'),
        requestId,
      },
      {
        status: 500,
        headers: { 'Cache-Control': 'no-store' },
      },
    );
  }
}
