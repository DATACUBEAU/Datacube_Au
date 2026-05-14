import { jwtVerify, createRemoteJWKSet, JWTVerifyGetKey } from 'jose';
import { logger } from './utils.js';

let jwks: JWTVerifyGetKey | null = null;

function getJWKS(supabaseUrl: string) {
  if (!jwks) {
    jwks = createRemoteJWKSet(new URL(`${supabaseUrl}/auth/v1/.well-known/jwks.json`));
  }
  return jwks;
}

export async function verifySupabaseToken(
  token: string,
  supabaseUrl: string,
  _anonKey: string
): Promise<string | null> {
  if (!token || token.length < 10) {
    return null;
  }

  try {
    const JWKS = getJWKS(supabaseUrl);
    const { payload } = await jwtVerify(token, JWKS, {
      issuer: `${supabaseUrl}/auth/v1`,
      audience: 'supabase',
    });

    if (!payload.sub || typeof payload.sub !== 'string') {
      logger.warn('JWT missing sub claim');
      return null;
    }

    return payload.sub;
  } catch (err: any) {
    if (err.code === 'ERR_JWT_EXPIRED') {
      logger.debug('Token expired');
    } else if (err.code === 'ERR_JWS_SIGNATURE_VERIFICATION_FAILED') {
      logger.debug('Token signature invalid');
    } else {
      logger.warn('Token verification failed', err.message);
    }
    return null;
  }
}

export async function verifySupabaseTokenWithRole(
  token: string,
  supabaseUrl: string,
  serviceRoleKey: string
): Promise<{ userId: string; isServiceRole: boolean } | null> {
  const userId = await verifySupabaseToken(token, supabaseUrl, '');
  
  if (!userId) {
    if (token === serviceRoleKey) {
      return { userId: 'service-role', isServiceRole: true };
    }
    return null;
  }

  return { userId, isServiceRole: false };
}

export async function verifyVpsTicket(
  token: string,
  secret: string
): Promise<{ userId: string; plan: string; feature: string } | null> {
  if (!token || token.length < 10) return null;

  try {
    const encodedSecret = new TextEncoder().encode(secret);
    const { payload } = await jwtVerify(token, encodedSecret, {
      algorithms: ['HS256'],
      clockTolerance: 300, // 5 minutes leeway for clock skew between Vercel and VPS
    });

    if (!payload.sub || typeof payload.sub !== 'string') {
      logger.warn('Ticket verification failed: missing sub claim', { payload });
      return null;
    }

    logger.debug('Ticket verified successfully', { userId: payload.sub, feature: payload.feature });
    
    return {
      userId: payload.sub,
      plan: typeof payload.plan === 'string' ? payload.plan : 'free',
      feature: typeof payload.feature === 'string' ? payload.feature : 'chat',
    };
  } catch (err: any) {
    if (err.code === 'ERR_JWT_EXPIRED') {
      logger.warn('Ticket verification failed: expired timestamp', { error: err.message, code: err.code, claim: err.claim });
    } else if (err.code === 'ERR_JWS_SIGNATURE_VERIFICATION_FAILED') {
      logger.error('Ticket verification failed: signature mismatch (check VPS_SHARED_SECRET)', { error: err.message, code: err.code });
    } else if (err.code === 'ERR_JWT_CLAIM_VALIDATION_FAILED') {
      logger.warn('Ticket verification failed: claim validation (e.g. issued in future due to clock skew)', { error: err.message, code: err.code, claim: err.claim });
    } else {
      logger.error('Ticket verification failed: unknown reason', { error: err.message, code: err.code });
    }
    return null;
  }
}