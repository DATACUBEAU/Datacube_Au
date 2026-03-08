import assert from 'node:assert/strict';
import {
  clearKnowledgeGenerationLockRecord,
  readKnowledgeGenerationLockRecord,
  resolveKnowledgeGenerateButtonState,
  writeKnowledgeGenerationLockRecord,
  type KnowledgeGenerationLockRecord,
} from '../src/lib/knowledge/generation-lock.js';

let failed = 0;

type SyncOrAsyncTest = () => void | Promise<void>;

async function run(name: string, fn: SyncOrAsyncTest) {
  try {
    await fn();
    console.log(`PASS ${name}`);
  } catch (error: any) {
    failed += 1;
    console.error(`FAIL ${name}`);
    console.error(error?.stack || error);
  }
}

function createMemoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem(key: string) {
      return values.has(key) ? values.get(key) || null : null;
    },
    setItem(key: string, value: string) {
      values.set(key, value);
    },
    removeItem(key: string) {
      values.delete(key);
    },
  };
}

async function main() {
  await run('active ready state renders the knowledge button as already generated', () => {
    const state = resolveKnowledgeGenerateButtonState({
      documentId: 'doc-1',
      isGenerating: false,
      isOnline: true,
      documentReady: true,
      remoteStatus: 'ready',
      localLockStatus: null,
    });

    assert.equal(state.disabled, true);
    assert.equal(state.effectiveLockStatus, 'ready');
    assert.equal(state.label, 'Already Generated');
  });

  await run('persisted ready lock keeps the knowledge button disabled before backend sync completes', () => {
    const state = resolveKnowledgeGenerateButtonState({
      documentId: 'doc-2',
      isGenerating: false,
      isOnline: true,
      documentReady: true,
      remoteStatus: 'idle',
      localLockStatus: 'ready',
    });

    assert.equal(state.disabled, true);
    assert.equal(state.effectiveLockStatus, 'ready');
    assert.equal(state.label, 'Already Generated');
  });

  await run('failed lock renders a controlled generation-locked state', () => {
    const state = resolveKnowledgeGenerateButtonState({
      documentId: 'doc-3',
      isGenerating: false,
      isOnline: true,
      documentReady: true,
      remoteStatus: 'missing',
      localLockStatus: 'failed',
    });

    assert.equal(state.disabled, true);
    assert.equal(state.effectiveLockStatus, 'failed');
    assert.equal(state.label, 'Generation Locked');
  });

  await run('knowledge generation locks round-trip through client storage', () => {
    const storage = createMemoryStorage();
    const record: KnowledgeGenerationLockRecord = {
      documentId: 'doc-4',
      status: 'ready',
      docVersionId: 'version-1',
      updatedAt: '2026-03-07T18:00:00.000Z',
    };

    writeKnowledgeGenerationLockRecord(storage, record);
    assert.deepEqual(readKnowledgeGenerationLockRecord('doc-4', storage), record);

    clearKnowledgeGenerationLockRecord('doc-4', storage);
    assert.equal(readKnowledgeGenerationLockRecord('doc-4', storage), null);
  });

  if (failed > 0) {
    process.exit(1);
  }
}

void main();
