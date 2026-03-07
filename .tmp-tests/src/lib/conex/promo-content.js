"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFAULT_PROMO_CONTENT_CONFIG = void 0;
exports.normalizePromoContentConfig = normalizePromoContentConfig;
exports.toPromoContentDraft = toPromoContentDraft;
exports.validatePromoContentDraft = validatePromoContentDraft;
exports.formatPromoEndsAtLabel = formatPromoEndsAtLabel;
exports.buildPromoCopy = buildPromoCopy;
const policy_1 = require("../tier/policy");
exports.DEFAULT_PROMO_CONTENT_CONFIG = {
    introText: 'You are currently on Promo Pro.',
    pricingTemplate: 'On {effectiveDate}, Pro becomes NGN {monthlyPrice}/month or NGN {weeklyPrice}/week.',
    endsTemplate: 'Promo ends at {promoEndsAt} {timezone} time.',
    effectiveDateLabel: 'April 2nd, 2026',
    monthlyPriceNgn: 4500,
    weeklyPriceNgn: 1500,
    promoEndsAtLagosIso: policy_1.PROMO_PRO_END_LAGOS_ISO,
    timezoneLabel: 'Africa/Lagos',
};
function asRecord(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value))
        return {};
    return value;
}
function asTrimmedString(value, fallback) {
    const next = String(value ?? '').trim();
    return next || fallback;
}
function asPositiveInteger(value, fallback) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric) || numeric <= 0)
        return fallback;
    return Math.floor(numeric);
}
function normalizeIsoLike(value, fallback) {
    const raw = String(value ?? '').trim();
    if (!raw)
        return fallback;
    const parsed = new Date(raw);
    if (!Number.isFinite(parsed.getTime()))
        return fallback;
    return raw;
}
function normalizePromoContentConfig(raw) {
    const row = asRecord(raw);
    return {
        introText: asTrimmedString(row.introText, exports.DEFAULT_PROMO_CONTENT_CONFIG.introText),
        pricingTemplate: asTrimmedString(row.pricingTemplate, exports.DEFAULT_PROMO_CONTENT_CONFIG.pricingTemplate),
        endsTemplate: asTrimmedString(row.endsTemplate, exports.DEFAULT_PROMO_CONTENT_CONFIG.endsTemplate),
        effectiveDateLabel: asTrimmedString(row.effectiveDateLabel, exports.DEFAULT_PROMO_CONTENT_CONFIG.effectiveDateLabel),
        monthlyPriceNgn: asPositiveInteger(row.monthlyPriceNgn, exports.DEFAULT_PROMO_CONTENT_CONFIG.monthlyPriceNgn),
        weeklyPriceNgn: asPositiveInteger(row.weeklyPriceNgn, exports.DEFAULT_PROMO_CONTENT_CONFIG.weeklyPriceNgn),
        promoEndsAtLagosIso: normalizeIsoLike(row.promoEndsAtLagosIso, exports.DEFAULT_PROMO_CONTENT_CONFIG.promoEndsAtLagosIso),
        timezoneLabel: asTrimmedString(row.timezoneLabel, exports.DEFAULT_PROMO_CONTENT_CONFIG.timezoneLabel),
    };
}
function toPromoContentDraft(config) {
    return {
        introText: config.introText,
        pricingTemplate: config.pricingTemplate,
        endsTemplate: config.endsTemplate,
        effectiveDateLabel: config.effectiveDateLabel,
        monthlyPriceNgn: String(config.monthlyPriceNgn),
        weeklyPriceNgn: String(config.weeklyPriceNgn),
        promoEndsAtLagosIso: config.promoEndsAtLagosIso,
        timezoneLabel: config.timezoneLabel,
    };
}
function validatePromoContentDraft(draft) {
    const errors = [];
    const base = normalizePromoContentConfig({
        ...exports.DEFAULT_PROMO_CONTENT_CONFIG,
        ...draft,
    });
    const monthlyRaw = String(draft.monthlyPriceNgn ?? '').trim();
    const weeklyRaw = String(draft.weeklyPriceNgn ?? '').trim();
    const monthlyOk = /^\d+$/.test(monthlyRaw) && Number(monthlyRaw) > 0;
    const weeklyOk = /^\d+$/.test(weeklyRaw) && Number(weeklyRaw) > 0;
    if (!base.introText)
        errors.push('Intro text is required.');
    if (!base.pricingTemplate)
        errors.push('Pricing template is required.');
    if (!base.endsTemplate)
        errors.push('Ending template is required.');
    if (!base.effectiveDateLabel)
        errors.push('Effective date label is required.');
    if (!base.timezoneLabel)
        errors.push('Timezone label is required.');
    if (!monthlyOk)
        errors.push('Monthly price must be a positive integer.');
    if (!weeklyOk)
        errors.push('Weekly price must be a positive integer.');
    if (!Number.isFinite(new Date(base.promoEndsAtLagosIso).getTime())) {
        errors.push('Promo end datetime must be a valid ISO-like date.');
    }
    const config = {
        ...base,
        monthlyPriceNgn: monthlyOk ? Math.floor(Number(monthlyRaw)) : exports.DEFAULT_PROMO_CONTENT_CONFIG.monthlyPriceNgn,
        weeklyPriceNgn: weeklyOk ? Math.floor(Number(weeklyRaw)) : exports.DEFAULT_PROMO_CONTENT_CONFIG.weeklyPriceNgn,
    };
    return { ok: errors.length === 0, errors, config };
}
function formatNgn(value) {
    return Math.floor(Math.max(0, value)).toLocaleString('en-US');
}
function replaceTokens(template, tokens) {
    return template.replace(/\{([a-zA-Z0-9_]+)\}/g, (_whole, token) => tokens[token] ?? '');
}
function formatPromoEndsAtLabel(isoLike) {
    const parsed = new Date(isoLike);
    if (!Number.isFinite(parsed.getTime())) {
        return new Date(exports.DEFAULT_PROMO_CONTENT_CONFIG.promoEndsAtLagosIso).toLocaleString('en-US', {
            timeZone: 'Africa/Lagos',
            month: 'long',
            day: 'numeric',
            year: 'numeric',
            hour: 'numeric',
            minute: '2-digit',
        });
    }
    return parsed.toLocaleString('en-US', {
        timeZone: 'Africa/Lagos',
        month: 'long',
        day: 'numeric',
        year: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
    });
}
function buildPromoCopy(config, promoEndsAtLabel) {
    const tokens = {
        effectiveDate: config.effectiveDateLabel,
        monthlyPrice: formatNgn(config.monthlyPriceNgn),
        weeklyPrice: formatNgn(config.weeklyPriceNgn),
        promoEndsAt: promoEndsAtLabel,
        timezone: config.timezoneLabel,
    };
    return {
        intro: config.introText,
        pricing: replaceTokens(config.pricingTemplate, tokens),
        ending: replaceTokens(config.endsTemplate, tokens),
    };
}
