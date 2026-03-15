import { NextRequest, NextResponse } from 'next/server';
import { requireUserFromRequest } from '@/app/api/proxy/_supabase-auth';
import { deleteOwnedDocumentNow } from '@/lib/server/retention';

export const runtime = 'nodejs';

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ documentId: string }> },
) {
  const auth = await requireUserFromRequest(req);
  if (!auth.ok) {
    return NextResponse.json(
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
    return NextResponse.json(
      {
        ok: true,
        alreadyDeleted: true,
        documentId,
      },
      { status: 200 },
    );
  }

  if (!result.ok) {
    return NextResponse.json(
      {
        error: result.message,
        message: result.message,
        details: result.details || null,
      },
      { status: result.status },
    );
  }

  return NextResponse.json(result, { status: 200 });
}
