import assert from 'node:assert/strict';
import { hasConexAccess } from '../src/lib/conex-rbac.js';
import {
  buildAppMetadataPatch,
  normalizeAccountStatus,
  normalizePermissions,
  normalizeUserRole,
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

run('permission-level checks deny free users and allow admin tier for Conex management', () => {
  const freeAccess = hasConexAccess({
    userId: '33333333-3333-4333-8333-333333333333',
    email: 'free@example.com',
    tier: 'free',
  });
  const adminAccess = hasConexAccess({
    userId: '44444444-4444-4444-8444-444444444444',
    email: 'admin@example.com',
    tier: 'admin',
  });

  assert.equal(freeAccess, false);
  assert.equal(adminAccess, true);
});

run('bulk metadata patch stays bounded to approved role/status/permission values', () => {
  const patch = buildAppMetadataPatch(
    { role: 'free', account_status: 'active', permissions: ['documents:read'] },
    {
      role: normalizeUserRole('weekly'),
      status: normalizeAccountStatus('inactive'),
      permissions: normalizePermissions(['users:manage', ' users:manage ', 'invalid permission!']),
    }
  );

  assert.equal(patch.role, 'weekly');
  assert.equal(patch.account_status, 'inactive');
  assert.deepEqual(patch.permissions, ['users:manage', 'invalidpermission']);
});

run('invalid role/status values cannot escalate privileges during normalization', () => {
  assert.equal(normalizeUserRole('superadmin', 'user'), 'user');
  assert.equal(normalizeAccountStatus('banned', 'inactive'), 'inactive');
});

if (failed > 0) process.exit(1);

