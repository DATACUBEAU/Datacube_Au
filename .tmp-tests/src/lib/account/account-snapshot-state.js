"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.classifyAccountSnapshotFailure = classifyAccountSnapshotFailure;
exports.resolveBootstrapAccountSnapshotState = resolveBootstrapAccountSnapshotState;
exports.resolveSuccessfulAccountSnapshotState = resolveSuccessfulAccountSnapshotState;
exports.resolveFailedAccountSnapshotState = resolveFailedAccountSnapshotState;
function normalizeErrorMessage(error) {
    return String(error?.message || '').trim().toLowerCase();
}
function classifyAccountSnapshotFailure(error) {
    const status = Number(error?.status || 0);
    const code = String(error?.code || '').trim().toUpperCase();
    const name = String(error?.name || '').trim();
    const message = normalizeErrorMessage(error);
    if (status === 401 || code === 'AUTH_REQUIRED')
        return 'unauthorized';
    if (status === 403)
        return 'forbidden';
    if (name === 'OfflineError' || message.includes('offline'))
        return 'offline';
    if (name === 'AbortError' || message.includes('timed out') || message.includes('timeout'))
        return 'timeout';
    if (message.includes('network') ||
        message.includes('failed to fetch') ||
        message.includes('load failed') ||
        message.includes('fetch failed')) {
        return 'network';
    }
    return 'unknown';
}
function resolveBootstrapAccountSnapshotState(snapshot, cachedAt) {
    return {
        snapshot,
        loading: !snapshot,
        isUsingCachedData: Boolean(snapshot),
        cachedAt: snapshot ? cachedAt : null,
    };
}
function resolveSuccessfulAccountSnapshotState(snapshot, cachedAt) {
    return {
        snapshot,
        loading: false,
        isUsingCachedData: false,
        cachedAt,
    };
}
function resolveFailedAccountSnapshotState(input) {
    const reason = classifyAccountSnapshotFailure(input.error);
    if (reason === 'unauthorized' || reason === 'forbidden') {
        return {
            snapshot: null,
            loading: false,
            isUsingCachedData: false,
            cachedAt: null,
            clearPersistedSnapshot: true,
            reason,
        };
    }
    const fallbackSnapshot = input.cachedSnapshot ?? input.currentSnapshot;
    const fallbackCachedAt = input.cachedSnapshot !== null && input.cachedSnapshot !== undefined
        ? input.cachedAt
        : input.currentCachedAt;
    if (fallbackSnapshot) {
        return {
            snapshot: fallbackSnapshot,
            loading: false,
            isUsingCachedData: true,
            cachedAt: fallbackCachedAt ?? null,
            clearPersistedSnapshot: false,
            reason,
        };
    }
    return {
        snapshot: null,
        loading: false,
        isUsingCachedData: false,
        cachedAt: null,
        clearPersistedSnapshot: false,
        reason,
    };
}
