"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildSnapshotFallbackFlags = buildSnapshotFallbackFlags;
function buildSnapshotFallbackFlags(snapshot) {
    const billingEnabled = snapshot?.entitlements?.billingEnabled === true;
    const promoEnabled = snapshot?.entitlements?.promoEnabled === true;
    return {
        billing_enabled: billingEnabled,
        paid_mode_enabled: billingEnabled,
        promo_enabled: promoEnabled,
    };
}
