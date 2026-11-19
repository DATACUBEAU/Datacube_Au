import { getProtectedOwnerUserId, isProtectedOwnerUserId } from './admin/protected-owner';

export const CONEX_ROOT_ADMIN_EMAIL = String(
  process.env.CONEX_ROOT_ADMIN_EMAIL ?? ''
)
  .trim()
  .toLowerCase();
export const CONEX_ROOT_ADMIN_EMAIL_FALLBACK = String(
  process.env.CONEX_ROOT_ADMIN_EMAIL_FALLBACK ?? ''
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
  void email;
  return isProtectedOwnerUserId(userId);
}

export function hasConexAccess(subject: ConexAccessSubject): boolean {
  // The authenticated Supabase user is matched to the server-read profile row.
  // The current database has one admin-tier account; browser-supplied tier claims are never used.
  return isRootConexAdmin(subject.userId, subject.email) || normalizeConexTier(subject.tier) === 'admin';
}

export function toConexTierFromToggle(enabled: boolean): ConexTier {
  return enabled ? 'admin' : 'free';
}
