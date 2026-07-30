import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

let failed = 0;

function readRepoFile(...segments: string[]): string {
  return readFileSync(path.join(process.cwd(), ...segments), 'utf8');
}

async function run(name: string, fn: () => void | Promise<void>) {
  try {
    await fn();
    console.log(`PASS ${name}`);
  } catch (error: any) {
    failed += 1;
    console.error(`FAIL ${name}`);
    console.error(error?.stack || error);
  }
}

async function main() {
  await run('activity route validates the current user and ignores browser-supplied identity', () => {
    const route = readRepoFile('src', 'app', 'api', 'auth', 'activity', 'route.ts');
    assert.match(route, /requireUserFromRequest\(req\)/);
    assert.match(route, /user_id:\s*auth\.userId/);
    assert.match(route, /\.eq\('user_id', auth\.userId\)/);
    assert.doesNotMatch(route, /body[\s\S]{0,80}user_id/);
    assert.doesNotMatch(route, /body[\s\S]{0,80}userId/);
  });

  await run('activity route records through server-only tables without depending on legacy RPC shape', () => {
    const route = readRepoFile('src', 'app', 'api', 'auth', 'activity', 'route.ts');
    assert.match(route, /createSupabaseAdminClient\(\)/);
    assert.match(route, /\.from\('au_user_activity'\)[\s\S]+\.upsert\(/);
    assert.match(route, /last_active_at:\s*nowIso/);
    assert.match(route, /\.from\('au_user_profiles'\)[\s\S]+\.update\(profilePatch\)/);
    assert.match(route, /last_activity_at:\s*nowIso/);
    assert.doesNotMatch(route, /\.rpc\('record_user_activity'/);
  });

  await run('activity route has explicit non-null request IDs on every response path', () => {
    const route = readRepoFile('src', 'app', 'api', 'auth', 'activity', 'route.ts');
    assert.match(route, /function createSafeRequestId/);
    assert.match(route, /const requestId = createSafeRequestId\(\)/);
    assert.match(route, /error:\s*'unauthorized'[\s\S]+requestId/);
    assert.match(route, /recorded:\s*true[\s\S]+requestId/);
    assert.match(route, /activity_update_degraded[\s\S]+requestId/);
    assert.match(route, /method_not_allowed[\s\S]+createSafeRequestId\(\)/);
  });

  await run('activity failures are sanitized and non-critical', () => {
    const route = readRepoFile('src', 'app', 'api', 'auth', 'activity', 'route.ts');
    assert.match(route, /ACTIVITY_AUTH_MISSING/);
    assert.match(route, /ACTIVITY_USER_VALIDATION_FAILED/);
    assert.match(route, /ACTIVITY_RPC_MISSING/);
    assert.match(route, /ACTIVITY_RPC_SIGNATURE_MISMATCH/);
    assert.match(route, /ACTIVITY_COLUMN_MISMATCH/);
    assert.match(route, /ACTIVITY_RLS_DENIED/);
    assert.match(route, /ACTIVITY_GRANT_MISSING/);
    assert.match(route, /ACTIVITY_SERVER_CLIENT_CONFIG_ERROR/);
    assert.match(route, /ACTIVITY_DATABASE_WRITE_FAILED/);
    assert.match(route, /status:\s*202/);
    assert.match(route, /recorded:\s*false/);
    assert.match(route, /degraded:\s*true/);
    assert.doesNotMatch(route, /error\.message/);
    assert.doesNotMatch(route, /details:/);
  });

  await run('activity client is throttled and does not escalate failures into session expiry', () => {
    const client = readRepoFile('src', 'lib', 'supabase-client', 'client.ts');
    assert.match(client, /USER_ACTIVITY_HEARTBEAT_MS = 5 \* 60 \* 1000/);
    assert.match(client, /USER_ACTIVITY_METADATA_SYNC_MS = 15 \* 60 \* 1000/);
    assert.match(client, /userActivityHeartbeatAt\.set\(userId, now\)/);
    assert.match(client, /safeFetch\('\/api\/auth\/activity'/);
    assert.match(client, /silent:\s*true/);
    assert.match(client, /retries:\s*0/);
    assert.doesNotMatch(client, /recordUserActivityRpc[\s\S]+dispatchSessionExpired/);
  });

  await run('migration documents the legacy RPC signature and server-only activity table shape', () => {
    const legacyMigration = readRepoFile(
      'supabase',
      'migrations',
      '20260227120000_master_auth_limits_retention.sql',
    );
    const runtimeMigration = readRepoFile(
      'supabase',
      'migrations',
      '20260730120000_retention_production_runtime.sql',
    );
    assert.match(legacyMigration, /CREATE OR REPLACE FUNCTION public\.record_user_activity\(\s*p_user_id UUID DEFAULT auth\.uid\(\),\s*p_event TEXT DEFAULT 'activity',\s*p_metadata JSONB DEFAULT '\{\}'::jsonb\s*\)/);
    assert.match(runtimeMigration, /CREATE TABLE IF NOT EXISTS public\.au_user_activity/);
    assert.match(runtimeMigration, /last_active_at timestamptz NOT NULL DEFAULT now\(\)/);
    assert.match(runtimeMigration, /REVOKE ALL ON TABLE public\.au_user_activity FROM anon, authenticated/);
    assert.match(runtimeMigration, /GRANT ALL ON TABLE public\.au_user_activity TO service_role/);
  });

  if (failed > 0) {
    process.exit(1);
  }
}

void main();
