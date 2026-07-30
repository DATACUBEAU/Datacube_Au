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
    assert.match(source, /responseIndicatesSessionExpiry/);
    assert.match(source, /SESSION_EXPIRY_AUTH_REASONS/);
    assert.match(source, /if \(!sessionExpiry\) \{\s*return response;\s*\}/);
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
    assert.match(source, /supabase\.auth\.getSession\(\)/);
    assert.match(source, /\.from\('au_activity_log'\)/);
    assert.match(source, /\.insert\(rows\)/);
    assert.match(source, /LOG_QUEUE\.length = 0/);
    assert.equal(source.includes('safeFetch'), false);
    assert.equal(source.includes('reauthOnAuthFailure'), false);
    assert.equal(source.includes('window.location.href'), false);
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

  await run('chat pipeline blocks protected ticket requests without a live access token', () => {
    const source = readRepoFile('src/hooks/api/use-au-chat.ts');
    assert.equal(source.includes('missing_access_token'), false);
    assert.match(source, /isAuthLoading \|\| isRestoringAuth/);
    assert.match(source, /await getSupabaseAccessToken\(\)/);
    assert.match(source, /\baccessToken,\s*\n/);
    assert.match(source, /sendChatMessageStream[\s\S]+\{ signal: abortControllerRef\.current\?\.signal, accessToken \}/);
    assert.match(source, /isSessionExpiryAuthFailure/);
    assert.doesNotMatch(source, /tokenExpiresAt/);
    const debugStart = source.indexOf('[useAuChat] Preparing to send message');
    assert.ok(debugStart >= 0, 'missing sanitized chat debug block');
    const debugBlock = source.slice(debugStart, source.indexOf('});', debugStart) + 3);
    assert.doesNotMatch(debugBlock, /userId/);
    assert.doesNotMatch(source, /__cookie_session__/);
    assert.equal(source.includes("source: 'useAuChat.sendMessage'"), false);
  });

  await run('AI ticket requests suppress global 401 expiry and preserve structured error handling', () => {
    const chat = readRepoFile('src/lib/api/chat.ts');
    const exams = readRepoFile('src/lib/api/exams.ts');
    const store = readRepoFile('src/hooks/use-store.ts');

    assert.match(chat, /throwResponseApiError/);
    assert.match(chat, /message:\s*'Sign in required\.'/);
    assert.match(chat, /suppressAuthError:\s*true/);
    assert.match(exams, /message:\s*'Sign in required\.'/);
    assert.match(exams, /suppressAuthError:\s*true/);
    assert.match(store, /message:\s*'Sign in required\.'/);
    assert.match(store, /suppressAuthError:\s*true/);
  });

  await run('support escalation uses configured public email and does not hardcode the deployment domain', () => {
    const support = readRepoFile('src/lib/support/contact.ts');
    assert.match(support, /NEXT_PUBLIC_SUPPORT_EMAIL/);
    assert.doesNotMatch(support, /support@datacube-au\.vercel\.app/);
    for (const file of [
      'src/app/dashboard/chat/page.tsx',
      'src/app/dashboard/knowledge/page.tsx',
      'src/app/dashboard/practice/page.tsx',
      'src/app/dashboard/predictions/page.tsx',
    ]) {
      const source = readRepoFile(file);
      assert.match(source, /openSupportEmail/);
      assert.doesNotMatch(source, /support@datacube-au\.vercel\.app/);
      assert.doesNotMatch(source, /mailto:support/);
    }
  });

  await run('admin auth failures include safe request IDs without leaking lockout internals', () => {
    const source = readRepoFile('src/app/api/admin/auth/route.ts');
    assert.match(source, /createSafeRequestId/);
    assert.match(source, /const requestId = createSafeRequestId\(\)/);
    assert.match(source, /accessControlResponse\(error, requestId\)/);
    assert.match(source, /requestId/);
    assert.match(source, /admin_auth_rate_limited/);
    assert.doesNotMatch(source, /toLocaleTimeString/);
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

  await run('available chat models are server-routed and prompt starters use the VPS ticket path', () => {
    const source = readRepoFile('src/lib/api/chat.ts');
    assert.match(source, /getAvailableModels\(\): Promise<string\[\]>/);
    assert.match(source, /return DEFAULT_MODEL_IDS/);
    assert.match(source, /createAiIdempotencyKey\('prompt_starters'\)/);
    assert.match(source, /feature:\s*'generate-prompt-starters'/);
    assert.match(source, /hasDocId \? undefined : documentContent/);
    assert.match(source, /\/api\/au\/vps-ticket/);
    assert.equal(source.includes('AVAILABLE_MODELS_CACHE_TTL_MS'), false);
    assert.equal(source.includes('availableModelsInFlight'), false);
  });

  await run('chat duplicate sends are blocked while the same prompt is already in flight', () => {
    const source = readRepoFile('src/hooks/api/use-au-chat.ts');
    assert.match(source, /activePromptHashRef/);
    assert.match(source, /if \(activePromptHashRef\.current === promptHash\) \{/);
  });

  await run('account snapshot refreshes are cache-first and no longer mount normal-user realtime', () => {
    const source = readRepoFile('src/components/providers/account-snapshot-provider.tsx');
    assert.match(source, /SNAPSHOT_MIN_REFRESH_INTERVAL_MS = 15_000/);
    assert.match(source, /resolveAccountSnapshotRefreshDecision/);
    assert.match(source, /inflightFetchRef/);
    assert.match(source, /stale_response_ignored/);
    assert.equal(source.includes("channel(`account-snapshot:"), false);
    assert.equal(source.includes("table: 'feature_flags'"), false);
    assert.equal(source.includes("table: 'usage_counters'"), false);
    assert.equal(source.includes("table: 'au_plan_limit_rules'"), false);
  });

  await run('feature flags are fetched with cache and etag instead of normal-user realtime', () => {
    const source = readRepoFile('src/components/feature-flag-provider.tsx');
    const routeSource = readRepoFile('src/app/api/feature-flags/route.ts');
    assert.match(source, /If-None-Match/);
    assert.match(source, /res\.status === 304/);
    assert.match(source, /inflightFetchRef/);
    assert.match(source, /currentUserIdRef/);
    assert.match(source, /setRows\(\[\]\)/);
    assert.match(routeSource, /status: 401/);
    assert.match(routeSource, /Cache-Control': 'no-store'/);
    assert.equal(source.includes("channel('feature-flags-v2')"), false);
    assert.equal(source.includes("table: 'feature_flags'"), false);
  });

  await run('document realtime remains scoped to the authenticated user and cleans up channels', () => {
    const source = readRepoFile('src/hooks/api/use-au-documents.ts');
    assert.match(source, /channel\(`au_documents_changes:\$\{user\.id\}`\)/);
    assert.match(source, /filter: `user_id=eq\.\$\{user\.id\}`/);
    assert.match(source, /ownerId !== user\.id/);
    assert.match(source, /supabase\.removeChannel\(channel\)/);
    assert.equal(source.includes("channel('au_documents_changes')"), false);
  });

  await run('dashboard sidebar collapse is local, accessible, and does not add Supabase preference traffic', () => {
    const source = readRepoFile('src/app/dashboard/dashboard-client-layout.tsx');
    assert.match(source, /DASHBOARD_SIDEBAR_STORAGE_KEY/);
    assert.match(source, /localStorage\.setItem\(DASHBOARD_SIDEBAR_STORAGE_KEY/);
    assert.match(source, /aria-expanded=\{expanded\}/);
    assert.match(source, /Collapse dashboard sidebar/);
    assert.match(source, /Expand dashboard sidebar/);
    assert.equal(source.includes('supabase.from'), false);
  });

  await run('admin plan assignment uses a server RPC and preserves billing-provider records', () => {
    const routeSource = readRepoFile('src/app/api/admin/users/route.ts');
    const migrationSource = readRepoFile('supabase/migrations/20260630120000_admin_plan_assignment_overrides.sql');
    assert.match(routeSource, /action: z\.literal\('set_user_plan'\)/);
    assert.match(routeSource, /admin_set_user_plan_override/);
    assert.match(routeSource, /billingRecordsPreserved: true/);
    assert.match(migrationSource, /billing_records_preserved', TRUE/);
    assert.match(migrationSource, /DROP CONSTRAINT IF EXISTS au_user_entitlements_admin_override_owner_check/);
    assert.equal(routeSource.includes(".from('billing_subscriptions').update"), false);
    assert.equal(routeSource.includes(".from('billing_subscriptions').upsert"), false);
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

  await run('generation flows pass document IDs/idempotency keys and use shared user-facing error messaging', () => {
    const storeSource = readRepoFile('src/hooks/use-store.ts');
    const examsHook = readRepoFile('src/hooks/api/use-au-exams.ts');
    const examsApi = readRepoFile('src/lib/api/exams.ts');
    assert.match(storeSource, /KNOWLEDGE_DOCUMENT_BUDGET/);
    assert.match(storeSource, /PREDICTION_PAST_QUESTIONS_BUDGET/);
    assert.match(storeSource, /describeApiErrorForUser/);
    assert.doesNotMatch(examsHook, /getAuDocumentChunksText/);
    assert.match(examsHook, /generatePracticeExam\(\s*['"]{2},\s*['"]{2}/);
    assert.match(examsHook, /describeApiErrorForUser/);
    assert.match(examsApi, /createAiIdempotencyKey\('practice_exam'\)/);
    assert.match(examsApi, /createAiIdempotencyKey\('exam_predictions'\)/);
    assert.match(examsApi, /feature:\s*'generate-practice-exam'/);
    assert.match(examsApi, /feature:\s*'generate-exam-predictions'/);
    assert.match(examsApi, /hasDocId \? undefined : \(documentContent \|\| undefined\)/);
    assert.match(examsApi, /hasPqIds \? undefined : \(pastQuestionsContent \|\| undefined\)/);
  });

  await run('dashboard activity heartbeat is throttled so it cannot chatter every minute', () => {
    const clientSource = readRepoFile('src/lib/supabase-client/client.ts');
    const smartAuth = readRepoFile('src/hooks/use-smart-auth.tsx');
    assert.match(clientSource, /USER_ACTIVITY_HEARTBEAT_MS = 5 \* 60 \* 1000/);
    assert.match(clientSource, /USER_ACTIVITY_METADATA_SYNC_MS = 15 \* 60 \* 1000/);
    assert.match(clientSource, /userActivityHeartbeatAt/);
    assert.match(clientSource, /userActivityMetadataSyncAt/);
    assert.match(smartAuth, /recordUserActivityRpc/);
  });

  await run('exam and generation flows require a live access token before protected AI requests', () => {
    const examsHook = readRepoFile('src/hooks/api/use-au-exams.ts');
    const knowledgePage = readRepoFile('src/app/dashboard/knowledge/page.tsx');
    const practicePage = readRepoFile('src/app/dashboard/practice/page.tsx');
    const predictionsPage = readRepoFile('src/app/dashboard/predictions/page.tsx');

    assert.match(examsHook, /await getSupabaseAccessToken\(\)/);
    assert.match(examsHook, /\baccessToken\s*\}/);
    assert.doesNotMatch(examsHook, /__cookie_session__/);
    assert.match(knowledgePage, /await getSupabaseAccessToken\(\)/);
    assert.match(knowledgePage, /\baccessToken,\s*\n/);
    assert.match(predictionsPage, /await getSupabaseAccessToken\(\)/);
    assert.match(predictionsPage, /\baccessToken,\s*\n/);
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

  await run('legacy AI proxy wrappers were removed in favor of the VPS ticket path', () => {
    assert.equal(fs.existsSync(path.join(repoRoot, 'src/app/api/_proxy-forward.ts')), false);
    for (const file of [
      'src/app/api/chat/route.ts',
      'src/app/api/generate-knowledge/route.ts',
      'src/app/api/generate-practice-exam/route.ts',
      'src/app/api/generate-exam-predictions/route.ts',
      'src/app/api/generate-prompt-starters/route.ts',
    ]) {
      assert.equal(fs.existsSync(path.join(repoRoot, file)), false, file);
    }
    const chat = readRepoFile('src/lib/api/chat.ts');
    const exams = readRepoFile('src/lib/api/exams.ts');
    const store = readRepoFile('src/hooks/use-store.ts');
    assert.match(chat, /\/api\/au\/vps-ticket/);
    assert.match(exams, /\/api\/au\/vps-ticket/);
    assert.match(store, /\/api\/au\/vps-ticket/);
  });

  await run('chat history route uses canonical request auth and RLS client helpers', () => {
    const source = readRepoFile('src/app/api/chat/history/route.ts');
    assert.match(source, /requireUserFromRequest/);
    assert.match(source, /createSupabaseRlsClient/);
    assert.equal(source.includes("runtime = 'edge'"), false);
  });

  await run('removed dynamic proxy route cannot expose raw auth diagnostics to browsers', () => {
    assert.equal(fs.existsSync(path.join(repoRoot, 'src/app/api/proxy/[functionName]/route.ts')), false);
    const proxyAuth = readRepoFile('src/app/api/proxy/_supabase-auth.ts');
    assert.doesNotMatch(proxyAuth, /tokenPreview/);
    assert.doesNotMatch(proxyAuth, /token\.slice/);
    assert.doesNotMatch(proxyAuth, /Authorization:\s*authorization/);
  });

  await run('VPS ticket route owns protected AI auth failures after proxy removal', () => {
    const source = readRepoFile('src/app/api/au/vps-ticket/route.ts');
    assert.match(source, /requireEntitlement/);
    assert.match(source, /accessControlResponse/);
    assert.match(source, /reserveAiUsage/);
    assert.match(source, /AI_USAGE_RESERVATION_FAILED/);
    assert.match(source, /route:\s*operation\.gatewayRoute/);
    assert.doesNotMatch(source, /console\.log\([^)]*Authorization/);
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
