"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const generation_lock_js_1 = require("../src/lib/knowledge/generation-lock.js");
let failed = 0;
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
function createMemoryStorage() {
    const values = new Map();
    return {
        getItem(key) {
            return values.has(key) ? values.get(key) || null : null;
        },
        setItem(key, value) {
            values.set(key, value);
        },
        removeItem(key) {
            values.delete(key);
        },
    };
}
async function main() {
    await run('active ready state renders the knowledge button as already generated', () => {
        const state = (0, generation_lock_js_1.resolveKnowledgeGenerateButtonState)({
            documentId: 'doc-1',
            isGenerating: false,
            isOnline: true,
            documentReady: true,
            remoteStatus: 'ready',
            localLockStatus: null,
        });
        strict_1.default.equal(state.disabled, true);
        strict_1.default.equal(state.effectiveLockStatus, 'ready');
        strict_1.default.equal(state.label, 'Already Generated');
    });
    await run('persisted ready lock keeps the knowledge button disabled before backend sync completes', () => {
        const state = (0, generation_lock_js_1.resolveKnowledgeGenerateButtonState)({
            documentId: 'doc-2',
            isGenerating: false,
            isOnline: true,
            documentReady: true,
            remoteStatus: 'idle',
            localLockStatus: 'ready',
        });
        strict_1.default.equal(state.disabled, true);
        strict_1.default.equal(state.effectiveLockStatus, 'ready');
        strict_1.default.equal(state.label, 'Already Generated');
    });
    await run('failed lock renders a controlled generation-locked state', () => {
        const state = (0, generation_lock_js_1.resolveKnowledgeGenerateButtonState)({
            documentId: 'doc-3',
            isGenerating: false,
            isOnline: true,
            documentReady: true,
            remoteStatus: 'missing',
            localLockStatus: 'failed',
        });
        strict_1.default.equal(state.disabled, true);
        strict_1.default.equal(state.effectiveLockStatus, 'failed');
        strict_1.default.equal(state.label, 'Generation Locked');
    });
    await run('knowledge generation locks round-trip through client storage', () => {
        const storage = createMemoryStorage();
        const record = {
            documentId: 'doc-4',
            status: 'ready',
            docVersionId: 'version-1',
            updatedAt: '2026-03-07T18:00:00.000Z',
        };
        (0, generation_lock_js_1.writeKnowledgeGenerationLockRecord)(storage, record);
        strict_1.default.deepEqual((0, generation_lock_js_1.readKnowledgeGenerationLockRecord)('doc-4', storage), record);
        (0, generation_lock_js_1.clearKnowledgeGenerationLockRecord)('doc-4', storage);
        strict_1.default.equal((0, generation_lock_js_1.readKnowledgeGenerationLockRecord)('doc-4', storage), null);
    });
    if (failed > 0) {
        process.exit(1);
    }
}
void main();
