"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
let failed = 0;
const repoRoot = node_path_1.default.resolve(__dirname, '..');
function readRepoFile(relativePath) {
    return node_fs_1.default.readFileSync(node_path_1.default.join(repoRoot, relativePath), 'utf8');
}
async function run(name, fn) {
    try {
        await fn();
        console.log(`PASS ${name}`);
    }
    catch (error) {
        failed += 1;
        console.error(`FAIL ${name}`);
        console.error(error?.stack || error);
    }
}
async function main() {
    await run('safeFetch no longer hard-redirects on every 401 response', () => {
        const source = readRepoFile('src/lib/api/safe-fetch.ts');
        strict_1.default.equal(source.includes('window.location.href = loginUrl'), false);
        strict_1.default.match(source, /authIntent = 'background'/);
        strict_1.default.match(source, /responseIndicatesSessionExpiry/);
        strict_1.default.match(source, /SESSION_EXPIRY_AUTH_REASONS/);
        strict_1.default.match(source, /if \(!sessionExpiry\) \{\s*return response;\s*\}/);
    });
    await run('safeFetch disables blind retries for interactive and non-idempotent traffic by default', () => {
        const source = readRepoFile('src/lib/api/safe-fetch.ts');
        strict_1.default.match(source, /retries\?: number \| false/);
        strict_1.default.match(source, /authIntent === 'interactive'\s*\?\s*0/);
        strict_1.default.match(source, /method === 'GET' \|\| method === 'HEAD' \? 1 : 0/);
    });
    await run('invokeEdgeFunction owns auth escalation instead of delegating it to safeFetch', () => {
        const source = readRepoFile('src/lib/supabase-client/client.ts');
        strict_1.default.match(source, /suppressAuthError:\s*true/);
        strict_1.default.match(source, /reauthOnAuthFailure/);
        strict_1.default.match(source, /authIntent,\s*\n/);
        strict_1.default.match(source, /readEdgeAuthFailureDiagnostics/);
        strict_1.default.match(source, /shouldRetryWithRecoveredToken/);
        strict_1.default.match(source, /shouldSuppressSessionExpiryAfterEdge401/);
        strict_1.default.match(source, /markAuthRestoring\(`invokeEdgeFunction:\$\{functionName\}`\)/);
        strict_1.default.match(source, /restoreRecoveredAuthState/);
        strict_1.default.match(source, /suppressed session expiry for recoverable or endpoint-scoped 401/);
        strict_1.default.match(source, /retries:\s*0/);
    });
    await run('browser auth restore reuses persisted sessions and syncs the server cookie before protected proxy calls', () => {
        const source = readRepoFile('src/lib/supabase-client/client.ts');
        strict_1.default.match(source, /readPersistedSupabaseSession/);
        strict_1.default.match(source, /export async function resolveBrowserSession/);
        strict_1.default.match(source, /SUPABASE_SESSION_REFRESH_WINDOW_MS/);
        strict_1.default.match(source, /syncServerAuthSessionCookie\(persistedSession\)/);
        strict_1.default.match(source, /syncServerAuthSessionCookie\(refreshedSession\)/);
        strict_1.default.match(source, /syncServerAuthSessionCookie\(session\)/);
        strict_1.default.match(source, /export async function fetchEdgeFunctionResponse/);
    });
    await run('auth refresh stays single-flight and does not stampede concurrent protected requests', () => {
        const source = readRepoFile('src/lib/supabase-client/client.ts');
        strict_1.default.match(source, /let refreshBrowserSessionPromise: Promise<Session \| null> \| null = null;/);
        strict_1.default.match(source, /if \(refreshBrowserSessionPromise\) return refreshBrowserSessionPromise;/);
    });
    await run('background analytics logging cannot force a full-page reauthenticate flow', () => {
        const source = readRepoFile('src/lib/analytics.ts');
        strict_1.default.match(source, /supabase\.auth\.getSession\(\)/);
        strict_1.default.match(source, /\.from\('au_activity_log'\)/);
        strict_1.default.match(source, /\.insert\(rows\)/);
        strict_1.default.match(source, /LOG_QUEUE\.length = 0/);
        strict_1.default.equal(source.includes('safeFetch'), false);
        strict_1.default.equal(source.includes('reauthOnAuthFailure'), false);
        strict_1.default.equal(source.includes('window.location.href'), false);
    });
    await run('feature output waits for auth restore before firing protected requests', () => {
        const source = readRepoFile('src/hooks/api/use-feature-output.ts');
        strict_1.default.match(source, /shouldDeferProtectedRequest/);
        strict_1.default.match(source, /isRestoringAuth/);
        strict_1.default.match(source, /suppressAuthError:\s*true/);
    });
    await run('smart auth bootstrap starts in a loading state until restore settles', () => {
        const source = readRepoFile('src/hooks/use-smart-auth.tsx');
        strict_1.default.match(source, /useState<'loading' \| 'authenticated' \| 'unauthenticated'>\('loading'\)/);
        strict_1.default.match(source, /resolveBrowserSession\(\)/);
    });
    await run('chat pipeline blocks protected ticket requests without a live access token', () => {
        const source = readRepoFile('src/hooks/api/use-au-chat.ts');
        strict_1.default.equal(source.includes('missing_access_token'), false);
        strict_1.default.match(source, /isAuthLoading \|\| isRestoringAuth/);
        strict_1.default.match(source, /await getSupabaseAccessToken\(\)/);
        strict_1.default.match(source, /\baccessToken,\s*\n/);
        strict_1.default.match(source, /sendChatMessageStream[\s\S]+\{ signal: abortControllerRef\.current\?\.signal, accessToken \}/);
        strict_1.default.match(source, /isSessionExpiryAuthFailure/);
        strict_1.default.doesNotMatch(source, /tokenExpiresAt/);
        const debugStart = source.indexOf('[useAuChat] Preparing to send message');
        strict_1.default.ok(debugStart >= 0, 'missing sanitized chat debug block');
        const debugBlock = source.slice(debugStart, source.indexOf('});', debugStart) + 3);
        strict_1.default.doesNotMatch(debugBlock, /userId/);
        strict_1.default.doesNotMatch(source, /__cookie_session__/);
        strict_1.default.equal(source.includes("source: 'useAuChat.sendMessage'"), false);
    });
    await run('AI ticket requests suppress global 401 expiry and preserve structured error handling', () => {
        const chat = readRepoFile('src/lib/api/chat.ts');
        const exams = readRepoFile('src/lib/api/exams.ts');
        const store = readRepoFile('src/hooks/use-store.ts');
        strict_1.default.match(chat, /throwResponseApiError/);
        strict_1.default.match(chat, /message:\s*'Sign in required\.'/);
        strict_1.default.match(chat, /suppressAuthError:\s*true/);
        strict_1.default.match(exams, /message:\s*'Sign in required\.'/);
        strict_1.default.match(exams, /suppressAuthError:\s*true/);
        strict_1.default.match(store, /message:\s*'Sign in required\.'/);
        strict_1.default.match(store, /suppressAuthError:\s*true/);
    });
    await run('support escalation uses configured public email and does not hardcode the deployment domain', () => {
        const support = readRepoFile('src/lib/support/contact.ts');
        strict_1.default.match(support, /NEXT_PUBLIC_SUPPORT_EMAIL/);
        strict_1.default.doesNotMatch(support, /support@datacube-au\.vercel\.app/);
        for (const file of [
            'src/app/dashboard/chat/page.tsx',
            'src/app/dashboard/knowledge/page.tsx',
            'src/app/dashboard/practice/page.tsx',
            'src/app/dashboard/predictions/page.tsx',
        ]) {
            const source = readRepoFile(file);
            strict_1.default.match(source, /openSupportEmail/);
            strict_1.default.doesNotMatch(source, /support@datacube-au\.vercel\.app/);
            strict_1.default.doesNotMatch(source, /mailto:support/);
        }
    });
    await run('admin auth failures include safe request IDs without leaking lockout internals', () => {
        const source = readRepoFile('src/app/api/admin/auth/route.ts');
        strict_1.default.match(source, /createSafeRequestId/);
        strict_1.default.match(source, /const requestId = createSafeRequestId\(\)/);
        strict_1.default.match(source, /accessControlResponse\(error, requestId\)/);
        strict_1.default.match(source, /requestId/);
        strict_1.default.match(source, /admin_auth_rate_limited/);
        strict_1.default.doesNotMatch(source, /toLocaleTimeString/);
    });
    await run('document bootstrap defers realtime and polling while auth is restoring', () => {
        const source = readRepoFile('src/hooks/api/use-au-documents.ts');
        strict_1.default.match(source, /isRestoringAuth/);
        strict_1.default.match(source, /if \(isRestoringAuth\) return;/);
        strict_1.default.match(source, /docsInflightRequests/);
        strict_1.default.match(source, /docsMemoryCache/);
        strict_1.default.match(source, /if \(!isRealtimeDegraded\) return;/);
    });
    await run('document list queries now use the lean shared column projection instead of select star', () => {
        const apiDocuments = readRepoFile('src/lib/api/documents.ts');
        const auDocuments = readRepoFile('src/lib/au/documents.ts');
        strict_1.default.match(auDocuments, /export const SAFE_DOC_COLUMNS =/);
        strict_1.default.match(apiDocuments, /\.select\(SAFE_DOC_COLUMNS\)/);
        strict_1.default.equal(apiDocuments.includes(".select('*')"), false);
    });
    await run('document retention resolution reuses persisted account snapshot data before attempting a live fetch', () => {
        const source = readRepoFile('src/lib/au/document-normalization.ts');
        strict_1.default.match(source, /persistedRetention/);
        strict_1.default.match(source, /if \(Number\.isFinite\(persistedRetention\) && persistedRetention > 0\)/);
        strict_1.default.match(source, /else \{\s*try \{/s);
    });
    await run('cached document text is reused in memory to avoid repeat chunk downloads during the same session', () => {
        const source = readRepoFile('src/lib/au/documents.ts');
        strict_1.default.match(source, /DOC_TEXT_MEMORY_TTL_MS/);
        strict_1.default.match(source, /docTextMemoryCache/);
        strict_1.default.match(source, /docTextInFlightRequests/);
    });
    await run('available chat models are server-routed and prompt starters use the VPS ticket path', () => {
        const source = readRepoFile('src/lib/api/chat.ts');
        strict_1.default.match(source, /getAvailableModels\(\): Promise<string\[\]>/);
        strict_1.default.match(source, /return DEFAULT_MODEL_IDS/);
        strict_1.default.match(source, /createAiIdempotencyKey\('prompt_starters'\)/);
        strict_1.default.match(source, /feature:\s*'generate-prompt-starters'/);
        strict_1.default.match(source, /hasDocId \? undefined : documentContent/);
        strict_1.default.match(source, /\/api\/au\/vps-ticket/);
        strict_1.default.equal(source.includes('AVAILABLE_MODELS_CACHE_TTL_MS'), false);
        strict_1.default.equal(source.includes('availableModelsInFlight'), false);
    });
    await run('chat duplicate sends are blocked while the same prompt is already in flight', () => {
        const source = readRepoFile('src/hooks/api/use-au-chat.ts');
        strict_1.default.match(source, /activePromptHashRef/);
        strict_1.default.match(source, /if \(activePromptHashRef\.current === promptHash\) \{/);
    });
    await run('account snapshot refreshes are cache-first and no longer mount normal-user realtime', () => {
        const source = readRepoFile('src/components/providers/account-snapshot-provider.tsx');
        strict_1.default.match(source, /SNAPSHOT_MIN_REFRESH_INTERVAL_MS = 15_000/);
        strict_1.default.match(source, /resolveAccountSnapshotRefreshDecision/);
        strict_1.default.match(source, /inflightFetchRef/);
        strict_1.default.match(source, /stale_response_ignored/);
        strict_1.default.equal(source.includes("channel(`account-snapshot:"), false);
        strict_1.default.equal(source.includes("table: 'feature_flags'"), false);
        strict_1.default.equal(source.includes("table: 'usage_counters'"), false);
        strict_1.default.equal(source.includes("table: 'au_plan_limit_rules'"), false);
    });
    await run('feature flags are fetched with cache and etag instead of normal-user realtime', () => {
        const source = readRepoFile('src/components/feature-flag-provider.tsx');
        const routeSource = readRepoFile('src/app/api/feature-flags/route.ts');
        strict_1.default.match(source, /If-None-Match/);
        strict_1.default.match(source, /res\.status === 304/);
        strict_1.default.match(source, /inflightFetchRef/);
        strict_1.default.match(source, /currentUserIdRef/);
        strict_1.default.match(source, /setRows\(\[\]\)/);
        strict_1.default.match(routeSource, /status: 401/);
        strict_1.default.match(routeSource, /Cache-Control': 'no-store'/);
        strict_1.default.equal(source.includes("channel('feature-flags-v2')"), false);
        strict_1.default.equal(source.includes("table: 'feature_flags'"), false);
    });
    await run('document realtime remains scoped to the authenticated user and cleans up channels', () => {
        const source = readRepoFile('src/hooks/api/use-au-documents.ts');
        strict_1.default.match(source, /channel\(`au_documents_changes:\$\{user\.id\}`\)/);
        strict_1.default.match(source, /filter: `user_id=eq\.\$\{user\.id\}`/);
        strict_1.default.match(source, /ownerId !== user\.id/);
        strict_1.default.match(source, /supabase\.removeChannel\(channel\)/);
        strict_1.default.equal(source.includes("channel('au_documents_changes')"), false);
    });
    await run('dashboard sidebar collapse is local, accessible, and does not add Supabase preference traffic', () => {
        const source = readRepoFile('src/app/dashboard/dashboard-client-layout.tsx');
        strict_1.default.match(source, /DASHBOARD_SIDEBAR_STORAGE_KEY/);
        strict_1.default.match(source, /localStorage\.setItem\(DASHBOARD_SIDEBAR_STORAGE_KEY/);
        strict_1.default.match(source, /aria-expanded=\{expanded\}/);
        strict_1.default.match(source, /Collapse dashboard sidebar/);
        strict_1.default.match(source, /Expand dashboard sidebar/);
        strict_1.default.equal(source.includes('supabase.from'), false);
    });
    await run('admin plan assignment uses a server RPC and preserves billing-provider records', () => {
        const routeSource = readRepoFile('src/app/api/admin/users/route.ts');
        const migrationSource = readRepoFile('supabase/migrations/20260630120000_admin_plan_assignment_overrides.sql');
        strict_1.default.match(routeSource, /action: z\.literal\('set_user_plan'\)/);
        strict_1.default.match(routeSource, /admin_set_user_plan_override/);
        strict_1.default.match(routeSource, /billingRecordsPreserved: true/);
        strict_1.default.match(migrationSource, /billing_records_preserved', TRUE/);
        strict_1.default.match(migrationSource, /DROP CONSTRAINT IF EXISTS au_user_entitlements_admin_override_owner_check/);
        strict_1.default.equal(routeSource.includes(".from('billing_subscriptions').update"), false);
        strict_1.default.equal(routeSource.includes(".from('billing_subscriptions').upsert"), false);
    });
    await run('feature output reads are deduped, cached briefly, and mapped to user-facing errors', () => {
        const hookSource = readRepoFile('src/hooks/api/use-feature-output.ts');
        const routeSource = readRepoFile('src/app/api/feature-output/route.ts');
        strict_1.default.match(hookSource, /featureOutputCache/);
        strict_1.default.match(hookSource, /featureOutputInFlight/);
        strict_1.default.match(hookSource, /describeApiErrorForUser/);
        strict_1.default.match(routeSource, /SUCCESS_CACHE_CONTROL/);
        strict_1.default.equal(routeSource.includes('cost_usd'), false);
        strict_1.default.equal(routeSource.includes('tokens:'), false);
        strict_1.default.equal(routeSource.includes('model:'), false);
    });
    await run('generation flows pass document IDs/idempotency keys and use shared user-facing error messaging', () => {
        const storeSource = readRepoFile('src/hooks/use-store.ts');
        const examsHook = readRepoFile('src/hooks/api/use-au-exams.ts');
        const examsApi = readRepoFile('src/lib/api/exams.ts');
        strict_1.default.match(storeSource, /KNOWLEDGE_DOCUMENT_BUDGET/);
        strict_1.default.match(storeSource, /PREDICTION_PAST_QUESTIONS_BUDGET/);
        strict_1.default.match(storeSource, /describeApiErrorForUser/);
        strict_1.default.doesNotMatch(examsHook, /getAuDocumentChunksText/);
        strict_1.default.match(examsHook, /generatePracticeExam\(\s*['"]{2},\s*['"]{2}/);
        strict_1.default.match(examsHook, /describeApiErrorForUser/);
        strict_1.default.match(examsApi, /createAiIdempotencyKey\('practice_exam'\)/);
        strict_1.default.match(examsApi, /createAiIdempotencyKey\('exam_predictions'\)/);
        strict_1.default.match(examsApi, /feature:\s*'generate-practice-exam'/);
        strict_1.default.match(examsApi, /feature:\s*'generate-exam-predictions'/);
        strict_1.default.match(examsApi, /hasDocId \? undefined : \(documentContent \|\| undefined\)/);
        strict_1.default.match(examsApi, /hasPqIds \? undefined : \(pastQuestionsContent \|\| undefined\)/);
    });
    await run('dashboard activity heartbeat is throttled so it cannot chatter every minute', () => {
        const clientSource = readRepoFile('src/lib/supabase-client/client.ts');
        const smartAuth = readRepoFile('src/hooks/use-smart-auth.tsx');
        strict_1.default.match(clientSource, /USER_ACTIVITY_HEARTBEAT_MS = 5 \* 60 \* 1000/);
        strict_1.default.match(clientSource, /USER_ACTIVITY_METADATA_SYNC_MS = 15 \* 60 \* 1000/);
        strict_1.default.match(clientSource, /userActivityHeartbeatAt/);
        strict_1.default.match(clientSource, /userActivityMetadataSyncAt/);
        strict_1.default.match(smartAuth, /recordUserActivityRpc/);
    });
    await run('exam and generation flows require a live access token before protected AI requests', () => {
        const examsHook = readRepoFile('src/hooks/api/use-au-exams.ts');
        const knowledgePage = readRepoFile('src/app/dashboard/knowledge/page.tsx');
        const practicePage = readRepoFile('src/app/dashboard/practice/page.tsx');
        const predictionsPage = readRepoFile('src/app/dashboard/predictions/page.tsx');
        strict_1.default.match(examsHook, /await getSupabaseAccessToken\(\)/);
        strict_1.default.match(examsHook, /\baccessToken\s*\}/);
        strict_1.default.doesNotMatch(examsHook, /__cookie_session__/);
        strict_1.default.match(knowledgePage, /await getSupabaseAccessToken\(\)/);
        strict_1.default.match(knowledgePage, /\baccessToken,\s*\n/);
        strict_1.default.match(predictionsPage, /await getSupabaseAccessToken\(\)/);
        strict_1.default.match(predictionsPage, /\baccessToken,\s*\n/);
        strict_1.default.match(knowledgePage, /enabled:\s*Boolean\(selectedDocId && user && !isAuthLoading && !isRestoringAuth && !isAuthLocked\)/);
        strict_1.default.match(practicePage, /enabled:\s*Boolean\(selectedDocId && user && !isAuthLoading && !isRestoringAuth && !isAuthLocked\)/);
        strict_1.default.match(predictionsPage, /enabled:\s*Boolean\(\(selectedTextbookId \|\| selectedPastQuestionsId\) && user && !isAuthLoading && !isRestoringAuth && !isAuthLocked\)/);
    });
    await run('chat pages defer user interaction until restore settles instead of keying off a raw token field', () => {
        const chatPage = readRepoFile('src/app/dashboard/chat/page.tsx');
        const globalChatPage = readRepoFile('src/app/dashboard/global-chat/page.tsx');
        strict_1.default.match(chatPage, /const canChat = isOnline && Boolean\(user\) && !isLoadingAuth && !isRestoringAuth && !isAuthLocked;/);
        strict_1.default.match(chatPage, /Restoring session\.\.\./);
        strict_1.default.match(globalChatPage, /const canChat = isOnline && Boolean\(user\) && !isLoadingAuth && !isRestoringAuth && !isAuthLocked;/);
        strict_1.default.match(globalChatPage, /Restoring session\.\.\./);
    });
    await run('legacy AI proxy wrappers were removed in favor of the VPS ticket path', () => {
        strict_1.default.equal(node_fs_1.default.existsSync(node_path_1.default.join(repoRoot, 'src/app/api/_proxy-forward.ts')), false);
        for (const file of [
            'src/app/api/chat/route.ts',
            'src/app/api/generate-knowledge/route.ts',
            'src/app/api/generate-practice-exam/route.ts',
            'src/app/api/generate-exam-predictions/route.ts',
            'src/app/api/generate-prompt-starters/route.ts',
        ]) {
            strict_1.default.equal(node_fs_1.default.existsSync(node_path_1.default.join(repoRoot, file)), false, file);
        }
        const chat = readRepoFile('src/lib/api/chat.ts');
        const exams = readRepoFile('src/lib/api/exams.ts');
        const store = readRepoFile('src/hooks/use-store.ts');
        strict_1.default.match(chat, /\/api\/au\/vps-ticket/);
        strict_1.default.match(exams, /\/api\/au\/vps-ticket/);
        strict_1.default.match(store, /\/api\/au\/vps-ticket/);
    });
    await run('chat history route uses canonical request auth and RLS client helpers', () => {
        const source = readRepoFile('src/app/api/chat/history/route.ts');
        strict_1.default.match(source, /requireUserFromRequest/);
        strict_1.default.match(source, /createSupabaseRlsClient/);
        strict_1.default.equal(source.includes("runtime = 'edge'"), false);
    });
    await run('removed dynamic proxy route cannot expose raw auth diagnostics to browsers', () => {
        strict_1.default.equal(node_fs_1.default.existsSync(node_path_1.default.join(repoRoot, 'src/app/api/proxy/[functionName]/route.ts')), false);
        const proxyAuth = readRepoFile('src/app/api/proxy/_supabase-auth.ts');
        strict_1.default.doesNotMatch(proxyAuth, /tokenPreview/);
        strict_1.default.doesNotMatch(proxyAuth, /token\.slice/);
        strict_1.default.doesNotMatch(proxyAuth, /Authorization:\s*authorization/);
    });
    await run('VPS ticket route owns protected AI auth failures after proxy removal', () => {
        const source = readRepoFile('src/app/api/au/vps-ticket/route.ts');
        strict_1.default.match(source, /requireEntitlement/);
        strict_1.default.match(source, /isAccessControlError/);
        strict_1.default.match(source, /buildApiErrorBody/);
        strict_1.default.match(source, /correlationId/);
        strict_1.default.match(source, /reserveAiUsage/);
        strict_1.default.match(source, /AI_USAGE_RESERVATION_FAILED/);
        strict_1.default.match(source, /route:\s*operation\.gatewayRoute/);
        strict_1.default.doesNotMatch(source, /console\.log\([^)]*Authorization/);
    });
    await run('middleware API denials include safe opaque request IDs for correlation', () => {
        const source = readRepoFile('src/middleware.ts');
        const unauthorizedStart = source.indexOf('function unauthorizedResponse');
        const forbiddenStart = source.indexOf('function forbiddenResponse');
        strict_1.default.ok(unauthorizedStart >= 0, 'missing unauthorizedResponse');
        strict_1.default.ok(forbiddenStart >= 0, 'missing forbiddenResponse');
        const unauthorizedBlock = source.slice(unauthorizedStart, forbiddenStart);
        const forbiddenBlock = source.slice(forbiddenStart, source.indexOf('function getServiceClient'));
        strict_1.default.match(source, /function createSafeRequestId/);
        strict_1.default.match(source, /const requestId = createSafeRequestId\(\)/);
        strict_1.default.match(source, /requestId,/);
        strict_1.default.match(source, /'X-Request-Id': requestId/);
        strict_1.default.doesNotMatch(unauthorizedBlock, /userId:\s*auth\.userId/);
        strict_1.default.doesNotMatch(forbiddenBlock, /userId:\s*auth\.userId/);
        strict_1.default.doesNotMatch(unauthorizedBlock, /accessToken/);
        strict_1.default.doesNotMatch(forbiddenBlock, /accessToken/);
    });
    await run('admin access is tied to the server-only owner override, not profile tier or browser claims', () => {
        const accessControl = readRepoFile('src/lib/authz/access-control.ts');
        const conexRbac = readRepoFile('src/lib/conex-rbac.ts');
        strict_1.default.match(accessControl, /export function isAdminSubject/);
        strict_1.default.match(accessControl, /return Boolean\(subject\.adminOverride\);/);
        strict_1.default.doesNotMatch(accessControl, /isAdminSubject[\s\S]+profileTier\)\s*===\s*'admin'/);
        strict_1.default.doesNotMatch(accessControl, /isAdminSubject[\s\S]+plan\)\s*===\s*'admin'/);
        strict_1.default.match(conexRbac, /return isProtectedOwnerUserId\(userId\);/);
        strict_1.default.match(conexRbac, /export function hasConexAccess/);
        strict_1.default.match(conexRbac, /return isRootConexAdmin\(subject\.userId, subject\.email\);/);
    });
    await run('Conex user management route returns admin data with no-store responses only', () => {
        const source = readRepoFile('src/app/conex/users/route.ts');
        strict_1.default.match(source, /requireAdmin\(req\)/);
        strict_1.default.match(source, /headers:\s*\{\s*'Cache-Control': 'no-store'\s*\}/);
        strict_1.default.doesNotMatch(source, /message\s*=\s*error instanceof Error \? error\.message/);
    });
    await run('proxy auth validation prefers the explicit authorization header over ambient cookies after refresh', () => {
        const source = readRepoFile('src/app/api/proxy/_supabase-auth.ts');
        const headerIndex = source.indexOf("candidates.push({ token: headerToken, source: 'header' })");
        const cookieIndex = source.indexOf("candidates.push({ token: cookieToken, source: 'cookie' })");
        strict_1.default.equal(headerIndex >= 0, true);
        strict_1.default.equal(cookieIndex >= 0, true);
        strict_1.default.equal(headerIndex < cookieIndex, true);
    });
    await run('recoverable proxy 401s stay endpoint-scoped when browser session restore is still possible', () => {
        const source = readRepoFile('src/lib/supabase-client/client.ts');
        strict_1.default.match(source, /input\.refreshedResolution\.source !== 'none'/);
        strict_1.default.match(source, /input\.settledResolution\.source !== 'none'/);
        strict_1.default.match(source, /Boolean\(input\.latestSession\?\.refresh_token\)/);
        strict_1.default.match(source, /refreshedSessionSource: refreshedResolution\.source/);
        strict_1.default.match(source, /settledSessionSource: settledResolution\.source/);
        strict_1.default.match(source, /hasLatestRefreshToken: Boolean\(latestSession\?\.refresh_token\)/);
    });
    if (failed > 0) {
        process.exit(1);
    }
}
void main();
