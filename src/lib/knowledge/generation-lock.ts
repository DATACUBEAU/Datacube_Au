export type KnowledgeGenerationRemoteStatus =
  | 'idle'
  | 'loading'
  | 'missing'
  | 'ready'
  | 'running'
  | 'failed';

export type KnowledgeGenerationLockStatus = 'ready' | 'failed';

export type KnowledgeGenerationLockRecord = {
  documentId: string;
  status: KnowledgeGenerationLockStatus;
  docVersionId: string | null;
  updatedAt: string | null;
};

const KNOWLEDGE_GENERATION_LOCK_PREFIX = 'knowledge_generation_lock_';

export function getKnowledgeGenerationLockStorageKey(documentId: string): string {
  return `${KNOWLEDGE_GENERATION_LOCK_PREFIX}${String(documentId || '').trim()}`;
}

export function readKnowledgeGenerationLockRecord(
  documentId: string,
  storage: Pick<Storage, 'getItem'>,
): KnowledgeGenerationLockRecord | null {
  const normalizedDocumentId = String(documentId || '').trim();
  if (!normalizedDocumentId) return null;

  const raw = storage.getItem(getKnowledgeGenerationLockStorageKey(normalizedDocumentId));
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw) as Partial<KnowledgeGenerationLockRecord> | null;
    if (!parsed || parsed.documentId !== normalizedDocumentId) {
      return null;
    }
    if (parsed.status !== 'ready' && parsed.status !== 'failed') {
      return null;
    }

    return {
      documentId: normalizedDocumentId,
      status: parsed.status,
      docVersionId: typeof parsed.docVersionId === 'string' && parsed.docVersionId.trim() ? parsed.docVersionId : null,
      updatedAt: typeof parsed.updatedAt === 'string' && parsed.updatedAt.trim() ? parsed.updatedAt : null,
    };
  } catch {
    return null;
  }
}

export function writeKnowledgeGenerationLockRecord(
  storage: Pick<Storage, 'setItem'>,
  record: KnowledgeGenerationLockRecord,
): void {
  storage.setItem(getKnowledgeGenerationLockStorageKey(record.documentId), JSON.stringify(record));
}

export function clearKnowledgeGenerationLockRecord(
  documentId: string,
  storage: Pick<Storage, 'removeItem'>,
): void {
  const normalizedDocumentId = String(documentId || '').trim();
  if (!normalizedDocumentId) return;
  storage.removeItem(getKnowledgeGenerationLockStorageKey(normalizedDocumentId));
}

export function isTerminalKnowledgeGenerationStatus(
  status: KnowledgeGenerationRemoteStatus | null | undefined,
): status is KnowledgeGenerationLockStatus {
  return status === 'ready' || status === 'failed';
}

export function resolveKnowledgeGenerationLockStatus(input: {
  remoteStatus: KnowledgeGenerationRemoteStatus;
  localLockStatus?: KnowledgeGenerationLockStatus | null;
}): KnowledgeGenerationLockStatus | null {
  if (isTerminalKnowledgeGenerationStatus(input.remoteStatus)) {
    return input.remoteStatus;
  }
  return input.localLockStatus || null;
}

export function resolveKnowledgeGenerateButtonState(input: {
  documentId?: string | null;
  isGenerating: boolean;
  isOnline: boolean;
  documentReady: boolean;
  remoteStatus: KnowledgeGenerationRemoteStatus;
  localLockStatus?: KnowledgeGenerationLockStatus | null;
}) {
  const effectiveLockStatus = resolveKnowledgeGenerationLockStatus({
    remoteStatus: input.remoteStatus,
    localLockStatus: input.localLockStatus,
  });
  const isBusy = input.isGenerating || input.remoteStatus === 'loading' || input.remoteStatus === 'running';
  const isLocked = effectiveLockStatus === 'ready' || effectiveLockStatus === 'failed';
  const disabled =
    !input.documentId ||
    !input.isOnline ||
    !input.documentReady ||
    isBusy ||
    isLocked;

  return {
    disabled,
    ariaDisabled: disabled,
    isBusy,
    effectiveLockStatus,
    label:
      effectiveLockStatus === 'ready'
        ? 'Already Generated'
        : effectiveLockStatus === 'failed'
          ? 'Generation Locked'
          : 'Generate',
  };
}
