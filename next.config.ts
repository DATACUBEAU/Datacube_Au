import type {NextConfig} from 'next';
import withPWAInit from '@ducanh2912/next-pwa';
import path from 'node:path';
import { isPwaCacheExcludedPathname, shouldCacheNextDataPath } from './shared/pwa-cache-policy.js';

const withPWA = withPWAInit({
  dest: 'public',
  disable: process.env.NODE_ENV === 'development',
  register: true,
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
        options: { cacheName: 'api-get-no-cache' },
      },
      {
        urlPattern: ({ sameOrigin }) => sameOrigin,
        method: 'POST',
        handler: 'NetworkOnly',
        options: { cacheName: 'post-no-cache' },
      },
      {
        urlPattern: ({ sameOrigin }) => sameOrigin,
        method: 'PUT',
        handler: 'NetworkOnly',
        options: { cacheName: 'put-no-cache' },
      },
      {
        urlPattern: ({ sameOrigin }) => sameOrigin,
        method: 'PATCH',
        handler: 'NetworkOnly',
        options: { cacheName: 'patch-no-cache' },
      },
      {
        urlPattern: ({ sameOrigin }) => sameOrigin,
        method: 'DELETE',
        handler: 'NetworkOnly',
        options: { cacheName: 'delete-no-cache' },
      },
      {
        urlPattern: ({ request, sameOrigin }) =>
          request.method === 'GET' &&
          sameOrigin &&
          request.destination !== '' &&
          ['style', 'script', 'font', 'image', 'worker'].includes(request.destination),
        handler: 'StaleWhileRevalidate',
        options: {
          cacheName: 'static-assets',
          expiration: {
            maxEntries: 256,
            maxAgeSeconds: 30 * 24 * 60 * 60,
          },
        },
      },
      {
        urlPattern: ({ request, url }) => request.method === 'GET' && /^https:\/\/.*\.supabase\.co\/.*/i.test(url.toString()),
        handler: 'NetworkOnly',
        options: { cacheName: 'supabase-no-cache' },
      },
      {
        urlPattern: ({ request, url }) => request.method === 'GET' && /\/api\/health$/i.test(url.pathname),
        handler: 'NetworkOnly',
        options: {
          cacheName: 'health-no-cache',
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
          cacheName: 'manifest-cache',
          expiration: {
            maxEntries: 1,
            maxAgeSeconds: 24 * 60 * 60,
          },
        },
      },
      {
        urlPattern: ({ request, url }) => request.method === 'GET' && /^https:\/\/www\.google\.com\/images\/cleardot\.gif/i.test(url.toString()),
        handler: 'NetworkOnly',
        options: { cacheName: 'google-pixel-no-cache' },
      },
      {
        urlPattern: ({ request, url }) => request.method === 'GET' && /^https:\/\/www\.googletagmanager\.com\/.*/i.test(url.toString()),
        handler: 'NetworkOnly',
        options: { cacheName: 'gtm-no-cache' },
      },
      {
        // Keep Next.js data payloads around longer so already-visited pages reopen offline.
        urlPattern: ({ request, url }) =>
          request.method === 'GET' &&
          /\/_next\/data\/.+\/.+\.json$/i.test(url.pathname) &&
          shouldCacheNextDataPath(url.pathname),
        handler: 'StaleWhileRevalidate',
        options: {
          cacheName: 'next-data',
          expiration: {
            maxEntries: 256,
            maxAgeSeconds: 7 * 24 * 60 * 60,
          },
        },
      },
      {
        // Cache dashboard route payload shells so previously visited pages can reopen offline.
        urlPattern: ({ request, url: { pathname }, sameOrigin }) =>
          request.method === 'GET' &&
          request.headers.get('RSC') === '1' &&
          request.headers.get('Next-Router-Prefetch') === '1' &&
          sameOrigin &&
          !pathname.startsWith('/api/') &&
          !isPwaCacheExcludedPathname(pathname),
        handler: 'NetworkFirst',
        options: {
          cacheName: 'pages-rsc-prefetch',
          networkTimeoutSeconds: 2,
          expiration: {
            maxEntries: 256,
            maxAgeSeconds: 7 * 24 * 60 * 60,
          },
        },
      },
      {
        // Route payloads should not block UI for long on flaky networks.
        urlPattern: ({ request, url: { pathname }, sameOrigin }) =>
          request.method === 'GET' &&
          request.headers.get('RSC') === '1' &&
          sameOrigin &&
          !pathname.startsWith('/api/') &&
          !isPwaCacheExcludedPathname(pathname),
        handler: 'NetworkFirst',
        options: {
          cacheName: 'pages-rsc',
          networkTimeoutSeconds: 2,
          expiration: {
            maxEntries: 256,
            maxAgeSeconds: 7 * 24 * 60 * 60,
          },
        },
      },
      {
        // Main HTML navigation fallback for instant offline/poor-network transitions.
        urlPattern: ({ request, url: { pathname }, sameOrigin }) =>
          request.method === 'GET' &&
          request.mode === 'navigate' &&
          sameOrigin &&
          !pathname.startsWith('/api/') &&
          !isPwaCacheExcludedPathname(pathname),
        handler: 'NetworkFirst',
        options: {
          cacheName: 'pages',
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
