import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

let failed = 0;

type AsyncTest = () => void | Promise<void>;

const repoRoot = path.resolve(__dirname, '..');

function readRepoFile(relativePath: string): string {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

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
  await run('safeFetch no longer hard-redirects on every 401 response', () => {
    const source = readRepoFile('src/lib/api/safe-fetch.ts');
    assert.equal(source.includes('window.location.href = loginUrl'), false);
    assert.match(source, /authIntent = 'background'/);
  });

  await run('invokeEdgeFunction owns auth escalation instead of delegating it to safeFetch', () => {
    const source = readRepoFile('src/lib/supabase-client/client.ts');
    assert.match(source, /suppressAuthError:\s*true/);
    assert.match(source, /reauthOnAuthFailure/);
    assert.match(source, /authIntent,\s*\n/);
  });

  await run('browser auth restore reuses persisted sessions and syncs the server cookie before protected proxy calls', () => {
    const source = readRepoFile('src/lib/supabase-client/client.ts');
    assert.match(source, /readPersistedSupabaseSession/);
    assert.match(source, /syncServerAuthSessionCookie\(nextSession\)/);
    assert.match(source, /syncServerAuthSessionCookie\(session\)/);
    assert.match(source, /export async function fetchEdgeFunctionResponse/);
  });

  await run('background analytics logging cannot force a full-page reauthenticate flow', () => {
    const source = readRepoFile('src/lib/analytics.ts');
    assert.match(source, /authIntent:\s*'background'/);
    assert.match(source, /reauthOnAuthFailure:\s*false/);
  });

  await run('feature output waits for auth restore before firing protected requests', () => {
    const source = readRepoFile('src/hooks/api/use-feature-output.ts');
    assert.match(source, /shouldDeferProtectedRequest/);
    assert.match(source, /isRestoringAuth/);
    assert.match(source, /suppressAuthError:\s*true/);
  });

  await run('smart auth bootstrap starts in a loading state until restore settles', () => {
    const source = readRepoFile('src/hooks/use-smart-auth.tsx');
    assert.match(source, /useState<'loading' \| 'authenticated' \| 'unauthenticated'>\('loading'\)/);
  });

  await run('chat pipeline does not force expiry on a transient missing token during restore', () => {
    const source = readRepoFile('src/hooks/api/use-au-chat.ts');
    assert.equal(source.includes('missing_access_token'), false);
    assert.match(source, /isAuthLoading \|\| isRestoringAuth/);
    assert.match(source, /accessToken:\s*session\?\.access_token \?\? '__cookie_session__'/);
  });

  await run('document bootstrap defers realtime and polling while auth is restoring', () => {
    const source = readRepoFile('src/hooks/api/use-au-documents.ts');
    assert.match(source, /isRestoringAuth/);
    assert.match(source, /if \(isRestoringAuth\) return;/);
  });

  await run('exam and generation flows no longer hard-require a local access token before protected requests', () => {
    const examsHook = readRepoFile('src/hooks/api/use-au-exams.ts');
    const knowledgePage = readRepoFile('src/app/dashboard/knowledge/page.tsx');
    const practicePage = readRepoFile('src/app/dashboard/practice/page.tsx');
    const predictionsPage = readRepoFile('src/app/dashboard/predictions/page.tsx');

    assert.match(examsHook, /accessToken:\s*session\?\.access_token \?\? '__cookie_session__'/);
    assert.match(knowledgePage, /enabled:\s*Boolean\(selectedDocId && user && !isAuthLoading && !isRestoringAuth && !isAuthLocked\)/);
    assert.match(practicePage, /enabled:\s*Boolean\(selectedDocId && user && !isAuthLoading && !isRestoringAuth && !isAuthLocked\)/);
    assert.match(predictionsPage, /enabled:\s*Boolean\(\(selectedTextbookId \|\| selectedPastQuestionsId\) && user && !isAuthLoading && !isRestoringAuth && !isAuthLocked\)/);
  });

  await run('chat pages defer user interaction until restore settles instead of keying off a raw token field', () => {
    const chatPage = readRepoFile('src/app/dashboard/chat/page.tsx');
    const globalChatPage = readRepoFile('src/app/dashboard/global-chat/page.tsx');

    assert.match(chatPage, /const canChat = isOnline && Boolean\(user\) && !isLoadingAuth && !isRestoringAuth && !isAuthLocked;/);
    assert.match(chatPage, /Restoring session\.\.\./);
    assert.match(globalChatPage, /const canChat = isOnline && Boolean\(user\) && !isLoadingAuth && !isRestoringAuth && !isAuthLocked;/);
    assert.match(globalChatPage, /Restoring session\.\.\./);
  });

  await run('legacy proxy wrappers share a cookie-aware forward helper instead of stripping auth context', () => {
    const helper = readRepoFile('src/app/api/_proxy-forward.ts');
    assert.match(helper, /headers\.set\('Cookie', cookie\)/);
    assert.match(helper, /headers\.set\('Authorization', authorization\)/);

    for (const file of [
      'src/app/api/chat/route.ts',
      'src/app/api/generate-knowledge/route.ts',
      'src/app/api/generate-practice-exam/route.ts',
      'src/app/api/generate-exam-predictions/route.ts',
      'src/app/api/generate-prompt-starters/route.ts',
    ]) {
      const source = readRepoFile(file);
      assert.match(source, /forwardProxyJsonRequest/);
    }
  });

  await run('chat history route uses canonical request auth and RLS client helpers', () => {
    const source = readRepoFile('src/app/api/chat/history/route.ts');
    assert.match(source, /requireUserFromRequest/);
    assert.match(source, /createSupabaseRlsClient/);
    assert.equal(source.includes("runtime = 'edge'"), false);
  });

  if (failed > 0) {
    process.exit(1);
  }
}

void main();
