import { NextRequest, NextResponse } from 'next/server';
import { randomUUID, randomInt, createHash, timingSafeEqual } from 'node:crypto';
import { accessControlResponse, isAccessControlError, requireConexOwner } from '@/lib/server/authorization';
import { CONEX_COOKIE, CHALLENGE_COOKIE, conexCookieOptions, signConexProof, verifyConexProof } from '@/lib/server/conex-proof';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function createSafeRequestId() { return randomUUID(); }
function response(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store, private' } });
}
function sameOrigin(req: NextRequest) { return req.headers.get('origin') === req.nextUrl.origin; }
function clear(res: NextResponse, name: string) { res.cookies.set(name, '', { ...conexCookieOptions, maxAge: 0 }); }
function secureEqual(a: string, b: string) {
  return timingSafeEqual(createHash('sha256').update(a).digest(), createHash('sha256').update(b).digest());
}

export async function GET(req: NextRequest) {
  const requestId = createSafeRequestId();
  try {
    const { auth } = await requireConexOwner(req);
    if (await verifyConexProof(req, auth.userId, auth.accessToken, 'verified')) return response({ ok: true, stage: 'unlocked' });
    if (await verifyConexProof(req, auth.userId, auth.accessToken, 'passcode')) return response({ ok: true, stage: 'passcode' });
    const a = randomInt(1, 10), b = randomInt(1, 10);
    const res = response({ ok: true, stage: 'math', a, b });
    res.cookies.set(CHALLENGE_COOKIE, await signConexProof(auth.userId, auth.accessToken, 'math', 300, a+b),
      { ...conexCookieOptions, maxAge: 300 });
    return res;
  } catch (error) {
    if (isAccessControlError(error)) return accessControlResponse(error, requestId);
    return response({ error: 'Admin verification unavailable.', requestId }, 503);
  }
}

export async function POST(req: NextRequest) {
  const requestId = createSafeRequestId();
  try {
    if (!sameOrigin(req)) return response({ error: 'Invalid request origin.', requestId }, 403);
    const { auth, supabase } = await requireConexOwner(req);
    if (Number(req.headers.get('content-length') || 0) > 4096) return response({ error: 'Invalid request.', requestId }, 413);
    const raw = await req.text();
    if (raw.length > 4096) return response({ error: 'Invalid request.', requestId }, 413);
    const body = JSON.parse(raw);
    const stage = body?.stage;
    if (stage !== 'math' && stage !== 'passcode') return response({ error: 'Restart verification.', requestId }, 409);
    const proof = await verifyConexProof(req, auth.userId, auth.accessToken, stage);
    if (!proof) return response({ error: 'Restart verification.', requestId }, 409);
    const windowSeconds = stage === 'passcode' ? 900 : 300;
    const start = new Date(Math.floor(Date.now() / (windowSeconds * 1000)) * windowSeconds * 1000).toISOString();
    const { data, error } = await supabase.rpc('au_rate_limit_hit', {
      p_key: 'conex:v2:' + auth.userId + ':' + stage + ':' + start,
      p_owner_id: auth.userId, p_ip_hash: 'owner-session', p_endpoint: '/conex/' + stage,
      p_window_start: start, p_window_seconds: windowSeconds,
    });
    const count = Number(data?.[0]?.current_count);
    if (error || !Number.isSafeInteger(count) || count < 1) return response({ error: 'Verification unavailable.', requestId }, 503);
    if (count > (stage === 'passcode' ? 5 : 10)) return response({ error: 'Too many attempts. Try again later.', code: 'admin_auth_rate_limited', requestId }, 429);
    if (stage === 'math') {
      if (!Number.isInteger(body.answer) || body.answer !== proof.answer) return response({ error: 'Incorrect answer.', requestId }, 401);
      const res = response({ ok: true, stage: 'passcode' });
      res.cookies.set(CHALLENGE_COOKIE, await signConexProof(auth.userId, auth.accessToken, 'passcode', 300),
        { ...conexCookieOptions, maxAge: 300 });
      return res;
    }
    const submitted = typeof body.passcode === 'string' ? body.passcode : '';
    if (!submitted || submitted.length > 512) return response({ error: 'Incorrect passcode.', requestId }, 401);
    const config = await supabase.from('au_admin_config').select('value').eq('key', 'admin_access_key').single();
    const expected = typeof config.data?.value === 'string' ? config.data.value : '';
    if (config.error || !expected) return response({ error: 'Passcode verification unavailable.', requestId }, 503);
    if (!secureEqual(submitted, expected)) return response({ error: 'Incorrect passcode.', requestId }, 401);
    const res = response({ ok: true, stage: 'unlocked' });
    clear(res, CHALLENGE_COOKIE);
    res.cookies.set(CONEX_COOKIE, await signConexProof(auth.userId, auth.accessToken, 'verified', 1800),
      { ...conexCookieOptions, maxAge: 1800 });
    return res;
  } catch (error) {
    if (isAccessControlError(error)) return accessControlResponse(error, requestId);
    return response({ error: 'Admin verification failed.', requestId }, 400);
  }
}
export async function DELETE(req: NextRequest) {
  if (!sameOrigin(req)) return response({ error: 'Invalid request origin.' }, 403);
  const res = response({ ok: true });
  clear(res, CONEX_COOKIE); clear(res, CHALLENGE_COOKIE);
  return res;
}
