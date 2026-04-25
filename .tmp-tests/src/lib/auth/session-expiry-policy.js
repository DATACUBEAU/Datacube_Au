"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.shouldDispatchSessionExpiry = shouldDispatchSessionExpiry;
exports.shouldDeferProtectedRequest = shouldDeferProtectedRequest;
function shouldDispatchSessionExpiry(input) {
    if (!input.isOnline)
        return false;
    if (input.status !== 401)
        return false;
    if ((input.intent ?? 'interactive') !== 'interactive')
        return false;
    if (input.runtimeState === 'RESTORING')
        return false;
    if (input.runtimeState === 'EXPIRED' || input.runtimeState === 'REAUTH_IN_PROGRESS') {
        return false;
    }
    return true;
}
function shouldDeferProtectedRequest(input) {
    if (input.requireAuth === false)
        return false;
    return input.isAuthLoading || input.isAuthRestoring || input.isAuthLocked;
}
