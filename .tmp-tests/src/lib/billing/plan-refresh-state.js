"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.shouldApplyBillingStatusResponse = shouldApplyBillingStatusResponse;
exports.resolveDisplayedPlanCode = resolveDisplayedPlanCode;
function shouldApplyBillingStatusResponse(input) {
    if (input.requestId !== input.activeRequestId) {
        return false;
    }
    if (!input.currentIssuedAt || !input.nextIssuedAt) {
        return true;
    }
    return new Date(input.nextIssuedAt).getTime() >= new Date(input.currentIssuedAt).getTime();
}
function resolveDisplayedPlanCode(input) {
    const resolved = input.limitsUsagePlan ||
        input.snapshot?.managedPlan ||
        input.currentPlanManagedPlan ||
        input.tier ||
        null;
    const normalized = String(resolved || '').trim().toLowerCase();
    return normalized || null;
}
