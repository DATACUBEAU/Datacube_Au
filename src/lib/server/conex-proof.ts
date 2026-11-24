import type { NextRequest } from 'next/server';

export const CONEX_COOKIE = 'conex_verified_v2';
export const CHALLENGE_COOKIE = 'conex_challenge_v2';
type Stage = 'math' | 'passcode' | 'verified';
type Proof = { stage: Stage; owner: string; session: string; expires: number; answer?: number };
const encoder = new TextEncoder();

async function key() {
  const secret = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SERVICE_ROLE_KEY;
  if (!secret) throw new Error('Admin session signing unavailable');
  return crypto.subtle.importKey('raw', encoder.encode('datacube-conex-v2:' + secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}
function encode(bytes: Uint8Array) {
  return btoa(String.fromCharCode(...bytes)).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}
function decode(value: string) {
  return Uint8Array.from(atob(value.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(value.length / 4) * 4, '=')), c => c.charCodeAt(0));
}
async function sessionBinding(token: string) {
  // The token has already been validated by Supabase getUser. Use its session ID
  // to survive token refresh; otherwise bind to the exact authenticated token.
  try {
    const claims = JSON.parse(new TextDecoder().decode(decode(token.split('.')[1])));
    if (typeof claims.session_id === 'string' && claims.session_id.length <= 100) return claims.session_id;
  } catch {}
  return encode(new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(token))));
}

export async function signConexProof(owner: string, token: string, stage: Stage, ttl: number, answer?: number) {
  const proof: Proof = { owner, session: await sessionBinding(token), stage, expires: Date.now() + ttl * 1000, answer };
  const payload = encode(encoder.encode(JSON.stringify(proof)));
  const signature = await crypto.subtle.sign('HMAC', await key(), encoder.encode(payload));
  return payload + '.' + encode(new Uint8Array(signature));
}

export async function verifyConexProof(req: NextRequest, owner: string, token: string, stage: Stage): Promise<Proof | null> {
  try {
    const value = req.cookies.get(stage === 'verified' ? CONEX_COOKIE : CHALLENGE_COOKIE)?.value || '';
    if (value.length > 2048) return null;
    const [payload, signature, extra] = value.split('.');
    if (!payload || !signature || extra || !await crypto.subtle.verify('HMAC', await key(), decode(signature), encoder.encode(payload))) return null;
    const proof: Proof = JSON.parse(new TextDecoder().decode(decode(payload)));
    return proof.owner === owner && proof.session === await sessionBinding(token) &&
      proof.stage === stage && Number.isFinite(proof.expires) && proof.expires > Date.now() ? proof : null;
  } catch { return null; }
}
export const conexCookieOptions = { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'strict' as const, path: '/' };
