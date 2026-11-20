const AUTH_PUBLIC_PREFIXES = ['/login', '/signup', '/auth/callback', '/session-expired'] as const;

function normalizeCandidatePath(value: string | null | undefined): string {
  return String(value || '').trim();
}

export function isPublicAuthPath(pathname: string | null | undefined): boolean {
  const normalized = normalizeCandidatePath(pathname).replace(/\/$/, '') || '/';
  return AUTH_PUBLIC_PREFIXES.some((prefix) => normalized === prefix || normalized.startsWith(`${prefix}/`));
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
    const nextPath = `${parsed.pathname}${parsed.search}${parsed.hash}`;
    if (isPublicAuthPath(parsed.pathname)) return fallback;
    return nextPath || fallback;
  } catch {
    return fallback;
  }
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
