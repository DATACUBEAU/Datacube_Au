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
    await run('invokeEdgeFunction owns auth escalation instead of delegating it to safeFetch', () => {
        const source = readRepoFile('src/lib/supabase-client/client.ts');
        strict_1.default.match(source, /suppressAuthError:\s*true/);
        strict_1.default.match(source, /reauthOnAuthFailure/);
        strict_1.default.match(source, /authIntent,\s*\n/);
        strict_1.default.match(source, /readEdgeAuthFailureDiagnostics/);
        strict_1.default.match(source, /shouldRetryWithRecoveredToken/);
        strict_1.default.match(source, /suppressed session expiry for recoverable or endpoint-scoped 401/);
    });
    await run('browser auth restore reuses persisted sessions and syncs the server cookie before protected proxy calls', () => {
        const source = readRepoFile('src/lib/supabase-client/client.ts');
        strict_1.default.match(source, /readPersistedSupabaseSession/);
        strict_1.default.match(source, /syncServerAuthSessionCookie\(persistedSession\)/);
        strict_1.default.match(source, /syncServerAuthSessionCookie\(refreshedSession\)/);
        strict_1.default.match(source, /syncServerAuthSessionCookie\(session\)/);
        strict_1.default.match(source, /export async function fetchEdgeFunctionResponse/);
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
    });
    if (failed > 0) {
        process.exit(1);
    }
}
void main();
