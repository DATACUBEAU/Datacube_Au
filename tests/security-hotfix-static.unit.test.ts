import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

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
  assert.match(handler, /requireConexAdmin\(req\)/);
  assert.doesNotMatch(handler, /from\('au_api_keys'\)\.select\('\*'\)/);
  assert.match(handler, /sanitizeProviderKeyRow/);
  assert.match(handler, /key_label/);
  assert.doesNotMatch(handler, /\{\s*ok:\s*true,\s*key:\s*data/);
  assert.doesNotMatch(conexPage, /selectedKey\.key_value/);
  assert.doesNotMatch(conexPage, /k\.key_value/);
  assert.match(conexPage, /Leave blank to keep existing key/);
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
