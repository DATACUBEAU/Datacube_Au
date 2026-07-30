import assert from 'node:assert/strict';

const TEST_OWNER_USER_ID = '11111111-1111-4111-8111-111111111111';
const TEST_OWNER_EMAIL = 'owner@example.test';
process.env.DATACUBE_OWNER_ADMIN_USER_ID = TEST_OWNER_USER_ID;
process.env.CONEX_ROOT_ADMIN_EMAIL = TEST_OWNER_EMAIL;

const {
  CONEX_ROOT_ADMIN_EMAIL,
  CONEX_ROOT_ADMIN_USER_ID,
  hasConexAccess,
  isRootConexAdmin,
  normalizeConexTier,
  toConexTierFromToggle,
} = require('../src/lib/conex-rbac.js') as typeof import('../src/lib/conex-rbac.js');

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

run('isRootConexAdmin allows bootstrap identity by known id or known email aliases', () => {
  assert.equal(isRootConexAdmin(CONEX_ROOT_ADMIN_USER_ID, CONEX_ROOT_ADMIN_EMAIL), true);
  assert.equal(isRootConexAdmin(CONEX_ROOT_ADMIN_USER_ID, 'wrong@example.com'), true);
  assert.equal(isRootConexAdmin('00000000-0000-0000-0000-000000000000', CONEX_ROOT_ADMIN_EMAIL), true);
  assert.equal(isRootConexAdmin('00000000-0000-0000-0000-000000000000', 'not-admin@example.com'), false);
});

run('hasConexAccess allows admin tier and denies free tier', () => {
  assert.equal(hasConexAccess({ userId: '22222222-2222-4222-8222-222222222222', email: 'user@example.com', tier: 'admin' }), true);
  assert.equal(hasConexAccess({ userId: '22222222-2222-4222-8222-222222222222', email: 'user@example.com', tier: 'free' }), false);
});

run('normalizeConexTier and toggle mapping are strict', () => {
  assert.equal(normalizeConexTier('admin'), 'admin');
  assert.equal(normalizeConexTier('free'), 'free');
  assert.equal(normalizeConexTier('pro'), null);
  assert.equal(toConexTierFromToggle(true), 'admin');
  assert.equal(toConexTierFromToggle(false), 'free');
});

if (failed > 0) process.exit(1);
