"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ApiRequestError = void 0;
exports.normalizeApiErrorCode = normalizeApiErrorCode;
exports.buildApiSuccessBody = buildApiSuccessBody;
exports.unwrapApiSuccess = unwrapApiSuccess;
exports.buildApiErrorBody = buildApiErrorBody;
exports.extractApiError = extractApiError;
exports.toApiRequestError = toApiRequestError;
exports.extractApiErrorMessage = extractApiErrorMessage;
function isRecord(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
function pickString(...values) {
    for (const value of values) {
        if (typeof value === 'string' && value.trim()) {
            return value.trim();
        }
    }
    return null;
}
function pickNumber(...values) {
    for (const value of values) {
        const parsed = Number(value);
        if (Number.isFinite(parsed)) {
            return parsed;
        }
    }
    return null;
}
function pickBoolean(...values) {
    for (const value of values) {
        if (typeof value === 'boolean') {
            return value;
        }
    }
    return undefined;
}
function maybeParseJsonString(value) {
    if (typeof value !== 'string')
        return value;
    const trimmed = value.trim();
    if (!trimmed)
        return value;
    if (!/^(?:\{|\[|"|-?\d|true|false|null)/i.test(trimmed)) {
        return value;
    }
    try {
        return JSON.parse(trimmed);
    }
    catch {
        return value;
    }
}
function normalizeApiErrorCode(value, fallback = 'INTERNAL_SERVER_ERROR') {
    const raw = String(value || '').trim();
    if (!raw)
        return fallback;
    const normalized = raw
        .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
        .replace(/[^a-zA-Z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '')
        .toUpperCase();
    return normalized || fallback;
}
function buildApiSuccessBody(data) {
    return {
        ok: true,
        data,
    };
}
function unwrapApiSuccess(payload) {
    if (isRecord(payload) && payload.ok === true && 'data' in payload) {
        return payload.data;
    }
    return payload;
}
function buildApiErrorBody(input) {
    const code = normalizeApiErrorCode(input.code || input.message);
    const message = pickString(input.message) || 'Unexpected server error';
    const retryable = typeof input.retryable === 'boolean'
        ? input.retryable
        : Boolean(input.status === 408 || input.status === 429 || (input.status ?? 0) >= 500);
    const error = {
        code,
        message,
        ...(input.details !== undefined ? { details: input.details } : {}),
        retryable,
        ...(input.status != null ? { status: input.status } : {}),
        ...(input.requestId ? { requestId: input.requestId } : {}),
        ...(input.correlationId ? { correlationId: input.correlationId } : {}),
        ...(input.retryAfter != null ? { retryAfter: input.retryAfter } : {}),
        ...(typeof input.isThrottled === 'boolean' ? { isThrottled: input.isThrottled } : {}),
        ...(input.limit ? { limit: input.limit } : {}),
        ...(input.key ? { key: input.key } : {}),
        ...(input.current != null ? { current: input.current } : {}),
        ...(input.used != null ? { used: input.used } : {}),
        ...(input.max != null ? { max: input.max } : {}),
        ...(input.upgrade ? { upgrade: input.upgrade } : {}),
    };
    return {
        ok: false,
        error,
        code,
        message,
        ...(input.details !== undefined ? { details: input.details } : {}),
        retryable,
        ...(input.status != null ? { status: input.status } : {}),
        ...(input.requestId ? { requestId: input.requestId } : {}),
        ...(input.correlationId ? { correlation_id: input.correlationId } : {}),
        ...(input.retryAfter != null ? { retryAfter: input.retryAfter } : {}),
        ...(typeof input.isThrottled === 'boolean' ? { isThrottled: input.isThrottled } : {}),
        ...(input.limit ? { limit: input.limit } : {}),
        ...(input.key ? { key: input.key } : {}),
        ...(input.current != null ? { current: input.current } : {}),
        ...(input.used != null ? { used: input.used } : {}),
        ...(input.max != null ? { max: input.max } : {}),
        ...(input.upgrade ? { upgrade: input.upgrade } : {}),
        ...(input.extra || {}),
    };
}
function extractApiError(input, fallbackMessage = 'Unexpected error') {
    const root = isRecord(input) ? input : {};
    const nestedError = isRecord(root.error) ? root.error : {};
    const parsedRootDetails = maybeParseJsonString(root.details);
    const parsedNestedDetails = maybeParseJsonString(nestedError.details);
    const detailsRecord = isRecord(parsedNestedDetails)
        ? parsedNestedDetails
        : isRecord(parsedRootDetails)
            ? parsedRootDetails
            : {};
    const message = pickString(nestedError.message, root.message, typeof root.error === 'string' ? root.error : null, typeof parsedNestedDetails === 'string' ? parsedNestedDetails : null, typeof parsedRootDetails === 'string' ? parsedRootDetails : null, detailsRecord.message, typeof detailsRecord.error === 'string' ? detailsRecord.error : null, input instanceof Error ? input.message : null, typeof input === 'string' ? input : null) || fallbackMessage;
    const status = pickNumber(nestedError.status, root.status, detailsRecord.status, input instanceof Error ? input.status : null);
    const retryable = pickBoolean(nestedError.retryable, root.retryable, detailsRecord.retryable, input instanceof Error ? input.retryable : undefined) ?? Boolean(status === 408 || status === 429 || (status ?? 0) >= 500);
    const code = normalizeApiErrorCode(pickString(nestedError.code, root.code, detailsRecord.code, typeof detailsRecord.error === 'string' ? detailsRecord.error : null, input instanceof Error ? input.code : null) || message, 'UNEXPECTED_ERROR');
    const requestId = pickString(nestedError.requestId, nestedError.request_id, root.requestId, root.request_id, detailsRecord.requestId, detailsRecord.request_id);
    const correlationId = pickString(nestedError.correlationId, nestedError.correlation_id, root.correlationId, root.correlation_id, detailsRecord.correlationId, detailsRecord.correlation_id);
    const retryAfter = pickString(nestedError.retryAfter, nestedError.retry_after, root.retryAfter, root.retry_after, detailsRecord.retryAfter, detailsRecord.retry_after) ??
        pickNumber(nestedError.retryAfter, nestedError.retry_after, root.retryAfter, root.retry_after, detailsRecord.retryAfter, detailsRecord.retry_after);
    const isThrottled = pickBoolean(nestedError.isThrottled, root.isThrottled, detailsRecord.isThrottled, input instanceof Error ? input.isThrottled : undefined) ?? status === 429;
    const limit = pickString(nestedError.limit, root.limit, detailsRecord.limit, nestedError.key, root.key, detailsRecord.key);
    const key = pickString(nestedError.key, root.key, detailsRecord.key, limit);
    const current = pickNumber(nestedError.current, nestedError.used, root.current, root.used, detailsRecord.current, detailsRecord.used);
    const used = pickNumber(nestedError.used, root.used, detailsRecord.used, current);
    const max = pickNumber(nestedError.max, root.max, detailsRecord.max);
    const upgrade = isRecord(nestedError.upgrade)
        ? nestedError.upgrade
        : isRecord(root.upgrade)
            ? root.upgrade
            : isRecord(detailsRecord.upgrade)
                ? detailsRecord.upgrade
                : null;
    const details = parsedNestedDetails ?? parsedRootDetails;
    return {
        code,
        message,
        ...(details !== undefined ? { details } : {}),
        retryable,
        status,
        requestId,
        correlationId,
        retryAfter,
        isThrottled,
        limit,
        key,
        current,
        used,
        max,
        upgrade,
        raw: input,
    };
}
class ApiRequestError extends Error {
    constructor(payload) {
        super(payload.message);
        this.name = 'ApiRequestError';
        this.status = payload.status ?? null;
        this.code = payload.code;
        this.details = payload.details;
        this.retryable = Boolean(payload.retryable);
        this.requestId = payload.requestId ?? null;
        this.correlationId = payload.correlationId ?? null;
        this.retryAfter = payload.retryAfter ?? null;
        this.isThrottled = Boolean(payload.isThrottled);
        this.limit = payload.limit ?? null;
        this.key = payload.key ?? null;
        this.current = payload.current ?? null;
        this.used = payload.used ?? null;
        this.max = payload.max ?? null;
        this.upgrade = payload.upgrade ?? null;
        this.raw = payload.raw;
    }
}
exports.ApiRequestError = ApiRequestError;
function toApiRequestError(input, fallbackMessage = 'Unexpected error') {
    if (input instanceof ApiRequestError) {
        return input;
    }
    const extracted = extractApiError(input, fallbackMessage);
    const error = new ApiRequestError(extracted);
    if (input instanceof Error && input.stack) {
        error.stack = input.stack;
    }
    return error;
}
function extractApiErrorMessage(input, fallbackMessage = 'Unexpected error') {
    return extractApiError(input, fallbackMessage).message;
}
