export const CONEX_ROOT_ADMIN_EMAIL_FALLBACK = 'fabiansazzy1214@gmail.com';
export const CONEX_ROOT_ADMIN_USER_ID = '05ad2f16-b3ce-48eb-bf24-41b407556ffd';

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
  return (
    userId === CONEX_ROOT_ADMIN_USER_ID &&
    (normalizedEmail === CONEX_ROOT_ADMIN_EMAIL || normalizedEmail === CONEX_ROOT_ADMIN_EMAIL_FALLBACK)
  );
}

export function hasConexAccess(subject: ConexAccessSubject): boolean {
  if (isRootConexAdmin(subject.userId, subject.email)) return true;
  return normalizeConexTier(subject.tier) === 'admin';
}

export function toConexTierFromToggle(enabled: boolean): ConexTier {
  return enabled ? 'admin' : 'free';
}
