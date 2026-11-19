import assert from 'node:assert/strict';

const TEST_OWNER_USER_ID = '11111111-1111-4111-8111-111111111111';
process.env.DATACUBE_OWNER_ADMIN_USER_ID = TEST_OWNER_USER_ID;

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

run('Conex root access requires both the protected owner ID and the exact administrator email', () => {
  assert.equal(CONEX_ROOT_ADMIN_EMAIL, 'fabiansazzy1214@gmail.com');
  assert.equal(CONEX_ROOT_ADMIN_USER_ID, TEST_OWNER_USER_ID);
  assert.equal(isRootConexAdmin(TEST_OWNER_USER_ID, 'fabiansazzy1214@gmail.com'), true);
  assert.equal(isRootConexAdmin(TEST_OWNER_USER_ID, 'FABIANSAZZY1214@GMAIL.COM'), true);
  assert.equal(isRootConexAdmin(TEST_OWNER_USER_ID, 'someone-else@gmail.com'), false);
  assert.equal(isRootConexAdmin('00000000-0000-0000-0000-000000000000', CONEX_ROOT_ADMIN_EMAIL), false);
});

run('profile tier and browser-visible claims cannot bypass the owner email and ID checks', () => {
  assert.equal(hasConexAccess({ userId: TEST_OWNER_USER_ID, email: CONEX_ROOT_ADMIN_EMAIL, tier: 'free' }), true);
  assert.equal(hasConexAccess({ userId: TEST_OWNER_USER_ID, email: 'someone-else@gmail.com', tier: 'admin' }), false);
  assert.equal(hasConexAccess({ userId: '22222222-2222-4222-8222-222222222222', email: CONEX_ROOT_ADMIN_EMAIL, tier: 'admin' }), false);
  assert.equal(hasConexAccess({ userId: '22222222-2222-4222-8222-222222222222', email: 'someone-else@gmail.com', tier: 'free' }), false);
});

run('missing protected owner configuration fails closed', () => {
  const previous = process.env.DATACUBE_OWNER_ADMIN_USER_ID;
  delete process.env.DATACUBE_OWNER_ADMIN_USER_ID;
  try {
    assert.equal(isRootConexAdmin(TEST_OWNER_USER_ID, CONEX_ROOT_ADMIN_EMAIL), false);
    assert.equal(hasConexAccess({ userId: TEST_OWNER_USER_ID, email: CONEX_ROOT_ADMIN_EMAIL, tier: 'admin' }), false);
  } finally {
    process.env.DATACUBE_OWNER_ADMIN_USER_ID = previous;
  }
});

run('normalizeConexTier and toggle mapping are strict', () => {
  assert.equal(normalizeConexTier('admin'), 'admin');
  assert.equal(normalizeConexTier('free'), 'free');
  assert.equal(normalizeConexTier('pro'), null);
  assert.equal(toConexTierFromToggle(true), 'admin');
  assert.equal(toConexTierFromToggle(false), 'free');
});

if (failed > 0) process.exit(1);
