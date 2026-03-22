import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { buildSnapshotFallbackFlags } from '../src/lib/feature-flags/client-fallback.js';
import {
  normalizePersistedUploadJobs,
  serializePersistedUploadJobs,
} from '../src/lib/upload/job-cache.js';

test('service worker cache policy keeps dashboard offline routes warm without excluding app pages', async () => {
  const policyText = readFileSync(path.join(process.cwd(), 'shared', 'pwa-cache-policy.js'), 'utf8');
  assert.equal(policyText.includes("'/dashboard/documents'"), true);
  assert.equal(policyText.includes("'/dashboard/settings/subscription'"), true);
  assert.equal(policyText.includes("['/conex']"), true);

  const swText = readFileSync(path.join(process.cwd(), 'public', 'sw.js'), 'utf8');
  assert.equal(swText.includes('"/dashboard"===a||a.startsWith("/dashboard/")'), false);
  assert.equal(swText.includes('"/dashboard"===s||s.startsWith("/dashboard/")'), false);
  assert.equal(swText.includes('"/conex"===a||a.startsWith("/conex/")'), true);
  assert.equal(swText.includes('"/conex"===s||s.startsWith("/conex/")'), true);
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
