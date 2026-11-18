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
  fallback = '/checkout',
): string {
  const candidate = normalizeCandidatePath(value);
  if (!candidate || !candidate.startsWith('/') || candidate.startsWith('//')) return fallback;
  if (/^[a-z][a-z0-9+.-]*:/i.test(candidate)) return fallback;

  try {
    const parsed = new URL(candidate, 'https://datacube.local');
    if (parsed.origin !== 'https://datacube.local') return fallback;
    const pathname = parsed.pathname.replace(/\/$/, '') || '/';
    if (isPublicAuthPath(pathname)) return fallback;

    // Browser navigation is restricted to the checkout, admin console and the
    // short-lived website-to-native authentication handoff.
    const allowed =
      pathname === '/checkout' ||
      pathname === '/conex' ||
      pathname.startsWith('/conex/') ||
      pathname === '/mobile-auth/complete' ||
      pathname === '/mobile-auth/install';
    if (!allowed) return fallback;

    return `${pathname}${parsed.search}${parsed.hash}`;
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
