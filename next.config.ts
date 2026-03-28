import type {NextConfig} from 'next';
import withPWAInit from '@ducanh2912/next-pwa';
import path from 'node:path';
import { PWA_RUNTIME_CACHE_NAMES } from './shared/pwa-runtime.js';

type WorkboxRouteContext = {
  request: Request;
  url: URL;
  sameOrigin: boolean;
};

function hasUsableRequestUrl({ request, url }: Pick<WorkboxRouteContext, 'request' | 'url'>): boolean {
  const requestUrl = typeof request.url === 'string' ? request.url.trim() : '';
  if (!requestUrl) return false;
  if (!/^https?:/i.test(requestUrl)) return false;
  return url.protocol === 'http:' || url.protocol === 'https:';
}

function describeWorkboxRequest(request: Request) {
  try {
    return {
      url: request.url,
      method: request.method,
      destination: request.destination,
      mode: request.mode,
      headers: Object.fromEntries(request.headers.entries()),
    };
  } catch {
    return {
      url: '',
      method: request.method,
      destination: request.destination,
      mode: request.mode,
      headers: {},
    };
  }
}

function buildServiceWorkerFailureResponse(request: Request, input: {
  status?: number;
  stage: string;
  message: string;
  forceJson?: boolean;
}) {
  const wantsJson =
    input.forceJson === true ||
    request.destination === '' ||
    String(request.headers.get('accept') || '').toLowerCase().includes('application/json') ||
    String(request.headers.get('accept') || '').toLowerCase().includes('text/event-stream') ||
    request.url.includes('/api/');

  const payload = {
    ok: false,
    code: 'SW_NETWORK_ERROR',
    message: input.message,
    offline: true,
    url: request.url || null,
    method: request.method || 'GET',
    stage: input.stage,
  };

  return new Response(
    wantsJson ? JSON.stringify(payload) : payload.message,
    {
      status: input.status ?? 503,
      headers: {
        'Content-Type': wantsJson ? 'application/json; charset=utf-8' : 'text/plain; charset=utf-8',
        'Cache-Control': 'no-store',
        'x-dcau-sw': 'network-failure',
        'x-dcau-sw-stage': input.stage,
      },
    },
  );
}

const apiGetFailurePlugin = {
  handlerDidError: async ({ request, error }: { request: Request; error: Error }) => {
    const snapshot = describeWorkboxRequest(request);
    const isMalformed = !snapshot.url || !/^https?:/i.test(snapshot.url);

    if (isMalformed) {
      console.warn('[SW] Ignoring malformed API GET request', {
        ...snapshot,
        error: error?.message || String(error || 'unknown_error'),
      });
      return buildServiceWorkerFailureResponse(request, {
        stage: 'malformed_request',
        message: 'Malformed request intercepted by the service worker.',
        forceJson: true,
      });
    }

    console.warn('[SW] API GET request failed', {
      ...snapshot,
      error: error?.message || String(error || 'unknown_error'),
    });
    return buildServiceWorkerFailureResponse(request, {
      stage: 'api_get_failure',
      message: 'API GET request failed while handled by the service worker.',
      forceJson: true,
    });
  },
};

const apiPostFailurePlugin = {
  handlerDidError: async ({ request, error }: { request: Request; error: Error }) => {
    const snapshot = describeWorkboxRequest(request);
    const isMalformed = !snapshot.url || !/^https?:/i.test(snapshot.url);

    if (isMalformed) {
      console.warn('[SW] Ignoring malformed API POST request', {
        ...snapshot,
        error: error?.message || String(error || 'unknown_error'),
      });
      return buildServiceWorkerFailureResponse(request, {
        stage: 'malformed_request',
        message: 'Malformed request intercepted by the service worker.',
        forceJson: true,
      });
    }

    console.warn('[SW] API POST request failed', {
      ...snapshot,
      error: error?.message || String(error || 'unknown_error'),
    });
    return buildServiceWorkerFailureResponse(request, {
      stage: 'api_post_failure',
      message: 'API POST request failed while handled by the service worker.',
      forceJson: true,
    });
  },
};

const matchNextDataRoute = ({ request, url }: { request: Request; url: URL }) => {
  if (!hasUsableRequestUrl({ request, url })) return false;
  if (request.method !== 'GET') return false;
  if (!/\/_next\/data\/.+\/.+\.json$/i.test(url.pathname)) return false;

  const matchedRoute = url.pathname.match(/^\/_next\/data\/[^/]+(\/.+)\.json$/i)?.[1] || '';
  if (!matchedRoute) return false;

  const excludedPrefixes = ['/conex'];
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
  const excludedPrefixes = ['/conex'];
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
  const excludedPrefixes = ['/conex'];
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
  const excludedPrefixes = ['/conex'];
  return !excludedPrefixes.some((prefix) => {
    return normalizedPath === prefix || normalizedPath.startsWith(`${prefix}/`);
  });
};

const withPWA = withPWAInit({
  dest: 'public',
  disable: process.env.NODE_ENV === 'development',
  register: false,
  cacheOnFrontEndNav: true,
  aggressiveFrontEndNavCaching: true,
  dynamicStartUrlRedirect: '/dashboard',
  fallbacks: {
    document: '/~offline',
  },
  extendDefaultRuntimeCaching: false,
  workboxOptions: {
    skipWaiting: true,
    clientsClaim: true,
    runtimeCaching: [
      {
        urlPattern: ({ request, url, sameOrigin }: WorkboxRouteContext) =>
          hasUsableRequestUrl({ request, url }) &&
          sameOrigin &&
          url.pathname.startsWith('/api/'),
        method: 'GET',
        handler: 'NetworkOnly',
        options: {
          cacheName: PWA_RUNTIME_CACHE_NAMES['api-get-no-cache'],
          plugins: [apiGetFailurePlugin],
        },
      },
      {
        urlPattern: ({ request, url, sameOrigin }: WorkboxRouteContext) =>
          hasUsableRequestUrl({ request, url }) && sameOrigin,
        method: 'POST',
        handler: 'NetworkOnly',
        options: {
          cacheName: PWA_RUNTIME_CACHE_NAMES['post-no-cache'],
          plugins: [apiPostFailurePlugin],
        },
      },
      {
        urlPattern: ({ request, url, sameOrigin }: WorkboxRouteContext) =>
          hasUsableRequestUrl({ request, url }) && sameOrigin,
        method: 'PUT',
        handler: 'NetworkOnly',
        options: { cacheName: PWA_RUNTIME_CACHE_NAMES['put-no-cache'] },
      },
      {
        urlPattern: ({ request, url, sameOrigin }: WorkboxRouteContext) =>
          hasUsableRequestUrl({ request, url }) && sameOrigin,
        method: 'PATCH',
        handler: 'NetworkOnly',
        options: { cacheName: PWA_RUNTIME_CACHE_NAMES['patch-no-cache'] },
      },
      {
        urlPattern: ({ request, url, sameOrigin }: WorkboxRouteContext) =>
          hasUsableRequestUrl({ request, url }) && sameOrigin,
        method: 'DELETE',
        handler: 'NetworkOnly',
        options: { cacheName: PWA_RUNTIME_CACHE_NAMES['delete-no-cache'] },
      },
      {
        urlPattern: ({ request, url, sameOrigin }) =>
          hasUsableRequestUrl({ request, url }) &&
          request.method === 'GET' &&
          sameOrigin &&
          request.destination !== '' &&
          ['style', 'script', 'font', 'image', 'worker'].includes(request.destination),
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
        urlPattern: ({ request, url }) =>
          hasUsableRequestUrl({ request, url }) &&
          request.method === 'GET' &&
          /^https:\/\/.*\.supabase\.co\/.*/i.test(url.toString()),
        handler: 'NetworkOnly',
        options: { cacheName: PWA_RUNTIME_CACHE_NAMES['supabase-no-cache'] },
      },
      {
        urlPattern: ({ request, url }) =>
          hasUsableRequestUrl({ request, url }) &&
          request.method === 'GET' &&
          /\/api\/health$/i.test(url.pathname),
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
        urlPattern: ({ request, url }) =>
          hasUsableRequestUrl({ request, url }) &&
          request.method === 'GET' &&
          /manifest\.webmanifest$/i.test(url.pathname),
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
        urlPattern: ({ request, url }) =>
          hasUsableRequestUrl({ request, url }) &&
          request.method === 'GET' &&
          /^https:\/\/www\.google\.com\/images\/cleardot\.gif/i.test(url.toString()),
        handler: 'NetworkOnly',
        options: { cacheName: PWA_RUNTIME_CACHE_NAMES['google-pixel-no-cache'] },
      },
      {
        urlPattern: ({ request, url }) =>
          hasUsableRequestUrl({ request, url }) &&
          request.method === 'GET' &&
          /^https:\/\/www\.googletagmanager\.com\/.*/i.test(url.toString()),
        handler: 'NetworkOnly',
        options: { cacheName: PWA_RUNTIME_CACHE_NAMES['gtm-no-cache'] },
      },
      {
        // Keep Next.js data payloads around longer so already-visited pages reopen offline.
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
        // Cache dashboard route payload shells so previously visited pages can reopen offline.
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
