import { NextRequest, NextResponse } from 'next/server';
import { buildApiErrorBody } from '@/lib/api/api-contract';
import { requireUserFromRequest } from '@/app/api/proxy/_supabase-auth';
import { createSupabaseRlsClient } from '@/lib/server/supabase-admin';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const requestId = crypto.randomUUID();

  try {
    const { searchParams } = new URL(req.url);
    const sessionId = searchParams.get('sessionId');

    if (!sessionId) {
      return NextResponse.json(
        buildApiErrorBody({
          status: 400,
          code: 'INVALID_REQUEST_PAYLOAD',
          message: 'Missing sessionId.',
          requestId,
          retryable: false,
        }),
        {
          status: 400,
          headers: { 'Cache-Control': 'no-store' },
        },
      );
    }

    const auth = await requireUserFromRequest(req);
    if (!auth.ok) {
      return NextResponse.json(
        buildApiErrorBody({
          status: 401,
          code: 'UNAUTHORIZED',
          message: 'Sign in required.',
          details: { reason: auth.reason },
          requestId,
          retryable: false,
        }),
        {
          status: 401,
          headers: { 'Cache-Control': 'no-store' },
        },
      );
    }

    const supabase = createSupabaseRlsClient(auth.accessToken);
    const { data, error } = await supabase
      .from('au_messages')
      .select('*')
      .eq('session_id', sessionId)
      .order('created_at', { ascending: true });

    if (error) {
      console.error('[API /api/chat/history] Supabase error:', error);
      const status = error.code === '42501' ? 403 : 500;
      return NextResponse.json(
        buildApiErrorBody({
          status,
          code: status === 403 ? 'FORBIDDEN' : 'CHAT_HISTORY_QUERY_FAILED',
          message: status === 403 ? 'You do not have access to this chat history.' : 'Failed to load chat history.',
          details: {
            supabaseCode: error.code ?? null,
            hint: error.hint ?? null,
          },
          requestId,
          retryable: status >= 500,
        }),
        {
          status,
          headers: { 'Cache-Control': 'no-store' },
        },
      );
    }

    return NextResponse.json(
      {
        ok: true,
        requestId,
        messages: data ?? [],
      },
      {
        status: 200,
        headers: { 'Cache-Control': 'no-store' },
      },
    );
  } catch (error: any) {
    console.error('[API /api/chat/history] Error:', error);
    return NextResponse.json(
      buildApiErrorBody({
        status: 500,
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Unexpected server error.',
        details: String(error?.message || error || 'unknown_error'),
        requestId,
      }),
      {
        status: 500,
        headers: { 'Cache-Control': 'no-store' },
      },
    );
  }
}
