"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.hashBillingRequestPayload = hashBillingRequestPayload;
exports.normalizeBillingIdempotencyKey = normalizeBillingIdempotencyKey;
exports.resolveBillingRequestIp = resolveBillingRequestIp;
exports.consumeBillingRateLimit = consumeBillingRateLimit;
exports.readBillingRequestIdempotency = readBillingRequestIdempotency;
exports.writeBillingRequestIdempotency = writeBillingRequestIdempotency;
const crypto_1 = require("crypto");
const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9._:-]{8,120}$/;
const routeBuckets = new Map();
function isSchemaDriftError(error) {
    const code = String(error?.code || '').trim();
    const message = String(error?.message || '').toLowerCase();
    const details = String(error?.details || '').toLowerCase();
    return (code === '42P01' ||
        code === '42703' ||
        message.includes('does not exist') ||
        details.includes('does not exist'));
}
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
function hashBillingRequestPayload(payload) {
    return (0, crypto_1.createHash)('sha256').update(stableStringify(payload), 'utf8').digest('hex');
}
function normalizeBillingIdempotencyKey(raw) {
    const value = String(raw || '').trim();
    if (!value || !IDEMPOTENCY_KEY_PATTERN.test(value)) {
        return '';
    }
    return value;
}
function resolveBillingRequestIp(req) {
    const forwardedFor = req.headers.get('x-forwarded-for');
    if (forwardedFor) {
        return forwardedFor.split(',')[0]?.trim() || 'unknown';
    }
    return req.headers.get('x-real-ip') || 'unknown';
}
function consumeBillingRateLimit(input) {
    const now = Date.now();
    const cacheKey = `${input.scope}:${input.key}`;
    const current = routeBuckets.get(cacheKey);
    if (!current || current.resetAt <= now) {
        routeBuckets.set(cacheKey, {
            count: 1,
            resetAt: now + input.windowMs,
        });
        return {
            limited: false,
            retryAfterSeconds: Math.max(1, Math.ceil(input.windowMs / 1000)),
        };
    }
    current.count += 1;
    routeBuckets.set(cacheKey, current);
    return {
        limited: current.count > input.maxHits,
        retryAfterSeconds: Math.max(1, Math.ceil((current.resetAt - now) / 1000)),
    };
}
async function readBillingRequestIdempotency(input) {
    const { data, error } = await input.supabase
        .from('au_request_idempotency')
        .select('request_hash,response_json,status_code,expires_at')
        .eq('user_id', input.userId)
        .eq('feature', input.feature)
        .eq('idempotency_key', input.idempotencyKey)
        .gt('expires_at', new Date().toISOString())
        .maybeSingle();
    if (error) {
        if (isSchemaDriftError(error))
            return null;
        throw error;
    }
    return data || null;
}
async function writeBillingRequestIdempotency(input) {
    const expiresAt = new Date(Date.now() + Math.max(30, Number(input.ttlSeconds || 300)) * 1000).toISOString();
    const { error } = await input.supabase
        .from('au_request_idempotency')
        .upsert({
        user_id: input.userId,
        feature: input.feature,
        idempotency_key: input.idempotencyKey,
        request_hash: input.requestHash,
        response_json: input.responseJson ?? {},
        status_code: Number(input.statusCode || 200) || 200,
        request_id: input.requestId || null,
        correlation_id: input.correlationId || null,
        expires_at: expiresAt,
    }, { onConflict: 'user_id,feature,idempotency_key' });
    if (error && !isSchemaDriftError(error)) {
        throw error;
    }
}
