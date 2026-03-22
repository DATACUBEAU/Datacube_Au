import assert from 'node:assert/strict';
import { shouldDispatchSessionExpiry } from '../src/lib/auth/session-expiry-policy.js';

let failed = 0;

type AsyncTest = () => void | Promise<void>;

async function run(name: string, fn: AsyncTest) {
  try {
    await fn();
    console.log(`PASS ${name}`);
  } catch (error: any) {
    failed += 1;
    console.error(`FAIL ${name}`);
    console.error(error?.stack || error);
  }
}

async function main() {
  await run('refresh bootstrap with a valid restoring session does not force reauthenticate', () => {
    assert.equal(
      shouldDispatchSessionExpiry({
        status: 401,
        runtimeState: 'RESTORING',
        isOnline: true,
      }),
      false,
    );
  });

  await run('offline state does not trigger reauthenticate for a cached signed-in user', () => {
    assert.equal(
      shouldDispatchSessionExpiry({
        status: 401,
        runtimeState: 'AUTHENTICATED',
        isOnline: false,
      }),
      false,
    );
  });

  await run('forbidden responses do not masquerade as expired sessions', () => {
    assert.equal(
      shouldDispatchSessionExpiry({
        status: 403,
        runtimeState: 'AUTHENTICATED',
        isOnline: true,
      }),
      false,
    );
  });

  await run('real online 401 failures still surface reauthentication', () => {
    assert.equal(
      shouldDispatchSessionExpiry({
        status: 401,
        runtimeState: 'AUTHENTICATED',
        isOnline: true,
      }),
      true,
    );
  });

  if (failed > 0) {
    process.exit(1);
  }
}

void main();
