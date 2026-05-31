export const PLATFORM_OWNER_USER_ID = '05ad2f16-b3ce-48eb-bf24-41b407556ffd';

export function isProtectedOwnerUserId(userId: unknown): boolean {
  return String(userId || '').trim().toLowerCase() === PLATFORM_OWNER_USER_ID;
}
