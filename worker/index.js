import {
  PWA_OFFLINE_WARMUP_ROUTES,
  isPwaCacheExcludedPathname,
  shouldCacheNextDataPath,
} from '../shared/pwa-cache-policy.js';
import {
  PWA_RUNTIME_CACHE_NAMES,
  PWA_RUNTIME_CACHE_VERSION,
  shouldDeleteStalePwaCacheName,
  versionPwaCacheName,
} from '../shared/pwa-runtime.js';

const PAGE_CACHE_NAME = PWA_RUNTIME_CACHE_NAMES.pages;

const rawCacheStorage = self.caches;
const rawOpenCache = rawCacheStorage?.open?.bind(rawCacheStorage);
const rawDeleteCache = rawCacheStorage?.delete?.bind(rawCacheStorage);
const rawHasCache = typeof rawCacheStorage?.has === 'function'
  ? rawCacheStorage.has.bind(rawCacheStorage)
  : null;
const rawMatchCache = rawCacheStorage?.match?.bind(rawCacheStorage);

function normalizeRuntimeCacheName(cacheName) {
  if (typeof cacheName !== 'string') return cacheName;
  return versionPwaCacheName(cacheName, PWA_RUNTIME_CACHE_VERSION);
}

if (rawCacheStorage && !self.__DCAU_PWA_CACHE_PATCHED__) {
  try {
    self.__DCAU_PWA_CACHE_PATCHED__ = true;

    rawCacheStorage.open = (cacheName) => rawOpenCache(normalizeRuntimeCacheName(cacheName));
    rawCacheStorage.delete = (cacheName) => rawDeleteCache(normalizeRuntimeCacheName(cacheName));

    if (rawHasCache) {
      rawCacheStorage.has = (cacheName) => rawHasCache(normalizeRuntimeCacheName(cacheName));
    }

    if (rawMatchCache) {
      rawCacheStorage.match = (request, options) => {
        if (!options?.cacheName) return rawMatchCache(request, options);
        return rawMatchCache(request, {
          ...options,
          cacheName: normalizeRuntimeCacheName(options.cacheName),
        });
      };
    }
  } catch {
    // CacheStorage monkey patching is best-effort; the compatibility shim still keeps the worker alive.
  }
}

self.__DCAU_PWA_RUNTIME_VERSION__ = PWA_RUNTIME_CACHE_VERSION;
self._pwacachepolicy = {
  isPwaCacheExcludedPathname,
  shouldCacheNextDataPath,
};

async function cleanupStaleRuntimeCaches() {
  if (!rawCacheStorage || !rawDeleteCache) return;

  const cacheNames = await rawCacheStorage.keys().catch(() => []);
  await Promise.all(
    cacheNames
      .filter((cacheName) => shouldDeleteStalePwaCacheName(cacheName, PWA_RUNTIME_CACHE_VERSION))
      .map((cacheName) => rawDeleteCache(cacheName).catch(() => false)),
  );
}

async function warmOfflinePages() {
  const cache = await caches.open(PAGE_CACHE_NAME);

  // Keep warmup sequential to avoid saturating bandwidth and slowing active navigation.
  for (const route of PWA_OFFLINE_WARMUP_ROUTES) {
    try {
      const requestUrl = new URL(route, self.location.origin).toString();
      const request = new Request(requestUrl, {
        method: "GET",
        credentials: "same-origin",
      });

      const response = await fetch(request, { cache: "reload" });
      if (!response || (!response.ok && response.type !== "opaqueredirect")) continue;

      const cacheable =
        response.type === "opaqueredirect"
          ? new Response(response.body, {
              status: 200,
              statusText: "OK",
              headers: response.headers,
            })
          : response.clone();

      await cache.put(requestUrl, cacheable);
    } catch {
    }
  }
}

self.addEventListener("install", (event) => {
  event.waitUntil(warmOfflinePages());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(Promise.all([
    cleanupStaleRuntimeCaches(),
    warmOfflinePages(),
  ]));
});

self.addEventListener("message", (event) => {
  if (event?.data?.type === "SKIP_WAITING") {
    self.skipWaiting();
    return;
  }
  if (!event?.data || event.data.type !== "PWA_WARM_ROUTES") return;
  event.waitUntil(warmOfflinePages());
});
