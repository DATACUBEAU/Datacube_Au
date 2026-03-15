"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const global_chat_routing_js_1 = require("../shared/global-chat-routing.js");
const document_chat_context_js_1 = require("../shared/document-chat-context.js");
const large_file_gating_js_1 = require("../src/lib/upload/large-file-gating.js");
const job_status_js_1 = require("../src/lib/upload/job-status.js");
const job_recovery_js_1 = require("../rag-worker/src/job-recovery.js");
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
async function main() {
    await run('global chat greeting uses the exact production welcome copy', () => {
        const result = (0, global_chat_routing_js_1.matchGlobalChatTemplate)('hello');
        strict_1.default.equal(result?.answer, global_chat_routing_js_1.GLOBAL_CHAT_WELCOME_COPY);
    });
    await run('global chat documents intent maps to /dashboard/documents', () => {
        const result = (0, global_chat_routing_js_1.resolveGlobalChatNavAction)('open my documents');
        strict_1.default.equal(result?.href, '/dashboard/documents');
        strict_1.default.equal(result?.available, true);
    });
    await run('global chat settings intent maps to the existing dashboard settings route', () => {
        const result = (0, global_chat_routing_js_1.resolveGlobalChatNavAction)('show my preferences');
        strict_1.default.equal(result?.href, '/dashboard/settings');
        strict_1.default.equal(result?.available, true);
    });
    await run('global chat goals intent falls back honestly when the route is unavailable', () => {
        const result = (0, global_chat_routing_js_1.matchGlobalChatTemplate)('review my goals');
        strict_1.default.equal(result?.navAction, null);
        strict_1.default.match(String(result?.answer || ''), /available/i);
    });
    await run('document intent classifier identifies summary-style follow-ups', () => {
        strict_1.default.equal((0, document_chat_context_js_1.classifyDocumentIntent)('give me an overview of this document'), 'document_overview');
        strict_1.default.equal((0, document_chat_context_js_1.classifyDocumentIntent)('Extract the key topics from this document.'), 'document_key_points');
        strict_1.default.equal((0, document_chat_context_js_1.hasDocumentScopedReference)('what is this document about'), true);
    });
    await run('document resolver prefers the active document for this-document follow-ups', () => {
        const result = (0, document_chat_context_js_1.resolveDocumentReference)({
            message: 'summarize this document',
            context: {
                active_document_id: 'doc-1',
                active_document_name: 'Biology',
                document_count_in_scope: 1,
            },
        });
        strict_1.default.equal(result.documentId, 'doc-1');
        strict_1.default.equal(result.strategy, 'active_document');
        strict_1.default.equal(result.needsClarification, false);
    });
    await run('document resolver uses the last retrieved document when there is prior-turn context', () => {
        const result = (0, document_chat_context_js_1.resolveDocumentReference)({
            message: 'what is this document about',
            context: {
                last_retrieved_document_id: 'doc-2',
                document_count_in_scope: 2,
            },
        });
        strict_1.default.equal(result.documentId, 'doc-2');
        strict_1.default.equal(result.strategy, 'last_retrieved_document');
    });
    await run('document resolver asks for clarification when multiple documents are in scope', () => {
        const result = (0, document_chat_context_js_1.resolveDocumentReference)({
            message: 'give me an overview of this document',
            context: {
                document_count_in_scope: 3,
            },
        });
        strict_1.default.equal(result.needsClarification, true);
        strict_1.default.equal(result.answer, 'Which document should I use?');
    });
    await run('document resolver reports the no-document case concisely', () => {
        const result = (0, document_chat_context_js_1.resolveDocumentReference)({
            message: 'summarize this file',
            context: {
                document_count_in_scope: 0,
            },
        });
        strict_1.default.equal(result.missingDocument, true);
        strict_1.default.equal(result.answer, 'Please upload a document so I can help.');
    });
    await run('upload reconciliation marks jobs done when document completion arrives', () => {
        const jobs = [
            {
                id: 'job-1',
                document_id: 'doc-1',
                status: 'processing',
                progress: 100,
                updated_at: '2024-01-01T00:00:00Z',
            },
        ];
        const docs = [
            {
                id: 'doc-1',
                status: 'completed',
                created_at: '2024-01-01T00:10:00Z',
            },
        ];
        const result = (0, job_status_js_1.reconcileJobsWithDocumentRows)(jobs, docs);
        strict_1.default.equal(result[0].status, 'done');
        strict_1.default.equal(result[0].progress, 100);
    });
    await run('upload reconciliation escalates to failed when document status fails', () => {
        const jobs = [
            {
                id: 'job-2',
                document_id: 'doc-2',
                status: 'processing',
                progress: 100,
                updated_at: '2024-01-01T00:00:00Z',
            },
        ];
        const docs = [
            {
                id: 'doc-2',
                status: 'failed',
                error: 'stale_timeout',
                created_at: '2024-01-01T00:15:00Z',
            },
        ];
        const result = (0, job_status_js_1.reconcileJobsWithDocumentRows)(jobs, docs);
        strict_1.default.equal(result[0].status, 'failed');
        strict_1.default.match(String(result[0].error || ''), /stale_timeout/i);
    });
    await run('terminal statuses release concurrency slots', () => {
        strict_1.default.equal((0, job_status_js_1.isActiveStatus)('processing'), true);
        strict_1.default.equal((0, job_status_js_1.isActiveStatus)('stale_timeout'), false);
        strict_1.default.equal((0, job_status_js_1.isTerminalStatus)('stale_timeout'), true);
        strict_1.default.equal((0, job_status_js_1.isTerminalStatus)('completed'), true);
    });
    await run('stale analyzing jobs are detected for cleanup', () => {
        const nowMs = Date.parse('2024-01-01T00:10:00Z');
        strict_1.default.equal((0, job_recovery_js_1.isJobOlderThan)('2024-01-01T00:00:00Z', 5 * 60 * 1000, nowMs), true);
        strict_1.default.equal((0, job_recovery_js_1.isJobOlderThan)('2024-01-01T00:08:00Z', 5 * 60 * 1000, nowMs), false);
    });
    await run('large-file gate triggers only above 50 MB when the future flag is disabled', () => {
        const result = (0, large_file_gating_js_1.getLargeFileGate)({
            fileSizeBytes: 51 * 1024 * 1024,
            maxFileSizeMb: 50,
        });
        strict_1.default.equal(result.blocked, true);
        strict_1.default.equal(result.message, large_file_gating_js_1.LARGE_FILE_DISABLED_MESSAGE);
        strict_1.default.equal(result.suppressUpgradePrompt, true);
    });
    await run('large-file gate does not trigger for files at or below 50 MB', () => {
        const result = (0, large_file_gating_js_1.getLargeFileGate)({
            fileSizeBytes: 50 * 1024 * 1024,
            maxFileSizeMb: 50,
        });
        strict_1.default.equal(result.blocked, false);
    });
    await run('large-file gate does not trigger when the feature flag is enabled', () => {
        const result = (0, large_file_gating_js_1.getLargeFileGate)({
            fileSizeBytes: 70 * 1024 * 1024,
            maxFileSizeMb: 100,
        });
        strict_1.default.equal(result.blocked, false);
    });
    await run('large-file gate is scoped to the current upload input only', () => {
        const blocked = (0, large_file_gating_js_1.getLargeFileGate)({
            fileSizeBytes: 80 * 1024 * 1024,
            maxFileSizeMb: 50,
        });
        const allowed = (0, large_file_gating_js_1.getLargeFileGate)({
            fileSizeBytes: 5 * 1024 * 1024,
            maxFileSizeMb: 50,
        });
        strict_1.default.equal(blocked.blocked, true);
        strict_1.default.equal(allowed.blocked, false);
    });
    if (failed > 0) {
        process.exit(1);
    }
}
void main();
