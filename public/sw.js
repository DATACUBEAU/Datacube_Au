const CACHE_NAME = 'datacube-au-cache-v1';

/**
 * ONLY cache truly static, public, non-user-specific assets
 */
const urlsToCache = [
  '/',
  '/about',
  '/features',
  '/login',
  '/manifest.webmanifest',
  '/icon.png',
];

/* ================= INSTALL ================= */
self.addEventListener('install', (event) => {
  self.skipWaiting();

  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(urlsToCache))
  );
});

/* ================= ACTIVATE ================= */
self.addEventListener('activate', (event) => {
  event.waitUntil(
    Promise.all([
      caches.keys().then((keys) =>
        Promise.all(
          keys.map((key) => {
            if (key !== CACHE_NAME) {
              return caches.delete(key);
            }
          })
        )
      ),
      self.clients.claim(),
    ])
  );
});

/* ================= FETCH ================= */
self.addEventListener('fetch', (event) => {
  const { request } = event;

  // 🚫 NEVER touch APIs, uploads, or non-GET
  if (
    request.method !== 'GET' ||
    request.url.includes('/api/') ||
    request.url.includes('/auth/v1/') ||
    request.url.includes('/rest/v1/') ||
    request.url.includes('/storage/v1/') ||
    request.url.includes('/functions/v1/') ||
    request.url.includes('supabase.co')
  ) {
    return;
  }

  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;

      return fetch(request)
        .then((response) => {
          if (
            !response ||
            response.status !== 200 ||
            response.type === 'opaque'
          ) {
            return response;
          }

          const responseClone = response.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(request, responseClone);
          });

          return response;
        })
        .catch(() => {
          // Optional offline fallback
          // return caches.match('/');
        });
    })
  );
});
