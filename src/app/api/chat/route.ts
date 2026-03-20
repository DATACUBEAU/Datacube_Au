import { NextResponse } from 'next/server';
import { buildApiErrorBody } from '@/lib/api/api-contract';

export const runtime = 'nodejs';

export async function POST(req: Request) {
  try {
    const authorization = req.headers.get('authorization') ?? undefined;
    const cookie = req.headers.get('cookie') ?? undefined;
    const accept = req.headers.get('accept') ?? undefined;
    const rawBody = await req.text();
    if (!rawBody.trim()) {
      return NextResponse.json(
        buildApiErrorBody({
          status: 400,
          code: 'INVALID_REQUEST_PAYLOAD',
          message: 'Invalid request payload.',
          retryable: false,
        }),
        { status: 400 },
      );
    }

    try {
      JSON.parse(rawBody);
    } catch {
      return NextResponse.json(
        buildApiErrorBody({
          status: 400,
          code: 'INVALID_REQUEST_PAYLOAD',
          message: 'Invalid request payload.',
          details: { reason: 'malformed_json' },
          retryable: false,
        }),
        { status: 400 },
      );
    }

    const proxyUrl = new URL('/api/proxy/chat', req.url);
    const res = await fetch(proxyUrl.toString(), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(accept ? { Accept: accept } : {}),
        ...(authorization ? { Authorization: authorization } : {}),
        ...(cookie ? { Cookie: cookie } : {}),
      },
      body: rawBody,
    });

    const text = await res.text();
    let json: any = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = { error: text || 'Unknown error' };
    }

    return NextResponse.json(json, { status: res.status });
  } catch (error: any) {
    console.error('[API /api/chat] Error:', error);
    return NextResponse.json(
      buildApiErrorBody({
        status: 500,
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Unexpected server error.',
        details: String(error?.message || error || 'unknown_error'),
      }),
      { status: 500 },
    );
  }
}
