"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolveSubscriptionCancellation = resolveSubscriptionCancellation;
exports.resolveSubscriptionResumption = resolveSubscriptionResumption;
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
function resolveSubscriptionResumption(input) {
    const status = normalizeText(input.status);
    if (!status) {
        return {
            mode: 'noop',
            reason: 'no_subscription',
        };
    }
    if (STOPPED_STATUSES.has(status)) {
        return {
            mode: 'noop',
            reason: 'already_stopped',
        };
    }
    if (input.cancelAtPeriodEnd !== true && status !== 'non_renewing') {
        return {
            mode: 'noop',
            reason: 'already_renewing',
        };
    }
    const gateway = normalizeText(input.gateway) || 'paystack';
    const hasPaystackCredentials = Boolean(String(input.paystackSubscriptionCode || '').trim() &&
        String(input.paystackEmailToken || '').trim());
    if (gateway === 'paystack' && hasPaystackCredentials) {
        return {
            mode: 'remote_resume',
            reason: 'remote_resume_supported',
        };
    }
    if (gateway !== 'paystack') {
        return {
            mode: 'local_resume',
            reason: 'unsupported_gateway',
        };
    }
    return {
        mode: 'local_resume',
        reason: 'missing_gateway_credentials',
    };
}
