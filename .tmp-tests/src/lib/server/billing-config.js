"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.BillingConfigurationError = exports.BillingApiError = void 0;
exports.getBillingGatewayCapability = getBillingGatewayCapability;
exports.assertBillingGatewayCapability = assertBillingGatewayCapability;
exports.serializeBillingApiError = serializeBillingApiError;
const env_1 = require("./env");
class BillingApiError extends Error {
    constructor(status, code, message, details) {
        super(message);
        this.status = status;
        this.code = code;
        this.details = details || {};
    }
}
exports.BillingApiError = BillingApiError;
class BillingConfigurationError extends BillingApiError {
    constructor(input) {
        super(503, 'billing_gateway_not_configured', `${input.gateway} billing is not configured on the server.`, {
            gateway: input.gateway,
            action: input.action,
            missingEnv: input.missingEnv,
        });
    }
}
exports.BillingConfigurationError = BillingConfigurationError;
const loggedCapabilityIssues = new Set();
function resolveMissingGatewayEnv(gateway, action) {
    if (gateway === 'flutterwave') {
        const missing = [];
        if (!(0, env_1.firstEnv)('FLUTTERWAVE_SECRET_KEY')) {
            missing.push('FLUTTERWAVE_SECRET_KEY');
        }
        if (action === 'webhook' && !(0, env_1.firstEnv)('FLUTTERWAVE_WEBHOOK_SECRET_HASH', 'FLUTTERWAVE_SECRET_HASH')) {
            missing.push('FLUTTERWAVE_WEBHOOK_SECRET_HASH');
        }
        return missing;
    }
    const missing = [];
    if (!(0, env_1.firstEnv)('PAYSTACK_SECRET_KEY', 'PAYSTACK_SECRET')) {
        missing.push('PAYSTACK_SECRET_KEY');
    }
    return missing;
}
function describeGatewayIssue(gateway, action) {
    if (gateway === 'flutterwave') {
        if (action === 'webhook')
            return 'Flutterwave webhook validation is not configured on the server.';
        return 'Flutterwave checkout is not configured on the server.';
    }
    if (action === 'webhook')
        return 'Paystack webhook validation is not configured on the server.';
    if (action === 'subscription_cancel')
        return 'Paystack subscription cancellation is not configured on the server.';
    if (action === 'payment_verify')
        return 'Paystack payment verification is not configured on the server.';
    return 'Paystack checkout is not configured on the server.';
}
function logCapabilityIssue(issue) {
    const cacheKey = `${issue.gateway}:${issue.action}:${issue.code}:${issue.missingEnv.join(',')}`;
    if (loggedCapabilityIssues.has(cacheKey))
        return;
    loggedCapabilityIssues.add(cacheKey);
    console.error('[billing-config] missing required billing env', issue);
}
function getBillingGatewayCapability(input) {
    const missingEnv = resolveMissingGatewayEnv(input.gateway, input.action);
    if (missingEnv.length === 0) {
        return {
            enabled: true,
            gateway: input.gateway,
            issue: null,
        };
    }
    const issue = {
        code: `${input.gateway}_env_missing`,
        message: describeGatewayIssue(input.gateway, input.action),
        missingEnv,
        action: input.action,
        gateway: input.gateway,
    };
    logCapabilityIssue(issue);
    return {
        enabled: false,
        gateway: input.gateway,
        issue,
    };
}
function assertBillingGatewayCapability(input) {
    const capability = getBillingGatewayCapability(input);
    if (capability.enabled) {
        return capability;
    }
    throw new BillingConfigurationError({
        gateway: input.gateway,
        action: input.action,
        missingEnv: capability.issue?.missingEnv || [],
    });
}
function serializeBillingApiError(error, fallback) {
    if (error instanceof BillingApiError) {
        return {
            status: error.status,
            body: {
                error: error.code,
                message: error.message,
                requestId: fallback.requestId,
                details: error.details,
            },
        };
    }
    const numericStatus = Number(error?.status || 0);
    const status = Number.isFinite(numericStatus) && numericStatus >= 500 && numericStatus <= 599
        ? numericStatus
        : fallback.status;
    const details = error?.details;
    return {
        status,
        body: {
            error: fallback.code,
            message: String(error?.message || fallback.message),
            requestId: fallback.requestId,
            ...(details !== undefined ? { details } : {}),
        },
    };
}
