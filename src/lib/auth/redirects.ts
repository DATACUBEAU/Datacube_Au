const AUTH_PUBLIC_PREFIXES = ['/login', '/signup', '/auth/callback', '/session-expired'] as const;
const MOBILE_AUTH_REQUEST_ID = /^[A-Za-z0-9_-]{43}$/;
export const MOBILE_AUTH_APPROVAL_PATH = '/mobile-auth/approve';
export const MOBILE_AUTH_RETURN_PATH = '/mobile-auth/return';

export function isMobileAuthorizationPage(pathname: string): boolean {
  const normalized = pathname.replace(/\/$/, '');
  return normalized === MOBILE_AUTH_APPROVAL_PATH || normalized === MOBILE_AUTH_RETURN_PATH;
}

export function readMobileAuthorizationRequest(search: Pick<URLSearchParams, 'get' | 'toString'>): string | null {
  const requestId = search.get('request');
  return requestId && MOBILE_AUTH_REQUEST_ID.test(requestId) && search.toString() === `request=${requestId}`
    ? requestId
    : null;
}

function normalizeCandidatePath(value: string | null | undefined): string {
  return String(value || '').trim();
}

export function isPublicAuthPath(pathname: string | null | undefined): boolean {
  const normalized = normalizeCandidatePath(pathname).replace(/\/$/, '') || '/';
  return isMobileAuthorizationPage(normalized)
    || AUTH_PUBLIC_PREFIXES.some((prefix) => normalized === prefix || normalized.startsWith(`${prefix}/`));
}

export function sanitizeLocalRedirectPath(
  value: string | null | undefined,
  fallback = '/mobile-app-required',
): string {
  const candidate = normalizeCandidatePath(value);
  if (!candidate || !candidate.startsWith('/') || candidate.startsWith('//')) return fallback;
  if (/^[a-z][a-z0-9+.-]*:/i.test(candidate)) return fallback;

  try {
    const parsed = new URL(candidate, 'https://datacube.local');
    if (parsed.origin !== 'https://datacube.local') return fallback;
    if (isMobileAuthorizationPage(parsed.pathname)) {
      const requestId = readMobileAuthorizationRequest(parsed.searchParams);
      return requestId && !parsed.hash ? `${parsed.pathname.replace(/\/$/, '')}?request=${requestId}` : fallback;
    }
    const nextPath = `${parsed.pathname}${parsed.search}${parsed.hash}`;
    if (isPublicAuthPath(parsed.pathname)) return fallback;
    return nextPath || fallback;
  } catch {
    return fallback;
  }
}

export function isMobileAuthorizationDestination(path: string): boolean {
  return [MOBILE_AUTH_APPROVAL_PATH, MOBILE_AUTH_RETURN_PATH].some((pathname) => {
    const prefix = `${pathname}?request=`;
    return path.startsWith(prefix) && MOBILE_AUTH_REQUEST_ID.test(path.slice(prefix.length));
  });
}

export function buildSessionExpiredPath(next: string | null | undefined): string {
  const safeNext = sanitizeLocalRedirectPath(next);
  return `/session-expired?next=${encodeURIComponent(safeNext)}`;
}

export function buildLoginReauthPath(next: string | null | undefined): string {
  const safeNext = sanitizeLocalRedirectPath(next);
  return `/login?redirectTo=${encodeURIComponent(safeNext)}&reason=session_expired`;
}


/**
 * Accepts local paths and same-origin absolute URLs, then applies the strict
 * local redirect sanitizer. Absolute URLs from another origin are rejected.
 */
export function sanitizeRedirectTarget(
  value: string | null | undefined,
  currentOrigin: string | null | undefined,
  fallback = '/',
): string {
  const candidate = normalizeCandidatePath(value);
  if (!candidate) return fallback;

  if (candidate.startsWith('/')) {
    return sanitizeLocalRedirectPath(candidate, fallback);
  }

  if (!currentOrigin) return fallback;

  try {
    const expectedOrigin = new URL(currentOrigin).origin;
    const parsed = new URL(candidate);
    if (parsed.origin !== expectedOrigin) return fallback;

    return sanitizeLocalRedirectPath(
      `${parsed.pathname}${parsed.search}${parsed.hash}`,
      fallback,
    );
  } catch {
    return fallback;
  }
}

export const CANONICAL_WEBSITE_ORIGIN = 'https://datacube.fabianodev.xyz';
export const MOBILE_OAUTH_DESTINATION_KEY = 'dcau:pending-mobile-oauth';
const MOBILE_OAUTH_DESTINATION_TTL = 15 * 60 * 1000;

export function saveMobileOAuthDestination(storage: Pick<Storage, 'setItem' | 'removeItem'>, path: string, now = Date.now()): void {
  if (!isMobileAuthorizationDestination(path)) {
    storage.removeItem(MOBILE_OAUTH_DESTINATION_KEY);
    return;
  }
  storage.setItem(MOBILE_OAUTH_DESTINATION_KEY, JSON.stringify({ path, createdAt: now }));
}

export function readMobileOAuthDestination(storage: Pick<Storage, 'getItem' | 'removeItem'>, now = Date.now()): string | null {
  try {
    const raw = storage.getItem(MOBILE_OAUTH_DESTINATION_KEY);
    if (!raw) return null;
    const pending = JSON.parse(raw);
    if (typeof pending?.path === 'string' && isMobileAuthorizationDestination(pending.path)
      && typeof pending.createdAt === 'number' && Number.isFinite(pending.createdAt)
      && pending.createdAt <= now && now - pending.createdAt <= MOBILE_OAUTH_DESTINATION_TTL) {
      return pending.path;
    }
    storage.removeItem(MOBILE_OAUTH_DESTINATION_KEY);
  } catch {
    // Unavailable storage must never turn an unvalidated URL into a destination.
  }
  return null;
}

export const MOBILE_OAUTH_REQUEST_COOKIE = 'dcau-mobile-pairing-request';
export const MOBILE_OAUTH_REQUEST_MAX_AGE = 5 * 60;

export function mobileApprovalRequestId(path: string | null | undefined): string | null {
  const prefix = MOBILE_AUTH_APPROVAL_PATH + '?request=';
  if (typeof path !== 'string' || !path.startsWith(prefix)) return null;
  const id = path.slice(prefix.length);
  return MOBILE_AUTH_REQUEST_ID.test(id) ? id : null;
}

export function mobileApprovalPath(requestId: string | null | undefined): string | null {
  return typeof requestId === 'string' && MOBILE_AUTH_REQUEST_ID.test(requestId)
    ? `${MOBILE_AUTH_APPROVAL_PATH}?request=${requestId}` : null;
}

export function isDownloadDestination(path: string): boolean {
  const pathname = path.split(/[?#]/, 1)[0].replace(/\/$/, '') || '/';
  return pathname === '/' || pathname === '/download' || pathname === '/mobile-app-required'
    || pathname === '/dashboard' || (pathname.startsWith('/dashboard/') && !pathname.startsWith('/dashboard/settings'))
    || pathname === '/mobile-auth/install';
}

export function looksLikeMobileAuthDestination(value: string | null | undefined): boolean {
  return typeof value === 'string' && /(?:^|\/)mobile-auth(?:\/|\?|$)/.test(value);
}
