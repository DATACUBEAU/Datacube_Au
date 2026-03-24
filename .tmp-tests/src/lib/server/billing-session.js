"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.BILLING_PLAN_CHECKSUM_HEADER = exports.BILLING_ACTION_TOKEN_HEADER = exports.BILLING_PLAN_SESSION_COOKIE = void 0;
exports.createBillingPlanChecksum = createBillingPlanChecksum;
exports.buildBillingPlanSnapshot = buildBillingPlanSnapshot;
exports.attachBillingSessionArtifacts = attachBillingSessionArtifacts;
exports.readBillingActionSignature = readBillingActionSignature;
const crypto_1 = require("crypto");
const env_1 = require("./env");
exports.BILLING_PLAN_SESSION_COOKIE = 'dcau-billing-plan';
exports.BILLING_ACTION_TOKEN_HEADER = 'x-billing-request-token';
exports.BILLING_PLAN_CHECKSUM_HEADER = 'x-billing-plan-checksum';
const BILLING_ACTION_TOKEN_MAX_AGE_MS = 15 * 60 * 1000;
const BILLING_PLAN_SESSION_MAX_AGE_SECONDS = 5 * 60;
function stableStringify(value) {
    if (value === null || value === undefined)
        return '';
    if (typeof value === 'string')
        return value;
    if (typeof value !== 'object')
        return String(value);
    if (Array.isArray(value)) {
        return `[${value.map((item) => stableStringify(item)).join(',')}]`;
    }
    const entries = Object.entries(value).sort(([a], [b]) => a.localeCompare(b));
    return `{${entries.map(([k, v]) => `${k}:${stableStringify(v)}`).join('|')}}`;
}
function base64UrlEncode(input) {
    return Buffer.from(input, 'utf8').toString('base64url');
}
function base64UrlDecode(input) {
    return Buffer.from(input, 'base64url').toString('utf8');
}
function billingSigningSecret() {
    return ((0, env_1.firstEnv)('BILLING_SESSION_SECRET', 'PAYSTACK_SECRET_KEY', 'PAYSTACK_SECRET', 'SUPABASE_SERVICE_ROLE_KEY') || 'datacube-au-billing-session-fallback');
}
function signTokenPayload(payload) {
    return (0, crypto_1.createHmac)('sha256', billingSigningSecret()).update(payload).digest('base64url');
}
function timingSafeCompare(left, right) {
    const a = Buffer.from(left);
    const b = Buffer.from(right);
    if (a.length !== b.length)
        return false;
    return (0, crypto_1.timingSafeEqual)(a, b);
}
function createBillingPlanChecksum(input) {
    return (0, crypto_1.createHash)('sha256').update(stableStringify(input), 'utf8').digest('hex');
}
function buildBillingPlanSnapshot(input) {
    const currentPlan = (input.status.currentPlan || {}) || {};
    const managedPlan = String(currentPlan.managedPlan ||
        input.status.tier ||
        input.status.effectivePlan ||
        '').trim().toLowerCase() || 'unknown';
    const entitlementSource = String(input.status.entitlementSource || currentPlan.entitlementSource || '').trim().toLowerCase() || 'unknown';
    const base = {
        userId: input.userId,
        managedPlan,
        activePlanKey: typeof currentPlan.activePlanKey === 'string' && currentPlan.activePlanKey.trim()
            ? currentPlan.activePlanKey
            : null,
        entitlementSource,
        expiresAt: typeof input.status.tier_expires_at === 'string' && String(input.status.tier_expires_at).trim()
            ? String(input.status.tier_expires_at)
            : null,
        hasPaidEntitlement: currentPlan.hasPaidEntitlement === true,
    };
    return {
        ...base,
        checksum: createBillingPlanChecksum(base),
        issuedAt: new Date().toISOString(),
    };
}
function issueSignedToken(kind, snapshot) {
    const payload = {
        kind,
        userId: snapshot.userId,
        checksum: snapshot.checksum,
        issuedAt: Date.now(),
        managedPlan: snapshot.managedPlan,
        activePlanKey: snapshot.activePlanKey,
        entitlementSource: snapshot.entitlementSource,
        expiresAt: snapshot.expiresAt,
        hasPaidEntitlement: snapshot.hasPaidEntitlement,
    };
    const encoded = base64UrlEncode(JSON.stringify(payload));
    return `${encoded}.${signTokenPayload(encoded)}`;
}
function attachBillingSessionArtifacts(response, snapshot) {
    const planToken = issueSignedToken('billing-plan', snapshot);
    response.cookies.set(exports.BILLING_PLAN_SESSION_COOKIE, planToken, {
        httpOnly: true,
        sameSite: 'lax',
        path: '/',
        secure: process.env.NODE_ENV === 'production',
        maxAge: BILLING_PLAN_SESSION_MAX_AGE_SECONDS,
    });
    response.headers.set(exports.BILLING_PLAN_CHECKSUM_HEADER, snapshot.checksum);
    return {
        requestToken: issueSignedToken('billing-action', snapshot),
    };
}
function readBillingActionSignature(input) {
    const token = input.req.headers.get(exports.BILLING_ACTION_TOKEN_HEADER);
    const checksumHeader = input.req.headers.get(exports.BILLING_PLAN_CHECKSUM_HEADER);
    if (!token || !checksumHeader) {
        return { valid: false, checksum: null };
    }
    const [encoded, signature] = token.split('.');
    if (!encoded || !signature) {
        return { valid: false, checksum: null };
    }
    if (!timingSafeCompare(signTokenPayload(encoded), signature)) {
        return { valid: false, checksum: null };
    }
    try {
        const parsed = JSON.parse(base64UrlDecode(encoded));
        if (parsed.kind !== 'billing-action')
            return { valid: false, checksum: null };
        if (parsed.userId !== input.userId)
            return { valid: false, checksum: null };
        if (parsed.checksum !== checksumHeader)
            return { valid: false, checksum: null };
        if (Date.now() - Number(parsed.issuedAt || 0) > BILLING_ACTION_TOKEN_MAX_AGE_MS) {
            return { valid: false, checksum: null };
        }
        return { valid: true, checksum: parsed.checksum };
    }
    catch {
        return { valid: false, checksum: null };
    }
}
