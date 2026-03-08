import { NextRequest, NextResponse } from 'next/server';
import { requireUserFromRequest } from '@/app/api/proxy/_supabase-auth';
import { createSupabaseAdminClient } from '@/lib/server/supabase-admin';
import { getEffectiveEntitlementsSnapshot } from '@/lib/server/effective-entitlements';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const requestId = crypto.randomUUID();

  try {
    const auth = await requireUserFromRequest(req);
    if (!auth.ok) {
      return NextResponse.json(
        {
          code: 'unauthorized',
          message: 'Sign in required.',
          requestId,
          details: { reason: auth.reason },
        },
        { status: 401, headers: { 'Cache-Control': 'no-store' } },
      );
    }

    const supabase = createSupabaseAdminClient();
    const snapshot = await getEffectiveEntitlementsSnapshot(supabase, auth.userId);
    const payload = {
      requestId,
      ...snapshot,
    };
    return NextResponse.json(payload, {
      status: 200,
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (error: any) {
    if (error?.code || error?.details) {
      console.error('[api/entitlements/effective] entitlement resolution failed', {
        requestId,
        userId: req.headers.get('x-user-id') || null,
        code: error?.code || null,
        message: error?.message || null,
        details: error?.details || null,
      });
    }
    console.error('[api/entitlements/effective] unexpected error', {
      requestId,
      message: String(error?.message || error),
      stack: String(error?.stack || ''),
    });
    return NextResponse.json(
      {
        code: 'internal_server_error',
        message: String(error?.message || 'Unexpected server error.'),
        requestId,
      },
      { status: 500, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}
