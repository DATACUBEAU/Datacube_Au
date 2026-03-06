import { NextRequest, NextResponse } from 'next/server';
import { requireConexAdmin } from '@/app/api/feedback/_auth';
import {
  DEFAULT_PLAN_LIMITS,
  LIMIT_COLUMN_KEYS,
  loadPlanLimits,
  type EffectivePlanCode,
} from '@/lib/server/au-limits';

export const runtime = 'nodejs';

const UI_TO_DB_KEYS: Record<string, (typeof LIMIT_COLUMN_KEYS)[number]> = {
  max_file_mb: 'max_file_size_mb',
  max_file_size_mb: 'max_file_size_mb',
  max_uploads_total: 'max_uploads_total',
  max_docs_total: 'max_documents_total',
  max_documents_total: 'max_documents_total',
  max_chats_total: 'max_chats_total',
  max_exams_total: 'max_exams_total',
  max_tokens_total: 'max_tokens_total',
  max_storage_mb: 'max_storage_mb',
  max_jobs_concurrent: 'max_concurrent_jobs',
  max_concurrent_jobs: 'max_concurrent_jobs',
};

function isPlan(value: string): value is EffectivePlanCode {
  return value === 'free' || value === 'pro';
}

function toUiLimits(row: Record<string, number>): Record<string, number> {
  return {
    max_file_mb: Number(row.max_file_size_mb || 0),
    max_uploads_total: Number(row.max_uploads_total || 0),
    max_docs_total: Number(row.max_documents_total || 0),
    max_chats_total: Number(row.max_chats_total || 0),
    max_exams_total: Number(row.max_exams_total || 0),
    max_tokens_total: Number(row.max_tokens_total || 0),
    max_storage_mb: Number(row.max_storage_mb || 0),
    max_jobs_concurrent: Number(row.max_concurrent_jobs || 0),
  };
}

function normalizePayload(plan: EffectivePlanCode, raw: unknown) {
  const source = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as Record<string, unknown> : {};
  const defaults = DEFAULT_PLAN_LIMITS[plan];
  const next = { ...defaults };

  for (const [incomingKey, value] of Object.entries(source)) {
    const dbKey = UI_TO_DB_KEYS[incomingKey];
    if (!dbKey) continue;
    const numeric = Number(value);
    if (!Number.isFinite(numeric) || numeric < 0) continue;
    next[dbKey] = Math.floor(numeric) as never;
  }

  return next;
}

export async function GET(req: NextRequest) {
  const requestId = crypto.randomUUID();
  const adminResult = await requireConexAdmin(req);
  if (!adminResult.ok) return adminResult.response;

  try {
    const supabase = adminResult.supabase;
    const { data: plansData, error: plansError } = await supabase
      .from('au_plans')
      .select('plan,is_default')
      .order('is_default', { ascending: false })
      .order('plan', { ascending: true });

    if (plansError) {
      return NextResponse.json(
        { ok: false, code: 'plan_limits_fetch_failed', message: plansError.message, requestId },
        { status: 500, headers: { 'Cache-Control': 'no-store' } },
      );
    }

    const planKeys = (plansData || [])
      .map((row: any) => String(row?.plan || '').trim().toLowerCase())
      .filter((value): value is EffectivePlanCode => isPlan(value));
    const ordered: EffectivePlanCode[] = Array.from(
      new Set<EffectivePlanCode>(planKeys.length > 0 ? planKeys : ['free', 'pro']),
    );

    const rows = await Promise.all(
      ordered.map(async (plan) => {
        const limits = await loadPlanLimits(supabase, plan);
        return {
          plan,
          limits: toUiLimits(limits),
        };
      }),
    );

    const limitsByPlan = rows.reduce((acc, row) => {
      acc[row.plan] = row.limits;
      return acc;
    }, {} as Record<string, Record<string, number>>);

    return NextResponse.json(
      {
        ok: true,
        requestId,
        planLimits: rows,
        limitsByPlan,
        planKeys: ordered,
      },
      { status: 200, headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error: any) {
    return NextResponse.json(
      { ok: false, code: 'internal_server_error', message: String(error?.message || error), requestId },
      { status: 500, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}

export async function POST(req: NextRequest) {
  const requestId = crypto.randomUUID();
  const adminResult = await requireConexAdmin(req);
  if (!adminResult.ok) return adminResult.response;

  const body = await req.json().catch(() => ({}));
  const plan = String((body as any)?.plan || '').trim().toLowerCase();
  if (!isPlan(plan)) {
    return NextResponse.json(
      { ok: false, code: 'invalid_plan', message: 'Plan must be free or pro.', requestId },
      { status: 400, headers: { 'Cache-Control': 'no-store' } },
    );
  }

  try {
    const supabase = adminResult.supabase;
    const normalized = normalizePayload(plan, (body as any)?.limits);

    const { error } = await supabase
      .from('au_plan_limits')
      .upsert(
        {
          plan,
          ...normalized,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'plan' },
      );

    if (error) {
      return NextResponse.json(
        { ok: false, code: 'plan_limits_save_failed', message: error.message, requestId },
        { status: 500, headers: { 'Cache-Control': 'no-store' } },
      );
    }

    return NextResponse.json(
      {
        ok: true,
        requestId,
        plan,
        limits: toUiLimits(normalized),
      },
      { status: 200, headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error: any) {
    return NextResponse.json(
      { ok: false, code: 'internal_server_error', message: String(error?.message || error), requestId },
      { status: 500, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}
