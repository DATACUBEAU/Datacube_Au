import { NextRequest, NextResponse } from 'next/server';
import {
  accessControlResponse,
  isAccessControlError,
  requireAdmin,
} from '@/lib/server/authorization';

export async function requireConexAdmin(req: NextRequest) {
  try {
    const authorization = await requireAdmin(req);
    return { ok: true as const, auth: authorization.auth, supabase: authorization.supabase };
  } catch (error) {
    if (isAccessControlError(error)) {
      return {
        ok: false as const,
        response: accessControlResponse(error),
      };
    }
    return {
      ok: false as const,
      response: NextResponse.json(
        { error: 'forbidden', message: 'Conex admin access required.' },
        { status: 403, headers: { 'Cache-Control': 'no-store' } },
      ),
    };
  }
}
