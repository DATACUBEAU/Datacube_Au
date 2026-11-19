import { getProtectedOwnerUserId, isProtectedOwnerUserId } from './admin/protected-owner';

// The browser UI never grants admin access. The signed-in Supabase identity must
// match both this verified email and the configured protected owner user ID.
export const CONEX_ROOT_ADMIN_EMAIL = 'fabiansazzy1214@gmail.com';
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
  return isProtectedOwnerUserId(userId) && normalizedEmail === CONEX_ROOT_ADMIN_EMAIL;
}

export function hasConexAccess(subject: ConexAccessSubject): boolean {
  return isRootConexAdmin(subject.userId, subject.email);
}

export function toConexTierFromToggle(enabled: boolean): ConexTier {
  return enabled ? 'admin' : 'free';
}
