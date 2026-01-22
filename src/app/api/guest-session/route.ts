import { NextResponse } from 'next/server';

export async function POST() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/$/, '');
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    return NextResponse.json({ error: 'Missing Supabase env.' }, { status: 500 });
  }

  try {
    const resp = await fetch(`${url}/functions/v1/guest-session`, {
      method: 'POST',
      headers: {
        apikey: anonKey,
        Authorization: `Bearer ${anonKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({}),
      cache: 'no-store',
    });

    const text = await resp.text();
    let json: any = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = { error: text || 'Unexpected response.' };
    }

    return NextResponse.json(json, { status: resp.status });
  } catch {
    return NextResponse.json({ error: 'Guest system is temporarily unavailable.' }, { status: 503 });
  }
}
