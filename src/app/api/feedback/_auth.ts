import { NextRequest, NextResponse } from 'next/server';
import {
  accessControlResponse,
  isAccessControlError,
  requireAdmin,
} from '@/lib/server/authorization';

function createSafeRequestId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `req_${Date.now().toString(36)}`;
}

export async function requireConexAdmin(req: NextRequest) {
  const requestId = createSafeRequestId();
  try {
    const authorization = await requireAdmin(req);
    return { ok: true as const, auth: authorization.auth, supabase: authorization.supabase };
  } catch (error) {
    if (isAccessControlError(error)) {
      return {
        ok: false as const,
        response: accessControlResponse(error, requestId),
      };
    }
    return {
      ok: false as const,
      response: NextResponse.json(
        { error: 'forbidden', message: 'Conex admin access required.', requestId },
        { status: 403, headers: { 'Cache-Control': 'no-store' } },
      ),
    };
  }
}
