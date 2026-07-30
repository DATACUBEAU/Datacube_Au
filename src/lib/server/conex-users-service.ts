import { isProtectedOwnerUserId } from '../admin/protected-owner';
import { hasConexAccess, normalizeConexTier, type ConexTier } from '../conex-rbac';

export type ConexActor = {
  userId: string;
  email?: string | null;
};

export type ConexProfileRow = {
  user_id: string;
  tier?: string | null;
  full_name?: string | null;
  avatar_url?: string | null;
};

export type ConexDashboardUser = {
  user_id: string;
  tier: ConexTier;
  full_name: string | null;
  avatar_url: string | null;
  is_authorized: boolean;
  is_protected_owner: boolean;
};

export interface ConexUsersRepository {
  getProfileByUserId(userId: string): Promise<ConexProfileRow | null>;
  listProfiles(): Promise<ConexProfileRow[]>;
  upsertTier(userId: string, tier: ConexTier): Promise<ConexProfileRow | null>;
}

export class ConexAccessError extends Error {
  status: number;
  code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function assertConexUserId(userId: string): void {
  if (!UUID_RE.test(String(userId ?? ''))) {
    throw new ConexAccessError(400, 'invalid_user_id', 'Invalid user_id. Expected UUID.');
  }
}

export function assertActorCanManageConex(actor: ConexActor, profile: ConexProfileRow | null): void {
  const isAllowed = hasConexAccess({
    userId: actor.userId,
    email: actor.email ?? null,
    tier: profile?.tier ?? null,
  });

  if (!isAllowed) {
    throw new ConexAccessError(403, 'forbidden', 'Forbidden: admin tier required for /conex access management.');
  }
}

export function buildConexDashboardUsers(rows: ConexProfileRow[]): {
  users: ConexDashboardUser[];
  authorizedUsers: ConexDashboardUser[];
} {
  const users = rows.map((row) => {
    const tier = normalizeConexTier(row.tier) ?? 'free';
    const item: ConexDashboardUser = {
      user_id: row.user_id,
      tier,
      full_name: row.full_name ?? null,
      avatar_url: row.avatar_url ?? null,
      is_authorized: tier === 'admin',
      is_protected_owner: isProtectedOwnerUserId(row.user_id),
    };
    return item;
  });

  users.sort((a, b) => {
    if (a.is_authorized !== b.is_authorized) return a.is_authorized ? -1 : 1;
    const aName = (a.full_name || a.user_id).toLowerCase();
    const bName = (b.full_name || b.user_id).toLowerCase();
    return aName.localeCompare(bName);
  });

  return {
    users,
    authorizedUsers: users.filter((user) => user.is_authorized),
  };
}

export async function listConexDashboardUsers(
  repo: ConexUsersRepository,
  actor: ConexActor
): Promise<{ users: ConexDashboardUser[]; authorizedUsers: ConexDashboardUser[] }> {
  const actorProfile = await repo.getProfileByUserId(actor.userId);
  assertActorCanManageConex(actor, actorProfile);
  const rows = await repo.listProfiles();
  return buildConexDashboardUsers(rows);
}

export async function setConexTierForUser(
  repo: ConexUsersRepository,
  actor: ConexActor,
  targetUserId: string,
  nextTierRaw: unknown
): Promise<ConexDashboardUser> {
  const actorProfile = await repo.getProfileByUserId(actor.userId);
  assertActorCanManageConex(actor, actorProfile);
  assertConexUserId(targetUserId);

  const nextTier = normalizeConexTier(nextTierRaw);
  if (!nextTier) {
    throw new ConexAccessError(400, 'invalid_tier', "Invalid tier. Expected 'admin' or 'free'.");
  }

  if (isProtectedOwnerUserId(targetUserId) && nextTier !== 'admin') {
    throw new ConexAccessError(400, 'protected_user', 'Cannot revoke root admin access.');
  }

  const updated = await repo.upsertTier(targetUserId, nextTier);
  if (!updated) {
    throw new ConexAccessError(500, 'update_failed', 'Failed to update user tier.');
  }

  const tier = normalizeConexTier(updated.tier) ?? nextTier;
  return {
    user_id: updated.user_id,
    tier,
    full_name: updated.full_name ?? null,
    avatar_url: updated.avatar_url ?? null,
    is_authorized: tier === 'admin',
    is_protected_owner: isProtectedOwnerUserId(updated.user_id),
  };
}
