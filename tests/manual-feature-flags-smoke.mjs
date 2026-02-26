#!/usr/bin/env node

import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SERVICE_ROLE_KEY;
const flagKey = (process.env.SMOKE_FLAG_KEY || 'limits.alerts.enabled').trim();

if (!supabaseUrl || !serviceRoleKey) {
  console.error('[feature-flags-smoke] Missing SUPABASE url/service-role env vars.');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

async function readFlag() {
  const { data, error } = await supabase
    .from('feature_flags')
    .select('id,key,enabled,updated_at')
    .eq('key', flagKey)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error(`Flag ${flagKey} not found`);
  return data;
}

async function main() {
  const before = await readFlag();
  const toggled = !before.enabled;

  const { error: updateError } = await supabase
    .from('feature_flags')
    .update({ enabled: toggled })
    .eq('key', flagKey);
  if (updateError) throw updateError;

  const after = await readFlag();
  if (after.enabled !== toggled) {
    throw new Error(`Expected ${flagKey}=${toggled}, got ${after.enabled}`);
  }

  const { error: revertError } = await supabase
    .from('feature_flags')
    .update({ enabled: before.enabled })
    .eq('key', flagKey);
  if (revertError) throw revertError;

  const restored = await readFlag();
  if (restored.enabled !== before.enabled) {
    throw new Error(`Failed to restore ${flagKey} to ${before.enabled}`);
  }

  console.log('[feature-flags-smoke] PASS');
  console.log(`[feature-flags-smoke] toggled ${flagKey}: ${before.enabled} -> ${after.enabled} -> ${restored.enabled}`);
  console.log('[feature-flags-smoke] Manual UI check: keep /conex open, toggle the same key once and confirm UI updates without refresh.');
}

main().catch((error) => {
  console.error('[feature-flags-smoke] FAIL:', error instanceof Error ? error.message : String(error));
  process.exit(1);
});
