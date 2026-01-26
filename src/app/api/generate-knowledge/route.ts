import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

// export const runtime = 'edge';

function requiredEnv(key: string): string {
  const value = process.env[key];
  if (!value) throw new Error(`Missing environment variable: ${key}`);
  return value;
}

function createRequestClient(authorization?: string) {
  const url = requiredEnv('NEXT_PUBLIC_SUPABASE_URL');
  const anonKey = requiredEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY');
  return createClient(url, anonKey, {
    global: {
      headers: authorization ? { Authorization: authorization } : {},
    },
  });
}

export async function POST(req: Request) {
  try {
    const authorization = req.headers.get('authorization') ?? undefined;
    const body = await req.json();

    const supabase = createRequestClient(authorization);
    const { data, error } = await supabase.functions.invoke('generate-knowledge', { body });
    if (error) return NextResponse.json({ error: error.message }, { status: 502 });

    return NextResponse.json(data);
  } catch (error: any) {
    console.error('[API /api/generate-knowledge] Error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
