import type {NextConfig} from 'next';
import withPWAInit from '@ducanh2912/next-pwa';
import path from 'node:path';
import { PWA_RUNTIME_CACHE_NAMES } from './shared/pwa-runtime.js';

type WorkboxRouteContext = {
  request: Request;
  url: URL;
  sameOrigin: boolean;
};

// Important: next-pwa serializes runtime matchers/plugins into sw.js.
// Keep every callback self-contained and free of closed-over helpers.

const apiGetFailurePlugin = {
  handlerDidError: async ({ request, error }: { request: Request; error: Error }) => {
    let snapshot: {
      url: string;
      method: string;
      destination: string;
      mode: string;
      headers: Record<string, string>;
    };

    try {
      snapshot = {
        url: typeof request?.url === 'string' ? request.url : '',
        method: request?.method || 'GET',
        destination: request?.destination || '',
        mode: request?.mode || 'same-origin',
        headers: Object.fromEntries(request?.headers?.entries?.() ?? []),
      };
    } catch {
      snapshot = {
        url: '',
        method: request?.method || 'GET',
        destination: request?.destination || '',
        mode: request?.mode || 'same-origin',
        headers: {},
      };
    }

    const isMalformed = !snapshot.url || !/^https?:/i.test(snapshot.url);
    const accept = String(request?.headers?.get?.('accept') || '').toLowerCase();
    const wantsJson =
      request?.destination === '' ||
      accept.includes('application/json') ||
      accept.includes('text/event-stream') ||
      snapshot.url.includes('/api/');

    if (isMalformed) {
      console.warn('[SW] Ignoring malformed API GET request', {
        ...snapshot,
        error: error?.message || String(error || 'unknown_error'),
      });
      return new Response(
        JSON.stringify({
          ok: false,
          code: 'SW_NETWORK_ERROR',
          message: 'Malformed request intercepted by the service worker.',
          offline: true,
          url: snapshot.url || null,
          method: snapshot.method,
          stage: 'malformed_request',
        }),
        {
          status: 503,
          headers: {
            'Content-Type': 'application/json; charset=utf-8',
            'Cache-Control': 'no-store',
            'x-dcau-sw': 'network-failure',
            'x-dcau-sw-stage': 'malformed_request',
          },
        },
      );
    }

    console.warn('[SW] API GET request failed', {
      ...snapshot,
      error: error?.message || String(error || 'unknown_error'),
    });
    const payload = {
      ok: false,
      code: 'SW_NETWORK_ERROR',
      message: 'API GET request failed while handled by the service worker.',
      offline: true,
      url: snapshot.url || null,
      method: snapshot.method,
      stage: 'api_get_failure',
    };
    return new Response(
      wantsJson ? JSON.stringify(payload) : payload.message,
      {
        status: 503,
        headers: {
          'Content-Type': wantsJson ? 'application/json; charset=utf-8' : 'text/plain; charset=utf-8',
          'Cache-Control': 'no-store',
          'x-dcau-sw': 'network-failure',
          'x-dcau-sw-stage': 'api_get_failure',
        },
      },
    );
  },
};

const apiPostFailurePlugin = {
  handlerDidError: async ({ request, error }: { request: Request; error: Error }) => {
    let snapshot: {
      url: string;
      method: string;
      destination: string;
      mode: string;
      headers: Record<string, string>;
    };

    try {
      snapshot = {
        url: typeof request?.url === 'string' ? request.url : '',
        method: request?.method || 'POST',
        destination: request?.destination || '',
        mode: request?.mode || 'same-origin',
        headers: Object.fromEntries(request?.headers?.entries?.() ?? []),
      };
    } catch {
      snapshot = {
        url: '',
        method: request?.method || 'POST',
        destination: request?.destination || '',
        mode: request?.mode || 'same-origin',
        headers: {},
      };
    }

    const isMalformed = !snapshot.url || !/^https?:/i.test(snapshot.url);
    const accept = String(request?.headers?.get?.('accept') || '').toLowerCase();
    const wantsJson =
      request?.destination === '' ||
      accept.includes('application/json') ||
      accept.includes('text/event-stream') ||
      snapshot.url.includes('/api/');

    if (isMalformed) {
      console.warn('[SW] Ignoring malformed API POST request', {
        ...snapshot,
        error: error?.message || String(error || 'unknown_error'),
      });
      return new Response(
        JSON.stringify({
          ok: false,
          code: 'SW_NETWORK_ERROR',
          message: 'Malformed request intercepted by the service worker.',
          offline: true,
          url: snapshot.url || null,
          method: snapshot.method,
          stage: 'malformed_request',
        }),
        {
          status: 503,
          headers: {
            'Content-Type': 'application/json; charset=utf-8',
            'Cache-Control': 'no-store',
            'x-dcau-sw': 'network-failure',
            'x-dcau-sw-stage': 'malformed_request',
          },
        },
      );
    }

    console.warn('[SW] API POST request failed', {
      ...snapshot,
      error: error?.message || String(error || 'unknown_error'),
    });
    const payload = {
      ok: false,
      code: 'SW_NETWORK_ERROR',
      message: 'API POST request failed while handled by the service worker.',
      offline: true,
      url: snapshot.url || null,
      method: snapshot.method,
      stage: 'api_post_failure',
    };
    return new Response(
      wantsJson ? JSON.stringify(payload) : payload.message,
      {
        status: 503,
        headers: {
          'Content-Type': wantsJson ? 'application/json; charset=utf-8' : 'text/plain; charset=utf-8',
          'Cache-Control': 'no-store',
          'x-dcau-sw': 'network-failure',
          'x-dcau-sw-stage': 'api_post_failure',
        },
      },
    );
  },
};

const matchNextDataRoute = ({ request, url }: { request: Request; url: URL }) => {
  const requestUrl = typeof request.url === 'string' ? request.url.trim() : '';
  if (!requestUrl || !/^https?:/i.test(requestUrl)) return false;
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
  if (request.method !== 'GET') return false;
  if (!/\/_next\/data\/.+\/.+\.json$/i.test(url.pathname)) return false;

  const matchedRoute = url.pathname.match(/^\/_next\/data\/[^/]+(\/.+)\.json$/i)?.[1] || '';
  if (!matchedRoute) return false;

  const excludedPrefixes = [
    '/conex',
    '/dashboard',
  ];
  return !excludedPrefixes.some((prefix) => {
    return matchedRoute === prefix || matchedRoute.startsWith(`${prefix}/`);
  });
};

const matchPrefetchedRscRoute = ({
  request,
  url: { pathname },
  sameOrigin,
}: {
  request: Request;
  url: { pathname: string };
  sameOrigin: boolean;
}) => {
  if (!request.url || !/^https?:/i.test(request.url)) return false;
  if (request.method !== 'GET') return false;
  if (request.headers.get('RSC') !== '1') return false;
  if (request.headers.get('Next-Router-Prefetch') !== '1') return false;
  if (!sameOrigin) return false;
  if (pathname.startsWith('/api/')) return false;

  const normalizedPath = typeof pathname === 'string' && pathname.trim() ? pathname : '/';
  const excludedPrefixes = [
    '/conex',
    '/dashboard',
  ];
  return !excludedPrefixes.some((prefix) => {
    return normalizedPath === prefix || normalizedPath.startsWith(`${prefix}/`);
  });
};

const matchRscRoute = ({
  request,
  url: { pathname },
  sameOrigin,
}: {
  request: Request;
  url: { pathname: string };
  sameOrigin: boolean;
}) => {
  if (!request.url || !/^https?:/i.test(request.url)) return false;
  if (request.method !== 'GET') return false;
  if (request.headers.get('RSC') !== '1') return false;
  if (!sameOrigin) return false;
  if (pathname.startsWith('/api/')) return false;

  const normalizedPath = typeof pathname === 'string' && pathname.trim() ? pathname : '/';
  const excludedPrefixes = [
    '/conex',
    '/dashboard',
  ];
  return !excludedPrefixes.some((prefix) => {
    return normalizedPath === prefix || normalizedPath.startsWith(`${prefix}/`);
  });
};

const matchNavigationRoute = ({
  request,
  url: { pathname },
  sameOrigin,
}: {
  request: Request;
  url: { pathname: string };
  sameOrigin: boolean;
}) => {
  if (!request.url || !/^https?:/i.test(request.url)) return false;
  if (request.method !== 'GET') return false;
  if (request.mode !== 'navigate') return false;
  if (!sameOrigin) return false;
  if (pathname.startsWith('/api/')) return false;

  const normalizedPath = typeof pathname === 'string' && pathname.trim() ? pathname : '/';
  const excludedPrefixes = [
    '/conex',
    '/dashboard',
  ];
  return !excludedPrefixes.some((prefix) => {
    return normalizedPath === prefix || normalizedPath.startsWith(`${prefix}/`);
  });
};

const withPWA = withPWAInit({
  dest: 'public',
  disable: process.env.NODE_ENV === 'development',
  register: false,
  cacheOnFrontEndNav: false,
  aggressiveFrontEndNavCaching: false,
  dynamicStartUrlRedirect: '/',
  fallbacks: {
    document: '/~offline',
  },
  extendDefaultRuntimeCaching: false,
  workboxOptions: {
    skipWaiting: true,
    clientsClaim: true,
    exclude: [
      /\/_next\/static\/chunks\/app\/dashboard\//,
      /\/_next\/static\/chunks\/app\/conex\//,
      /\/_next\/static\/chunks\/app\/api\/(account|admin|au|billing|chat|entitlements|feature-output|feedback|limits|payments)\//,
      /\/dashboard$/,
    ],
    runtimeCaching: [
      {
        urlPattern: ({ request, url, sameOrigin }: WorkboxRouteContext) => {
          const requestUrl = typeof request.url === 'string' ? request.url.trim() : '';
          if (!requestUrl || !/^https?:/i.test(requestUrl)) return false;
          if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
          // Exclude protected/session-scoped APIs. Entitlement, billing, admin,
          // upload, chat, and generated-output reads must never be served stale.
          if (/\/api\/health$/i.test(url.pathname)) return false;
          if (/\/api\/(account|admin|au|auth|billing|chat|entitlements|feedback|limits|payments)(\/|$)/i.test(url.pathname)) return false;
          if (/\/api\/feature-output$/i.test(url.pathname)) return false;
          if (/\/api\/feature-flags$/i.test(url.pathname)) return false;
          if (/\/api\/webhooks\//i.test(url.pathname)) return false;
          if (/\/socket\.io\//i.test(url.pathname)) return false;
          return sameOrigin && url.pathname.startsWith('/api/');
        },
        method: 'GET',
        handler: 'NetworkFirst',
        options: {
          cacheName: PWA_RUNTIME_CACHE_NAMES['api-get-swr'],
          plugins: [
            {
              // Only cache successful responses
              cacheWillUpdate: async ({ response }: { response: Response }) => {
                return response && response.status === 200 ? response : null;
              },
            },
            apiGetFailurePlugin,
          ],
          expiration: {
            maxEntries: 128,
            maxAgeSeconds: 60 * 60, // 1 hour
          },
        },
      },
      {
        urlPattern: ({ request, url, sameOrigin }: WorkboxRouteContext) => {
          const requestUrl = typeof request.url === 'string' ? request.url.trim() : '';
          if (!requestUrl || !/^https?:/i.test(requestUrl)) return false;
          if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
          return sameOrigin;
        },
        method: 'POST',
        handler: 'NetworkOnly',
        options: {
          cacheName: PWA_RUNTIME_CACHE_NAMES['post-no-cache'],
          plugins: [apiPostFailurePlugin],
        },
      },
      {
        urlPattern: ({ request, url, sameOrigin }: WorkboxRouteContext) => {
          const requestUrl = typeof request.url === 'string' ? request.url.trim() : '';
          if (!requestUrl || !/^https?:/i.test(requestUrl)) return false;
          if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
          return sameOrigin;
        },
        method: 'PUT',
        handler: 'NetworkOnly',
        options: { cacheName: PWA_RUNTIME_CACHE_NAMES['put-no-cache'] },
      },
      {
        urlPattern: ({ request, url, sameOrigin }: WorkboxRouteContext) => {
          const requestUrl = typeof request.url === 'string' ? request.url.trim() : '';
          if (!requestUrl || !/^https?:/i.test(requestUrl)) return false;
          if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
          return sameOrigin;
        },
        method: 'PATCH',
        handler: 'NetworkOnly',
        options: { cacheName: PWA_RUNTIME_CACHE_NAMES['patch-no-cache'] },
      },
      {
        urlPattern: ({ request, url, sameOrigin }: WorkboxRouteContext) => {
          const requestUrl = typeof request.url === 'string' ? request.url.trim() : '';
          if (!requestUrl || !/^https?:/i.test(requestUrl)) return false;
          if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
          return sameOrigin;
        },
        method: 'DELETE',
        handler: 'NetworkOnly',
        options: { cacheName: PWA_RUNTIME_CACHE_NAMES['delete-no-cache'] },
      },
      {
        urlPattern: ({ request, url, sameOrigin }) => {
          const requestUrl = typeof request.url === 'string' ? request.url.trim() : '';
          if (!requestUrl || !/^https?:/i.test(requestUrl)) return false;
          if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
          return (
            request.method === 'GET' &&
            sameOrigin &&
            request.destination !== '' &&
            ['style', 'script', 'font', 'image', 'worker'].includes(request.destination)
          );
        },
        handler: 'StaleWhileRevalidate',
        options: {
          cacheName: PWA_RUNTIME_CACHE_NAMES['static-assets'],
          expiration: {
            maxEntries: 256,
            maxAgeSeconds: 30 * 24 * 60 * 60,
          },
        },
      },
      {
        urlPattern: ({ request, url }) => {
          const requestUrl = typeof request.url === 'string' ? request.url.trim() : '';
          if (!requestUrl || !/^https?:/i.test(requestUrl)) return false;
          if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
          // Exclude auth endpoints from caching
          if (/\/auth\/v1\//i.test(url.pathname)) return false;
          return request.method === 'GET' && /^https:\/\/.*\.supabase\.co\/.*/i.test(url.toString());
        },
        handler: 'StaleWhileRevalidate',
        options: {
          cacheName: PWA_RUNTIME_CACHE_NAMES['supabase-swr'],
          plugins: [
            {
              cacheWillUpdate: async ({ response }: { response: Response }) => {
                return response && response.status === 200 ? response : null;
              },
            },
          ],
          expiration: {
            maxEntries: 64,
            maxAgeSeconds: 30 * 60, // 30 minutes
          },
        },
      },
      {
        urlPattern: ({ request, url }) => {
          const requestUrl = typeof request.url === 'string' ? request.url.trim() : '';
          if (!requestUrl || !/^https?:/i.test(requestUrl)) return false;
          if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
          return request.method === 'GET' && /\/api\/health$/i.test(url.pathname);
        },
        handler: 'NetworkOnly',
        options: {
          cacheName: PWA_RUNTIME_CACHE_NAMES['health-no-cache'],
          plugins: [
            {
              handlerDidError: async () =>
                new Response(JSON.stringify({ ok: false, offline: true, ts: Date.now() }), {
                  status: 503,
                  headers: { 'Content-Type': 'application/json' },
                }),
            },
          ],
        },
      },
      {
        urlPattern: ({ request, url }) => {
          const requestUrl = typeof request.url === 'string' ? request.url.trim() : '';
          if (!requestUrl || !/^https?:/i.test(requestUrl)) return false;
          if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
          return request.method === 'GET' && /manifest\.webmanifest$/i.test(url.pathname);
        },
        handler: 'StaleWhileRevalidate',
        options: {
          cacheName: PWA_RUNTIME_CACHE_NAMES['manifest-cache'],
          expiration: {
            maxEntries: 1,
            maxAgeSeconds: 24 * 60 * 60,
          },
        },
      },
      {
        urlPattern: ({ request, url }) => {
          const requestUrl = typeof request.url === 'string' ? request.url.trim() : '';
          if (!requestUrl || !/^https?:/i.test(requestUrl)) return false;
          if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
          return request.method === 'GET' && /^https:\/\/www\.google\.com\/images\/cleardot\.gif/i.test(url.toString());
        },
        handler: 'NetworkOnly',
        options: { cacheName: PWA_RUNTIME_CACHE_NAMES['google-pixel-no-cache'] },
      },
      {
        urlPattern: ({ request, url }) => {
          const requestUrl = typeof request.url === 'string' ? request.url.trim() : '';
          if (!requestUrl || !/^https?:/i.test(requestUrl)) return false;
          if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
          return request.method === 'GET' && /^https:\/\/www\.googletagmanager\.com\/.*/i.test(url.toString());
        },
        handler: 'NetworkOnly',
        options: { cacheName: PWA_RUNTIME_CACHE_NAMES['gtm-no-cache'] },
      },
      {
        // Cache only public Next.js data payloads. Protected dashboard/admin/billing
        // routes are excluded in matchNextDataRoute.
        urlPattern: matchNextDataRoute,
        handler: 'StaleWhileRevalidate',
        options: {
          cacheName: PWA_RUNTIME_CACHE_NAMES['next-data'],
          expiration: {
            maxEntries: 256,
            maxAgeSeconds: 7 * 24 * 60 * 60,
          },
        },
      },
      {
        // Cache only public route prefetch payloads. Protected routes are excluded
        // before Workbox sees the request.
        urlPattern: matchPrefetchedRscRoute,
        handler: 'NetworkFirst',
        options: {
          cacheName: PWA_RUNTIME_CACHE_NAMES['pages-rsc-prefetch'],
          networkTimeoutSeconds: 2,
          expiration: {
            maxEntries: 256,
            maxAgeSeconds: 7 * 24 * 60 * 60,
          },
        },
      },
      {
        // Route payloads should not block UI for long on flaky networks.
        urlPattern: matchRscRoute,
        handler: 'NetworkFirst',
        options: {
          cacheName: PWA_RUNTIME_CACHE_NAMES['pages-rsc'],
          networkTimeoutSeconds: 2,
          expiration: {
            maxEntries: 256,
            maxAgeSeconds: 7 * 24 * 60 * 60,
          },
        },
      },
      {
        // Main HTML navigation fallback for instant offline/poor-network transitions.
        urlPattern: matchNavigationRoute,
        handler: 'NetworkFirst',
        options: {
          cacheName: PWA_RUNTIME_CACHE_NAMES['pages'],
          networkTimeoutSeconds: 2,
          expiration: {
            maxEntries: 256,
            maxAgeSeconds: 7 * 24 * 60 * 60,
          },
        },
      },
    ],
  },
});

const nextConfig: NextConfig = {
  /* config options here */
  // Fix Next.js 16 build error by acknowledging Turbopack default
  // while allowing PWA plugin to use Webpack internally.
  turbopack: {
    resolveAlias: {
      '@': './src',
      '@shared': './shared',
    },
  },
  typescript: {
    tsconfigPath: "tsconfig.next.json",
  },
  webpack: (config) => {
    config.resolve = config.resolve ?? {};
    config.resolve.alias = {
      ...(config.resolve.alias ?? {}),
      '@': path.join(process.cwd(), 'src'),
      '@shared': path.join(process.cwd(), 'shared'),
    };
    return config;
  },
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'placehold.co',
        port: '',
        pathname: '/**',
      },
      {
        protocol: 'https',
        hostname: 'images.unsplash.com',
        port: '',
        pathname: '/**',
      },
      {
        protocol: 'https',
        hostname: 'picsum.photos',
        port: '',
        pathname: '/**',
      },
      {
        protocol: 'https',
        hostname: 'storage.googleapis.com',
        port: '',
        pathname: '/**',
      },
    ],
  },
  headers: async () => [
    {
      source: '/(.*)',
      headers: [
        {
          key: 'Cross-Origin-Opener-Policy',
          value: 'same-origin-allow-popups',
        },
      ],
    },
  ],
};

export default withPWA(nextConfig);
