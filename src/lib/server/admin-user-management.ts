export const ACCOUNT_STATUSES = ['active', 'inactive', 'suspended'] as const;
export type AccountStatus = (typeof ACCOUNT_STATUSES)[number];

export const USER_ROLES = ['admin', 'free', 'weekly', 'monthly', 'pro', 'user'] as const;
export type UserRole = (typeof USER_ROLES)[number];

export type ManagedUserRecord = {
  user_id: string;
  email: string | null;
  full_name: string | null;
  avatar_url: string | null;
  provider: string | null;
  created_at: string | null;
  last_sign_in_at: string | null;
  last_active_at: string | null;
  account_status: AccountStatus;
  role: UserRole;
  tier: string | null;
  permissions: string[];
  is_suspended: boolean;
  is_authorized: boolean;
};

export type ManagedUserFilter = {
  q?: string;
  status?: 'all' | AccountStatus;
  role?: 'all' | UserRole;
  presence?: 'all' | 'online' | 'offline';
  sortBy?: 'created_at' | 'last_active_at' | 'email' | 'full_name';
  sortDir?: 'asc' | 'desc';
};

export type ManagedUserPatch = {
  status?: unknown;
  role?: unknown;
  permissions?: unknown;
};

export function normalizeAccountStatus(value: unknown, fallback: AccountStatus = 'active'): AccountStatus {
  const normalized = String(value ?? '').trim().toLowerCase();
  if (normalized === 'active') return 'active';
  if (normalized === 'inactive') return 'inactive';
  if (normalized === 'suspended') return 'suspended';
  return fallback;
}

export function normalizeUserRole(value: unknown, fallback: UserRole = 'user'): UserRole {
  const normalized = String(value ?? '').trim().toLowerCase();
  if (normalized === 'admin') return 'admin';
  if (normalized === 'free') return 'free';
  if (normalized === 'weekly') return 'weekly';
  if (normalized === 'monthly') return 'monthly';
  if (normalized === 'pro') return 'pro';
  if (normalized === 'user') return 'user';
  return fallback;
}

export function normalizePermissions(value: unknown): string[] {
  if (!Array.isArray(value)) return [];

  const unique = new Set<string>();
  for (const raw of value) {
    const normalized = String(raw ?? '')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9:_-]/g, '');
    if (!normalized) continue;
    unique.add(normalized);
  }

  return [...unique];
}

export function roleToTier(role: unknown): 'admin' | 'free' | 'weekly' | 'monthly' | null {
  const normalized = normalizeUserRole(role, 'user');
  if (normalized === 'admin') return 'admin';
  if (normalized === 'free') return 'free';
  if (normalized === 'weekly') return 'weekly';
  if (normalized === 'monthly') return 'monthly';
  if (normalized === 'pro') return 'monthly';
  return null;
}

export function buildAppMetadataPatch(
  current: Record<string, unknown> | null | undefined,
  patch: ManagedUserPatch
): Record<string, unknown> {
  const next: Record<string, unknown> = { ...(current ?? {}) };
  if (patch.status !== undefined) {
    next.account_status = normalizeAccountStatus(patch.status);
  }
  if (patch.role !== undefined) {
    next.role = normalizeUserRole(patch.role);
  }
  if (patch.permissions !== undefined) {
    next.permissions = normalizePermissions(patch.permissions);
  }
  return next;
}

export function filterManagedUsers(rows: ManagedUserRecord[], filters: ManagedUserFilter): ManagedUserRecord[] {
  const normalizedQ = String(filters.q ?? '').trim().toLowerCase();
  const status = filters.status ?? 'all';
  const role = filters.role ?? 'all';
  const presence = filters.presence ?? 'all';
  const sortBy = filters.sortBy ?? 'last_active_at';
  const sortDir = filters.sortDir === 'asc' ? 'asc' : 'desc';
  const onlineWindowMs = 5 * 60 * 1000;

  let filtered = rows.slice();

  if (status !== 'all') {
    filtered = filtered.filter((row) => row.account_status === status);
  }

  if (role !== 'all') {
    filtered = filtered.filter((row) => row.role === role);
  }

  if (presence !== 'all') {
    filtered = filtered.filter((row) => {
      const timestamp = row.last_active_at ? new Date(String(row.last_active_at)).getTime() : 0;
      const online = timestamp > 0 && Date.now() - timestamp <= onlineWindowMs;
      return presence === 'online' ? online : !online;
    });
  }

  if (normalizedQ) {
    filtered = filtered.filter((row) => {
      const email = String(row.email ?? '').toLowerCase();
      const name = String(row.full_name ?? '').toLowerCase();
      const userId = String(row.user_id ?? '').toLowerCase();
      return email.includes(normalizedQ) || name.includes(normalizedQ) || userId.includes(normalizedQ);
    });
  }

  const direction = sortDir === 'asc' ? 1 : -1;

  filtered.sort((a, b) => {
    const aVal = (a as Record<string, unknown>)[sortBy];
    const bVal = (b as Record<string, unknown>)[sortBy];

    if (sortBy.endsWith('_at')) {
      const aTs = aVal ? new Date(String(aVal)).getTime() : 0;
      const bTs = bVal ? new Date(String(bVal)).getTime() : 0;
      return direction * (aTs - bTs);
    }

    return direction * String(aVal ?? '').localeCompare(String(bVal ?? ''));
  });

  return filtered;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function validateBulkUserIds(value: unknown, max = 200): string[] {
  if (!Array.isArray(value)) {
    throw new Error('Expected userIds array.');
  }

  const unique = [...new Set(value.map((item) => String(item ?? '').trim()))].filter(Boolean);
  if (unique.length === 0) {
    throw new Error('userIds array is empty.');
  }
  if (unique.length > max) {
    throw new Error(`Too many user IDs. Maximum is ${max}.`);
  }

  for (const userId of unique) {
    if (!UUID_RE.test(userId)) {
      throw new Error(`Invalid user ID: ${userId}`);
    }
  }

  return unique;
}
