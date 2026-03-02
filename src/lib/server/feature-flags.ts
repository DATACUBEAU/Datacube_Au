import type { SupabaseClient } from '@supabase/supabase-js';

type FlagValue = {
  enabled: boolean;
  config: Record<string, unknown>;
};

type FlagsSnapshot = {
  fetchedAt: number;
  values: Map<string, FlagValue>;
};

const FLAG_CACHE_TTL_MS = 15_000;
let cache: FlagsSnapshot | null = null;

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

function normalizeConfig(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

async function loadFlagsFromDb(supabase: SupabaseClient): Promise<Map<string, FlagValue>> {
  const out = new Map<string, FlagValue>();

  const { data, error } = await supabase
    .from('feature_flags')
    .select('key,enabled,config');

  if (error) {
    if (!isSchemaDriftError(error)) {
      throw error;
    }

    const { data: legacyData, error: legacyError } = await supabase
      .from('au_feature_flags')
      .select('key,is_enabled');

    if (legacyError) {
      throw legacyError;
    }

    for (const row of legacyData || []) {
      const key = String((row as any)?.key || '').trim();
      if (!key) continue;
      out.set(key, {
        enabled: Boolean((row as any)?.is_enabled),
        config: {},
      });
    }

    return out;
  }

  for (const row of data || []) {
    const key = String((row as any)?.key || '').trim();
    if (!key) continue;
    out.set(key, {
      enabled: Boolean((row as any)?.enabled),
      config: normalizeConfig((row as any)?.config),
    });
  }

  return out;
}

export async function getFeatureFlagsSnapshot(
  supabase: SupabaseClient,
  opts?: { force?: boolean }
): Promise<Map<string, FlagValue>> {
  const now = Date.now();
  if (!opts?.force && cache && now - cache.fetchedAt < FLAG_CACHE_TTL_MS) {
    return cache.values;
  }

  const values = await loadFlagsFromDb(supabase);
  cache = { fetchedAt: now, values };
  return values;
}

export async function getFeatureFlagBoolean(
  supabase: SupabaseClient,
  key: string,
  fallback: boolean
): Promise<boolean> {
  const flags = await getFeatureFlagsSnapshot(supabase);
  const row = flags.get(key);
  return row ? row.enabled : fallback;
}

export function clearFeatureFlagsCache() {
  cache = null;
}

