"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SUPABASE_SESSION_REFRESH_WINDOW_MS = exports.SUPABASE_SESSION_EXPIRY_SKEW_MS = void 0;
exports.getSupabaseSessionExpiryMs = getSupabaseSessionExpiryMs;
exports.normalizeUsableSupabaseSession = normalizeUsableSupabaseSession;
exports.shouldRefreshSupabaseSession = shouldRefreshSupabaseSession;
exports.selectUsableSupabaseSession = selectUsableSupabaseSession;
exports.SUPABASE_SESSION_EXPIRY_SKEW_MS = 5000;
exports.SUPABASE_SESSION_REFRESH_WINDOW_MS = 60000;
function getSupabaseSessionExpiryMs(candidate) {
    return typeof candidate?.expires_at === 'number' ? candidate.expires_at * 1000 : null;
}
function normalizeUsableSupabaseSession(candidate, nowMs = Date.now()) {
    if (!candidate?.user?.id || !candidate?.access_token)
        return null;
    const expiresAtMs = getSupabaseSessionExpiryMs(candidate);
    if (expiresAtMs !== null && expiresAtMs <= nowMs + exports.SUPABASE_SESSION_EXPIRY_SKEW_MS) {
        return null;
    }
    return candidate;
}
function shouldRefreshSupabaseSession(candidate, nowMs = Date.now(), refreshWindowMs = exports.SUPABASE_SESSION_REFRESH_WINDOW_MS) {
    if (!candidate?.user?.id || !candidate?.refresh_token)
        return false;
    const expiresAtMs = getSupabaseSessionExpiryMs(candidate);
    if (expiresAtMs === null) {
        return !candidate.access_token;
    }
    return expiresAtMs <= nowMs + Math.max(refreshWindowMs, exports.SUPABASE_SESSION_EXPIRY_SKEW_MS);
}
function selectUsableSupabaseSession(...candidates) {
    for (const candidate of candidates) {
        const normalized = normalizeUsableSupabaseSession(candidate);
        if (normalized)
            return normalized;
    }
    return null;
}
