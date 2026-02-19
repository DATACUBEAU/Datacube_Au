import assert from 'node:assert/strict';
import { CONEX_ROOT_ADMIN_EMAIL, CONEX_ROOT_ADMIN_USER_ID } from '../src/lib/conex-rbac.js';
import {
  ConexAccessError,
  listConexDashboardUsers,
  setConexTierForUser,
  type ConexProfileRow,
  type ConexUsersRepository,
} from '../src/lib/server/conex-users-service.js';

let failed = 0;

async function run(name: string, fn: () => Promise<void>) {
  try {
    await fn();
    console.log(`PASS ${name}`);
  } catch (error: any) {
    failed += 1;
    console.error(`FAIL ${name}`);
    console.error(error?.stack || error);
  }
}

class InMemoryConexRepo implements ConexUsersRepository {
  private rows: Map<string, ConexProfileRow>;

  constructor(seed: ConexProfileRow[]) {
    this.rows = new Map(seed.map((row) => [row.user_id, { ...row }]));
  }

  async getProfileByUserId(userId: string): Promise<ConexProfileRow | null> {
    return this.rows.get(userId) ?? null;
  }

  async listProfiles(): Promise<ConexProfileRow[]> {
    return [...this.rows.values()];
  }

  async upsertTier(userId: string, tier: 'admin' | 'free'): Promise<ConexProfileRow | null> {
    const existing = this.rows.get(userId);
    const next: ConexProfileRow = {
      user_id: userId,
      tier,
      full_name: existing?.full_name ?? null,
      avatar_url: existing?.avatar_url ?? null,
    };
    this.rows.set(userId, next);
    return next;
  }
}

const bootstrapAdmin = {
  user_id: CONEX_ROOT_ADMIN_USER_ID,
  tier: 'admin',
  full_name: 'Root Admin',
  avatar_url: 'https://example.com/root.png',
} satisfies ConexProfileRow;

const targetUser = {
  user_id: '91f4f16d-211d-4eb8-8ed1-2f41f2a6f4e4',
  tier: 'free',
  full_name: 'Target User',
  avatar_url: 'https://example.com/target.png',
} satisfies ConexProfileRow;

const freeActor = {
  user_id: 'b5415935-3bb9-4e3b-a4f6-e12f95b31f40',
  tier: 'free',
  full_name: 'No Access',
  avatar_url: 'https://example.com/noaccess.png',
} satisfies ConexProfileRow;

run('access control cannot be bypassed by non-admin actor', async () => {
  const repo = new InMemoryConexRepo([bootstrapAdmin, targetUser, freeActor]);

  await assert.rejects(
    async () => {
      await setConexTierForUser(
        repo,
        { userId: freeActor.user_id, email: 'unauthorized@example.com' },
        targetUser.user_id,
        'admin'
      );
    },
    (error: any) =>
      error instanceof ConexAccessError &&
      error.status === 403 &&
      error.code === 'forbidden'
  );
});

run('toggle switch persistence updates tier in repository', async () => {
  const repo = new InMemoryConexRepo([bootstrapAdmin, targetUser]);

  const updated = await setConexTierForUser(
    repo,
    { userId: CONEX_ROOT_ADMIN_USER_ID, email: CONEX_ROOT_ADMIN_EMAIL },
    targetUser.user_id,
    'admin'
  );

  assert.equal(updated.tier, 'admin');

  const persisted = await repo.getProfileByUserId(targetUser.user_id);
  assert.equal(persisted?.tier, 'admin');
});

run('dashboard list includes authorized users with avatar_url and full_name', async () => {
  const repo = new InMemoryConexRepo([bootstrapAdmin, targetUser]);

  await setConexTierForUser(
    repo,
    { userId: CONEX_ROOT_ADMIN_USER_ID, email: CONEX_ROOT_ADMIN_EMAIL },
    targetUser.user_id,
    'admin'
  );

  const dashboard = await listConexDashboardUsers(repo, {
    userId: CONEX_ROOT_ADMIN_USER_ID,
    email: CONEX_ROOT_ADMIN_EMAIL,
  });

  const authorizedTarget = dashboard.authorizedUsers.find((user) => user.user_id === targetUser.user_id);
  assert.ok(authorizedTarget);
  assert.equal(authorizedTarget?.full_name, 'Target User');
  assert.equal(authorizedTarget?.avatar_url, 'https://example.com/target.png');
});

process.on('beforeExit', () => {
  if (failed > 0) process.exitCode = 1;
});
