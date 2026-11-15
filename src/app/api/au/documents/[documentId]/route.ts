import { NextResponse } from 'next/server';

export const runtime = 'nodejs';

export async function DELETE() {
  return NextResponse.json(
    {
      ok: false,
      error: 'DOCUMENTS_ARE_LOCAL',
      code: 'DOCUMENTS_ARE_LOCAL',
      message: 'Cloud document deletion has been retired. Manage documents in the AU app on the device where they are stored.',
    },
    {
      status: 410,
      headers: { 'Cache-Control': 'no-store, private' },
    },
  );
}
