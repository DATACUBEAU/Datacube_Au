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

  await run('safeFetch disables blind retries for interactive and non-idempotent traffic by default', () => {
    const source = readRepoFile('src/lib/api/safe-fetch.ts');
    assert.match(source, /retries\?: number \| false/);
    assert.match(source, /authIntent === 'interactive'\s*\?\s*0/);
    assert.match(source, /method === 'GET' \|\| method === 'HEAD' \? 1 : 0/);
  });

  await run('invokeEdgeFunction owns auth escalation instead of delegating it to safeFetch', () => {
    const source = readRepoFile('src/lib/supabase-client/client.ts');
    assert.match(source, /suppressAuthError:\s*true/);
    assert.match(source, /reauthOnAuthFailure/);
    assert.match(source, /authIntent,\s*\n/);
    assert.match(source, /readEdgeAuthFailureDiagnostics/);
    assert.match(source, /shouldRetryWithRecoveredToken/);
    assert.match(source, /shouldSuppressSessionExpiryAfterEdge401/);
    assert.match(source, /markAuthRestoring\(`invokeEdgeFunction:\$\{functionName\}`\)/);
    assert.match(source, /restoreRecoveredAuthState/);
    assert.match(source, /suppressed session expiry for recoverable or endpoint-scoped 401/);
    assert.match(source, /retries:\s*0/);
  });

  await run('browser auth restore reuses persisted sessions and syncs the server cookie before protected proxy calls', () => {
    const source = readRepoFile('src/lib/supabase-client/client.ts');
    assert.match(source, /readPersistedSupabaseSession/);
    assert.match(source, /export async function resolveBrowserSession/);
    assert.match(source, /SUPABASE_SESSION_REFRESH_WINDOW_MS/);
    assert.match(source, /syncServerAuthSessionCookie\(persistedSession\)/);
    assert.match(source, /syncServerAuthSessionCookie\(refreshedSession\)/);
    assert.match(source, /syncServerAuthSessionCookie\(session\)/);
    assert.match(source, /export async function fetchEdgeFunctionResponse/);
  });

  await run('auth refresh stays single-flight and does not stampede concurrent protected requests', () => {
    const source = readRepoFile('src/lib/supabase-client/client.ts');
    assert.match(source, /let refreshBrowserSessionPromise: Promise<Session \| null> \| null = null;/);
    assert.match(source, /if \(refreshBrowserSessionPromise\) return refreshBrowserSessionPromise;/);
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
    assert.match(source, /resolveBrowserSession\(\)/);
  });

  await run('chat pipeline does not force expiry on a transient missing token during restore', () => {
    const source = readRepoFile('src/hooks/api/use-au-chat.ts');
    assert.equal(source.includes('missing_access_token'), false);
    assert.match(source, /isAuthLoading \|\| isRestoringAuth/);
    assert.match(source, /accessToken:\s*session\?\.access_token \?\? '__cookie_session__'/);
    assert.equal(source.includes("source: 'useAuChat.sendMessage'"), false);
  });

  await run('document bootstrap defers realtime and polling while auth is restoring', () => {
    const source = readRepoFile('src/hooks/api/use-au-documents.ts');
    assert.match(source, /isRestoringAuth/);
    assert.match(source, /if \(isRestoringAuth\) return;/);
    assert.match(source, /docsInflightRequests/);
    assert.match(source, /docsMemoryCache/);
    assert.match(source, /if \(!isRealtimeDegraded\) return;/);
  });

  await run('document list queries now use the lean shared column projection instead of select star', () => {
    const apiDocuments = readRepoFile('src/lib/api/documents.ts');
    const auDocuments = readRepoFile('src/lib/au/documents.ts');
    assert.match(auDocuments, /export const SAFE_DOC_COLUMNS =/);
    assert.match(apiDocuments, /\.select\(SAFE_DOC_COLUMNS\)/);
    assert.equal(apiDocuments.includes(".select('*')"), false);
  });

  await run('document retention resolution reuses persisted account snapshot data before attempting a live fetch', () => {
    const source = readRepoFile('src/lib/au/document-normalization.ts');
    assert.match(source, /persistedRetention/);
    assert.match(source, /if \(Number\.isFinite\(persistedRetention\) && persistedRetention > 0\)/);
    assert.match(source, /else \{\s*try \{/s);
  });

  await run('cached document text is reused in memory to avoid repeat chunk downloads during the same session', () => {
    const source = readRepoFile('src/lib/au/documents.ts');
    assert.match(source, /DOC_TEXT_MEMORY_TTL_MS/);
    assert.match(source, /docTextMemoryCache/);
    assert.match(source, /docTextInFlightRequests/);
  });

  await run('available chat models are cached and prompt starter payloads are budgeted', () => {
    const source = readRepoFile('src/lib/api/chat.ts');
    assert.match(source, /AVAILABLE_MODELS_CACHE_TTL_MS/);
    assert.match(source, /availableModelsInFlight/);
    assert.match(source, /PROMPT_STARTER_DOCUMENT_BUDGET/);
  });

  await run('chat duplicate sends are blocked while the same prompt is already in flight', () => {
    const source = readRepoFile('src/hooks/api/use-au-chat.ts');
    assert.match(source, /activePromptHashRef/);
    assert.match(source, /if \(activePromptHashRef\.current === promptHash\) \{/);
  });

  await run('account snapshot refreshes are throttled and polling only runs when realtime is degraded', () => {
    const source = readRepoFile('src/components/providers/account-snapshot-provider.tsx');
    assert.match(source, /POLL_INTERVAL_MS = 120_000/);
    assert.match(source, /SNAPSHOT_MIN_REFRESH_INTERVAL_MS = 15_000/);
    assert.match(source, /const \[isRealtimeDegraded, setIsRealtimeDegraded\] = useState\(false\)/);
    assert.match(source, /if \(!isRealtimeDegraded\) return;/);
    assert.equal(source.includes("table: 'au_messages'"), false);
    assert.equal(source.includes("table: 'au_model_usage'"), false);
  });

  await run('feature flag polling only activates when realtime is degraded', () => {
    const source = readRepoFile('src/components/feature-flag-provider.tsx');
    assert.match(source, /POLL_INTERVAL_MS = 120_000/);
    assert.match(source, /const \[isRealtimeDegraded, setIsRealtimeDegraded\] = useState\(false\)/);
    assert.match(source, /if \(!isRealtimeDegraded\) return;/);
  });

  await run('feature output reads are deduped, cached briefly, and mapped to user-facing errors', () => {
    const hookSource = readRepoFile('src/hooks/api/use-feature-output.ts');
    const routeSource = readRepoFile('src/app/api/feature-output/route.ts');
    assert.match(hookSource, /featureOutputCache/);
    assert.match(hookSource, /featureOutputInFlight/);
    assert.match(hookSource, /describeApiErrorForUser/);
    assert.match(routeSource, /SUCCESS_CACHE_CONTROL/);
    assert.equal(routeSource.includes('cost_usd'), false);
    assert.equal(routeSource.includes('tokens:'), false);
    assert.equal(routeSource.includes('model:'), false);
  });

  await run('generation flows clamp heavy document payloads and use shared user-facing error messaging', () => {
    const storeSource = readRepoFile('src/hooks/use-store.ts');
    const examsHook = readRepoFile('src/hooks/api/use-au-exams.ts');
    assert.match(storeSource, /KNOWLEDGE_DOCUMENT_BUDGET/);
    assert.match(storeSource, /PREDICTION_PAST_QUESTIONS_BUDGET/);
    assert.match(storeSource, /describeApiErrorForUser/);
    assert.match(examsHook, /getAuDocumentChunksText/);
    assert.match(examsHook, /PRACTICE_DOCUMENT_BUDGET/);
    assert.match(examsHook, /describeApiErrorForUser/);
  });

  await run('dashboard activity heartbeat is throttled so it cannot chatter every minute', () => {
    const layoutSource = readRepoFile('src/app/dashboard/layout.tsx');
    const clientSource = readRepoFile('src/lib/supabase-client/client.ts');
    assert.match(layoutSource, /5 \* 60 \* 1000/);
    assert.match(clientSource, /USER_ACTIVITY_HEARTBEAT_MS = 5 \* 60 \* 1000/);
    assert.match(clientSource, /USER_ACTIVITY_METADATA_SYNC_MS = 15 \* 60 \* 1000/);
    assert.match(clientSource, /userActivityHeartbeatAt/);
    assert.match(clientSource, /userActivityMetadataSyncAt/);
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

  await run('proxy auth failures now expose request auth diagnostics for runtime debugging', () => {
    const source = readRepoFile('src/app/api/proxy/[functionName]/route.ts');
    assert.match(source, /x-dcau-auth-stage/);
    assert.match(source, /x-dcau-auth-has-authorization/);
    assert.match(source, /serializeRequestAuthDiagnostics/);
    assert.match(source, /auth_stage:\s*input\.stage/);
    assert.match(source, /\[proxy\] auth failure surfaced via catch/);
    assert.match(source, /const headers = applyRequestAuthDebugHeaders/);
    assert.match(source, /const normalizedDetails = buildAuthFailureDetails/);
  });

  await run('proxy no longer turns ambiguous post-auth chat failures into false 401 responses', () => {
    const source = readRepoFile('src/app/api/proxy/[functionName]/route.ts');
    assert.match(source, /shouldTreatCaughtAuthFailureAsAmbiguousPostAuthFailure/);
    assert.match(source, /hasValidatedRequestAuth/);
    assert.match(source, /\[proxy\] suppressing ambiguous auth failure after validated auth/);
    assert.match(source, /tryLegacyChatFallbackIfEligible\('unexpected_error'\)/);
  });

  await run('proxy auth validation prefers the explicit authorization header over ambient cookies after refresh', () => {
    const source = readRepoFile('src/app/api/proxy/_supabase-auth.ts');
    const headerIndex = source.indexOf("candidates.push({ token: headerToken, source: 'header' })");
    const cookieIndex = source.indexOf("candidates.push({ token: cookieToken, source: 'cookie' })");
    assert.equal(headerIndex >= 0, true);
    assert.equal(cookieIndex >= 0, true);
    assert.equal(headerIndex < cookieIndex, true);
  });

  await run('recoverable proxy 401s stay endpoint-scoped when browser session restore is still possible', () => {
    const source = readRepoFile('src/lib/supabase-client/client.ts');
    assert.match(source, /input\.refreshedResolution\.source !== 'none'/);
    assert.match(source, /input\.settledResolution\.source !== 'none'/);
    assert.match(source, /Boolean\(input\.latestSession\?\.refresh_token\)/);
    assert.match(source, /refreshedSessionSource: refreshedResolution\.source/);
    assert.match(source, /settledSessionSource: settledResolution\.source/);
    assert.match(source, /hasLatestRefreshToken: Boolean\(latestSession\?\.refresh_token\)/);
  });

  if (failed > 0) {
    process.exit(1);
  }
}

void main();
