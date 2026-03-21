import assert from 'node:assert/strict';
import {
  classifyAuthFailure,
  isAuthenticationFailure,
  isAuthorizationFailure,
} from '../src/lib/auth/auth-error-classification.js';

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

run('reclassifies unauthorized catch payloads that were previously mislabeled as internal errors', () => {
  const result = classifyAuthFailure({
    status: 500,
    code: 'INTERNAL_SERVER_ERROR',
    message: 'internal_server_error',
    details: 'unauthorized',
  });

  assert.ok(result);
  assert.equal(result?.status, 401);
  assert.equal(result?.code, 'UNAUTHORIZED');
  assert.equal(result?.reason, 'unauthorized');
});

run('keeps explicit forbidden errors mapped to 403', () => {
  const result = classifyAuthFailure({
    status: 403,
    code: 'TIER_ACCESS_DENIED',
    message: 'Access denied.',
    details: { reason: 'permission_denied' },
  });

  assert.ok(result);
  assert.equal(result?.status, 403);
  assert.equal(result?.code, 'FORBIDDEN');
  assert.equal(result?.reason, 'permission_denied');
  assert.equal(isAuthorizationFailure(result), true);
});

run('does not classify genuine infrastructure failures as auth failures', () => {
  const result = classifyAuthFailure({
    status: 500,
    code: 'UPSTREAM_TIMEOUT',
    message: 'upstream_timeout',
    details: { timeoutMs: 120000 },
  });

  assert.equal(result, null);
  assert.equal(isAuthenticationFailure(result), false);
});

if (failed > 0) process.exit(1);
