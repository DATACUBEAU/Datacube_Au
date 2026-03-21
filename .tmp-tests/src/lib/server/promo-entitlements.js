"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PROMO_PRO_END_UTC_ISO = exports.PROMO_PRO_END_LAGOS_ISO = void 0;
exports.isPromoProActive = isPromoProActive;
exports.isPromoModeActive = isPromoModeActive;
const feature_flags_1 = require("@/lib/server/feature-flags");
exports.PROMO_PRO_END_LAGOS_ISO = '2026-04-02T00:00:00+01:00';
exports.PROMO_PRO_END_UTC_ISO = '2026-04-01T23:00:00.000Z';
const PROMO_PRO_END_MS = new Date(exports.PROMO_PRO_END_UTC_ISO).getTime();
function isPromoProActive(now = Date.now()) {
    return now < PROMO_PRO_END_MS;
}
async function isPromoModeActive(supabase, now = Date.now()) {
    const promoEnabled = await (0, feature_flags_1.getFeatureFlagBoolean)(supabase, 'promo_enabled', false);
    return promoEnabled && isPromoProActive(now);
}
