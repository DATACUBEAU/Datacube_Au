import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const runtime = 'edge';

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

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const sessionId = searchParams.get('sessionId');
    const authorization = req.headers.get('authorization') ?? undefined;

    if (!sessionId) {
      return NextResponse.json({ error: 'Missing sessionId' }, { status: 400 });
    }

    const supabase = createRequestClient(authorization);

    // RLS will ensure the user can only see their own session's messages
    const { data, error } = await supabase
      .from('au_messages')
      .select('*')
      .eq('session_id', sessionId)
      .order('created_at', { ascending: true });

    if (error) {
      console.error('[API /api/chat/history] Supabase error:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ messages: data });
  } catch (error: any) {
    console.error('[API /api/chat/history] Error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
