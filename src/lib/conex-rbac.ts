import { getProtectedOwnerUserId, isProtectedOwnerUserId } from './admin/protected-owner';

export const CONEX_ROOT_ADMIN_EMAIL = String(
  process.env.NEXT_PUBLIC_CONEX_ROOT_ADMIN_EMAIL ?? process.env.CONEX_ROOT_ADMIN_EMAIL ?? ''
)
  .trim()
  .toLowerCase();
export const CONEX_ROOT_ADMIN_EMAIL_FALLBACK = String(
  process.env.NEXT_PUBLIC_CONEX_ROOT_ADMIN_EMAIL_FALLBACK ?? process.env.CONEX_ROOT_ADMIN_EMAIL_FALLBACK ?? ''
)
  .trim()
  .toLowerCase();
export const CONEX_ROOT_ADMIN_USER_ID = getProtectedOwnerUserId();

export type ConexTier = 'admin' | 'free';

export type ConexAccessSubject = {
  userId: string;
  email?: string | null;
  tier?: string | null;
};

export function normalizeConexTier(value: unknown): ConexTier | null {
  const normalized = String(value ?? '').trim().toLowerCase();
  if (normalized === 'admin') return 'admin';
  if (normalized === 'free') return 'free';
  return null;
}

export function isRootConexAdmin(userId: string, email?: string | null): boolean {
  const normalizedEmail = String(email ?? '').trim().toLowerCase();
  const emailMatch =
    normalizedEmail === CONEX_ROOT_ADMIN_EMAIL || normalizedEmail === CONEX_ROOT_ADMIN_EMAIL_FALLBACK;
  const idMatch = isProtectedOwnerUserId(userId);

  // Allow either verified root email or known root user_id.
  // This prevents lockout when auth provider/user migration changes one side.
  return emailMatch || idMatch;
}

export function hasConexAccess(subject: ConexAccessSubject): boolean {
  if (isRootConexAdmin(subject.userId, subject.email)) return true;
  return normalizeConexTier(subject.tier) === 'admin';
}

export function toConexTierFromToggle(enabled: boolean): ConexTier {
  return enabled ? 'admin' : 'free';
}
