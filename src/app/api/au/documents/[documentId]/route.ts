import { NextRequest, NextResponse } from 'next/server';
import { requireUserFromRequest } from '@/app/api/proxy/_supabase-auth';
import { deleteOwnedDocumentNow } from '@/lib/server/retention';

export const runtime = 'nodejs';

function jsonNoStore(body: unknown, init: ResponseInit = {}): NextResponse {
  const headers = new Headers(init.headers);
  headers.set('Cache-Control', 'no-store, private');
  return NextResponse.json(body, { ...init, headers });
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
    return jsonNoStore(
      {
        error: result.message,
        message: result.message,
        details: result.details || null,
      },
      { status: result.status },
    );
  }

  return jsonNoStore(result, { status: 200 });
}
