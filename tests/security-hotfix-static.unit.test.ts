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

test('in-repository auth diagnostics do not expose token previews; worker source is external', () => {
  const proxyAuth = readRepoFile('src', 'app', 'api', 'proxy', '_supabase-auth.ts');
  assert.doesNotMatch(proxyAuth, /tokenPreview/);
  assert.doesNotMatch(proxyAuth, /token\.slice/);
  assert.equal(existsSync(path.join(process.cwd(), 'rag-worker')), false);
});

test('RAG worker source is deployed separately and is not present in the web repository', () => {
  assert.equal(existsSync(path.join(process.cwd(), 'rag-worker')), false);
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

test('legacy document upload endpoint fails closed because documents are local-first', () => {
  const route = readRepoFile('src', 'app', 'api', 'au', 'document-upload', 'route.ts');

  assert.match(route, /DOCUMENTS_ARE_LOCAL/);
  assert.match(route, /status: 410/);
  assert.match(route, /export async function POST\(\)/);
  assert.match(route, /export async function GET\(\)/);
  assert.doesNotMatch(route, /createSignedUrl|storage\.from|from\('au_documents'\)|from\('au_worker_jobs'\)/);
});

test('retired document upload route returns a fixed safe response without provider diagnostics', () => {
  const route = readRepoFile('src', 'app', 'api', 'au', 'document-upload', 'route.ts');

  assert.match(route, /error: 'DOCUMENTS_ARE_LOCAL'/);
  assert.match(route, /code: 'DOCUMENTS_ARE_LOCAL'/);
  assert.match(route, /status: 410/);
  assert.match(route, /Cache-Control/);
  assert.doesNotMatch(route, /signed_url_failed|insert_failed|job_creation_failed|upload_failed/);
  assert.doesNotMatch(route, /error\?\.message|signedError\.message|insertError\.message|jobError\.message/);
});



test('production profile ACL migrations revoke all browser privilege escalation paths', () => {
  const initialAcl = readRepoFile(
    'supabase',
    'migrations',
    '20261116094720_protect_profile_privileged_columns.sql',
  );
  const finalAcl = readRepoFile(
    'supabase',
    'migrations',
    '20261116094903_restrict_profile_username_updates.sql',
  );

  assert.match(initialAcl, /REVOKE ALL PRIVILEGES ON TABLE public\.au_user_profiles FROM PUBLIC, anon, authenticated/i);
  assert.match(initialAcl, /GRANT SELECT ON TABLE public\.au_user_profiles TO authenticated/i);
  assert.match(initialAcl, /GRANT UPDATE \(full_name, avatar_url, username\)/i);
  assert.match(finalAcl, /REVOKE UPDATE \(username\) ON TABLE public\.au_user_profiles FROM authenticated/i);
  assert.doesNotMatch(finalAcl, /GRANT UPDATE/i);
});

test('same-repository Strix runs cannot report success when the scan credential is missing', () => {
  const workflow = readRepoFile('.github', 'workflows', 'strix-security-scan.yml');
  assert.match(workflow, /IS_FORK_PR:/);
  assert.match(workflow, /Fork pull requests cannot receive repository secrets/);
  assert.match(workflow, /same-repository pull requests and manual runs; refusing a false-green security result/);
  assert.doesNotMatch(workflow, /Pull-request scan is non-blocking while Strix is unconfigured/);
  const missingCredentialBlock = workflow.match(/if \[ -z "\$\{LLM_API_KEY:-\}" \]; then[\s\S]+?echo "configured=true"/)?.[0] || '';
  assert.match(missingCredentialBlock, /exit 1/);
});
