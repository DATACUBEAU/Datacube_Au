import { NextResponse } from 'next/server';

export const runtime = 'edge';

function requiredEnv(key: string): string {
  const value = process.env[key];
  if (!value) throw new Error(`Missing environment variable: ${key}`);
  return value;
}

function functionsBaseUrl(): string {
  return `${requiredEnv('NEXT_PUBLIC_SUPABASE_URL').replace(/\/$/, '')}/functions/v1`;
}

export async function POST(req: Request) {
  try {
    const authorization = req.headers.get('authorization') ?? undefined;
    const body = await req.json();

    const res = await fetch(`${functionsBaseUrl()}/prediction-engine`, {
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
  } catch (err: any) {
    console.error('[API /api/generate-exam-predictions] Fatal error:', err);
    return NextResponse.json(
      { ok: false, error: err.message || 'Unexpected server error.' },
      { status: 500 },
    );
  }
}

