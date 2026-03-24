import assert from 'node:assert/strict';
import {
  shouldDeferProtectedRequest,
  shouldDispatchSessionExpiry,
} from '../src/lib/auth/session-expiry-policy.js';

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
        intent: 'interactive',
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
        intent: 'interactive',
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
        intent: 'interactive',
      }),
      false,
    );
  });

  await run('background analytics or polling failures do not trigger reauthenticate', () => {
    assert.equal(
      shouldDispatchSessionExpiry({
        status: 401,
        runtimeState: 'AUTHENTICATED',
        isOnline: true,
        intent: 'background',
      }),
      false,
    );
  });

  await run('bootstrap-time 401 failures do not trigger reauthenticate', () => {
    assert.equal(
      shouldDispatchSessionExpiry({
        status: 401,
        runtimeState: 'AUTHENTICATED',
        isOnline: true,
        intent: 'bootstrap',
      }),
      false,
    );
  });

  await run('degraded backend 5xx responses do not masquerade as auth expiry', () => {
    assert.equal(
      shouldDispatchSessionExpiry({
        status: 503,
        runtimeState: 'AUTHENTICATED',
        isOnline: true,
        intent: 'interactive',
      }),
      false,
    );
  });

  await run('real online interactive 401 failures still surface reauthentication', () => {
    assert.equal(
      shouldDispatchSessionExpiry({
        status: 401,
        runtimeState: 'AUTHENTICATED',
        isOnline: true,
        intent: 'interactive',
      }),
      true,
    );
  });

  await run('protected background data waits for auth bootstrap to settle', () => {
    assert.equal(
      shouldDeferProtectedRequest({
        isAuthLoading: true,
        isAuthRestoring: false,
        isAuthLocked: false,
      }),
      true,
    );
    assert.equal(
      shouldDeferProtectedRequest({
        isAuthLoading: false,
        isAuthRestoring: true,
        isAuthLocked: false,
      }),
      true,
    );
    assert.equal(
      shouldDeferProtectedRequest({
        isAuthLoading: false,
        isAuthRestoring: false,
        isAuthLocked: true,
      }),
      true,
    );
    assert.equal(
      shouldDeferProtectedRequest({
        isAuthLoading: false,
        isAuthRestoring: false,
        isAuthLocked: false,
      }),
      false,
    );
  });

  if (failed > 0) {
    process.exit(1);
  }
}

void main();
