import type { Session } from '@supabase/supabase-js';

export const SUPABASE_SESSION_EXPIRY_SKEW_MS = 5_000;
export const SUPABASE_SESSION_REFRESH_WINDOW_MS = 60_000;

export function getSupabaseSessionExpiryMs(candidate: Session | null | undefined): number | null {
  return typeof candidate?.expires_at === 'number' ? candidate.expires_at * 1000 : null;
}

export function normalizeUsableSupabaseSession(
  candidate: Session | null | undefined,
  nowMs = Date.now(),
): Session | null {
  if (!candidate?.user?.id || !candidate?.access_token) return null;

  const expiresAtMs = getSupabaseSessionExpiryMs(candidate);
  if (expiresAtMs !== null && expiresAtMs <= nowMs + SUPABASE_SESSION_EXPIRY_SKEW_MS) {
    return null;
  }

  return candidate;
}

export function shouldRefreshSupabaseSession(
  candidate: Session | null | undefined,
  nowMs = Date.now(),
  refreshWindowMs = SUPABASE_SESSION_REFRESH_WINDOW_MS,
): boolean {
  if (!candidate?.user?.id || !candidate?.refresh_token) return false;

  const expiresAtMs = getSupabaseSessionExpiryMs(candidate);
  if (expiresAtMs === null) {
    return !candidate.access_token;
  }

  return expiresAtMs <= nowMs + Math.max(refreshWindowMs, SUPABASE_SESSION_EXPIRY_SKEW_MS);
}

export function selectUsableSupabaseSession(
  ...candidates: Array<Session | null | undefined>
): Session | null {
  for (const candidate of candidates) {
    const normalized = normalizeUsableSupabaseSession(candidate);
    if (normalized) return normalized;
  }

  return null;
}
