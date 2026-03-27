"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SUPABASE_SESSION_EXPIRY_SKEW_MS = void 0;
exports.normalizeUsableSupabaseSession = normalizeUsableSupabaseSession;
exports.selectUsableSupabaseSession = selectUsableSupabaseSession;
exports.SUPABASE_SESSION_EXPIRY_SKEW_MS = 5000;
function normalizeUsableSupabaseSession(candidate, nowMs = Date.now()) {
    if (!candidate?.user?.id || !candidate?.access_token)
        return null;
    const expiresAt = typeof candidate.expires_at === 'number' ? candidate.expires_at : null;
    if (expiresAt !== null && expiresAt * 1000 <= nowMs + exports.SUPABASE_SESSION_EXPIRY_SKEW_MS) {
        return null;
    }
    return candidate;
}
function selectUsableSupabaseSession(...candidates) {
    for (const candidate of candidates) {
        const normalized = normalizeUsableSupabaseSession(candidate);
        if (normalized)
            return normalized;
    }
    return null;
}
