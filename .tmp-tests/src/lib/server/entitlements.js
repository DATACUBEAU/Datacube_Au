"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.EntitlementError = void 0;
exports.getProEntitlementStatus = getProEntitlementStatus;
exports.assertProEntitlement = assertProEntitlement;
const effective_entitlements_1 = require("@/lib/server/effective-entitlements");
const promo_entitlements_1 = require("@/lib/server/promo-entitlements");
class EntitlementError extends Error {
    constructor(status, code, message, payload) {
        super(message);
        this.status = status;
        this.code = code;
        this.payload = payload || {};
    }
}
exports.EntitlementError = EntitlementError;
async function getProEntitlementStatus(supabase, userId) {
    const snapshot = await (0, effective_entitlements_1.getEffectiveEntitlementsSnapshot)(supabase, userId);
    return {
        hasPro: snapshot.hasPro,
        source: snapshot.entitlementSource,
        endsAt: snapshot.entitlementEndsAt,
        promoActive: snapshot.promoActive,
        promoEndsAt: promo_entitlements_1.PROMO_PRO_END_LAGOS_ISO,
    };
}
async function assertProEntitlement(supabase, userId) {
    const status = await getProEntitlementStatus(supabase, userId);
    if (status.hasPro) {
        return status;
    }
    throw new EntitlementError(402, 'UPGRADE_REQUIRED', 'Pro entitlement required.', {
        code: 'UPGRADE_REQUIRED',
        reason: 'pro_entitlement_missing',
        cta: 'Upgrade to Pro to continue.',
        upgradeUrl: '/pricing?source=feature_pro_access',
    });
}
