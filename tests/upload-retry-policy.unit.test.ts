import assert from 'node:assert/strict';
import { isRetryableUploadError } from '../src/lib/upload/retry-policy';

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

run('retries transient server failures', () => {
  assert.equal(isRetryableUploadError({ status: 500 }), true);
  assert.equal(isRetryableUploadError({ status: 503 }), true);
  assert.equal(isRetryableUploadError({ code: 'storage_error' }), true);
  assert.equal(isRetryableUploadError({ code: 'UPSTREAM_TIMEOUT' }), true);
  assert.equal(isRetryableUploadError({ message: 'Failed to fetch upload endpoint' }), true);
  assert.equal(isRetryableUploadError({ details: { error: { code: 'network_error' } } }), true);
});

run('does not retry client, auth, conflict, size, validation, or throttling responses', () => {
  for (const status of [400, 401, 403, 404, 409, 410, 413, 422, 429]) {
    assert.equal(isRetryableUploadError({ status }), false, `status ${status}`);
  }
});

run('schema compatibility failures fail closed even when surfaced as 5xx', () => {
  assert.equal(
    isRetryableUploadError({ status: 500, code: 'schema_mismatch' }),
    false,
  );
  assert.equal(
    isRetryableUploadError({ status: 503, message: 'Database schema mismatch; apply latest migrations' }),
    false,
  );
  assert.equal(
    isRetryableUploadError({
      status: 500,
      details: { error: { code: 'DB_MIGRATION_REQUIRED' } },
    }),
    false,
  );
  assert.equal(
    isRetryableUploadError({
      status: 500,
      details: { message: 'Required upload finalize RPC is missing' },
    }),
    false,
  );
});

run('unknown and empty errors are not retried automatically', () => {
  assert.equal(isRetryableUploadError(undefined), false);
  assert.equal(isRetryableUploadError(null), false);
  assert.equal(isRetryableUploadError({}), false);
  assert.equal(isRetryableUploadError({ code: 'validation_failed' }), false);
});

if (failed > 0) process.exit(1);
