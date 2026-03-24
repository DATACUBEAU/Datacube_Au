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
    if (failed > 0) {
        process.exit(1);
    }
}
void main();
