import assert from 'node:assert/strict';
import {
  buildAppMetadataPatch,
  filterManagedUsers,
  normalizeAdminAssignablePlan,
  normalizeAccountStatus,
  normalizePermissions,
  normalizeUserRole,
  resolveAdminPlanChangeType,
  roleToTier,
  validateBulkUserIds,
  type ManagedUserRecord,
} from '../src/lib/server/admin-user-management.js';

let failed = 0;

function run(name: string, fn: () => void) {
  try {
    fn();
    console.log(`PASS ${name}`);
  } catch (error: any) {
    failed += 1;
    console.error(`FAIL ${name}`);
    console.error(error?.stack || error);
  }
}

const now = new Date('2026-02-20T12:00:00.000Z').toISOString();

const seedUsers: ManagedUserRecord[] = [
  {
    user_id: '11111111-1111-4111-8111-111111111111',
    email: 'alice@example.com',
    full_name: 'Alice Admin',
    avatar_url: null,
    provider: 'supabase',
    created_at: now,
    last_sign_in_at: now,
    last_active_at: now,
    account_status: 'active',
    role: 'admin',
    tier: 'admin',
    permissions: ['users:manage'],
    is_suspended: false,
    is_authorized: true,
  },
  {
    user_id: '22222222-2222-4222-8222-222222222222',
    email: 'bob@example.com',
    full_name: 'Bob Free',
    avatar_url: null,
    provider: 'supabase',
    created_at: '2026-02-19T12:00:00.000Z',
    last_sign_in_at: '2026-02-19T12:00:00.000Z',
    last_active_at: '2026-02-19T12:00:00.000Z',
    account_status: 'inactive',
    role: 'free',
    tier: 'free',
    permissions: ['documents:read'],
    is_suspended: false,
    is_authorized: false,
  },
];

run('status and role normalizers are strict', () => {
  assert.equal(normalizeAccountStatus('active'), 'active');
  assert.equal(normalizeAccountStatus('suspended'), 'suspended');
  assert.equal(normalizeAccountStatus('weird', 'inactive'), 'inactive');

  assert.equal(normalizeUserRole('admin'), 'admin');
  assert.equal(normalizeUserRole('pro'), 'pro');
  assert.equal(normalizeUserRole('unknown', 'user'), 'user');
});

run('permission normalization removes invalid chars and duplicates', () => {
  const normalized = normalizePermissions([' users:manage ', 'USERS:MANAGE', 'bad value!@#', '', null as any]);
  assert.deepEqual(normalized, ['users:manage', 'badvalue']);
});

run('role to tier mapping handles pro and invalid roles safely', () => {
  assert.equal(roleToTier('admin'), 'admin');
  assert.equal(roleToTier('pro'), 'monthly');
  assert.equal(roleToTier('user'), null);
});

run('metadata patch merges status role and permissions correctly', () => {
  const patch = buildAppMetadataPatch(
    { role: 'user', account_status: 'active', permissions: ['documents:read'] },
    { status: 'inactive', role: 'admin', permissions: ['users:manage', 'users:manage'] }
  );

  assert.equal(patch.account_status, 'inactive');
  assert.equal(patch.role, 'admin');
  assert.deepEqual(patch.permissions, ['users:manage']);
});

run('filter users by search/status/role and sort', () => {
  const filtered = filterManagedUsers(seedUsers, {
    q: 'alice',
    status: 'active',
    role: 'admin',
    sortBy: 'email',
    sortDir: 'asc',
  });
  assert.equal(filtered.length, 1);
  assert.equal(filtered[0].email, 'alice@example.com');
});

run('bulk user id validation rejects invalid payloads', () => {
  const valid = validateBulkUserIds([
    '11111111-1111-4111-8111-111111111111',
    '22222222-2222-4222-8222-222222222222',
    '11111111-1111-4111-8111-111111111111',
  ]);

  assert.deepEqual(valid, [
    '11111111-1111-4111-8111-111111111111',
    '22222222-2222-4222-8222-222222222222',
  ]);

  assert.throws(() => validateBulkUserIds('bad' as any), /Expected userIds array/);
  assert.throws(() => validateBulkUserIds(['not-a-uuid']), /Invalid user ID/);
});

run('admin plan assignment normalizes exact supported targets', () => {
  assert.equal(normalizeAdminAssignablePlan('free'), 'free');
  assert.equal(normalizeAdminAssignablePlan('pro'), 'pro_monthly');
  assert.equal(normalizeAdminAssignablePlan('pro_monthly'), 'pro_monthly');
  assert.equal(normalizeAdminAssignablePlan('premium'), 'premium');
  assert.equal(normalizeAdminAssignablePlan('enterprise'), null);
});

run('admin plan assignment classifies every supported transition', () => {
  assert.equal(resolveAdminPlanChangeType({ previousPlan: 'free', targetPlan: 'pro_monthly' }), 'upgrade');
  assert.equal(resolveAdminPlanChangeType({ previousPlan: 'free', targetPlan: 'premium' }), 'upgrade');
  assert.equal(resolveAdminPlanChangeType({ previousPlan: 'pro_monthly', targetPlan: 'premium' }), 'upgrade');
  assert.equal(resolveAdminPlanChangeType({ previousPlan: 'premium', targetPlan: 'pro_monthly' }), 'downgrade');
  assert.equal(resolveAdminPlanChangeType({ previousPlan: 'premium', targetPlan: 'free' }), 'downgrade');
  assert.equal(resolveAdminPlanChangeType({ previousPlan: 'pro_monthly', targetPlan: 'free' }), 'downgrade');
  assert.equal(resolveAdminPlanChangeType({ previousPlan: 'premium', targetPlan: 'premium' }), 'reassignment');
});

if (failed > 0) process.exit(1);
