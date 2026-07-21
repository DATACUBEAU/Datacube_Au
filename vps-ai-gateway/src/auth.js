"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolveVpsSharedSecret = resolveVpsSharedSecret;
exports.normalizeGatewayPath = normalizeGatewayPath;
exports.routeRequirementForPath = routeRequirementForPath;
exports.verifyVpsTicket = verifyVpsTicket;
const jose_1 = require("jose");
const utils_js_1 = require("./utils.js");
const EXPLICIT_DEV_SECRET_FLAG = 'DCAU_ALLOW_INSECURE_DEV_VPS_SECRET';
const LOCAL_DEV_SHARED_SECRET = 'dcau-explicit-local-dev-vps-secret';
const TICKET_ISSUER = 'dcau-next';
const TICKET_AUDIENCE = 'dcau-vps-ai-gateway';
const GATEWAY_ROUTE_REQUIREMENTS = {
    '/chat/au-chat': { route: '/chat/au-chat', featureKey: 'au_chat' },
    '/chat/global-chat': { route: '/chat/global-chat', featureKey: 'global_chat' },
    '/chat/legacy': { route: '/chat/legacy', featureKey: 'au_chat' },
    '/generate/knowledge': { route: '/generate/knowledge', featureKey: 'knowledge_generation' },
    '/generate/exam-predictions': { route: '/generate/exam-predictions', featureKey: 'exam_predictions' },
    '/generate/practice-exam': { route: '/generate/practice-exam', featureKey: 'practice_exam_generation' },
    '/generate/prompt-starters': { route: '/generate/prompt-starters', featureKey: 'prompt_starters' },
};
function resolveVpsSharedSecret(env = process.env) {
    const configured = String(env.VPS_SHARED_SECRET || '').trim();
    if (configured)
        return { ok: true, secret: configured, source: 'env' };
    const isProduction = env.NODE_ENV === 'production';
    if (!isProduction && env[EXPLICIT_DEV_SECRET_FLAG] === '1') {
        return { ok: true, secret: LOCAL_DEV_SHARED_SECRET, source: 'explicit_dev' };
    }
    return {
        ok: false,
        code: 'VPS_SHARED_SECRET_MISSING',
        message: 'VPS_SHARED_SECRET is required before accepting AI gateway traffic.',
    };
}
function normalizeGatewayPath(rawUrl) {
    const raw = String(rawUrl || '').trim() || '/';
    const withoutQuery = raw.split('?')[0] || '/';
    return withoutQuery.endsWith('/') && withoutQuery !== '/'
        ? withoutQuery.slice(0, -1)
        : withoutQuery;
}
function routeRequirementForPath(rawUrl) {
    const route = normalizeGatewayPath(rawUrl);
    return GATEWAY_ROUTE_REQUIREMENTS[route] || null;
}
async function verifyVpsTicket(token, secret, expected) {
    if (!token || token.length < 10)
        return null;
    if (!secret || !String(secret).trim()) {
        utils_js_1.logger.error('Ticket verification failed: VPS shared secret is not configured');
        return null;
    }
    try {
        const encodedSecret = new TextEncoder().encode(secret);
        const { payload } = await (0, jose_1.jwtVerify)(token, encodedSecret, {
            algorithms: ['HS256'],
            issuer: TICKET_ISSUER,
            audience: TICKET_AUDIENCE,
            clockTolerance: 30,
        });
        if (!payload.sub || typeof payload.sub !== 'string') {
            utils_js_1.logger.warn('Ticket verification failed: missing sub claim');
            return null;
        }
        const feature = typeof payload.feature === 'string' ? payload.feature : '';
        const featureKey = typeof payload.feature_key === 'string' ? payload.feature_key : '';
        const route = typeof payload.route === 'string' ? normalizeGatewayPath(payload.route) : '';
        if (!feature || !featureKey || !route) {
            utils_js_1.logger.warn('Ticket verification failed: missing route or feature claims', {
                hasFeature: Boolean(feature),
                hasFeatureKey: Boolean(featureKey),
                hasRoute: Boolean(route),
            });
            return null;
        }
        if (expected) {
            if (route !== expected.route) {
                utils_js_1.logger.warn('Ticket verification failed: route mismatch', {
                    expectedRoute: expected.route,
                    actualRoute: route,
                    featureKey,
                });
                return null;
            }
            if (featureKey !== expected.featureKey) {
                utils_js_1.logger.warn('Ticket verification failed: feature mismatch', {
                    route: expected.route,
                    expectedFeatureKey: expected.featureKey,
                    actualFeatureKey: featureKey,
                });
                return null;
            }
        }
        const routeRequirement = routeRequirementForPath(route);
        if (!routeRequirement || routeRequirement.featureKey !== featureKey) {
            utils_js_1.logger.warn('Ticket verification failed: route claim is not recognized for feature', {
                route,
                featureKey,
            });
            return null;
        }
        utils_js_1.logger.debug('Ticket verified successfully', { userId: payload.sub, feature, route });
        return {
            userId: payload.sub,
            plan: typeof payload.plan === 'string' ? payload.plan : 'free',
            feature,
            featureKey,
            route,
            ticketId: typeof payload.ticket_id === 'string'
                ? payload.ticket_id
                : typeof payload.jti === 'string'
                    ? payload.jti
                    : null,
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
            utils_js_1.logger.warn('Ticket verification failed: claim validation', { error: err.message, code: err.code, claim: err.claim });
        }
        else {
            utils_js_1.logger.error('Ticket verification failed: unknown reason', { error: err.message, code: err.code });
        }
        return null;
    }
}
