import { NextRequest, NextResponse } from 'next/server';
import { requireUserFromRequest } from '@/app/api/proxy/_supabase-auth';
import { deleteOwnedDocumentNow } from '@/lib/server/retention';

export const runtime = 'nodejs';

function jsonNoStore(body: unknown, init: ResponseInit = {}): NextResponse {
  const headers = new Headers(init.headers);
  headers.set('Cache-Control', 'no-store, private');
  return NextResponse.json(body, { ...init, headers });
}

function safeDeleteFailureMessage(status: number): string {
  if (status === 409) {
    return 'This document cannot be deleted yet because related processing is still active. Please try again shortly.';
  }
  return 'We could not delete this document right now. Please try again shortly.';
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ documentId: string }> },
) {
  const auth = await requireUserFromRequest(req);
  if (!auth.ok) {
    return jsonNoStore(
      { error: 'unauthorized', message: 'unauthorized' },
      { status: 401 },
    );
  }

  const { documentId } = await params;
  const result = await deleteOwnedDocumentNow({
    userId: auth.userId,
    documentId,
  });

  if (!result.ok && result.status === 404) {
    return jsonNoStore(
      {
        ok: true,
        alreadyDeleted: true,
        documentId,
      },
      { status: 200 },
    );
  }

  if (!result.ok) {
    const requestId = req.headers.get('x-request-id')?.trim() || crypto.randomUUID();
    console.error('[document-delete] failed', {
      requestId,
      status: result.status,
      code: result.message,
    });

    return jsonNoStore(
      {
        ok: false,
        error: result.message,
        message: safeDeleteFailureMessage(result.status),
        requestId,
      },
      { status: result.status },
    );
  }

  return jsonNoStore(result, { status: 200 });
}
