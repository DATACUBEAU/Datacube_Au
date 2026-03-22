export const PWA_CACHE_EXCLUDED_PREFIXES = ['/conex'];

export const PWA_OFFLINE_WARMUP_ROUTES = [
  '/',
  '/about',
  '/features',
  '/policy',
  '/login',
  '/dashboard',
  '/dashboard/documents',
  '/dashboard/chat',
  '/dashboard/global-chat',
  '/dashboard/knowledge',
  '/dashboard/messages',
  '/dashboard/predictions',
  '/dashboard/practice',
  '/dashboard/settings',
  '/dashboard/settings/subscription',
  '/offline',
  '/~offline',
  '/403',
  '/conex',
];

export function normalizePwaPathname(pathname) {
  const raw = typeof pathname === 'string' ? pathname.trim() : '';
  if (!raw) return '/';
  return raw.startsWith('/') ? raw : `/${raw}`;
}

export function isPwaCacheExcludedPathname(pathname) {
  const normalized = normalizePwaPathname(pathname);
  return PWA_CACHE_EXCLUDED_PREFIXES.some(
    (prefix) => normalized === prefix || normalized.startsWith(`${prefix}/`),
  );
}

export function extractNextDataRoutePath(pathname) {
  const normalized = normalizePwaPathname(pathname);
  const match = normalized.match(/^\/_next\/data\/[^/]+(\/.+)\.json$/i);
  return match?.[1] || '';
}

export function shouldCacheNextDataPath(pathname) {
  const routePath = extractNextDataRoutePath(pathname);
  if (!routePath) return false;
  return !isPwaCacheExcludedPathname(routePath);
}
