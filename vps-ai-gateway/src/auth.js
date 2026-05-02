"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.verifySupabaseToken = verifySupabaseToken;
exports.verifySupabaseTokenWithRole = verifySupabaseTokenWithRole;
const jose_1 = require("jose");
const utils_js_1 = require("./utils.js");
let jwks = null;
function getJWKS(supabaseUrl) {
    if (!jwks) {
        jwks = (0, jose_1.createRemoteJWKSet)(new URL(`${supabaseUrl}/auth/v1/.well-known/jwks.json`));
    }
    return jwks;
}
async function verifySupabaseToken(token, supabaseUrl, _anonKey) {
    if (!token || token.length < 10) {
        return null;
    }
    try {
        const JWKS = getJWKS(supabaseUrl);
        const { payload } = await (0, jose_1.jwtVerify)(token, JWKS, {
            issuer: `${supabaseUrl}/auth/v1`,
            audience: 'supabase',
        });
        if (!payload.sub || typeof payload.sub !== 'string') {
            utils_js_1.logger.warn('JWT missing sub claim');
            return null;
        }
        return payload.sub;
    }
    catch (err) {
        if (err.code === 'ERR_JWT_EXPIRED') {
            utils_js_1.logger.debug('Token expired');
        }
        else if (err.code === 'ERR_JWS_SIGNATURE_VERIFICATION_FAILED') {
            utils_js_1.logger.debug('Token signature invalid');
        }
        else {
            utils_js_1.logger.warn('Token verification failed', err.message);
        }
        return null;
    }
}
async function verifySupabaseTokenWithRole(token, supabaseUrl, serviceRoleKey) {
    const userId = await verifySupabaseToken(token, supabaseUrl, '');
    if (!userId) {
        if (token === serviceRoleKey) {
            return { userId: 'service-role', isServiceRole: true };
        }
        return null;
    }
    return { userId, isServiceRole: false };
}
