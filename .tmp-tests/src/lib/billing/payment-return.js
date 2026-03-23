"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.extractBillingReturnState = extractBillingReturnState;
const SUCCESS_STATUSES = new Set(['success', 'successful', 'completed']);
const CANCELED_STATUSES = new Set(['cancelled', 'canceled', 'failed']);
function hasSearchParamGetter(value) {
    return Boolean(value && typeof value === 'object' && typeof value.get === 'function');
}
function firstString(value) {
    if (typeof value === 'string')
        return value.trim();
    if (Array.isArray(value)) {
        for (const item of value) {
            const normalized = firstString(item);
            if (normalized)
                return normalized;
        }
    }
    return '';
}
function readValue(source, key) {
    if (!source)
        return '';
    if (hasSearchParamGetter(source)) {
        return String(source.get(key) || '').trim();
    }
    return firstString(source[key]);
}
function firstNonEmpty(values) {
    for (const value of values) {
        const normalized = firstString(value);
        if (normalized)
            return normalized;
    }
    return null;
}
function normalizeGatewayHint(raw) {
    const value = firstString(raw).toLowerCase();
    if (value === 'paystack' || value === 'flutterwave') {
        return value;
    }
    return null;
}
function extractBillingReturnState(source) {
    const directReference = firstNonEmpty([
        readValue(source, 'reference'),
        readValue(source, 'trxref'),
        readValue(source, 'tx_ref'),
    ]);
    const explicitVerificationTarget = firstNonEmpty([
        readValue(source, 'verification_target'),
        readValue(source, 'verificationTarget'),
    ]);
    const transactionId = firstNonEmpty([
        readValue(source, 'transaction_id'),
        readValue(source, 'transactionId'),
    ]);
    const status = readValue(source, 'status').toLowerCase();
    const successFlag = readValue(source, 'success').toLowerCase() === 'true';
    const canceledFlag = readValue(source, 'cancelled').toLowerCase() === 'true';
    const explicitGatewayHint = normalizeGatewayHint(readValue(source, 'gateway'));
    const inferredGatewayHint = explicitGatewayHint ||
        (readValue(source, 'tx_ref') || transactionId ? 'flutterwave' : readValue(source, 'trxref') ? 'paystack' : null);
    return {
        reference: directReference,
        verificationTarget: firstNonEmpty([explicitVerificationTarget, directReference, transactionId]),
        transactionId,
        gatewayHint: inferredGatewayHint,
        isSuccess: successFlag || SUCCESS_STATUSES.has(status),
        isCanceled: canceledFlag || CANCELED_STATUSES.has(status),
        hasCallbackState: Boolean(directReference ||
            transactionId ||
            status ||
            readValue(source, 'success') ||
            readValue(source, 'cancelled')),
    };
}
