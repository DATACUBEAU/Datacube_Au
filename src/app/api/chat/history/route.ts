import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';

export const runtime = 'edge';

function requiredEnv(key: string): string {
  const value = process.env[key];
  if (!value) return "";
  return value;
}

export async function GET(req: Request) {
    const { searchParams } = new URL(req.url);
    const docId = searchParams.get('docId');
    const authorization = req.headers.get('Authorization');

    if (!docId || !authorization) {
        return NextResponse.json({ error: 'Missing docId or Authorization' }, { status: 400 });
    }

    const supabaseUrl = requiredEnv('NEXT_PUBLIC_SUPABASE_URL');
    const anonKey = requiredEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY');
    const supabase = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authorization } },
    });

    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Find session
    const { data: sessions } = await supabase
        .from('au_sessions')
        .select('id')
        .eq('user_id', user.id)
        .eq('title', docId) // Using docId as the linking key
        .limit(1);

    if (!sessions || sessions.length === 0) {
        return NextResponse.json({ history: [] });
    }

    const sessionId = sessions[0].id;

    // Fetch messages
    const { data: messages } = await supabase
        .from('au_messages')
        .select('id, role, content, created_at, metadata')
        .eq('session_id', sessionId)
        .order('created_at', { ascending: true });

    return NextResponse.json({ history: messages || [] });
}

export async function DELETE(req: Request) {
    const { searchParams } = new URL(req.url);
    const docId = searchParams.get('docId');
    const authorization = req.headers.get('Authorization');

    if (!docId || !authorization) {
        return NextResponse.json({ error: 'Missing docId or Authorization' }, { status: 400 });
    }

    const supabaseUrl = requiredEnv('NEXT_PUBLIC_SUPABASE_URL');
    const anonKey = requiredEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY');
    const supabase = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authorization } },
    });

    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Find session
    const { data: sessions } = await supabase
        .from('au_sessions')
        .select('id')
        .eq('user_id', user.id)
        .eq('title', docId)
        .limit(1);

    if (sessions && sessions.length > 0) {
        const sessionId = sessions[0].id;
        // Delete messages
        await supabase.from('au_messages').delete().eq('session_id', sessionId);
    }

    return NextResponse.json({ success: true });
}
