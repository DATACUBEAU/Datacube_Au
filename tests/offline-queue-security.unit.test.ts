import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  canReplayQueuedWriteForUser,
  sanitizeQueuedWriteHeaders,
} from '../src/lib/offline/write-queue';

async function run(name: string, fn: () => void | Promise<void>) {
  try {
    await fn();
    console.log(`ok - ${name}`);
  } catch (error) {
    console.error(`not ok - ${name}`);
    throw error;
  }
}

function readRepoFile(...segments: string[]): string {
  return readFileSync(path.join(process.cwd(), ...segments), 'utf8');
}

async function main() {
  await run('queued write headers strip Authorization, cookies, API keys, tokens, and secrets', () => {
    const sanitized = sanitizeQueuedWriteHeaders({
      Authorization: 'Bearer secret',
      Cookie: 'sb-access-token=secret',
      apikey: 'public-or-private-key',
      'x-api-key': 'key',
      'x-admin-token': 'admin-token',
      'x-refresh-token': 'refresh',
      'x-secret-value': 'secret',
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'x-idempotency-key': 'safe-idempotency-key',
    });

    assert.deepEqual(sanitized, {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'x-idempotency-key': 'safe-idempotency-key',
    });
  });

  await run('private queued writes replay only for the same authenticated user', () => {
    assert.equal(canReplayQueuedWriteForUser({ requires_auth: true, user_id: 'user-1' }, 'user-1'), true);
    assert.equal(canReplayQueuedWriteForUser({ requires_auth: true, user_id: 'user-1' }, 'user-2'), false);
    assert.equal(canReplayQueuedWriteForUser({ requires_auth: true, user_id: 'user-1' }, null), false);
    assert.equal(canReplayQueuedWriteForUser({ requires_auth: undefined as any, user_id: 'user-1' }, 'user-1'), true);
    assert.equal(canReplayQueuedWriteForUser({ requires_auth: undefined as any, user_id: 'user-1' }, null), false);
    assert.equal(canReplayQueuedWriteForUser({ requires_auth: false, user_id: null }, null), true);
  });

  await run('offline replay obtains fresh auth at replay time', () => {
    const syncEngine = readRepoFile('src', 'lib', 'offline', 'sync-engine.ts');
    assert.match(syncEngine, /resolveBrowserSession\(\{\s*forceRefresh:\s*true\s*\}\)/);
    assert.match(syncEngine, /replayHeaders\.Authorization = `Bearer \$\{auth\.accessToken\}`/);
  });

  await run('safeFetch queues private writes with user scope but not raw Authorization persistence', () => {
    const safeFetch = readRepoFile('src', 'lib', 'api', 'safe-fetch.ts');
    assert.match(safeFetch, /offlineQueueUserId/);
    assert.match(safeFetch, /readPersistedSupabaseSession/);
    assert.doesNotMatch(safeFetch, /headersObj\[['"]Authorization['"]\]\s*=/);
  });

  await run('logout/account-switch cleanup clears private queued writes', () => {
    const sessionStorage = readRepoFile('src', 'lib', 'auth', 'session-storage.ts');
    assert.match(sessionStorage, /clearQueuedWritesForUser\(userId\)/);
    assert.match(sessionStorage, /clearAllPrivateQueuedWrites\(\)/);
  });

  await run('offline DB upgrade scrubs legacy queued authorization headers', () => {
    const offlineDb = readRepoFile('src', 'lib', 'offline', 'db.ts');
    assert.match(offlineDb, /const DB_VERSION = 2/);
    assert.match(offlineDb, /scrubLegacyQueuedWrites/);
    assert.match(offlineDb, /sanitizeLegacyQueuedWriteHeaders/);
    assert.match(offlineDb, /event\.oldVersion < 2/);
    assert.match(offlineDb, /last_error = 'AUTH_REQUIRED'/);
  });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
