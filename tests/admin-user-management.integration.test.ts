import assert from 'node:assert/strict';
import { hasConexAccess } from '../src/lib/conex-rbac.js';
import {
  buildAppMetadataPatch,
  parseDeviceSupportReport,
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

run('admin user management denies non-owner profiles regardless of tier', () => {
  const freeAccess = hasConexAccess({
    userId: '33333333-3333-4333-8333-333333333333',
    email: 'free@example.com',
    tier: 'free',
  });
  const verifiedAdminAccess = hasConexAccess({
    userId: '44444444-4444-4444-8444-444444444444',
    email: 'admin@example.com',
    tier: 'admin',
  });

  assert.equal(freeAccess, false);
  assert.equal(verifiedAdminAccess, false);
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

run('device reports are opt-in bounded diagnostic data, not identity or authorization', () => {
  assert.equal(parseDeviceSupportReport(null), null);
  assert.equal(parseDeviceSupportReport({ installation_id: 'raw-imei' }), null);
  const report = parseDeviceSupportReport({ installation_id: '11111111-1111-4111-8111-111111111111',
    manufacturer: 'Example', model: 'Phone', android_version: '15', sdk: 35,
    app_version: '1.0.1006', app_version_code: 1006, reported_at: '2026-11-24T12:00:00Z',
    imei: 'must-not-export', is_admin: true, location: 'must-not-export' });
  assert.equal(report?.model, 'Phone');
  assert.equal(report?.sdk, 35);
  assert.equal(Object.prototype.hasOwnProperty.call(report!, 'imei'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(report!, 'is_admin'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(report!, 'location'), false);
});
