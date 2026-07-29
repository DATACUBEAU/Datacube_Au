import { jwtVerify } from 'jose';
import { logger } from './utils.js';

const EXPLICIT_DEV_SECRET_FLAG = 'DCAU_ALLOW_INSECURE_DEV_VPS_SECRET';
const LOCAL_DEV_SHARED_SECRET = 'dcau-explicit-local-dev-vps-secret';
const TICKET_ISSUER = 'dcau-next';
const TICKET_AUDIENCE = 'dcau-vps-ai-gateway';
const MAX_TICKET_TTL_SECONDS = 10 * 60;

export type GatewayRouteRequirement = {
  route: string;
  featureKey: string;
};

export type VpsTicketData = {
  userId: string;
  plan: string;
  feature: string;
  featureKey: string;
  route: string;
  ticketId: string | null;
  reservationId: string;
  idempotencyKey: string;
};

export type VpsSecretResolution =
  | { ok: true; secret: string; source: 'env' | 'explicit_dev' }
  | { ok: false; code: 'VPS_SHARED_SECRET_MISSING'; message: string };

export type AllowedOriginsResolution =
  | { ok: true; origins: Set<string> }
  | { ok: false; code: 'ALLOWED_ORIGINS_MISSING' | 'ALLOWED_ORIGINS_INVALID'; message: string };

type VpsSharedSecretEnv =
  Partial<Record<'VPS_SHARED_SECRET' | 'NODE_ENV' | 'DCAU_ALLOW_INSECURE_DEV_VPS_SECRET', string | undefined>> &
  Record<string, string | undefined>;

type VpsCorsEnv =
  Partial<Record<'ALLOWED_ORIGINS' | 'NODE_ENV', string | undefined>> &
  Record<string, string | undefined>;

const GATEWAY_ROUTE_REQUIREMENTS: Record<string, GatewayRouteRequirement> = {
  '/chat/au-chat': { route: '/chat/au-chat', featureKey: 'au_chat' },
  '/chat/global-chat': { route: '/chat/global-chat', featureKey: 'global_chat' },
  '/chat/legacy': { route: '/chat/legacy', featureKey: 'au_chat' },
  '/generate/knowledge': { route: '/generate/knowledge', featureKey: 'knowledge_generation' },
  '/generate/exam-predictions': { route: '/generate/exam-predictions', featureKey: 'exam_predictions' },
  '/generate/practice-exam': { route: '/generate/practice-exam', featureKey: 'practice_exam_generation' },
  '/generate/prompt-starters': { route: '/generate/prompt-starters', featureKey: 'prompt_starters' },
};

export function resolveVpsSharedSecret(
  env: VpsSharedSecretEnv = process.env,
): VpsSecretResolution {
  const configured = String(env.VPS_SHARED_SECRET || '').trim();
  if (configured) return { ok: true, secret: configured, source: 'env' };

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

export function normalizeGatewayPath(rawUrl: string): string {
  const raw = String(rawUrl || '').trim() || '/';
  const withoutQuery = raw.split('?')[0] || '/';
  return withoutQuery.endsWith('/') && withoutQuery !== '/'
    ? withoutQuery.slice(0, -1)
    : withoutQuery;
}

export function routeRequirementForPath(rawUrl: string): GatewayRouteRequirement | null {
  const route = normalizeGatewayPath(rawUrl);
  return GATEWAY_ROUTE_REQUIREMENTS[route] || null;
}

export function resolveAllowedOrigins(
  env: VpsCorsEnv = process.env,
): AllowedOriginsResolution {
  const raw = String(env.ALLOWED_ORIGINS || '').trim();
  if (!raw) {
    if (env.NODE_ENV === 'production') {
      return {
        ok: false,
        code: 'ALLOWED_ORIGINS_MISSING',
        message: 'ALLOWED_ORIGINS is required in production.',
      };
    }
    return { ok: true, origins: new Set() };
  }

  const origins = new Set<string>();
  const invalid: string[] = [];
  for (const entry of raw.split(/[\s,]+/)) {
    const candidate = entry.trim();
    if (!candidate) continue;
    if (candidate === '*') {
      invalid.push(candidate);
      continue;
    }
    try {
      const parsed = new URL(candidate);
      if (!['http:', 'https:'].includes(parsed.protocol)) {
        invalid.push(candidate);
        continue;
      }
      origins.add(parsed.origin);
    } catch {
      invalid.push(candidate);
    }
  }

  if (invalid.length > 0 || origins.size === 0) {
    return {
      ok: false,
      code: 'ALLOWED_ORIGINS_INVALID',
      message: 'ALLOWED_ORIGINS must contain explicit http(s) origins only.',
    };
  }

  return { ok: true, origins };
}

export function isOriginAllowed(origin: string | undefined, allowedOrigins: Set<string>): boolean {
  if (!origin) return true;
  try {
    return allowedOrigins.has(new URL(origin).origin);
  } catch {
    return false;
  }
}

export async function verifyVpsTicket(
  token: string,
  secret: string | null | undefined,
  expected?: GatewayRouteRequirement | null,
): Promise<VpsTicketData | null> {
  if (!token || token.length < 10) return null;
  if (!secret || !String(secret).trim()) {
    logger.error('Ticket verification failed: VPS shared secret is not configured');
    return null;
  }

  try {
    const encodedSecret = new TextEncoder().encode(secret);
    const { payload } = await jwtVerify(token, encodedSecret, {
      algorithms: ['HS256'],
      issuer: TICKET_ISSUER,
      audience: TICKET_AUDIENCE,
      clockTolerance: 30,
    });

    if (!payload.sub || typeof payload.sub !== 'string') {
      logger.warn('Ticket verification failed: missing sub claim');
      return null;
    }

    if (typeof payload.exp !== 'number') {
      logger.warn('Ticket verification failed: missing exp claim');
      return null;
    }

    if (typeof payload.iat !== 'number') {
      logger.warn('Ticket verification failed: missing iat claim');
      return null;
    }

    if (payload.exp <= payload.iat || payload.exp - payload.iat > MAX_TICKET_TTL_SECONDS) {
      logger.warn('Ticket verification failed: invalid ticket lifetime');
      return null;
    }

    const feature = typeof payload.feature === 'string' ? payload.feature : '';
    const featureKey = typeof payload.feature_key === 'string' ? payload.feature_key : '';
    const route = typeof payload.route === 'string' ? normalizeGatewayPath(payload.route) : '';
    const ticketId = typeof payload.ticket_id === 'string' && payload.ticket_id.trim()
      ? payload.ticket_id
      : typeof payload.jti === 'string' && payload.jti.trim()
        ? payload.jti
        : '';
    const reservationId = typeof payload.reservation_id === 'string' && payload.reservation_id.trim()
      ? payload.reservation_id
      : '';
    const idempotencyKey = typeof payload.idempotency_key === 'string' && payload.idempotency_key.trim()
      ? payload.idempotency_key
      : '';
    if (!feature || !featureKey || !route) {
      logger.warn('Ticket verification failed: missing route or feature claims', {
        hasFeature: Boolean(feature),
        hasFeatureKey: Boolean(featureKey),
        hasRoute: Boolean(route),
      });
      return null;
    }

    if (!ticketId) {
      logger.warn('Ticket verification failed: missing unique ticket id');
      return null;
    }

    if (!reservationId || !idempotencyKey) {
      logger.warn('Ticket verification failed: missing usage reservation claims', {
        hasReservationId: Boolean(reservationId),
        hasIdempotencyKey: Boolean(idempotencyKey),
      });
      return null;
    }

    if (expected) {
      if (route !== expected.route) {
        logger.warn('Ticket verification failed: route mismatch', {
          expectedRoute: expected.route,
        });
        return null;
      }
      if (featureKey !== expected.featureKey) {
        logger.warn('Ticket verification failed: feature mismatch', {
          route: expected.route,
          expectedFeatureKey: expected.featureKey,
        });
        return null;
      }
    }

    const routeRequirement = routeRequirementForPath(route);
    if (!routeRequirement || routeRequirement.featureKey !== featureKey) {
      logger.warn('Ticket verification failed: route claim is not recognized for feature');
      return null;
    }

    logger.debug('Ticket verified successfully', { route: expected?.route || routeRequirement.route });

    return {
      userId: payload.sub,
      plan: typeof payload.plan === 'string' ? payload.plan : 'free',
      feature,
      featureKey,
      route,
      ticketId,
      reservationId,
      idempotencyKey,
    };
  } catch (err: any) {
    if (err.code === 'ERR_JWT_EXPIRED') {
      logger.warn('Ticket verification failed: expired timestamp', { code: err.code, claim: err.claim });
    } else if (err.code === 'ERR_JWS_SIGNATURE_VERIFICATION_FAILED') {
      logger.error('Ticket verification failed: signature mismatch', { code: err.code });
    } else if (err.code === 'ERR_JWT_CLAIM_VALIDATION_FAILED') {
      logger.warn('Ticket verification failed: claim validation', { code: err.code, claim: err.claim });
    } else {
      logger.error('Ticket verification failed: unknown reason', { code: err.code || 'unknown' });
    }
    return null;
  }
}
