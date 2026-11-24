import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { accessControlResponse, isAccessControlError, requireAdmin } from '@/lib/server/authorization';
import { issueConexState, readConexState, clearConexState, secureEqual } from '@/lib/server/conex-challenge';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function createSafeRequestId() { return randomUUID(); }
function response(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store, private' } });
}
function sameOrigin(req: NextRequest) {
  return req.headers.get('origin') === req.nextUrl.origin;
}

export async function GET(req: NextRequest) {
  const requestId = createSafeRequestId();
  try {
    const { auth } = await requireAdmin(req, { ownerCheckOnly: true });
    const current = readConexState(req, auth.userId, auth.accessToken);
    if (current?.stage === 'unlocked') return response({ ok: true, stage: 'unlocked' });
    if (current?.stage === 'passcode') return response({ ok: true, stage: 'passcode' });
    const res = response({ ok: true, stage: 'math' });
    const state = current?.stage === 'math' ? current : issueConexState(res, auth.userId, auth.accessToken, 'math');
    // Preserve the signed cookie on the response while adding the math question.
    const output = response({ ok: true, stage: 'math', a: state.a, b: state.b });
    for (const cookie of res.cookies.getAll()) output.cookies.set(cookie);
    return output;
  } catch (error) {
    if (isAccessControlError(error)) return accessControlResponse(error, requestId);
    return response({ error: 'Admin verification unavailable.', requestId }, 503);
  }
}

export async function POST(req: NextRequest) {
  const requestId = createSafeRequestId();
  try {
    if (!sameOrigin(req)) return response({ error: 'Invalid request origin.', requestId }, 403);
    const { auth, supabase } = await requireAdmin(req, { ownerCheckOnly: true });
    const state = readConexState(req, auth.userId, auth.accessToken);
    if (!state || state.stage === 'unlocked') return response({ error: 'Restart verification.', requestId }, 409);
    if (Number(req.headers.get('content-length') || 0) > 4096) return response({ error: 'Invalid request.', requestId }, 413);
    const raw = await req.text();
    if (raw.length > 4096) return response({ error: 'Invalid request.', requestId }, 413);
    const body = JSON.parse(raw);
    if (body?.stage !== state.stage) return response({ error: 'Restart verification.', requestId }, 409);
    // Existing service-role-only atomic rate limiter. Owner-scoped, not spoofable IP headers.
    // Count attempts before checking the answer, so parallel requests cannot bypass the budget.
    const windowSeconds = state.stage === 'passcode' ? 900 : 300;
    const start = new Date(Math.floor(Date.now() / (windowSeconds * 1000)) * windowSeconds * 1000).toISOString();
    const { data, error } = await supabase.rpc('au_rate_limit_hit', {
      p_key: 'conex:v2:' + auth.userId + ':' + state.stage + ':' + start,
      p_owner_id: auth.userId, p_ip_hash: 'owner-session', p_endpoint: '/conex/' + state.stage,
      p_window_start: start, p_window_seconds: windowSeconds,
    });
    const count = Number(data?.[0]?.current_count);
    if (error || !Number.isSafeInteger(count) || count < 1) return response({ error: 'Verification unavailable.', requestId }, 503);
    if (count > (state.stage === 'passcode' ? 5 : 10)) {
      return response({ error: 'Too many attempts. Try again later.', code: 'admin_auth_rate_limited', requestId }, 429);
    }
    if (state.stage === 'math') {
      if (!Number.isInteger(body.answer) || body.answer !== Number(state.a) + Number(state.b))
        return response({ error: 'Incorrect answer.', requestId }, 401);
      const res = response({ ok: true, stage: 'passcode' });
      issueConexState(res, auth.userId, auth.accessToken, 'passcode');
      return res;
    }
    const submitted = typeof body.passcode === 'string' ? body.passcode.trim() : '';
    if (!submitted || submitted.length > 512) return response({ error: 'Incorrect passcode.', requestId }, 401);
    const config = await supabase.from('au_admin_config').select('value').eq('key', 'admin_access_key').single();
    const expected = typeof config.data?.value === 'string' ? config.data.value.trim() : '';
    if (config.error || !expected) return response({ error: 'Passcode verification unavailable.', requestId }, 503);
    if (!secureEqual(submitted, expected)) return response({ error: 'Incorrect passcode.', requestId }, 401);
    const res = response({ ok: true, stage: 'unlocked' });
    issueConexState(res, auth.userId, auth.accessToken, 'unlocked');
    return res;
  } catch (error) {
    if (isAccessControlError(error)) return accessControlResponse(error, requestId);
    return response({ error: 'Admin verification failed.', requestId }, 400);
  }
}

export async function DELETE(req: NextRequest) {
  if (!sameOrigin(req)) return response({ error: 'Invalid request origin.' }, 403);
  const res = response({ ok: true });
  clearConexState(res);
  return res;
}
