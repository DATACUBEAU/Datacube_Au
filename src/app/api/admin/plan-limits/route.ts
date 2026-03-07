import { NextRequest, NextResponse } from 'next/server';
import { requireConexAdmin } from '@/app/api/feedback/_auth';
import {
  DEFAULT_PLAN_LIMITS,
  DEFAULT_PLAN_ORDER,
  LIMIT_COLUMN_KEYS,
  loadPlanLimits,
  type CanonicalPlanLimits,
  type EffectivePlanCode,
} from '@/lib/server/au-limits';

export const runtime = 'nodejs';

const UI_TO_DB_KEYS: Record<string, keyof CanonicalPlanLimits> = {
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
  tokens_reset_every_days: 'tokens_reset_every_days',
  chats_reset_every_days: 'chats_reset_every_days',
  uploads_reset_every_days: 'uploads_reset_every_days',
  documents_reset_every_days: 'documents_reset_every_days',
  exams_reset_every_days: 'exams_reset_every_days',
  storage_reset_every_days: 'storage_reset_every_days',
};

function isPlan(value: string): value is EffectivePlanCode {
  return DEFAULT_PLAN_ORDER.includes(value as EffectivePlanCode);
}

function toUiLimits(row: CanonicalPlanLimits): Record<string, number> {
  return {
    max_file_mb: Number(row.max_file_size_mb || 0),
    max_uploads_total: Number(row.max_uploads_total || 0),
    max_docs_total: Number(row.max_documents_total || 0),
    max_chats_total: Number(row.max_chats_total || 0),
    max_exams_total: Number(row.max_exams_total || 0),
    max_tokens_total: Number(row.max_tokens_total || 0),
    max_storage_mb: Number(row.max_storage_mb || 0),
    max_jobs_concurrent: Number(row.max_concurrent_jobs || 0),
    tokens_reset_every_days: Number(row.tokens_reset_every_days || 0),
    chats_reset_every_days: Number(row.chats_reset_every_days || 0),
    uploads_reset_every_days: Number(row.uploads_reset_every_days || 0),
    documents_reset_every_days: Number(row.documents_reset_every_days || 0),
    exams_reset_every_days: Number(row.exams_reset_every_days || 0),
    storage_reset_every_days: Number(row.storage_reset_every_days || 0),
  };
}

function normalizePayload(base: CanonicalPlanLimits, raw: unknown): CanonicalPlanLimits {
  const source = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as Record<string, unknown> : {};
  const next = { ...base };

  for (const [incomingKey, value] of Object.entries(source)) {
    const dbKey = UI_TO_DB_KEYS[incomingKey];
    if (!dbKey) continue;
    const numeric = Number(value);
    if (!Number.isFinite(numeric) || numeric < 0) continue;
    next[dbKey] = Math.floor(numeric);
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

    const dbPlanKeys = (plansData || [])
      .map((row: any) => String(row?.plan || '').trim().toLowerCase())
      .filter((value): value is EffectivePlanCode => isPlan(value));
    const ordered: EffectivePlanCode[] = Array.from(
      new Set<EffectivePlanCode>(dbPlanKeys.length > 0 ? [...DEFAULT_PLAN_ORDER, ...dbPlanKeys] : [...DEFAULT_PLAN_ORDER]),
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

    const defaultLimitsByPlan = ordered.reduce((acc, plan) => {
      acc[plan] = toUiLimits(DEFAULT_PLAN_LIMITS[plan]);
      return acc;
    }, {} as Record<string, Record<string, number>>);

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
        defaultLimitsByPlan,
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
  const action = String((body as any)?.action || 'save').trim().toLowerCase();
  if (!isPlan(plan)) {
    return NextResponse.json(
      { ok: false, code: 'invalid_plan', message: 'Plan must be free, pro, or premium.', requestId },
      { status: 400, headers: { 'Cache-Control': 'no-store' } },
    );
  }

  try {
    const supabase = adminResult.supabase;
    const base = action === 'reset_to_defaults'
      ? { ...DEFAULT_PLAN_LIMITS[plan] }
      : normalizePayload(await loadPlanLimits(supabase, plan), (body as any)?.limits);

    const payload = {
      plan,
      ...Object.fromEntries(LIMIT_COLUMN_KEYS.map((key) => [key, base[key]])),
      updated_at: new Date().toISOString(),
    };

    const { error } = await supabase
      .from('au_plan_limits')
      .upsert(payload, { onConflict: 'plan' });

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
        action,
        limits: toUiLimits(base),
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
