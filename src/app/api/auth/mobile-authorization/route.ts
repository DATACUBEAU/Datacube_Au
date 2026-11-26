import { createHash, createHmac, randomBytes, randomInt } from 'node:crypto';
import { isIP } from 'node:net';
import { createClient, type Session, type SupabaseClient } from '@supabase/supabase-js';
import { type NextRequest, NextResponse } from 'next/server';
import { MOBILE_OAUTH_REQUEST_COOKIE } from '@/lib/auth/redirects';
import {
  createSupabaseAdminClient,
  getSupabaseAnonKey,
  getSupabaseServiceRoleKey,
  getSupabaseUrl,
} from '@/lib/server/supabase-admin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const BODY_LIMIT = 2_048;
const PROOF_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const PAIRING_PATTERN = /^[A-Z2-9]{8}$/;
const PAIRING_ALPHABET = 'ABCDEFGHJKMNPQRSTVWXYZ23456789';
const DEVICE_STATES = new Set(['pending', 'approved', 'consumed', 'denied', 'expired', 'cancelled']);

function json(body: Record<string, unknown>, status = 200, retryAfter?: number): NextResponse {
  return NextResponse.json(body, {
    status,
    headers: {
      'Cache-Control': 'no-store, max-age=0',
      Pragma: 'no-cache',
      'X-Content-Type-Options': 'nosniff',
      ...(retryAfter ? { 'Retry-After': String(retryAfter) } : {}),
    },
  });
}

function problem(code: string, status: number, retryAfter?: number): NextResponse {
  return json({ ok: false, code }, status, retryAfter);
}

function digest(value: string, format: 'hex' | 'base64url'): string {
  return createHash('sha256').update(value, 'ascii').digest(format);
}

function protectedDigest(...parts: string[]): string {
  return createHmac('sha256', getSupabaseServiceRoleKey())
    .update('datacube-au/mobile-device/v1\0')
    .update(parts.join('\0'))
    .digest('hex');
}

function trustedClientAddress(request: NextRequest): string {
  // Vercel provides this header independently of forwarded headers from other proxies.
  const address = process.env.VERCEL === '1' ? request.headers.get('x-vercel-forwarded-for')?.trim() : null;
  return address && isIP(address) ? address : 'unknown';
}

async function requestBody(request: NextRequest): Promise<Record<string, unknown> | null> {
  const contentType = request.headers.get('content-type')?.split(';', 1)[0].trim().toLowerCase();
  if (contentType !== 'application/json' || !request.body || Number(request.headers.get('content-length')) > BODY_LIMIT) {
    return null;
  }
  const reader = request.body.getReader();
  const buffer = new Uint8Array(BODY_LIMIT);
  let length = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (length + value.byteLength > BODY_LIMIT) {
        await reader.cancel();
        return null;
      }
      buffer.set(value, length);
      length += value.byteLength;
    }
    const parsed: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(0, length)));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null;
  } catch {
    return null;
  } finally {
    reader.releaseLock();
  }
}

async function allow(admin: SupabaseClient, scope: string, subject: string): Promise<boolean> {
  const { data, error } = await admin.rpc('au_mobile_device_auth_limit', {
    p_scope: scope,
    p_subject_hash: protectedDigest('limit', subject),
  }).abortSignal(AbortSignal.timeout(5_000));
  if (error || typeof data !== 'boolean') throw new Error('Mobile authorization rate limit unavailable.');
  return data;
}

function authClient(key: string, signal: AbortSignal): SupabaseClient {
  return createClient(getSupabaseUrl(), key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: (input, init) => fetch(input, { ...init, signal }) },
  });
}

async function mintSession(userId: string): Promise<Session | null> {
  const signal = AbortSignal.timeout(15_000);
  const issuer = authClient(getSupabaseServiceRoleKey(), signal);
  const { data: account, error: accountError } = await issuer.auth.admin.getUserById(userId);
  if (accountError || account.user?.id !== userId || !account.user.email || !account.user.email_confirmed_at) return null;

  // Redeem the OTP internally. Android receives a separate Supabase session in
  // the winning HTTPS response, while the browser's session remains independent.
  const { data: generated, error: generateError } = await issuer.auth.admin.generateLink({
    type: 'magiclink',
    email: account.user.email,
  });
  const token = generated?.properties?.hashed_token;
  if (generateError || !token || generated.user?.id !== userId) return null;

  const validator = authClient(getSupabaseAnonKey(), signal);
  const { data: verified, error: verifyError } = await validator.auth.verifyOtp({ token_hash: token, type: 'email' });
  const session = verified.session;
  if (verifyError || !session?.access_token || !session.refresh_token || verified.user?.id !== userId || session.user.id !== userId) {
    if (session?.access_token) await validator.auth.signOut({ scope: 'local' }).catch(() => undefined);
    return null;
  }
  return session;
}

async function createAuthorization(admin: SupabaseClient, challenge: unknown, address: string): Promise<NextResponse> {
  if (typeof challenge !== 'string' || !PROOF_PATTERN.test(challenge)) return problem('INVALID_REQUEST', 400);
  if (!await allow(admin, 'create-ip', address) || !await allow(admin, 'create-global', 'all')) {
    return problem('RATE_LIMITED', 429, 300);
  }
  const requestId = randomBytes(32).toString('base64url');
  const pairingCode = Array.from({ length: 8 }, () => PAIRING_ALPHABET[randomInt(PAIRING_ALPHABET.length)]).join('');
  const { data: expiresAt, error } = await admin.rpc('au_mobile_device_auth_create', {
    p_request_hash: digest(requestId, 'hex'),
    p_challenge: challenge,
    p_pairing_hash: protectedDigest('pairing', requestId, pairingCode),
  }).abortSignal(AbortSignal.timeout(5_000));
  if (error || typeof expiresAt !== 'string') return problem('TEMPORARILY_UNAVAILABLE', 503);
  return json({ ok: true, requestId, pairingCode, expiresAt: new Date(expiresAt).toISOString() }, 201);
}

async function decideAuthorization(admin: SupabaseClient, request: NextRequest, action: 'approve' | 'deny',
  requestId: string, pairingCode: unknown, address: string): Promise<NextResponse> {
  const host = request.headers.get('host');
  const origin = host ? `${request.nextUrl.protocol}//${host}` : request.nextUrl.origin;
  if (request.headers.get('origin') !== origin) return problem('INVALID_ORIGIN', 403);
  if (typeof pairingCode !== 'string' || !PAIRING_PATTERN.test(pairingCode)) return problem('INVALID_REQUEST', 400);
  const bearer = /^Bearer ([^\s]+)$/i.exec(request.headers.get('authorization') ?? '')?.[1];
  if (!bearer) return problem('UNAUTHENTICATED', 401);
  if (!await allow(admin, 'browser-ip', address)) return problem('RATE_LIMITED', 429, 300);
  const verifier = authClient(getSupabaseAnonKey(), AbortSignal.timeout(7_000));
  const { data, error } = await verifier.auth.getUser(bearer);
  if (error?.status && error.status >= 500) return problem('TEMPORARILY_UNAVAILABLE', 503);
  if (error || !data.user?.id || !data.user.email || !data.user.email_confirmed_at) return problem('UNAUTHENTICATED', 401);
  if (!await allow(admin, 'browser-account', data.user.id)) return problem('RATE_LIMITED', 429, 300);

  const decision = action === 'approve' ? 'approved' : 'denied';
  const { data: status, error: decisionError } = await admin.rpc('au_mobile_device_auth_decide', {
    p_request_hash: digest(requestId, 'hex'),
    p_pairing_hash: protectedDigest('pairing', requestId, pairingCode),
    p_user_id: data.user.id,
    p_decision: decision,
  }).abortSignal(AbortSignal.timeout(5_000));
  if (decisionError) return problem('TEMPORARILY_UNAVAILABLE', 503);
  if (status !== decision) return problem('REQUEST_UNAVAILABLE', 409);
  const response = json({ ok: true, status });
  if (request.cookies.get(MOBILE_OAUTH_REQUEST_COOKIE)?.value === requestId) {
    response.cookies.set(MOBILE_OAUTH_REQUEST_COOKIE, '', {
      path: '/', maxAge: 0, httpOnly: true, sameSite: 'lax', secure: request.nextUrl.protocol === 'https:',
    });
  }
  return response;
}

async function handleDeviceProof(admin: SupabaseClient, action: 'status' | 'consume' | 'cancel',
  requestId: string, verifier: unknown, address: string): Promise<NextResponse> {
  if (typeof verifier !== 'string' || !PROOF_PATTERN.test(verifier)) return problem('INVALID_REQUEST', 400);
  if (!await allow(admin, 'device-ip', address)) return problem('RATE_LIMITED', 429, 60);
  const requestHash = digest(requestId, 'hex');
  const { data, error } = await admin.rpc('au_mobile_device_auth_device', {
    p_request_hash: requestHash,
    p_challenge: digest(verifier, 'base64url'),
    p_action: action,
  }).abortSignal(AbortSignal.timeout(5_000));
  if (error) return problem('TEMPORARILY_UNAVAILABLE', 503);
  if (!data) return problem('REQUEST_UNAVAILABLE', 401);
  const { status, userId } = data as { status: string; userId?: string };
  if (!DEVICE_STATES.has(status)) return problem('TEMPORARILY_UNAVAILABLE', 503);
  if (action !== 'consume' || status !== 'consumed' || typeof userId !== 'string') return json({ ok: true, status });

  let session: Session | null;
  try {
    session = await mintSession(userId);
  } finally {
    // A failed release expires naturally. It must not discard an issued session.
    await admin.rpc('au_mobile_device_auth_release_mint', { p_user_id: userId, p_request_hash: requestHash })
      .abortSignal(AbortSignal.timeout(1_000)).then(() => undefined, () => undefined);
  }
  if (!session) return problem('SESSION_UNAVAILABLE', 503);
  const expiresAt = session.expires_at ?? Math.floor(Date.now() / 1000) + session.expires_in;
  return json({
    ok: true,
    status,
    userId,
    session: {
      access_token: session.access_token,
      refresh_token: session.refresh_token,
      token_type: session.token_type,
      expires_in: session.expires_in,
      expires_at: expiresAt,
      user: session.user,
    },
  });
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const body = await requestBody(request);
  if (!body || typeof body.action !== 'string') return problem('INVALID_REQUEST', 400);
  try {
    const admin = createSupabaseAdminClient();
    const address = trustedClientAddress(request);
    if (body.action === 'create') {
      if (request.headers.has('origin')) return problem('INVALID_ORIGIN', 403);
      return await createAuthorization(admin, body.challenge, address);
    }
    if (typeof body.requestId !== 'string' || !PROOF_PATTERN.test(body.requestId)) return problem('INVALID_REQUEST', 400);
    switch (body.action) {
      case 'approve':
      case 'deny':
        return await decideAuthorization(admin, request, body.action, body.requestId, body.pairingCode, address);
      case 'status':
      case 'consume':
      case 'cancel':
        if (request.headers.has('origin')) return problem('INVALID_ORIGIN', 403);
        return await handleDeviceProof(admin, body.action, body.requestId, body.verifier, address);
      default:
        return problem('INVALID_REQUEST', 400);
    }
  } catch {
    // Upstream errors may include request details. Only return fixed codes.
    return problem('TEMPORARILY_UNAVAILABLE', 503);
  }
}
