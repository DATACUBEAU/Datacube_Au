import type {NextConfig} from 'next';
import withPWAInit from '@ducanh2912/next-pwa';
import path from 'node:path';

const withPWA = withPWAInit({
  dest: 'public',
  disable: process.env.NODE_ENV === 'development',
  register: true,
  skipWaiting: true,
  clientsClaim: true,
  runtimeCaching: [
    {
      // Explicitly disable caching for Firestore Listen/Channel (Long Polling)
      // This is critical to prevent Workbox from intercepting streaming connections
      urlPattern: /^https:\/\/firestore\.googleapis\.com\/google\.firestore\.v1\.Firestore\/Listen\/channel/i,
      handler: 'NetworkOnly',
      options: { 
        cacheName: 'firestore-channel-no-cache',
        backgroundSync: undefined // Ensure no background sync for streams
      },
    },
    {
      // Explicitly disable caching for Supabase APIs and websockets
      urlPattern: /^https:\/\/.*\.supabase\.co\/.*/i,
      handler: 'NetworkOnly',
      options: { cacheName: 'supabase-no-cache' },
    },
    {
      // Explicitly disable caching for Google APIs used by Firebase Auth
      urlPattern: /^https:\/\/.*\.googleapis\.com\/.*/i,
      handler: 'NetworkOnly',
      options: { cacheName: 'google-apis-no-cache' },
    },
    {
      // Disable caching for Firebase config endpoints
      urlPattern: /^https:\/\/firebase\.googleapis\.com\/.*/i,
      handler: 'NetworkOnly',
      options: { cacheName: 'firebase-no-cache' },
    },
    {
      // Do not cache cross-origin requests (Google, Firebase, Supabase, etc.)
      urlPattern: ({ url }) => url.origin !== self.location.origin,
      handler: 'NetworkOnly',
      options: { cacheName: 'external-no-cache' },
    },
    {
      // Ensure navigation requests are fetched from network first
      urlPattern: ({ request }) => request.mode === 'navigate',
      handler: 'NetworkFirst',
      options: {
        cacheName: 'html-cache',
        networkTimeoutSeconds: 5,
      },
    },
    {
      // Cache Next.js App Router RSC payloads for offline navigation
      urlPattern: /\?_rsc=/,
      handler: 'NetworkFirst',
      options: {
        cacheName: 'next-rsc-cache',
        expiration: {
          maxEntries: 50,
          maxAgeSeconds: 24 * 60 * 60, // 24 hours
        },
      },
    },
    {
      // Explicitly disable caching for Firestore Listen/Channel (Long Polling)
      // This is critical to prevent Workbox from intercepting streaming connections
      urlPattern: /^https:\/\/firestore\.googleapis\.com\/google\.firestore\.v1\.Firestore\/Listen\/channel/i,
      handler: 'NetworkOnly',
      options: { 
        cacheName: 'firestore-channel-no-cache',
        backgroundSync: undefined // Ensure no background sync for streams
      },
    },
    {
      // Disable caching for Google Analytics/Pixel
      urlPattern: /^https:\/\/www\.google\.com\/images\/cleardot\.gif/i,
      handler: 'NetworkOnly',
      options: { cacheName: 'google-pixel-no-cache' },
    },
    {
      // Explicitly disable caching for Supabase APIs and websockets
      urlPattern: /^https:\/\/.*\.supabase\.co\/.*/i,
      handler: 'NetworkOnly',
      options: { cacheName: 'supabase-no-cache' },
    },
    {
      // Explicitly disable caching for Google APIs used by Firebase Auth
      urlPattern: /^https:\/\/.*\.googleapis\.com\/.*/i,
      handler: 'NetworkOnly',
      options: { cacheName: 'google-apis-no-cache' },
    },
    {
      // Disable caching for GTM and analytics scripts
      urlPattern: /^https:\/\/www\.googletagmanager\.com\/.*/i,
      handler: 'NetworkOnly',
      options: { cacheName: 'gtm-no-cache' },
    },
    {
      // Disable caching for Firebase config endpoints
      urlPattern: /^https:\/\/firebase\.googleapis\.com\/.*/i,
      handler: 'NetworkOnly',
      options: { cacheName: 'firebase-no-cache' },
    },
  ],
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
