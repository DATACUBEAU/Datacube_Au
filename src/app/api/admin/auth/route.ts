import { NextRequest, NextResponse } from 'next/server';
import { randomInt, timingSafeEqual, createHash } from 'node:crypto';
import { requireConexOwner, accessControlResponse, isAccessControlError } from '@/lib/server/authorization';
import { CONEX_COOKIE, CHALLENGE_COOKIE, conexCookieOptions, signConexProof, verifyConexProof } from '@/lib/server/conex-proof';

export const runtime = 'nodejs';
const noStore = { 'Cache-Control': 'no-store, private' };
function response(data: object, status = 200) {
  return NextResponse.json(data, { status, headers: noStore });
}
function equal(a: string, b: string) {
  return timingSafeEqual(createHash('sha256').update(a).digest(), createHash('sha256').update(b).digest());
}
export async function POST(req: NextRequest) {
  try {
    if (req.headers.get('origin') !== req.nextUrl.origin) return response({ error: 'Invalid origin' }, 403);
    const { auth, supabase } = await requireConexOwner(req);
    const body = await req.json().catch(() => null);
    const action = body?.action;
    if (action === 'status') return response({ verified: Boolean(await verifyConexProof(req, auth.userId, auth.accessToken, 'verified')) });
    if (action === 'logout') {
      const res = response({ ok: true });
      for (const name of [CONEX_COOKIE, CHALLENGE_COOKIE]) res.cookies.set(name, '', { ...conexCookieOptions, maxAge: 0 });
      return res;
    }
    if (!['start', 'math', 'passcode'].includes(action)) return response({ error: 'Invalid challenge action' }, 400);
    // Reuse the existing atomic database rate limiter, keyed by verified owner.
    const seconds = 900;
    const start = new Date(Math.floor(Date.now() / (seconds * 1000)) * seconds * 1000).toISOString();
    const { data: counts, error: limitError } = await supabase.rpc('au_rate_limit_hit', {
      p_key: 'conex-v2:' + auth.userId + ':' + action + ':' + start,
      p_owner_id: auth.userId, p_ip_hash: null, p_endpoint: 'conex-' + action,
      p_window_start: start, p_window_seconds: seconds,
    });
    const count = Number(counts?.[0]?.current_count);
    if (limitError || !Number.isSafeInteger(count) || count < 1) return response({ error: 'Security check temporarily unavailable' }, 503);
    if (count > (action === 'passcode' ? 5 : 20)) return response({ error: 'Too many attempts. Try again after the rate-limit window.' }, 429);
    if (action === 'start') {
      const a = randomInt(1, 11), b = randomInt(1, 11);
      const res = response({ a, b });
      res.cookies.set(CHALLENGE_COOKIE, await signConexProof(auth.userId, auth.accessToken, 'math', 300, a+b), { ...conexCookieOptions, maxAge: 300 });
      return res;
    }
    if (action === 'math') {
      const proof = await verifyConexProof(req, auth.userId, auth.accessToken, 'math');
      if (!proof || typeof body.answer !== 'string' || !/^\d{1,2}$/.test(body.answer) || Number(body.answer) !== proof.answer)
        return response({ error: 'Incorrect or expired challenge' }, 400);
      const res = response({ ok: true });
      res.cookies.set(CHALLENGE_COOKIE, await signConexProof(auth.userId, auth.accessToken, 'passcode', 300), { ...conexCookieOptions, maxAge: 300 });
      return res;
    }
    if (!await verifyConexProof(req, auth.userId, auth.accessToken, 'passcode')) return response({ error: 'Restart the security check' }, 403);
    if (typeof body.passcode !== 'string' || !body.passcode || body.passcode.length > 256) return response({ error: 'Invalid passcode' }, 400);
    const { data, error } = await supabase.from('au_admin_config').select('value').eq('key', 'admin_access_key').maybeSingle();
    if (error || typeof data?.value !== 'string' || !data.value) return response({ error: 'Passcode configuration unavailable' }, 503);
    if (!equal(body.passcode, data.value)) return response({ error: 'Incorrect passcode' }, 403);
    const res = response({ ok: true, verified: true });
    res.cookies.set(CONEX_COOKIE, await signConexProof(auth.userId, auth.accessToken, 'verified', 1800), { ...conexCookieOptions, maxAge: 1800 });
    res.cookies.set(CHALLENGE_COOKIE, '', { ...conexCookieOptions, maxAge: 0 });
    return res;
  } catch (error) {
    if (isAccessControlError(error)) return accessControlResponse(error);
    return response({ error: 'Security check unavailable' }, 503);
  }
}
