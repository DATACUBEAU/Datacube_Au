import { PWA_OFFLINE_WARMUP_ROUTES } from '../shared/pwa-cache-policy.js';

const PAGE_CACHE_NAME = "pages";

// Compatibility shim for older generated sw.js builds that referenced this helper.
function isProtectedAppPath(pathname) {
  const safePath = typeof pathname === "string" ? pathname : "";
  return (
    safePath === "/dashboard" ||
    safePath.startsWith("/dashboard/") ||
    safePath === "/conex" ||
    safePath.startsWith("/conex/")
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
  event.waitUntil(warmOfflinePages());
});

self.addEventListener("message", (event) => {
  if (event?.data?.type === "SKIP_WAITING") {
    self.skipWaiting();
    return;
  }
  if (!event?.data || event.data.type !== "PWA_WARM_ROUTES") return;
  event.waitUntil(warmOfflinePages());
});
