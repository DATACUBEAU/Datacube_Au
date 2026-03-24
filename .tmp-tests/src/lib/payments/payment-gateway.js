"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getSupportedPaymentMethodsForGateway = getSupportedPaymentMethodsForGateway;
exports.isPaymentMethodSupportedForGateway = isPaymentMethodSupportedForGateway;
exports.getDefaultPaymentMethodForGateway = getDefaultPaymentMethodForGateway;
exports.coercePaymentMethodForGateway = coercePaymentMethodForGateway;
function getSupportedPaymentMethodsForGateway(gatewayId) {
    return gatewayId === 'flutterwave' ? ['transfer'] : ['subscription', 'transfer'];
}
function isPaymentMethodSupportedForGateway(gatewayId, paymentMethod) {
    return getSupportedPaymentMethodsForGateway(gatewayId).includes(paymentMethod);
}
function getDefaultPaymentMethodForGateway(gatewayId) {
    const supported = getSupportedPaymentMethodsForGateway(gatewayId);
    return supported.includes('subscription') ? 'subscription' : 'transfer';
}
function coercePaymentMethodForGateway(gatewayId, requestedPaymentMethod) {
    if (requestedPaymentMethod && isPaymentMethodSupportedForGateway(gatewayId, requestedPaymentMethod)) {
        return requestedPaymentMethod;
    }
    return getDefaultPaymentMethodForGateway(gatewayId);
}
