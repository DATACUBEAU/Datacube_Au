import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { GenerateExamPredictionsOutputSchema } from '@shared/schemas';

// Use Node.js runtime for better stability with timeouts and broad compatibility
// export const runtime = 'edge'; 

function requiredEnv(key: string): string {
  const value = process.env[key];
  if (!value) throw new Error(`Missing environment variable: ${key}`);
  return value;
}

function createRequestClient(authorization?: string) {
  const url = requiredEnv('NEXT_PUBLIC_SUPABASE_URL');
  const anonKey = requiredEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY');
  return createClient(url, anonKey, {
    global: {
      headers: authorization ? { Authorization: authorization } : {},
    },
  });
}

export async function POST(req: Request) {
  try {
    const authorization = req.headers.get('authorization') ?? undefined;
    const body = await req.json();
    const { pastQuestionsContent, mainTextbookContent } = body;

    const supabase = createRequestClient(authorization);
    const { data, error } = await supabase.functions.invoke('generate-exam-predictions', {
      body: { pastQuestionsContent, mainTextbookContent },
    });
    if (error) throw error;

    const parsed = GenerateExamPredictionsOutputSchema.safeParse(data);
    if (!parsed.success) {
      return NextResponse.json(
        { ok: false, error: 'Invalid predictions payload received from backend.' },
        { status: 502 }
      );
    }
    return NextResponse.json(parsed.data);

  } catch (err: any) {
    console.error('[API /api/predictions] Fatal error:', err);
    return NextResponse.json(
      { ok: false, error: err.message || 'Unexpected server error.' },
      { status: 500 }
    );
  }
}
