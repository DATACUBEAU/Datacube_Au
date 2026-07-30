const OWNER_ADMIN_USER_ID_ENV = 'DATACUBE_OWNER_ADMIN_USER_ID';

export function getProtectedOwnerUserId(): string {
  const configured =
    typeof process !== 'undefined'
      ? process.env?.[OWNER_ADMIN_USER_ID_ENV]
      : null;
  return String(configured || '').trim().toLowerCase();
}

export const PLATFORM_OWNER_USER_ID = getProtectedOwnerUserId();

export function isProtectedOwnerUserId(userId: unknown): boolean {
  const ownerUserId = getProtectedOwnerUserId();
  return Boolean(ownerUserId && String(userId || '').trim().toLowerCase() === ownerUserId);
}
