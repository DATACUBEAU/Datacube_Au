import { NextResponse } from 'next/server';

export const runtime = 'nodejs';

function localOnlyResponse() {
  return NextResponse.json(
    {
      ok: false,
      error: 'DOCUMENTS_ARE_LOCAL',
      code: 'DOCUMENTS_ARE_LOCAL',
      message: 'Cloud document upload and ingestion have been retired. Documents are now stored and processed locally in the AU app.',
    },
    {
      status: 410,
      headers: { 'Cache-Control': 'no-store, private' },
    },
  );
}

export async function POST() {
  return localOnlyResponse();
}

export async function GET() {
  return localOnlyResponse();
}
