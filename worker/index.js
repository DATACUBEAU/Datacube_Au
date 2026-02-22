const PAGE_CACHE_NAME = "pages";

// Warm core routes so cold offline launches can open app sections immediately.
const OFFLINE_WARMUP_ROUTES = [
  "/",
  "/about",
  "/features",
  "/policy",
  "/login",
  "/dashboard",
  "/dashboard/documents",
  "/dashboard/chat",
  "/dashboard/global-chat",
  "/dashboard/knowledge",
  "/dashboard/messages",
  "/dashboard/predictions",
  "/dashboard/practice",
  "/dashboard/settings",
  "/dashboard/settings/subscription",
  "/offline",
  "/~offline",
  "/403",
  "/conex",
];

async function warmOfflinePages() {
  const cache = await caches.open(PAGE_CACHE_NAME);

  // Keep warmup sequential to avoid saturating bandwidth and slowing active navigation.
  for (const route of OFFLINE_WARMUP_ROUTES) {
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
  if (!event?.data || event.data.type !== "PWA_WARM_ROUTES") return;
  event.waitUntil(warmOfflinePages());
});
