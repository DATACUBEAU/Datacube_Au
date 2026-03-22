import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
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

test('service worker cache policy keeps dashboard offline routes warm without excluding app pages', async () => {
  const policyText = readFileSync(path.join(process.cwd(), 'shared', 'pwa-cache-policy.js'), 'utf8');
  assert.equal(policyText.includes("'/dashboard/documents'"), true);
  assert.equal(policyText.includes("'/dashboard/settings/subscription'"), true);
  assert.equal(policyText.includes("['/conex']"), true);

  const swText = readFileSync(path.join(process.cwd(), 'public', 'sw.js'), 'utf8');
  const workerFileName = readdirSync(path.join(process.cwd(), 'public')).find((entry) => /^worker-.*\.js$/i.test(entry));
  assert.ok(workerFileName, 'expected a generated worker helper file in public/');
  const workerText = readFileSync(path.join(process.cwd(), 'public', workerFileName!), 'utf8');
  const runtimeVersion = readRuntimeVersion();

  assert.equal(swText.includes('"/dashboard"===a||a.startsWith("/dashboard/")'), false);
  assert.equal(swText.includes('"/dashboard"===s||s.startsWith("/dashboard/")'), false);
  assert.equal(swText.includes('_pwacachepolicy'), false);
  assert.equal(workerText.includes('self._pwacachepolicy'), true);
  assert.equal(workerText.includes('__DCAU_PWA_RUNTIME_VERSION__'), true);
  assert.equal(workerText.includes(`"${runtimeVersion}"`), true);
  assert.equal(workerText.includes('__DCAU_PWA_CACHE_PATCHED__'), true);
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
