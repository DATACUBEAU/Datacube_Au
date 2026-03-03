const SERVER_AUTH_COOKIE_NAME = 'sb-access-token';
const EXPIRY_SKEW_SECONDS = 5;
type SessionLike = {
  access_token?: string | null;
  expires_at?: number | null;
} | null;

function isBrowser(): boolean {
  return typeof window !== 'undefined' && typeof document !== 'undefined';
}

function getSecureCookieFlag(): string {
  if (!isBrowser()) return '';
  return window.location.protocol === 'https:' ? '; Secure' : '';
}

function readCookieValue(name: string): string | null {
  if (!isBrowser()) return null;
  const prefix = `${name}=`;
  const cookies = document.cookie ? document.cookie.split(';') : [];
  for (const entry of cookies) {
    const trimmed = entry.trim();
    if (!trimmed.startsWith(prefix)) continue;
    return trimmed.slice(prefix.length);
  }
  return null;
}

export function hasServerAuthSessionCookie(): boolean {
  const value = readCookieValue(SERVER_AUTH_COOKIE_NAME);
  return Boolean(value && value.trim().length > 0);
}

export function clearServerAuthSessionCookie(): void {
  if (!isBrowser()) return;
  document.cookie = `${SERVER_AUTH_COOKIE_NAME}=; Path=/; Max-Age=0; SameSite=Lax${getSecureCookieFlag()}`;
}

export function syncServerAuthSessionCookie(session: SessionLike): void {
  if (!isBrowser()) return;
  if (!session?.access_token) {
    clearServerAuthSessionCookie();
    return;
  }

  const expiresAtSeconds = typeof session.expires_at === 'number' ? session.expires_at : null;
  if (expiresAtSeconds !== null) {
    const nowSeconds = Math.floor(Date.now() / 1000);
    const maxAge = expiresAtSeconds - nowSeconds - EXPIRY_SKEW_SECONDS;
    if (maxAge <= 0) {
      clearServerAuthSessionCookie();
      return;
    }
    document.cookie = `${SERVER_AUTH_COOKIE_NAME}=${encodeURIComponent(session.access_token)}; Path=/; Max-Age=${maxAge}; SameSite=Lax${getSecureCookieFlag()}`;
    return;
  }

  document.cookie = `${SERVER_AUTH_COOKIE_NAME}=${encodeURIComponent(session.access_token)}; Path=/; SameSite=Lax${getSecureCookieFlag()}`;
}
