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
        strict_1.default.match(source, /authIntent:\s*'background'/);
        strict_1.default.match(source, /reauthOnAuthFailure:\s*false/);
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
    await run('chat pipeline does not force expiry on a transient missing token during restore', () => {
        const source = readRepoFile('src/hooks/api/use-au-chat.ts');
        strict_1.default.equal(source.includes('missing_access_token'), false);
        strict_1.default.match(source, /isAuthLoading \|\| isRestoringAuth/);
        strict_1.default.match(source, /accessToken:\s*session\?\.access_token \?\? '__cookie_session__'/);
        strict_1.default.equal(source.includes("source: 'useAuChat.sendMessage'"), false);
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
    await run('available chat models are cached and prompt starter payloads are budgeted', () => {
        const source = readRepoFile('src/lib/api/chat.ts');
        strict_1.default.match(source, /AVAILABLE_MODELS_CACHE_TTL_MS/);
        strict_1.default.match(source, /availableModelsInFlight/);
        strict_1.default.match(source, /PROMPT_STARTER_DOCUMENT_BUDGET/);
    });
    await run('chat duplicate sends are blocked while the same prompt is already in flight', () => {
        const source = readRepoFile('src/hooks/api/use-au-chat.ts');
        strict_1.default.match(source, /activePromptHashRef/);
        strict_1.default.match(source, /if \(activePromptHashRef\.current === promptHash\) \{/);
    });
    await run('account snapshot refreshes are throttled and polling only runs when realtime is degraded', () => {
        const source = readRepoFile('src/components/providers/account-snapshot-provider.tsx');
        strict_1.default.match(source, /POLL_INTERVAL_MS = 120_000/);
        strict_1.default.match(source, /SNAPSHOT_MIN_REFRESH_INTERVAL_MS = 15_000/);
        strict_1.default.match(source, /const \[isRealtimeDegraded, setIsRealtimeDegraded\] = useState\(false\)/);
        strict_1.default.match(source, /if \(!isRealtimeDegraded\) return;/);
        strict_1.default.equal(source.includes("table: 'au_messages'"), false);
        strict_1.default.equal(source.includes("table: 'au_model_usage'"), false);
    });
    await run('feature flag polling only activates when realtime is degraded', () => {
        const source = readRepoFile('src/components/feature-flag-provider.tsx');
        strict_1.default.match(source, /POLL_INTERVAL_MS = 120_000/);
        strict_1.default.match(source, /const \[isRealtimeDegraded, setIsRealtimeDegraded\] = useState\(false\)/);
        strict_1.default.match(source, /if \(!isRealtimeDegraded\) return;/);
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
    await run('generation flows clamp heavy document payloads and use shared user-facing error messaging', () => {
        const storeSource = readRepoFile('src/hooks/use-store.ts');
        const examsHook = readRepoFile('src/hooks/api/use-au-exams.ts');
        strict_1.default.match(storeSource, /KNOWLEDGE_DOCUMENT_BUDGET/);
        strict_1.default.match(storeSource, /PREDICTION_PAST_QUESTIONS_BUDGET/);
        strict_1.default.match(storeSource, /describeApiErrorForUser/);
        strict_1.default.match(examsHook, /getAuDocumentChunksText/);
        strict_1.default.match(examsHook, /PRACTICE_DOCUMENT_BUDGET/);
        strict_1.default.match(examsHook, /describeApiErrorForUser/);
    });
    await run('dashboard activity heartbeat is throttled so it cannot chatter every minute', () => {
        const layoutSource = readRepoFile('src/app/dashboard/layout.tsx');
        const clientSource = readRepoFile('src/lib/supabase-client/client.ts');
        strict_1.default.match(layoutSource, /5 \* 60 \* 1000/);
        strict_1.default.match(clientSource, /USER_ACTIVITY_HEARTBEAT_MS = 5 \* 60 \* 1000/);
        strict_1.default.match(clientSource, /USER_ACTIVITY_METADATA_SYNC_MS = 15 \* 60 \* 1000/);
        strict_1.default.match(clientSource, /userActivityHeartbeatAt/);
        strict_1.default.match(clientSource, /userActivityMetadataSyncAt/);
    });
    await run('exam and generation flows no longer hard-require a local access token before protected requests', () => {
        const examsHook = readRepoFile('src/hooks/api/use-au-exams.ts');
        const knowledgePage = readRepoFile('src/app/dashboard/knowledge/page.tsx');
        const practicePage = readRepoFile('src/app/dashboard/practice/page.tsx');
        const predictionsPage = readRepoFile('src/app/dashboard/predictions/page.tsx');
        strict_1.default.match(examsHook, /accessToken:\s*session\?\.access_token \?\? '__cookie_session__'/);
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
    await run('legacy proxy wrappers share a cookie-aware forward helper instead of stripping auth context', () => {
        const helper = readRepoFile('src/app/api/_proxy-forward.ts');
        strict_1.default.match(helper, /headers\.set\('Cookie', cookie\)/);
        strict_1.default.match(helper, /headers\.set\('Authorization', authorization\)/);
        for (const file of [
            'src/app/api/chat/route.ts',
            'src/app/api/generate-knowledge/route.ts',
            'src/app/api/generate-practice-exam/route.ts',
            'src/app/api/generate-exam-predictions/route.ts',
            'src/app/api/generate-prompt-starters/route.ts',
        ]) {
            const source = readRepoFile(file);
            strict_1.default.match(source, /forwardProxyJsonRequest/);
        }
    });
    await run('chat history route uses canonical request auth and RLS client helpers', () => {
        const source = readRepoFile('src/app/api/chat/history/route.ts');
        strict_1.default.match(source, /requireUserFromRequest/);
        strict_1.default.match(source, /createSupabaseRlsClient/);
        strict_1.default.equal(source.includes("runtime = 'edge'"), false);
    });
    await run('proxy auth failures now expose request auth diagnostics for runtime debugging', () => {
        const source = readRepoFile('src/app/api/proxy/[functionName]/route.ts');
        strict_1.default.match(source, /x-dcau-auth-stage/);
        strict_1.default.match(source, /x-dcau-auth-has-authorization/);
        strict_1.default.match(source, /serializeRequestAuthDiagnostics/);
        strict_1.default.match(source, /auth_stage:\s*input\.stage/);
        strict_1.default.match(source, /\[proxy\] auth failure surfaced via catch/);
        strict_1.default.match(source, /const headers = applyRequestAuthDebugHeaders/);
        strict_1.default.match(source, /const normalizedDetails = buildAuthFailureDetails/);
    });
    await run('proxy no longer turns ambiguous post-auth chat failures into false 401 responses', () => {
        const source = readRepoFile('src/app/api/proxy/[functionName]/route.ts');
        strict_1.default.match(source, /shouldTreatCaughtAuthFailureAsAmbiguousPostAuthFailure/);
        strict_1.default.match(source, /hasValidatedRequestAuth/);
        strict_1.default.match(source, /\[proxy\] suppressing ambiguous auth failure after validated auth/);
        strict_1.default.match(source, /tryLegacyChatFallbackIfEligible\('unexpected_error'\)/);
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
