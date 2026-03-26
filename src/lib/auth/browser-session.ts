import type { Session } from '@supabase/supabase-js';

export const SUPABASE_SESSION_EXPIRY_SKEW_MS = 5_000;

export function normalizeUsableSupabaseSession(
  candidate: Session | null | undefined,
  nowMs = Date.now(),
): Session | null {
  if (!candidate?.user?.id || !candidate?.access_token) return null;

  const expiresAt = typeof candidate.expires_at === 'number' ? candidate.expires_at : null;
  if (expiresAt !== null && expiresAt * 1000 <= nowMs + SUPABASE_SESSION_EXPIRY_SKEW_MS) {
    return null;
  }

  return candidate;
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
