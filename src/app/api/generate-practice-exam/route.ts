import { NextResponse } from 'next/server';

export const runtime = 'nodejs';

export async function POST(req: Request) {
  try {
    const authorization = req.headers.get('authorization') ?? undefined;
    const body = await req.json();
    const proxyUrl = new URL('/api/proxy/exam-generator', req.url);
    const res = await fetch(proxyUrl.toString(), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(authorization ? { Authorization: authorization } : {}),
      },
      body: JSON.stringify(body),
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
    console.error('[API /api/generate-practice-exam] Error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
