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
const originalFallback = typeof self.fallback === "function" ? self.fallback.bind(self) : null;

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

function readRequestUrl(request) {
  return typeof request?.url === "string" ? request.url.trim() : "";
}

function tryParseRequestUrl(request) {
  const requestUrl = readRequestUrl(request);
  if (!requestUrl) return null;

  try {
    return new URL(requestUrl, self.location.origin);
  } catch {
    return null;
  }
}

function isHttpRequestUrl(url) {
  return Boolean(url && (url.protocol === "http:" || url.protocol === "https:"));
}

function isApiRequest(request, url) {
  if (!request || !url) return false;
  return url.origin === self.location.origin && url.pathname.startsWith("/api/");
}

function isNextDataRequest(url) {
  return Boolean(url && /\/_next\/data\/.+\/.+\.json$/i.test(url.pathname));
}

function serializeRequestHeaders(request) {
  try {
    return Object.fromEntries(request?.headers?.entries?.() ?? []);
  } catch {
    return {};
  }
}

function buildServiceWorkerNetworkFailureResponse(request, input = {}) {
  const url = tryParseRequestUrl(request);
  const accept = String(request?.headers?.get?.("accept") || "").toLowerCase();
  const wantsJson =
    input.forceJson === true ||
    request?.destination === "" ||
    accept.includes("application/json") ||
    accept.includes("text/event-stream") ||
    isApiRequest(request, url) ||
    isNextDataRequest(url);

  const payload = {
    ok: false,
    code: "SW_NETWORK_ERROR",
    message: String(input.message || "Network request failed in service worker."),
    offline: true,
    url: url?.toString() || readRequestUrl(request) || null,
    method: String(request?.method || "GET"),
    stage: String(input.stage || "network_failure"),
  };

  return new Response(
    wantsJson ? JSON.stringify(payload) : payload.message,
    {
      status: Number(input.status || 503),
      headers: {
        "Content-Type": wantsJson ? "application/json; charset=utf-8" : "text/plain; charset=utf-8",
        "Cache-Control": "no-store",
        "x-dcau-sw": "network-fallback",
        "x-dcau-sw-stage": payload.stage,
      },
    },
  );
}

self.fallback = async (request) => {
  const requestUrl = readRequestUrl(request);
  const url = tryParseRequestUrl(request);
  const destination = typeof request?.destination === "string" ? request.destination : "";

  if (!requestUrl || !isHttpRequestUrl(url)) {
    console.warn("[SW] Ignoring malformed request in fallback", {
      url: requestUrl,
      method: request?.method || "GET",
      destination,
      headers: serializeRequestHeaders(request),
    });
    return buildServiceWorkerNetworkFailureResponse(request, {
      stage: "malformed_request",
      message: "Malformed request intercepted by service worker.",
      forceJson: true,
    });
  }

  if (isApiRequest(request, url)) {
    console.warn("[SW] Returning typed API fallback response", {
      url: url.toString(),
      method: request?.method || "GET",
      destination,
      headers: serializeRequestHeaders(request),
    });
    return buildServiceWorkerNetworkFailureResponse(request, {
      stage: "api_network_failure",
      message: "API request failed while handled by the service worker.",
      forceJson: true,
    });
  }

  if (destination === "" && !isNextDataRequest(url)) {
    return buildServiceWorkerNetworkFailureResponse(request, {
      stage: "generic_fetch_failure",
      message: "Fetch request failed while handled by the service worker.",
      forceJson: true,
    });
  }

  if (originalFallback) {
    const fallbackResponse = await originalFallback(request);
    if (fallbackResponse) return fallbackResponse;
  }

  return buildServiceWorkerNetworkFailureResponse(request, {
    stage: "fallback_unavailable",
    message: "No offline fallback response was available.",
    forceJson: destination === "",
  });
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
  if (event?.data?.type === "PWA_RUNTIME_HEALTHCHECK") {
    const response = {
      ok: true,
      version: PWA_RUNTIME_CACHE_VERSION,
      hasPolicyShim:
        typeof self._pwacachepolicy?.isPwaCacheExcludedPathname === "function" &&
        typeof self._pwacachepolicy?.shouldCacheNextDataPath === "function",
    };

    if (event.ports?.[0]) {
      event.ports[0].postMessage(response);
      return;
    }

    if (event.source && typeof event.source.postMessage === "function") {
      event.source.postMessage({
        type: "PWA_RUNTIME_HEALTHCHECK_RESULT",
        ...response,
      });
    }
    return;
  }
  if (event?.data?.type === "SKIP_WAITING") {
    self.skipWaiting();
    return;
  }
  if (!event?.data || event.data.type !== "PWA_WARM_ROUTES") return;
  event.waitUntil(warmOfflinePages());
});
