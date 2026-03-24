"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.BILLING_RENEWAL_MAX_ATTEMPTS = void 0;
exports.classifyRenewalFailure = classifyRenewalFailure;
exports.buildRenewalRetryState = buildRenewalRetryState;
exports.buildRenewalSuccessMetadata = buildRenewalSuccessMetadata;
exports.BILLING_RENEWAL_MAX_ATTEMPTS = 1;
function normalizeString(value) {
    return String(value || '').trim().toLowerCase();
}
function classifyRenewalFailure(input) {
    const haystack = [
        normalizeString(input.gatewayResponse),
        normalizeString(input.message),
        normalizeString(input.status),
    ]
        .filter(Boolean)
        .join(' ');
    if (!haystack)
        return 'gateway_error';
    if (haystack.includes('timeout') ||
        haystack.includes('timed out') ||
        haystack.includes('network') ||
        haystack.includes('connection reset')) {
        return 'network_timeout';
    }
    if (haystack.includes('do not honor') ||
        haystack.includes('stolen') ||
        haystack.includes('pick up card') ||
        haystack.includes('restricted card') ||
        haystack.includes('lost card') ||
        haystack.includes('fraud') ||
        haystack.includes('declined')) {
        return 'hard_decline';
    }
    if (haystack.includes('insufficient funds') ||
        haystack.includes('temporary') ||
        haystack.includes('retry') ||
        haystack.includes('bank unavailable')) {
        return 'soft_decline';
    }
    return 'gateway_error';
}
function buildRenewalRetryState(input) {
    const previousAttempts = Math.max(0, Number(input.existingAttemptCount || 0));
    const attemptNumber = previousAttempts + 1;
    return {
        attemptNumber,
        failureKind: input.failureKind,
        nextRetryAt: null,
        finalFailure: attemptNumber >= exports.BILLING_RENEWAL_MAX_ATTEMPTS,
        status: 'failed',
    };
}
function buildRenewalSuccessMetadata(input) {
    return {
        renewal_attempt_count: 0,
        renewal_failure_kind: null,
        renewal_next_retry_at: null,
        renewal_final_failure: false,
        renewal_status: 'active',
        renewal_last_failed_at: null,
        renewal_last_reference: input.reference,
        renewal_last_paid_at: input.paidAt,
        renewal_last_gateway: input.gateway,
        renewal_last_gateway_response: input.gatewayResponse ?? null,
    };
}
