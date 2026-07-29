import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

type AsyncTest = () => void | Promise<void>;

let failed = 0;

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

function readRepoFile(...segments: string[]): string {
  return readFileSync(path.join(process.cwd(), ...segments), 'utf8');
}

function assertRequiresTokenBeforeTicket(source: string, functionName: string) {
  const functionIndex = source.indexOf(`function ${functionName}`);
  assert.notEqual(functionIndex, -1, `missing ${functionName}`);
  const tokenIndex = source.indexOf('requireAiAccessToken', functionIndex + 1);
  const ticketIndex = source.indexOf("'/api/au/vps-ticket'", functionIndex);
  assert.ok(tokenIndex > functionIndex, `${functionName} must require a token`);
  assert.ok(ticketIndex > tokenIndex, `${functionName} must require token before requesting a VPS ticket`);
}

async function main() {
  await run('401 restore with no session moves to UNAUTHENTICATED, not AUTHENTICATED', () => {
    const sessionEvents = readRepoFile('src', 'lib', 'auth', 'session-expiry-events.ts');
    const useSmartAuth = readRepoFile('src', 'hooks', 'use-smart-auth.tsx');
    assert.match(sessionEvents, /export type AuthRuntimeState = 'RESTORING' \| 'AUTHENTICATED' \| 'UNAUTHENTICATED'/);
    assert.match(sessionEvents, /markAuthUnauthenticated/);
    assert.match(useSmartAuth, /await clearStaleAuthState\('useSmartAuth\.bootstrap'\)/);
  });

  await run('clearAuthActionsDisabled no longer marks a session restored', () => {
    const sessionEvents = readRepoFile('src', 'lib', 'auth', 'session-expiry-events.ts');
    const clearStart = sessionEvents.indexOf('export function clearAuthActionsDisabled');
    const clearEnd = sessionEvents.indexOf('export function markAuthSessionRestored');
    const clearBody = sessionEvents.slice(clearStart, clearEnd);
    assert.doesNotMatch(clearBody, /setAuthRuntimeState\('AUTHENTICATED'/);
    assert.match(sessionEvents, /export function markAuthSessionRestored[\s\S]+setAuthRuntimeState\('AUTHENTICATED'/);
  });

  await run('no session state cannot dispatch as authenticated expiry loop', () => {
    const policy = readRepoFile('src', 'lib', 'auth', 'session-expiry-policy.ts');
    assert.match(policy, /\| 'UNAUTHENTICATED'/);
    assert.match(policy, /input\.runtimeState === 'UNAUTHENTICATED'\) return false/);
  });

  await run('useSmartAuth stale-session path clears auth artifacts once and does not use token fragments', () => {
    const source = readRepoFile('src', 'hooks', 'use-smart-auth.tsx');
    assert.match(source, /staleAuthCleanupRef/);
    assert.match(source, /clearClientAuthStorageArtifacts/);
    assert.match(source, /clearUserScopedClientCaches/);
    assert.match(source, /clearServerAuthSessionCookie/);
    assert.match(source, /markAuthUnauthenticated\(source, 'session_missing'\)/);
    assert.doesNotMatch(source, /access_token\.slice/);
    assert.doesNotMatch(source, /tokenTail/);
    assert.doesNotMatch(source, /expiresAt:/);
  });

  await run('AI ticket callers require access token before requesting VPS ticket', () => {
    const chat = readRepoFile('src', 'lib', 'api', 'chat.ts');
    const exams = readRepoFile('src', 'lib', 'api', 'exams.ts');
    const store = readRepoFile('src', 'hooks', 'use-store.ts');
    assertRequiresTokenBeforeTicket(chat, 'sendChatMessage');
    assertRequiresTokenBeforeTicket(chat, 'sendChatMessageStream');
    assertRequiresTokenBeforeTicket(chat, 'generatePromptStarters');
    assertRequiresTokenBeforeTicket(exams, 'generatePracticeExam');
    assertRequiresTokenBeforeTicket(exams, 'generatePredictions');
    assert.match(store, /requireAiAccessToken\(options\?\.accessToken\)/);
    assert.doesNotMatch(readRepoFile('src', 'hooks', 'api', 'use-au-chat.ts'), /__cookie_session__/);
    assert.doesNotMatch(readRepoFile('src', 'hooks', 'api', 'use-au-exams.ts'), /__cookie_session__/);
    assert.doesNotMatch(readRepoFile('src', 'lib', 'supabase-client', 'client.ts'), /__cookie_session__/);
  });

  await run('protected API guard still blocks missing access tokens', () => {
    const requestGuard = readRepoFile('src', 'lib', 'api', 'request-guard.ts');
    assert.match(requestGuard, /requireAuth && !hasToken/);
    assert.match(requestGuard, /reason: 'unauthenticated'/);
    assert.match(requestGuard, /Sign in required\./);
  });

  await run('service worker private cache cannot restore stale auth state', () => {
    const useSmartAuth = readRepoFile('src', 'hooks', 'use-smart-auth.tsx');
    const sessionStorage = readRepoFile('src', 'lib', 'auth', 'session-storage.ts');
    const pwaTest = readRepoFile('tests', 'pwa-offline.unit.test.ts');
    assert.match(useSmartAuth, /clearStaleAuthState/);
    assert.match(sessionStorage, /purgeEmergencyPwaCaches/);
    assert.match(pwaTest, /service worker cache policy excludes protected app pages and APIs/);
  });

  if (failed > 0) {
    process.exit(1);
  }
}

void main();
