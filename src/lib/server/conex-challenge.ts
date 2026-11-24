import 'server-only';
import { createHmac, createHash, timingSafeEqual, randomInt, randomBytes } from 'node:crypto';
import type { NextRequest, NextResponse } from 'next/server';
import { getSupabaseServiceRoleKey } from './supabase-admin';

export const CONEX_COOKIE = 'dcau_conex_session_v2';
type Stage = 'math' | 'passcode' | 'unlocked';
type State = { uid: string; binding: string; stage: Stage; expires: number; nonce: string; a?: number; b?: number };

function sessionBinding(token: string): string {
  // The caller must have verified this token with Supabase first.
  let session = token;
  try {
    const claims = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'));
    if (typeof claims.session_id === 'string' && claims.session_id.length > 0) session = claims.session_id;
  } catch { /* Bind to the verified token if session_id is absent. */ }
  return createHash('sha256').update(session).digest('base64url');
}
function signature(payload: string): Buffer {
  return createHmac('sha256', getSupabaseServiceRoleKey()).update('datacube:conex:v2:' + payload).digest();
}
export function secureEqual(left: string, right: string): boolean {
  const a = createHash('sha256').update(left).digest();
  const b = createHash('sha256').update(right).digest();
  return timingSafeEqual(a, b);
}
export function readConexState(req: NextRequest, userId: string, token: string): State | null {
  try {
    const raw = req.cookies.get(CONEX_COOKIE)?.value || '';
    if (!raw || raw.length > 1800) return null;
    const [payload, mac, extra] = raw.split('.');
    if (!payload || !mac || extra) return null;
    const expected = signature(payload);
    const actual = Buffer.from(mac, 'base64url');
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null;
    const state = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as State;
    if (state.uid !== userId || state.binding !== sessionBinding(token) ||
        !Number.isFinite(state.expires) || state.expires <= Date.now() ||
        !['math','passcode','unlocked'].includes(state.stage)) return null;
    return state;
  } catch { return null; }
}
export function issueConexState(res: NextResponse, userId: string, token: string, stage: Stage) {
  const seconds = stage === 'unlocked' ? 1800 : 300;
  const state: State = { uid: userId, binding: sessionBinding(token), stage,
    expires: Date.now() + seconds * 1000, nonce: randomBytes(16).toString('base64url') };
  if (stage === 'math') { state.a = randomInt(1, 10); state.b = randomInt(1, 10); }
  const payload = Buffer.from(JSON.stringify(state)).toString('base64url');
  res.cookies.set(CONEX_COOKIE, payload + '.' + signature(payload).toString('base64url'), {
    httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'strict',
    path: '/', maxAge: seconds,
  });
  return state;
}
export function clearConexState(res: NextResponse) {
  res.cookies.set(CONEX_COOKIE, '', { httpOnly: true, secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict', path: '/', maxAge: 0 });
}
