import assert from 'node:assert/strict';
import {
  GLOBAL_CHAT_WELCOME_COPY,
  matchGlobalChatTemplate,
  resolveGlobalChatNavAction,
} from '../shared/global-chat-routing.js';
import {
  classifyDocumentIntent,
  hasDocumentScopedReference,
  resolveDocumentReference,
} from '../shared/document-chat-context.js';
import {
  LARGE_FILE_DISABLED_MESSAGE,
  getLargeFileGate,
} from '../src/lib/upload/large-file-gating.js';
import {
  isActiveStatus,
  isTerminalStatus,
  reconcileJobsWithDocumentRows,
} from '../src/lib/upload/job-status.js';
import { isJobOlderThan } from '../rag-worker/src/job-recovery.js';

let failed = 0;

type AsyncTest = () => void | Promise<void>;

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
  await run('global chat greeting uses the exact production welcome copy', () => {
    const result = matchGlobalChatTemplate('hello');
    assert.equal(result?.answer, GLOBAL_CHAT_WELCOME_COPY);
  });

  await run('global chat documents intent maps to /dashboard/documents', () => {
    const result = resolveGlobalChatNavAction('open my documents');
    assert.equal(result?.href, '/dashboard/documents');
    assert.equal(result?.available, true);
  });

  await run('global chat settings intent maps to the existing dashboard settings route', () => {
    const result = resolveGlobalChatNavAction('show my preferences');
    assert.equal(result?.href, '/dashboard/settings');
    assert.equal(result?.available, true);
  });

  await run('global chat goals intent falls back honestly when the route is unavailable', () => {
    const result = matchGlobalChatTemplate('review my goals');
    assert.equal(result?.navAction, null);
    assert.match(String(result?.answer || ''), /available/i);
  });

  await run('document intent classifier identifies summary-style follow-ups', () => {
    assert.equal(classifyDocumentIntent('give me an overview of this document'), 'document_overview');
    assert.equal(classifyDocumentIntent('Extract the key topics from this document.'), 'document_key_points');
    assert.equal(hasDocumentScopedReference('what is this document about'), true);
  });

  await run('document resolver prefers the active document for this-document follow-ups', () => {
    const result = resolveDocumentReference({
      message: 'summarize this document',
      context: {
        active_document_id: 'doc-1',
        active_document_name: 'Biology',
        document_count_in_scope: 1,
      },
    });

    assert.equal(result.documentId, 'doc-1');
    assert.equal(result.strategy, 'active_document');
    assert.equal(result.needsClarification, false);
  });

  await run('document resolver uses the last retrieved document when there is prior-turn context', () => {
    const result = resolveDocumentReference({
      message: 'what is this document about',
      context: {
        last_retrieved_document_id: 'doc-2',
        document_count_in_scope: 2,
      },
    });

    assert.equal(result.documentId, 'doc-2');
    assert.equal(result.strategy, 'last_retrieved_document');
  });

  await run('document resolver asks for clarification when multiple documents are in scope', () => {
    const result = resolveDocumentReference({
      message: 'give me an overview of this document',
      context: {
        document_count_in_scope: 3,
      },
    });

    assert.equal(result.needsClarification, true);
    assert.equal(result.answer, 'Which document should I use?');
  });

  await run('document resolver reports the no-document case concisely', () => {
    const result = resolveDocumentReference({
      message: 'summarize this file',
      context: {
        document_count_in_scope: 0,
      },
    });

    assert.equal(result.missingDocument, true);
    assert.equal(result.answer, 'Please upload a document so I can help.');
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
    const result = reconcileJobsWithDocumentRows(jobs as any, docs);
    assert.equal(result[0].status, 'done');
    assert.equal(result[0].progress, 100);
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
    const result = reconcileJobsWithDocumentRows(jobs as any, docs);
    assert.equal(result[0].status, 'failed');
    assert.match(String(result[0].error || ''), /stale_timeout/i);
  });

  await run('terminal statuses release concurrency slots', () => {
    assert.equal(isActiveStatus('processing' as any), true);
    assert.equal(isActiveStatus('stale_timeout' as any), false);
    assert.equal(isTerminalStatus('stale_timeout' as any), true);
    assert.equal(isTerminalStatus('completed' as any), true);
  });

  await run('stale analyzing jobs are detected for cleanup', () => {
    const nowMs = Date.parse('2024-01-01T00:10:00Z');
    assert.equal(isJobOlderThan('2024-01-01T00:00:00Z', 5 * 60 * 1000, nowMs), true);
    assert.equal(isJobOlderThan('2024-01-01T00:08:00Z', 5 * 60 * 1000, nowMs), false);
  });

  await run('large-file gate triggers only above 50 MB when the future flag is disabled', () => {
    const result = getLargeFileGate({
      fileSizeBytes: 51 * 1024 * 1024,
      maxFileSizeMb: 50,
    });

    assert.equal(result.blocked, true);
    assert.equal(result.message, LARGE_FILE_DISABLED_MESSAGE);
    assert.equal(result.suppressUpgradePrompt, true);
  });

  await run('large-file gate does not trigger for files at or below 50 MB', () => {
    const result = getLargeFileGate({
      fileSizeBytes: 50 * 1024 * 1024,
      maxFileSizeMb: 50,
    });

    assert.equal(result.blocked, false);
  });

  await run('large-file gate does not trigger when the feature flag is enabled', () => {
    const result = getLargeFileGate({
      fileSizeBytes: 70 * 1024 * 1024,
      maxFileSizeMb: 100,
    });

    assert.equal(result.blocked, false);
  });

  await run('large-file gate is scoped to the current upload input only', () => {
    const blocked = getLargeFileGate({
      fileSizeBytes: 80 * 1024 * 1024,
      maxFileSizeMb: 50,
    });
    const allowed = getLargeFileGate({
      fileSizeBytes: 5 * 1024 * 1024,
      maxFileSizeMb: 50,
    });

    assert.equal(blocked.blocked, true);
    assert.equal(allowed.blocked, false);
  });

  if (failed > 0) {
    process.exit(1);
  }
}

void main();
