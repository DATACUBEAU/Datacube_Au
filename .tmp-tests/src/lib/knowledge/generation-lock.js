"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getKnowledgeGenerationLockStorageKey = getKnowledgeGenerationLockStorageKey;
exports.readKnowledgeGenerationLockRecord = readKnowledgeGenerationLockRecord;
exports.writeKnowledgeGenerationLockRecord = writeKnowledgeGenerationLockRecord;
exports.clearKnowledgeGenerationLockRecord = clearKnowledgeGenerationLockRecord;
exports.isTerminalKnowledgeGenerationStatus = isTerminalKnowledgeGenerationStatus;
exports.resolveKnowledgeGenerationLockStatus = resolveKnowledgeGenerationLockStatus;
exports.resolveKnowledgeGenerateButtonState = resolveKnowledgeGenerateButtonState;
const KNOWLEDGE_GENERATION_LOCK_PREFIX = 'knowledge_generation_lock_';
function getKnowledgeGenerationLockStorageKey(documentId) {
    return `${KNOWLEDGE_GENERATION_LOCK_PREFIX}${String(documentId || '').trim()}`;
}
function readKnowledgeGenerationLockRecord(documentId, storage) {
    const normalizedDocumentId = String(documentId || '').trim();
    if (!normalizedDocumentId)
        return null;
    const raw = storage.getItem(getKnowledgeGenerationLockStorageKey(normalizedDocumentId));
    if (!raw)
        return null;
    try {
        const parsed = JSON.parse(raw);
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
    }
    catch {
        return null;
    }
}
function writeKnowledgeGenerationLockRecord(storage, record) {
    storage.setItem(getKnowledgeGenerationLockStorageKey(record.documentId), JSON.stringify(record));
}
function clearKnowledgeGenerationLockRecord(documentId, storage) {
    const normalizedDocumentId = String(documentId || '').trim();
    if (!normalizedDocumentId)
        return;
    storage.removeItem(getKnowledgeGenerationLockStorageKey(normalizedDocumentId));
}
function isTerminalKnowledgeGenerationStatus(status) {
    return status === 'ready' || status === 'failed';
}
function resolveKnowledgeGenerationLockStatus(input) {
    if (isTerminalKnowledgeGenerationStatus(input.remoteStatus)) {
        return input.remoteStatus;
    }
    return input.localLockStatus || null;
}
function resolveKnowledgeGenerateButtonState(input) {
    const effectiveLockStatus = resolveKnowledgeGenerationLockStatus({
        remoteStatus: input.remoteStatus,
        localLockStatus: input.localLockStatus,
    });
    const isBusy = input.isGenerating || input.remoteStatus === 'loading' || input.remoteStatus === 'running';
    const isLocked = effectiveLockStatus === 'ready' || effectiveLockStatus === 'failed';
    const disabled = !input.documentId ||
        !input.isOnline ||
        !input.documentReady ||
        isBusy ||
        isLocked;
    return {
        disabled,
        ariaDisabled: disabled,
        isBusy,
        effectiveLockStatus,
        label: effectiveLockStatus === 'ready'
            ? 'Already Generated'
            : effectiveLockStatus === 'failed'
                ? 'Generation Locked'
                : 'Generate',
    };
}
