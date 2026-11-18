import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { requireUserFromRequest } from '@/app/api/proxy/_supabase-auth';
import {
  createSupabaseAdminClient,
  getSupabaseAnonKey,
  getSupabaseServiceRoleKey,
  getSupabaseUrl,
} from '@/lib/server/supabase-admin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const HANDOFF_TABLE = 'au_mobile_auth_handoffs';
const HANDOFF_TTL_MS = 5 * 60 * 1000;
const VALUE_PATTERN = /^[A-Za-z0-9_-]{40,64}$/;
const CHALLENGE_PATTERN = /^[A-Za-z0-9_-]{43}$/;

function json(payload: Record<string, unknown>, status = 200): NextResponse {
  return NextResponse.json(payload, {
    status,
    headers: {
      'Cache-Control': 'no-store, max-age=0',
      Pragma: 'no-cache',
      Vary: 'Authorization, Cookie',
    },
  });
}

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function expectedChallenge(verifier: string): string {
  return createHash('sha256').update(verifier, 'ascii').digest('base64url');
}

/**
 * Refresh tokens are never written to Postgres in plaintext. The encryption
 * key is derived server-side from the existing service-role secret and is
 * never sent to the browser or Android app.
 */
function handoffEncryptionKey(): Buffer {
  return createHash('sha256')
    .update('datacube-au/mobile-auth-handoff/v1:', 'utf8')
    .update(getSupabaseServiceRoleKey(), 'utf8')
    .digest();
}

function encryptRefreshToken(refreshToken: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', handoffEncryptionKey(), iv);
  const ciphertext = Buffer.concat([
    cipher.update(refreshToken, 'utf8'),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return ['v1', iv.toString('base64url'), tag.toString('base64url'), ciphertext.toString('base64url')].join('.');
}

function decryptRefreshToken(value: string): string {
  const [version, ivValue, tagValue, ciphertextValue] = value.split('.');
  if (version !== 'v1' || !ivValue || !tagValue || !ciphertextValue) {
    throw new Error('Invalid encrypted mobile session.');
  }
  const decipher = createDecipheriv(
    'aes-256-gcm',
    handoffEncryptionKey(),
    Buffer.from(ivValue, 'base64url'),
  );
  decipher.setAuthTag(Buffer.from(tagValue, 'base64url'));
  return Buffer.concat([
    decipher.update(Buffer.from(ciphertextValue, 'base64url')),
    decipher.final(),
  ]).toString('utf8');
}

function createSessionValidator() {
  return createClient(getSupabaseUrl(), getSupabaseAnonKey(), {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const contentLength = Number(request.headers.get('content-length') || 0);
  if (contentLength > 8_192) {
    return json({ ok: false, code: 'PAYLOAD_TOO_LARGE', message: 'Invalid authentication request.' }, 413);
  }

  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  if (!body || typeof body.action !== 'string') {
    return json({ ok: false, code: 'INVALID_REQUEST', message: 'Invalid authentication request.' }, 400);
  }

  const admin = createSupabaseAdminClient();

  if (body.action === 'issue') {
    // The website's already-authenticated browser session is the authority.
    // Require a bearer header so this state-changing request is not cookie-only.
    const auth = await requireUserFromRequest(request);
    if (!auth.ok || auth.source !== 'header') {
      return json({ ok: false, code: 'UNAUTHENTICATED', message: 'Sign in on the DataCube AU website first.' }, 401);
    }

    const state = typeof body.state === 'string' ? body.state : '';
    const codeChallenge = typeof body.codeChallenge === 'string' ? body.codeChallenge : '';

    if (!VALUE_PATTERN.test(state) || !CHALLENGE_PATTERN.test(codeChallenge) || !auth.email) {
      return json({ ok: false, code: 'INVALID_REQUEST', message: 'The mobile sign-in request is invalid.' }, 400);
    }

    // Create an independent Supabase session for Android. Do not copy or rotate
    // the browser's refresh token: sharing one refresh-token chain between
    // browser and native clients creates refresh races and cross-device coupling.
    const { data: generated, error: generateError } = await admin.auth.admin.generateLink({
      type: 'magiclink',
      email: auth.email,
    });
    const tokenHash = generated?.properties?.hashed_token;
    if (generateError || !tokenHash || generated.user?.id !== auth.userId) {
      return json({
        ok: false,
        code: 'MOBILE_SESSION_CREATE_FAILED',
        message: 'Your website session is valid, but a separate app session could not be created.',
      }, 503);
    }

    // The admin-generated magic-link hash is immediately redeemed server-side
    // with the public client. Supabase returns a fresh, independent mobile session;
    // the magic-link token itself is never sent to the browser or Android.
    const validator = createSessionValidator();
    const { data: verified, error: verifyError } = await validator.auth.verifyOtp({
      token_hash: tokenHash,
      type: 'email',
    });
    const mobileSession = verified.session;
    if (verifyError || !mobileSession?.refresh_token || verified.user?.id !== auth.userId) {
      return json({
        ok: false,
        code: 'MOBILE_SESSION_VERIFY_FAILED',
        message: 'The app session could not be prepared. Please try again.',
      }, 503);
    }

    const now = new Date();
    const expiresAt = new Date(now.getTime() + HANDOFF_TTL_MS).toISOString();
    const handoffCode = randomBytes(32).toString('base64url');

    // Remove only expired handoffs. Live handoffs for other devices remain valid.
    await admin.from(HANDOFF_TABLE).delete().lt('expires_at', now.toISOString());

    const { error: insertError } = await admin.from(HANDOFF_TABLE).insert({
      user_id: auth.userId,
      code_hash: sha256(handoffCode),
      state_hash: sha256(state),
      code_challenge: codeChallenge,
      refresh_token_ciphertext: encryptRefreshToken(mobileSession.refresh_token),
      expires_at: expiresAt,
    });

    if (insertError) {
      // The newly-created mobile session is independent of the website session.
      // Revoke it if persistence fails so an orphaned session is not left active.
      await validator.auth.signOut().catch(() => undefined);
      return json({
        ok: false,
        code: 'HANDOFF_STORAGE_FAILED',
        message: 'The secure app handoff could not be prepared. Please try again.',
      }, 503);
    }

    return json({ ok: true, handoffCode });
  }

  if (body.action === 'exchange') {
    const code = typeof body.code === 'string' ? body.code : '';
    const state = typeof body.state === 'string' ? body.state : '';
    const verifier = typeof body.codeVerifier === 'string' ? body.codeVerifier : '';

    if (!VALUE_PATTERN.test(code) || !VALUE_PATTERN.test(state) || !VALUE_PATTERN.test(verifier)) {
      return json({ ok: false, code: 'INVALID_HANDOFF', message: 'This sign-in link is invalid or has expired.' }, 400);
    }

    const codeChallenge = expectedChallenge(verifier);
    const now = new Date().toISOString();

    // This conditional UPDATE is the atomic single-use gate. Only one client
    // can consume a handoff whose code, state, PKCE challenge and expiry match.
    const { data: consumed, error: consumeError } = await admin
      .from(HANDOFF_TABLE)
      .update({ consumed_at: now })
      .eq('code_hash', sha256(code))
      .eq('state_hash', sha256(state))
      .eq('code_challenge', codeChallenge)
      .is('consumed_at', null)
      .gt('expires_at', now)
      .select('user_id,refresh_token_ciphertext')
      .maybeSingle();

    if (consumeError || !consumed) {
      return json({ ok: false, code: 'HANDOFF_EXPIRED_OR_USED', message: 'This sign-in link has expired or was already used. Please sign in again.' }, 401);
    }

    try {
      const refreshToken = decryptRefreshToken(consumed.refresh_token_ciphertext);
      return json({
        ok: true,
        refreshToken,
        userId: consumed.user_id,
      });
    } catch {
      return json({ ok: false, code: 'HANDOFF_UNAVAILABLE', message: 'The secure sign-in could not be completed. Please sign in again.' }, 500);
    }
  }

  return json({ ok: false, code: 'INVALID_ACTION', message: 'Invalid authentication request.' }, 400);
}
