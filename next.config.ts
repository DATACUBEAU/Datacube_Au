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
