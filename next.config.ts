import type {NextConfig} from 'next';
import withPWAInit from '@ducanh2912/next-pwa';
import path from 'node:path';
import { PWA_RUNTIME_CACHE_NAMES } from './shared/pwa-runtime.js';

const matchNextDataRoute = ({ request, url }: { request: Request; url: URL }) => {
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
        urlPattern: ({ url, sameOrigin }) => sameOrigin && url.pathname.startsWith('/api/'),
        method: 'GET',
        handler: 'NetworkOnly',
        options: {
          cacheName: PWA_RUNTIME_CACHE_NAMES['api-get-no-cache'],
          plugins: [
            {
              handlerDidError: async ({ request, error }) => {
                console.error('[SW] API GET request failed:', {
                  url: request.url,
                  method: request.method,
                  headers: Object.fromEntries(request.headers.entries()),
                  error: error.message,
                });
                return Response.error();
              },
            },
          ],
        },
      },
      {
        urlPattern: ({ sameOrigin }) => sameOrigin,
        method: 'POST',
        handler: 'NetworkOnly',
        options: {
          cacheName: PWA_RUNTIME_CACHE_NAMES['post-no-cache'],
          plugins: [
            {
              handlerDidError: async ({ request, error }) => {
                console.error('[SW] API POST request failed:', {
                  url: request.url,
                  method: request.method,
                  headers: Object.fromEntries(request.headers.entries()),
                  error: error.message,
                });
                return Response.error();
              },
            },
          ],
        },
      },
      {
        urlPattern: ({ sameOrigin }) => sameOrigin,
        method: 'PUT',
        handler: 'NetworkOnly',
        options: { cacheName: PWA_RUNTIME_CACHE_NAMES['put-no-cache'] },
      },
      {
        urlPattern: ({ sameOrigin }) => sameOrigin,
        method: 'PATCH',
        handler: 'NetworkOnly',
        options: { cacheName: PWA_RUNTIME_CACHE_NAMES['patch-no-cache'] },
      },
      {
        urlPattern: ({ sameOrigin }) => sameOrigin,
        method: 'DELETE',
        handler: 'NetworkOnly',
        options: { cacheName: PWA_RUNTIME_CACHE_NAMES['delete-no-cache'] },
      },
      {
        urlPattern: ({ request, sameOrigin }) =>
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
        urlPattern: ({ request, url }) => request.method === 'GET' && /^https:\/\/.*\.supabase\.co\/.*/i.test(url.toString()),
        handler: 'NetworkOnly',
        options: { cacheName: PWA_RUNTIME_CACHE_NAMES['supabase-no-cache'] },
      },
      {
        urlPattern: ({ request, url }) => request.method === 'GET' && /\/api\/health$/i.test(url.pathname),
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
        urlPattern: ({ request, url }) => request.method === 'GET' && /manifest\.webmanifest$/i.test(url.pathname),
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
        urlPattern: ({ request, url }) => request.method === 'GET' && /^https:\/\/www\.google\.com\/images\/cleardot\.gif/i.test(url.toString()),
        handler: 'NetworkOnly',
        options: { cacheName: PWA_RUNTIME_CACHE_NAMES['google-pixel-no-cache'] },
      },
      {
        urlPattern: ({ request, url }) => request.method === 'GET' && /^https:\/\/www\.googletagmanager\.com\/.*/i.test(url.toString()),
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
