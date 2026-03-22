"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = __importDefault(require("node:test"));
const strict_1 = __importDefault(require("node:assert/strict"));
const node_fs_1 = require("node:fs");
const node_path_1 = __importDefault(require("node:path"));
const client_fallback_js_1 = require("../src/lib/feature-flags/client-fallback.js");
const job_cache_js_1 = require("../src/lib/upload/job-cache.js");
function readRuntimeVersion() {
    const runtimeText = (0, node_fs_1.readFileSync)(node_path_1.default.join(process.cwd(), 'shared', 'pwa-runtime.js'), 'utf8');
    const version = runtimeText.match(/PWA_RUNTIME_CACHE_VERSION = '([^']+)'/)?.[1];
    strict_1.default.ok(version, 'expected PWA runtime cache version in shared/pwa-runtime.js');
    return version;
}
function versionPwaCacheName(cacheName, version) {
    const normalized = String(cacheName || '').trim();
    if (!normalized)
        return normalized;
    const suffix = `-v${version}`;
    return normalized.endsWith(suffix) ? normalized : `${normalized}${suffix}`;
}
function shouldDeleteStalePwaCacheName(cacheName, version) {
    const normalized = String(cacheName || '').trim();
    if (!normalized)
        return false;
    if (normalized === 'pages')
        return true;
    if (!normalized.startsWith('pages-v'))
        return false;
    return normalized !== versionPwaCacheName('pages', version);
}
(0, node_test_1.default)('service worker cache policy keeps dashboard offline routes warm without excluding app pages', async () => {
    const policyText = (0, node_fs_1.readFileSync)(node_path_1.default.join(process.cwd(), 'shared', 'pwa-cache-policy.js'), 'utf8');
    strict_1.default.equal(policyText.includes("'/dashboard/documents'"), true);
    strict_1.default.equal(policyText.includes("'/dashboard/settings/subscription'"), true);
    strict_1.default.equal(policyText.includes("['/conex']"), true);
    const swText = (0, node_fs_1.readFileSync)(node_path_1.default.join(process.cwd(), 'public', 'sw.js'), 'utf8');
    const workerFileName = (0, node_fs_1.readdirSync)(node_path_1.default.join(process.cwd(), 'public')).find((entry) => /^worker-.*\.js$/i.test(entry));
    strict_1.default.ok(workerFileName, 'expected a generated worker helper file in public/');
    const workerText = (0, node_fs_1.readFileSync)(node_path_1.default.join(process.cwd(), 'public', workerFileName), 'utf8');
    const runtimeVersion = readRuntimeVersion();
    strict_1.default.equal(swText.includes('"/dashboard"===a||a.startsWith("/dashboard/")'), false);
    strict_1.default.equal(swText.includes('"/dashboard"===s||s.startsWith("/dashboard/")'), false);
    strict_1.default.equal(swText.includes('_pwacachepolicy'), false);
    strict_1.default.equal(workerText.includes('self._pwacachepolicy'), true);
    strict_1.default.equal(workerText.includes('__DCAU_PWA_RUNTIME_VERSION__'), true);
    strict_1.default.equal(workerText.includes(`"${runtimeVersion}"`), true);
    strict_1.default.equal(workerText.includes('__DCAU_PWA_CACHE_PATCHED__'), true);
    strict_1.default.equal(workerText.includes('PWA_RUNTIME_HEALTHCHECK'), true);
});
(0, node_test_1.default)('stale service-worker runtime caches are versioned and old names are invalidated', async () => {
    const runtimeVersion = readRuntimeVersion();
    const currentPagesCache = versionPwaCacheName('pages', runtimeVersion);
    strict_1.default.equal(currentPagesCache.endsWith(`-v${runtimeVersion}`), true);
    strict_1.default.equal(shouldDeleteStalePwaCacheName('pages', runtimeVersion), true);
    strict_1.default.equal(shouldDeleteStalePwaCacheName(currentPagesCache, runtimeVersion), false);
    strict_1.default.equal(shouldDeleteStalePwaCacheName('pages-v20260320-1', runtimeVersion), true);
    strict_1.default.equal(shouldDeleteStalePwaCacheName('custom-cache', runtimeVersion), false);
});
(0, node_test_1.default)('snapshot-backed billing flags stay enabled when remote feature rows are unavailable', () => {
    const flags = (0, client_fallback_js_1.buildSnapshotFallbackFlags)({
        entitlements: {
            billingEnabled: true,
            promoEnabled: false,
        },
    });
    strict_1.default.deepEqual(flags, {
        billing_enabled: true,
        paid_mode_enabled: true,
        promo_enabled: false,
    });
});
(0, node_test_1.default)('persisted upload jobs keep same-user queued metadata across refresh', () => {
    const userId = 'user-1';
    const jobs = (0, job_cache_js_1.normalizePersistedUploadJobs)({
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
    }, userId);
    strict_1.default.equal(jobs.length, 1);
    strict_1.default.equal(jobs[0]?.id, 'job-1');
    strict_1.default.equal(jobs[0]?.status, 'processing');
    const serialized = (0, job_cache_js_1.serializePersistedUploadJobs)(jobs);
    strict_1.default.deepEqual(serialized.jobs.map((job) => job.id), ['job-1']);
});
