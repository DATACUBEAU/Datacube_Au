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
function readImportedWorkerFileName(swText) {
    const workerFileName = swText.match(/\/(worker-[a-f0-9]+\.js)/i)?.[1];
    strict_1.default.ok(workerFileName, 'expected sw.js to import a hashed worker helper file');
    return workerFileName;
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
(0, node_test_1.default)('service worker cache policy excludes protected app pages and APIs', async () => {
    const nextConfigText = (0, node_fs_1.readFileSync)(node_path_1.default.join(process.cwd(), 'next.config.ts'), 'utf8');
    const policyText = (0, node_fs_1.readFileSync)(node_path_1.default.join(process.cwd(), 'shared', 'pwa-cache-policy.js'), 'utf8');
    const workerSourceText = (0, node_fs_1.readFileSync)(node_path_1.default.join(process.cwd(), 'worker', 'index.js'), 'utf8');
    const serviceWorkerClientText = (0, node_fs_1.readFileSync)(node_path_1.default.join(process.cwd(), 'src', 'lib', 'pwa', 'service-worker-client.ts'), 'utf8');
    strict_1.default.equal(policyText.includes("'/dashboard'"), true);
    strict_1.default.equal(policyText.includes("'/api/entitlements'"), true);
    strict_1.default.equal(policyText.includes("'/api/feature-output'"), true);
    strict_1.default.equal(policyText.includes("'/dashboard/documents'"), false);
    strict_1.default.equal(policyText.includes("'/dashboard/settings/subscription'"), false);
    strict_1.default.equal(nextConfigText.includes('app\\/dashboard'), true);
    const swText = (0, node_fs_1.readFileSync)(node_path_1.default.join(process.cwd(), 'public', 'sw.js'), 'utf8');
    const workerFileName = readImportedWorkerFileName(swText);
    const workerText = (0, node_fs_1.readFileSync)(node_path_1.default.join(process.cwd(), 'public', workerFileName), 'utf8');
    const runtimeVersion = readRuntimeVersion();
    strict_1.default.equal(workerSourceText.includes('isPwaCacheExcludedPathname(route)'), true);
    strict_1.default.equal(workerSourceText.includes('Cache-Control'), true);
    strict_1.default.equal(swText.includes('_pwacachepolicy'), false);
    strict_1.default.equal(workerText.includes('self._pwacachepolicy'), true);
    strict_1.default.equal(workerText.includes('__DCAU_PWA_RUNTIME_VERSION__'), true);
    strict_1.default.equal(workerText.includes(`"${runtimeVersion}"`), true);
    strict_1.default.equal(workerText.includes('__DCAU_PWA_CACHE_PATCHED__'), true);
    strict_1.default.equal(workerText.includes('PWA_RUNTIME_HEALTHCHECK'), true);
    strict_1.default.equal(workerSourceText.includes('self.fallback = async'), true);
    strict_1.default.equal(workerText.includes('SW_NETWORK_ERROR'), true);
    strict_1.default.equal(workerText.includes('Ignoring malformed request in fallback'), true);
    strict_1.default.equal(nextConfigText.includes('hasUsableRequestUrl'), false);
    strict_1.default.equal(nextConfigText.includes('describeWorkboxRequest'), false);
    strict_1.default.equal(nextConfigText.includes('buildServiceWorkerFailureResponse'), false);
    strict_1.default.equal(nextConfigText.includes('apiGetFailurePlugin'), true);
    strict_1.default.equal(nextConfigText.includes('apiPostFailurePlugin'), true);
    strict_1.default.equal(nextConfigText.includes("url.pathname.startsWith('/api/')"), true);
    strict_1.default.match(nextConfigText, /handler:\s*'NetworkOnly'/);
    strict_1.default.match(swText, /pathname\.startsWith\("\/api\/"\).*new e\.NetworkOnly/s);
    strict_1.default.equal(swText.includes('hasUsableRequestUrl'), false);
    strict_1.default.equal(swText.includes('describeWorkboxRequest'), false);
    strict_1.default.equal(swText.includes('buildServiceWorkerFailureResponse'), false);
    strict_1.default.equal(swText.includes('Malformed request intercepted by the service worker.'), true);
    strict_1.default.equal(swText.includes('API GET request failed while handled by the service worker.'), true);
    strict_1.default.equal(swText.includes('if(a.startsWith("/api/"))return!1'), true);
    strict_1.default.equal(serviceWorkerClientText.includes("'hasUsableRequestUrl'"), true);
    strict_1.default.equal(serviceWorkerClientText.includes("'describeWorkboxRequest'"), true);
    strict_1.default.equal(serviceWorkerClientText.includes("'buildServiceWorkerFailureResponse'"), true);
    strict_1.default.match(serviceWorkerClientText, /BROKEN_SW_HELPER_SYMBOLS/);
    strict_1.default.match(serviceWorkerClientText, /hasDefinedServiceWorkerHelper/);
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
