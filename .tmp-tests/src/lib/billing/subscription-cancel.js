"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolveSubscriptionCancellation = resolveSubscriptionCancellation;
const STOPPED_STATUSES = new Set(['canceled', 'cancelled', 'expired']);
function normalizeText(raw) {
    return String(raw || '').trim().toLowerCase();
}
function resolveSubscriptionCancellation(input) {
    const status = normalizeText(input.status);
    if (!status) {
        return {
            mode: 'noop',
            reason: 'no_subscription',
        };
    }
    if (input.cancelAtPeriodEnd === true || status === 'non_renewing') {
        return {
            mode: 'noop',
            reason: 'already_non_renewing',
        };
    }
    if (STOPPED_STATUSES.has(status)) {
        return {
            mode: 'noop',
            reason: 'already_stopped',
        };
    }
    const gateway = normalizeText(input.gateway) || 'paystack';
    const hasPaystackCredentials = Boolean(String(input.paystackSubscriptionCode || '').trim() &&
        String(input.paystackEmailToken || '').trim());
    if (gateway === 'paystack' && hasPaystackCredentials) {
        return {
            mode: 'remote_cancel',
            reason: 'remote_cancel_supported',
        };
    }
    if (gateway !== 'paystack') {
        return {
            mode: 'local_schedule',
            reason: 'unsupported_gateway',
        };
    }
    return {
        mode: 'local_schedule',
        reason: 'missing_gateway_credentials',
    };
}
