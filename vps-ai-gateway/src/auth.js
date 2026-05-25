"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.verifyVpsTicket = verifyVpsTicket;
const jose_1 = require("jose");
const utils_js_1 = require("./utils.js");
async function verifyVpsTicket(token, secret) {
    if (!token || token.length < 10)
        return null;
    try {
        const encodedSecret = new TextEncoder().encode(secret);
        const { payload } = await (0, jose_1.jwtVerify)(token, encodedSecret, {
            algorithms: ['HS256'],
            clockTolerance: 300, // 5 minutes leeway for clock skew between Vercel and VPS
        });
        if (!payload.sub || typeof payload.sub !== 'string') {
            utils_js_1.logger.warn('Ticket verification failed: missing sub claim', { payload });
            return null;
        }
        utils_js_1.logger.debug('Ticket verified successfully', { userId: payload.sub, feature: payload.feature });
        return {
            userId: payload.sub,
            plan: typeof payload.plan === 'string' ? payload.plan : 'free',
            feature: typeof payload.feature === 'string' ? payload.feature : 'chat',
        };
    }
    catch (err) {
        if (err.code === 'ERR_JWT_EXPIRED') {
            utils_js_1.logger.warn('Ticket verification failed: expired timestamp', { error: err.message, code: err.code, claim: err.claim });
        }
        else if (err.code === 'ERR_JWS_SIGNATURE_VERIFICATION_FAILED') {
            utils_js_1.logger.error('Ticket verification failed: signature mismatch (check VPS_SHARED_SECRET)', { error: err.message, code: err.code });
        }
        else if (err.code === 'ERR_JWT_CLAIM_VALIDATION_FAILED') {
            utils_js_1.logger.warn('Ticket verification failed: claim validation (e.g. issued in future due to clock skew)', { error: err.message, code: err.code, claim: err.claim });
        }
        else {
            utils_js_1.logger.error('Ticket verification failed: unknown reason', { error: err.message, code: err.code });
        }
        return null;
    }
}
