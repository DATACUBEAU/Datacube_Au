import type {NextConfig} from 'next';
import withPWAInit from '@ducanh2912/next-pwa';
import path from 'node:path';

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
  extendDefaultRuntimeCaching: true,
  workboxOptions: {
    skipWaiting: true,
    clientsClaim: true,
    runtimeCaching: [
      {
        urlPattern: /^https:\/\/.*\.supabase\.co\/.*/i,
        handler: 'NetworkOnly',
        options: { cacheName: 'supabase-no-cache' },
      },
      {
        urlPattern: /\/api\/health$/i,
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
        urlPattern: /manifest\.webmanifest$/i,
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
        urlPattern: /^https:\/\/www\.google\.com\/images\/cleardot\.gif/i,
        handler: 'NetworkOnly',
        options: { cacheName: 'google-pixel-no-cache' },
      },
      {
        urlPattern: /^https:\/\/www\.googletagmanager\.com\/.*/i,
        handler: 'NetworkOnly',
        options: { cacheName: 'gtm-no-cache' },
      },
      {
        // Keep Next.js data payloads around longer so already-visited pages reopen offline.
        urlPattern: /\/_next\/data\/.+\/.+\.json$/i,
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
        // App Router prefetch payloads should fail over to cache quickly when offline.
        urlPattern: ({ request, url: { pathname }, sameOrigin }) =>
          request.headers.get('RSC') === '1' &&
          request.headers.get('Next-Router-Prefetch') === '1' &&
          sameOrigin &&
          !pathname.startsWith('/api/'),
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
          request.headers.get('RSC') === '1' &&
          sameOrigin &&
          !pathname.startsWith('/api/'),
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
          request.mode === 'navigate' && sameOrigin && !pathname.startsWith('/api/'),
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
