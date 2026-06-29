import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { createHash } from 'node:crypto';
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
  key: string;
  enabled: boolean;
  category: string;
  description: string;
  scope: FeatureFlagScope;
  config: Record<string, unknown>;
  updated_at: string;
};

const SUCCESS_CACHE_HEADERS = {
  'Cache-Control': 'private, max-age=120, stale-while-revalidate=1080',
  Vary: 'Authorization, Cookie',
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
    key,
    enabled: row?.enabled === true || row?.is_enabled === true,
    category: String(row?.category || 'billing').trim() || 'billing',
    description: typeof row?.description === 'string' ? row.description : '',
    scope: normalizeScope(row?.scope),
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
    key,
    enabled: row?.enabled === true || row?.is_enabled === true,
    category: 'billing',
    description: typeof row?.description === 'string' ? row.description : '',
    scope: 'global',
    config: normalizeConfig(row?.value),
    updated_at: typeof row?.updated_at === 'string'
      ? row.updated_at
      : new Date().toISOString(),
  };
}

async function loadFeatureFlagRows(supabase: SupabaseClient) {
  const { data, error } = await supabase
    .from('feature_flags')
    .select('key,enabled,category,description,scope,config,updated_at')
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

function buildFeatureFlagsEtag(rows: FeatureFlagApiRow[]): string {
  const stableRows = rows
    .map((row) => ({
      key: row.key,
      enabled: row.enabled,
      category: row.category,
      description: row.description,
      scope: row.scope,
      config: row.config,
      updated_at: row.updated_at,
    }))
    .sort((a, b) => a.key.localeCompare(b.key));
  const hash = createHash('sha256').update(JSON.stringify(stableRows)).digest('base64url');
  return `"feature-flags:${hash}"`;
}

function etagMatches(req: NextRequest, etag: string): boolean {
  const header = req.headers.get('if-none-match');
  if (!header) return false;
  return header
    .split(',')
    .map((entry) => entry.trim())
    .some((entry) => entry === etag || entry === '*');
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
    const etag = buildFeatureFlagsEtag(rows);

    if (etagMatches(req, etag)) {
      return new NextResponse(null, {
        status: 304,
        headers: {
          ...SUCCESS_CACHE_HEADERS,
          ETag: etag,
          'X-DCAU-Feature-Flag-Count': String(rows.length),
        },
      });
    }

    return NextResponse.json(
      { rows, requestId },
      {
        status: 200,
        headers: {
          ...SUCCESS_CACHE_HEADERS,
          ETag: etag,
          'X-DCAU-Feature-Flag-Count': String(rows.length),
        },
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
