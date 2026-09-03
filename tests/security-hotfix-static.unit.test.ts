import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

function readRepoFile(...segments: string[]): string {
  return readFileSync(path.join(process.cwd(), ...segments), 'utf8');
}

test('PWA Supabase requests are NetworkOnly and protected APIs remain excluded from caching', () => {
  const nextConfig = readRepoFile('next.config.ts');
  assert.match(nextConfig, /supabase\\\.co/);
  assert.match(nextConfig, /request\.method === 'GET'/);
  assert.match(nextConfig, /handler:\s*'NetworkOnly'/);
  assert.match(nextConfig, /PWA_RUNTIME_CACHE_NAMES\['supabase-no-cache'\]/);
  assert.doesNotMatch(nextConfig, /PWA_RUNTIME_CACHE_NAMES\['supabase-swr'\]/);
  assert.doesNotMatch(nextConfig, /headers:\s*Object\.fromEntries\(request\?\.headers/);
  for (const protectedPrefix of [
    '/_next/static/chunks/app/api/account/',
    '/_next/static/chunks/app/api/admin/',
    '/_next/static/chunks/app/api/au/',
    '/_next/static/chunks/app/api/auth/',
    '/_next/static/chunks/app/api/billing/',
    '/_next/static/chunks/app/api/chat/',
    '/_next/static/chunks/app/api/entitlements/',
    '/_next/static/chunks/app/api/feature-output/',
    '/_next/static/chunks/app/api/limits/',
    '/_next/static/chunks/app/api/payments/',
  ]) {
    assert.ok(nextConfig.includes(protectedPrefix), `missing protected PWA prefix ${protectedPrefix}`);
  }
});

test('admin provider key responses are masked and never echo raw key rows', () => {
  const handler = readRepoFile('src', 'app', 'api', 'admin', 'handler', 'route.ts');
  const conexPage = readRepoFile('src', 'app', 'conex', 'page.tsx');
  const adminAuth = readRepoFile('src', 'app', 'api', 'admin', 'auth', 'route.ts');
  const adminFetch = readRepoFile('src', 'lib', 'api', 'admin-fetch.ts');
  const featureFlags = readRepoFile('src', 'components', 'feature-flag-provider.tsx');
  const providerColumns = handler.match(/const PROVIDER_KEY_PUBLIC_COLUMNS =\s*\n\s*'([^']+)'/)?.[1] || '';
  assert.match(handler, /requireConexAdmin\(req\)/);
  assert.doesNotMatch(handler, /from\('au_api_keys'\)\.select\('\*'\)/);
  assert.match(providerColumns, /key_last4/);
  assert.doesNotMatch(providerColumns, /key_value/);
  assert.match(handler, /sanitizeProviderKeyRow/);
  assert.match(handler, /key_label/);
  assert.match(handler, /au_provider_key_audit_logs/);
  assert.match(handler, /key_fingerprint/);
  assert.doesNotMatch(handler, /\{\s*ok:\s*true,\s*key:\s*data/);
  assert.doesNotMatch(handler, /select\('\*'\)/);
  assert.doesNotMatch(conexPage, /selectedKey\.key_value/);
  assert.doesNotMatch(conexPage, /k\.key_value/);
  assert.doesNotMatch(conexPage, /localStorage\.getItem\('conex_admin_token'\)/);
  assert.doesNotMatch(conexPage, /localStorage\.setItem\('conex_admin_token'/);
  assert.doesNotMatch(conexPage, /X-Admin-Token/);
  assert.doesNotMatch(adminFetch, /localStorage\.getItem\('conex_admin_token'\)/);
  assert.doesNotMatch(adminFetch, /X-Admin-Token/);
  assert.doesNotMatch(featureFlags, /conex_admin_token/);
  assert.match(adminAuth, /sanitizeCredentialPayload/);
  assert.doesNotMatch(adminAuth, /select\('\*'\)/);
  assert.doesNotMatch(adminAuth, /Non-JSON response from Edge Function:',\s*text/);
  assert.match(conexPage, /Leave blank to keep existing key/);
});

test('tracked and public files do not contain high-confidence raw secret values', () => {
  const trackedFiles = execFileSync('git', ['ls-files'], { encoding: 'utf8' })
    .split('\n')
    .map((file) => file.trim())
    .filter(Boolean);
  const highConfidencePatterns: Array<[RegExp, string]> = [
    [/\beyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g, 'jwt'],
    [/\bsk-[A-Za-z0-9_-]{12,}\b/g, 'provider_key'],
    [/\bsb_secret_[A-Za-z0-9_-]{12,}\b/g, 'supabase_secret'],
  ];
  const findings: string[] = [];

  for (const file of trackedFiles) {
    let text = '';
    try {
      text = readFileSync(path.join(process.cwd(), file), 'utf8');
    } catch {
      continue;
    }
    for (const [pattern, label] of highConfidencePatterns) {
      if (pattern.test(text)) {
        findings.push(`${label}:${file}`);
      }
      pattern.lastIndex = 0;
    }
  }

  assert.deepEqual(findings, []);
});

test('service worker and public assets do not carry credential plumbing', () => {
  const publicFiles = execFileSync('git', ['ls-files', 'public'], { encoding: 'utf8' })
    .split('\n')
    .map((file) => file.trim())
    .filter(Boolean);
  const findings: string[] = [];

  for (const file of publicFiles) {
    if (!existsSync(path.join(process.cwd(), file))) continue;
    const text = readFileSync(path.join(process.cwd(), file), 'utf8');
    if (/Authorization|Bearer|service_role|SUPABASE_SERVICE_ROLE|OPENAI_API_KEY|OPENROUTER_API_KEY|ANTHROPIC_API_KEY|QDRANT_API_KEY|VPS_SHARED_SECRET/i.test(text)) {
      findings.push(file);
    }
  }

  assert.deepEqual(findings, []);
});

test('auth and worker diagnostics do not log token or document text previews', () => {
  const proxyAuth = readRepoFile('src', 'app', 'api', 'proxy', '_supabase-auth.ts');
  const worker = readRepoFile('rag-worker', 'src', 'worker.ts');
  const ingestion = readRepoFile('rag-worker', 'src', 'ingestion.ts');
  assert.doesNotMatch(proxyAuth, /tokenPreview/);
  assert.doesNotMatch(proxyAuth, /token\.slice/);
  assert.doesNotMatch(worker, /preview:\s*text\.slice/);
  assert.doesNotMatch(ingestion, /textPreview/);
});

test('source cleanup is owner and path bound with bounded attempts', () => {
  const cleanup = readRepoFile('rag-worker', 'src', 'source-cleanup.ts');
  const worker = readRepoFile('rag-worker', 'src', 'worker.ts');
  assert.match(cleanup, /expectedOwnerId/);
  assert.match(cleanup, /owner_mismatch/);
  assert.match(cleanup, /path_mismatch/);
  assert.match(cleanup, /max_attempts_exceeded/);
  assert.match(worker, /expectedOwnerId:\s*String\(job\.owner_id \|\| job\.user_id/);
});

test('legacy permissive service-role RLS policies are narrowed to service_role in the final schema', () => {
  const migration = readRepoFile(
    'supabase',
    'migrations',
    '20260902165500_scope_service_role_rls_policies.sql',
  );

  for (const [policyName, relation] of [
    ['Service role full access conex config', 'public.au_conex_config'],
    ['Service role only stripe events', 'public.au_stripe_events'],
    ['Service role can manage events', 'public.au_events'],
  ] as const) {
    assert.ok(migration.includes(`to_regclass('${relation}') IS NOT NULL`));
    assert.ok(migration.includes(`DROP POLICY IF EXISTS \"${policyName}\"`));
    const marker = `CREATE POLICY \"${policyName}\"`;
    const policyStart = migration.indexOf(marker);
    assert.ok(policyStart >= 0, `missing replacement policy ${policyName}`);
    const nextPolicy = migration.indexOf('CREATE POLICY', policyStart + marker.length);
    const policySql = migration.slice(policyStart, nextPolicy >= 0 ? nextPolicy : migration.length);
    assert.match(policySql, /\bTO\s+service_role\b/i);
    assert.match(policySql, /USING\s*\(TRUE\)/i);
    assert.match(policySql, /WITH CHECK\s*\(TRUE\)/i);
  }
});

test('authenticated profile updates cannot mutate authorization or billing-controlled columns', () => {
  const identityMigration = readRepoFile(
    'supabase',
    'migrations',
    '20260205000000_placeholder.sql',
  );
  const roleMigration = readRepoFile(
    'supabase',
    'migrations',
    '20260206000007_placeholder.sql',
  );
  const hardeningMigration = readRepoFile(
    'supabase',
    'migrations',
    '20260902194500_protect_profile_privileged_columns.sql',
  );

  assert.match(identityMigration, /Users can update own profile/);
  assert.match(roleMigration, /ADD COLUMN IF NOT EXISTS role TEXT DEFAULT 'user'/);
  assert.match(hardeningMigration, /REVOKE UPDATE ON TABLE public\.au_user_profiles FROM anon, authenticated/i);
  assert.match(hardeningMigration, /GRANT UPDATE \(full_name, avatar_url\) ON TABLE public\.au_user_profiles TO authenticated/i);
  for (const protectedColumn of [
    'role',
    'tier',
    'stripe_customer_id',
    'stripe_subscription_id',
    'stripe_price_id',
    'stripe_current_period_end',
    'stripe_status',
  ]) {
    assert.doesNotMatch(
      hardeningMigration,
      new RegExp(`GRANT UPDATE \\([^)]*\\b${protectedColumn}\\b`, 'i'),
      `privileged profile column ${protectedColumn} must not be browser-updatable`,
    );
  }
});

test('document completion binds worker ingestion to the persisted owner-scoped storage object', () => {
  const route = readRepoFile('src', 'app', 'api', 'au', 'document-upload', 'route.ts');

  assert.match(route, /select\('id,file_name,file_path,file_size_bytes,bucket'\)/);
  assert.match(route, /\.eq\('id', documentId\)[\s\S]*\.eq\('user_id', userId\)[\s\S]*\.maybeSingle\(\)/);
  assert.match(route, /const objectPath = String\(ownedDocument\.file_path \|\| ''\)\.trim\(\)/);
  assert.match(route, /const bucket = String\(ownedDocument\.bucket \|\| DEFAULT_BUCKET\)\.trim\(\)/);
  assert.match(route, /const expectedPrefix = `uploads\/\$\{userId\}\/\$\{documentId\}\//);
  assert.match(route, /!objectPath\.startsWith\(expectedPrefix\)/);
  assert.match(route, /bucket !== DEFAULT_BUCKET/);
  assert.match(route, /object_path:\s*objectPath/);
  assert.doesNotMatch(route, /const objectPath = String\(body\.path/);
  assert.doesNotMatch(route, /const bucket = String\(body\.bucket/);
  assert.doesNotMatch(route, /updatePayload\.file_path\s*=\s*objectPath/);
});
