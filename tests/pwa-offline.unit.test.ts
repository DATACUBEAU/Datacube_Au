import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { buildSnapshotFallbackFlags } from '../src/lib/feature-flags/client-fallback.js';
import {
  normalizePersistedUploadJobs,
  serializePersistedUploadJobs,
} from '../src/lib/upload/job-cache.js';

function readRuntimeVersion(): string {
  const runtimeText = readFileSync(path.join(process.cwd(), 'shared', 'pwa-runtime.js'), 'utf8');
  const version = runtimeText.match(/PWA_RUNTIME_CACHE_VERSION = '([^']+)'/)?.[1];
  assert.ok(version, 'expected PWA runtime cache version in shared/pwa-runtime.js');
  return version;
}

function readImportedWorkerFileName(swText: string): string {
  const workerFileName = swText.match(/\/(worker-[a-f0-9]+\.js)/i)?.[1];
  assert.ok(workerFileName, 'expected sw.js to import a hashed worker helper file');
  return workerFileName!;
}

function versionPwaCacheName(cacheName: string, version: string): string {
  const normalized = String(cacheName || '').trim();
  if (!normalized) return normalized;
  const suffix = `-v${version}`;
  return normalized.endsWith(suffix) ? normalized : `${normalized}${suffix}`;
}

function shouldDeleteStalePwaCacheName(cacheName: string, version: string): boolean {
  const normalized = String(cacheName || '').trim();
  if (!normalized) return false;
  if (normalized === 'pages') return true;
  if (!normalized.startsWith('pages-v')) return false;
  return normalized !== versionPwaCacheName('pages', version);
}

test('service worker cache policy excludes protected app pages and APIs', async () => {
  const nextConfigText = readFileSync(path.join(process.cwd(), 'next.config.ts'), 'utf8');
  const policyText = readFileSync(path.join(process.cwd(), 'shared', 'pwa-cache-policy.js'), 'utf8');
  const workerSourceText = readFileSync(path.join(process.cwd(), 'worker', 'index.js'), 'utf8');
  const serviceWorkerClientText = readFileSync(path.join(process.cwd(), 'src', 'lib', 'pwa', 'service-worker-client.ts'), 'utf8');
  assert.equal(policyText.includes("'/dashboard'"), true);
  assert.equal(policyText.includes("'/api/entitlements'"), true);
  assert.equal(policyText.includes("'/api/feature-output'"), true);
  assert.equal(policyText.includes("'/dashboard/documents'"), false);
  assert.equal(policyText.includes("'/dashboard/settings/subscription'"), false);
  assert.equal(nextConfigText.includes('app\\/dashboard'), true);

  const swText = readFileSync(path.join(process.cwd(), 'public', 'sw.js'), 'utf8');
  const workerFileName = readImportedWorkerFileName(swText);
  const workerText = readFileSync(path.join(process.cwd(), 'public', workerFileName!), 'utf8');
  const runtimeVersion = readRuntimeVersion();

  assert.equal(workerSourceText.includes('isPwaCacheExcludedPathname(route)'), true);
  assert.equal(workerSourceText.includes('Cache-Control'), true);
  assert.equal(swText.includes('_pwacachepolicy'), false);
  assert.equal(workerText.includes('self._pwacachepolicy'), true);
  assert.equal(workerText.includes('__DCAU_PWA_RUNTIME_VERSION__'), true);
  assert.equal(workerText.includes(`"${runtimeVersion}"`), true);
  assert.equal(workerText.includes('__DCAU_PWA_CACHE_PATCHED__'), true);
  assert.equal(workerText.includes('PWA_RUNTIME_HEALTHCHECK'), true);
  assert.equal(workerSourceText.includes('self.fallback = async'), true);
  assert.equal(workerText.includes('SW_NETWORK_ERROR'), true);
  assert.equal(workerText.includes('Ignoring malformed request in fallback'), true);
  assert.equal(nextConfigText.includes('hasUsableRequestUrl'), false);
  assert.equal(nextConfigText.includes('describeWorkboxRequest'), false);
  assert.equal(nextConfigText.includes('buildServiceWorkerFailureResponse'), false);
  assert.equal(nextConfigText.includes('apiGetFailurePlugin'), true);
  assert.equal(nextConfigText.includes('apiPostFailurePlugin'), true);
  assert.equal(nextConfigText.includes("url.pathname.startsWith('/api/')"), true);
  assert.match(nextConfigText, /handler:\s*'NetworkOnly'/);
  assert.match(swText, /pathname\.startsWith\("\/api\/"\).*new e\.NetworkOnly/s);
  assert.equal(swText.includes('hasUsableRequestUrl'), false);
  assert.equal(swText.includes('describeWorkboxRequest'), false);
  assert.equal(swText.includes('buildServiceWorkerFailureResponse'), false);
  assert.equal(swText.includes('Malformed request intercepted by the service worker.'), true);
  assert.equal(swText.includes('API GET request failed while handled by the service worker.'), true);
  assert.equal(swText.includes('if(a.startsWith("/api/"))return!1'), true);
  assert.equal(serviceWorkerClientText.includes("'hasUsableRequestUrl'"), true);
  assert.equal(serviceWorkerClientText.includes("'describeWorkboxRequest'"), true);
  assert.equal(serviceWorkerClientText.includes("'buildServiceWorkerFailureResponse'"), true);
  assert.match(serviceWorkerClientText, /BROKEN_SW_HELPER_SYMBOLS/);
  assert.match(serviceWorkerClientText, /hasDefinedServiceWorkerHelper/);
});

test('stale service-worker runtime caches are versioned and old names are invalidated', async () => {
  const runtimeVersion = readRuntimeVersion();
  const currentPagesCache = versionPwaCacheName('pages', runtimeVersion);
  assert.equal(currentPagesCache.endsWith(`-v${runtimeVersion}`), true);
  assert.equal(shouldDeleteStalePwaCacheName('pages', runtimeVersion), true);
  assert.equal(shouldDeleteStalePwaCacheName(currentPagesCache, runtimeVersion), false);
  assert.equal(shouldDeleteStalePwaCacheName('pages-v20260320-1', runtimeVersion), true);
  assert.equal(shouldDeleteStalePwaCacheName('custom-cache', runtimeVersion), false);
});

test('snapshot-backed billing flags stay enabled when remote feature rows are unavailable', () => {
  const flags = buildSnapshotFallbackFlags({
    entitlements: {
      billingEnabled: true,
      promoEnabled: false,
    },
  });

  assert.deepEqual(flags, {
    billing_enabled: true,
    paid_mode_enabled: true,
    promo_enabled: false,
  });
});

test('persisted upload jobs keep same-user queued metadata across refresh', () => {
  const userId = 'user-1';
  const jobs = normalizePersistedUploadJobs(
    {
      jobs: [
        {
          id: 'job-1',
          user_id: userId,
          owner_id: userId,
          document_id: 'doc-1',
          file_name: 'lecture-notes.pdf',
          bucket: 'documents',
          object_path: '',
          status: 'queued',
          progress: 100,
          created_at: '2026-03-22T09:00:00.000Z',
          updated_at: '2026-03-22T09:00:00.000Z',
        },
        {
          id: 'job-1',
          user_id: userId,
          owner_id: userId,
          document_id: 'doc-1',
          file_name: 'lecture-notes.pdf',
          bucket: 'documents',
          object_path: '',
          status: 'processing',
          progress: 100,
          created_at: '2026-03-22T09:00:00.000Z',
          updated_at: '2026-03-22T09:05:00.000Z',
        },
        {
          id: 'job-2',
          user_id: 'user-2',
          owner_id: 'user-2',
          document_id: 'doc-2',
          file_name: 'other.pdf',
          bucket: 'documents',
          object_path: '',
          status: 'queued',
          progress: 0,
          created_at: '2026-03-22T09:00:00.000Z',
          updated_at: '2026-03-22T09:00:00.000Z',
        },
      ],
    },
    userId,
  );

  assert.equal(jobs.length, 1);
  assert.equal(jobs[0]?.id, 'job-1');
  assert.equal(jobs[0]?.status, 'processing');

  const serialized = serializePersistedUploadJobs(jobs);
  assert.deepEqual(serialized.jobs.map((job) => job.id), ['job-1']);
});
