import { NextRequest, NextResponse } from 'next/server';
import { requireUserFromRequest } from '@/app/api/proxy/_supabase-auth';
import { getSupabaseUrl, getSupabaseAnonKey } from '@/lib/server/supabase-admin';
import { checkRateLimit } from '@/lib/server/proxy-rate-limiter';
import { exchangePkceTransport } from '@/lib/server/pkce-exchange';
import { isIP } from 'node:net';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const requestId = crypto.randomUUID();
  const auth = await requireUserFromRequest(req);

  if (!auth.ok) {
    return NextResponse.json(
      {
        ok: false,
        code: 'unauthorized',
        requestId,
        reason: auth.reason,
      },
      {
        status: 401,
        headers: { 'Cache-Control': 'no-store' },
      },
    );
  }

  return NextResponse.json(
    {
      ok: true,
      requestId,
      userId: auth.userId,
      source: auth.source,
    },
    {
      status: 200,
      headers: { 'Cache-Control': 'no-store' },
    },
  );
}

/** Transport an existing SDK PKCE exchange through the official website. */
export async function POST(req: NextRequest) {
  const requestId = crypto.randomUUID();
  const forwarded = process.env.VERCEL === '1' ? req.headers.get('x-vercel-forwarded-for')?.trim() : null;
  const ip = forwarded && isIP(forwarded) ? forwarded : 'unknown';
  const host = req.headers.get('host');
  const origin = host ? `${req.nextUrl.protocol}//${host}` : req.nextUrl.origin;
  return exchangePkceTransport(req, {
    origin,
    requestId,
    allow: () => checkRateLimit(`pkce:${ip}`, `pkce:${ip}`).allowed,
    config: () => ({ url: getSupabaseUrl(), anonKey: getSupabaseAnonKey() }),
    upstreamFetch: fetch,
    record: (stage, status, elapsedMs) => console.info('[auth:pkce-transport]', { requestId, stage, status, elapsedMs }),
  });
}
