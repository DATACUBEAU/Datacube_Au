export const PWA_RUNTIME_CACHE_VERSION = '20260322-1';

export const PWA_RUNTIME_CACHE_BASE_NAMES = Object.freeze([
  'start-url',
  'api-get-no-cache',
  'post-no-cache',
  'put-no-cache',
  'patch-no-cache',
  'delete-no-cache',
  'static-assets',
  'supabase-no-cache',
  'health-no-cache',
  'manifest-cache',
  'google-pixel-no-cache',
  'gtm-no-cache',
  'next-data',
  'pages-rsc-prefetch',
  'pages-rsc',
  'pages',
]);

export function versionPwaCacheName(cacheName, version = PWA_RUNTIME_CACHE_VERSION) {
  const normalized = typeof cacheName === 'string' ? cacheName.trim() : '';
  if (!normalized) return normalized;
  const suffix = `-v${version}`;
  if (normalized.endsWith(suffix)) return normalized;
  return `${normalized}${suffix}`;
}

export const PWA_RUNTIME_CACHE_NAMES = Object.freeze(
  Object.fromEntries(
    PWA_RUNTIME_CACHE_BASE_NAMES.map((baseName) => [baseName, versionPwaCacheName(baseName)]),
  ),
);

export function isKnownPwaRuntimeCacheName(cacheName) {
  const normalized = typeof cacheName === 'string' ? cacheName.trim() : '';
  if (!normalized) return false;
  return PWA_RUNTIME_CACHE_BASE_NAMES.some((baseName) => {
    return normalized === baseName || normalized.startsWith(`${baseName}-v`);
  });
}

export function shouldDeleteStalePwaCacheName(cacheName, version = PWA_RUNTIME_CACHE_VERSION) {
  const normalized = typeof cacheName === 'string' ? cacheName.trim() : '';
  if (!normalized) return false;
  if (!isKnownPwaRuntimeCacheName(normalized)) return false;

  return PWA_RUNTIME_CACHE_BASE_NAMES.some((baseName) => {
    if (normalized === baseName) return true;
    if (!normalized.startsWith(`${baseName}-v`)) return false;
    return normalized !== versionPwaCacheName(baseName, version);
  });
}

export function isCurrentPwaRuntimeCacheName(cacheName, version = PWA_RUNTIME_CACHE_VERSION) {
  const normalized = typeof cacheName === 'string' ? cacheName.trim() : '';
  if (!normalized) return false;
  return PWA_RUNTIME_CACHE_BASE_NAMES.some(
    (baseName) => normalized === versionPwaCacheName(baseName, version),
  );
}
