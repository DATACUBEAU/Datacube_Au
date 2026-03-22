"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.shouldDispatchSessionExpiry = shouldDispatchSessionExpiry;
function shouldDispatchSessionExpiry(input) {
    if (!input.isOnline)
        return false;
    if (input.status === 403)
        return false;
    if (input.runtimeState === 'RESTORING')
        return false;
    if (input.runtimeState === 'EXPIRED' || input.runtimeState === 'REAUTH_IN_PROGRESS') {
        return false;
    }
    return true;
}
