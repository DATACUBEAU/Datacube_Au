import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireUserFromRequest } from '@/app/api/proxy/_supabase-auth';
import { createSupabaseAdminClient } from '@/lib/server/supabase-admin';

export const runtime = 'nodejs';

const ToneSchema = z.enum(['friendly', 'professional', 'strict']);
const VerbositySchema = z.enum(['short', 'medium', 'deep']);
const AnswerScopeSchema = z.enum(['docs_only', 'docs_preferred', 'general_allowed']);
const SafetySchema = z.enum(['standard', 'strict']);

const PreferenceUpdateSchema = z.object({
  tone: ToneSchema.optional(),
  verbosity: VerbositySchema.optional(),
  citations: z.boolean().optional(),
  answer_scope: AnswerScopeSchema.optional(),
  language: z.string().min(2).max(64).optional(),
  safety: SafetySchema.optional(),
  instructions: z.string().max(2000).optional(),
});

type PreferenceRow = {
  user_id: string;
  tone: z.infer<typeof ToneSchema>;
  verbosity: z.infer<typeof VerbositySchema>;
  citations: boolean;
  answer_scope: z.infer<typeof AnswerScopeSchema>;
  language: string;
  safety: z.infer<typeof SafetySchema>;
  instructions: string | null;
  updated_at: string;
};

const DEFAULT_PREFERENCES = {
  tone: 'friendly',
  verbosity: 'medium',
  citations: true,
  answer_scope: 'general_allowed',
  language: 'english',
  safety: 'standard',
  instructions: '',
} as const;

function normalizePreferences(row: Partial<PreferenceRow> | null | undefined) {
  return {
    tone: ToneSchema.safeParse(row?.tone).success ? row?.tone : DEFAULT_PREFERENCES.tone,
    verbosity: VerbositySchema.safeParse(row?.verbosity).success ? row?.verbosity : DEFAULT_PREFERENCES.verbosity,
    citations: typeof row?.citations === 'boolean' ? row.citations : DEFAULT_PREFERENCES.citations,
    answer_scope: AnswerScopeSchema.safeParse(row?.answer_scope).success
      ? row?.answer_scope
      : DEFAULT_PREFERENCES.answer_scope,
    language: typeof row?.language === 'string' && row.language.trim()
      ? row.language.trim()
      : DEFAULT_PREFERENCES.language,
    safety: SafetySchema.safeParse(row?.safety).success ? row?.safety : DEFAULT_PREFERENCES.safety,
    instructions: typeof row?.instructions === 'string' ? row.instructions : DEFAULT_PREFERENCES.instructions,
    updated_at: typeof row?.updated_at === 'string' ? row.updated_at : new Date().toISOString(),
  };
}

export async function GET(req: NextRequest) {
  const requestId = crypto.randomUUID();
  const auth = await requireUserFromRequest(req);
  if (!auth.ok) {
    return NextResponse.json(
      { error: 'unauthorized', message: 'Sign in required.', requestId, details: { reason: auth.reason } },
      { status: 401, headers: { 'Cache-Control': 'no-store' } },
    );
  }

  try {
    const supabase = createSupabaseAdminClient();
    const { data, error } = await supabase
      .from('au_user_preferences')
      .select('user_id,tone,verbosity,citations,answer_scope,language,safety,instructions,updated_at')
      .eq('user_id', auth.userId)
      .maybeSingle();

    if (error) {
      return NextResponse.json(
        { error: 'preferences_fetch_failed', message: error.message, requestId },
        { status: 500, headers: { 'Cache-Control': 'no-store' } },
      );
    }

    return NextResponse.json(
      {
        ok: true,
        requestId,
        preferences: normalizePreferences((data as Partial<PreferenceRow> | null) ?? null),
      },
      { status: 200, headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error: any) {
    return NextResponse.json(
      { error: 'internal_server_error', message: String(error?.message || error), requestId },
      { status: 500, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}

export async function POST(req: NextRequest) {
  const requestId = crypto.randomUUID();
  const auth = await requireUserFromRequest(req);
  if (!auth.ok) {
    return NextResponse.json(
      { error: 'unauthorized', message: 'Sign in required.', requestId, details: { reason: auth.reason } },
      { status: 401, headers: { 'Cache-Control': 'no-store' } },
    );
  }

  const body = await req.json().catch(() => null);
  const parsed = PreferenceUpdateSchema.safeParse(body ?? {});
  if (!parsed.success) {
    const issues = parsed.error.issues.map((issue) => ({
      path: issue.path.join('.') || 'payload',
      message: issue.message,
      code: issue.code,
    }));
    return NextResponse.json(
      { error: 'invalid_payload', message: 'Invalid preferences payload.', requestId, details: { issues } },
      { status: 400, headers: { 'Cache-Control': 'no-store' } },
    );
  }

  try {
    const supabase = createSupabaseAdminClient();
    const nextRow = {
      user_id: auth.userId,
      ...parsed.data,
      instructions:
        typeof parsed.data.instructions === 'string'
          ? parsed.data.instructions.trim() || null
          : undefined,
    };

    const { data, error } = await supabase
      .from('au_user_preferences')
      .upsert(nextRow, { onConflict: 'user_id' })
      .select('user_id,tone,verbosity,citations,answer_scope,language,safety,instructions,updated_at')
      .maybeSingle();

    if (error) {
      return NextResponse.json(
        { error: 'preferences_save_failed', message: error.message, requestId },
        { status: 500, headers: { 'Cache-Control': 'no-store' } },
      );
    }

    return NextResponse.json(
      {
        ok: true,
        requestId,
        preferences: normalizePreferences((data as Partial<PreferenceRow> | null) ?? nextRow as any),
      },
      { status: 200, headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error: any) {
    return NextResponse.json(
      { error: 'internal_server_error', message: String(error?.message || error), requestId },
      { status: 500, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}

