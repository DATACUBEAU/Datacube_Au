import { NextRequest, NextResponse } from 'next/server';
import { requireConexAdmin } from '@/app/api/feedback/_auth';
import {
  DEFAULT_PLAN_METADATA,
  DEFAULT_PLAN_ORDER,
  loadPlanMetadata,
  type EffectivePlanCode,
  type PlanMetadata,
} from '@/lib/server/au-limits';

export const runtime = 'nodejs';

function isPlan(value: string): value is EffectivePlanCode {
  return DEFAULT_PLAN_ORDER.includes(value as EffectivePlanCode);
}

function normalizeFeatureBullets(value: unknown, fallback: string[]): string[] {
  if (Array.isArray(value)) {
    const items = value
      .map((entry) => String(entry ?? '').trim())
      .filter(Boolean);
    return items.length > 0 ? items : [...fallback];
  }

  const text = String(value ?? '').trim();
  if (!text) return [...fallback];
  const items = text
    .split(/\r?\n/)
    .map((entry) => entry.trim())
    .filter(Boolean);
  return items.length > 0 ? items : [...fallback];
}

function normalizeMetadata(plan: EffectivePlanCode, raw: unknown): PlanMetadata {
  const source = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as Record<string, unknown> : {};
  const defaults = DEFAULT_PLAN_METADATA[plan];

  const asInt = (value: unknown, fallback: number | null) => {
    if (value === null || value === undefined || value === '') return fallback;
    const numeric = Number(value);
    if (!Number.isFinite(numeric) || numeric < 0) return fallback;
    return Math.floor(numeric);
  };

  const asText = (value: unknown, fallback: string) => {
    const next = String(value ?? '').trim();
    return next || fallback;
  };

  return {
    label: asText(source.label, defaults.label),
    description: asText(source.description, defaults.description),
    price_display: asText(source.price_display ?? source.priceDisplay, defaults.price_display),
    monthly_amount_ngn: asInt(source.monthly_amount_ngn ?? source.monthlyAmountNgn, defaults.monthly_amount_ngn),
    monthly_compare_at_ngn: asInt(source.monthly_compare_at_ngn ?? source.monthlyCompareAtNgn, defaults.monthly_compare_at_ngn),
    monthly_badge: asText(source.monthly_badge ?? source.monthlyBadge, defaults.monthly_badge),
    weekly_amount_ngn: asInt(source.weekly_amount_ngn ?? source.weeklyAmountNgn, defaults.weekly_amount_ngn),
    weekly_compare_at_ngn: asInt(source.weekly_compare_at_ngn ?? source.weeklyCompareAtNgn, defaults.weekly_compare_at_ngn),
    weekly_badge: asText(source.weekly_badge ?? source.weeklyBadge, defaults.weekly_badge),
    feature_bullets: normalizeFeatureBullets(source.feature_bullets ?? source.featureBullets, defaults.feature_bullets),
    cta_label: asText(source.cta_label ?? source.ctaLabel, defaults.cta_label),
    cta_href: asText(source.cta_href ?? source.ctaHref, defaults.cta_href),
    sort_order: asInt(source.sort_order ?? source.sortOrder, defaults.sort_order) ?? defaults.sort_order,
    retention_days: asInt(source.retention_days ?? source.retentionDays, defaults.retention_days) ?? defaults.retention_days,
    expiration_days: asInt(source.expiration_days ?? source.expirationDays, defaults.expiration_days) ?? defaults.expiration_days,
  };
}

export async function GET(req: NextRequest) {
  const requestId = crypto.randomUUID();
  const adminResult = await requireConexAdmin(req);
  if (!adminResult.ok) return adminResult.response;

  try {
    const rows = await Promise.all(
      DEFAULT_PLAN_ORDER.map(async (plan) => ({
        plan,
        metadata: await loadPlanMetadata(adminResult.supabase, plan),
      })),
    );

    return NextResponse.json(
      {
        ok: true,
        requestId,
        planMetadata: rows,
        metadataByPlan: rows.reduce((acc, row) => {
          acc[row.plan] = row.metadata;
          return acc;
        }, {} as Record<string, PlanMetadata>),
        planKeys: [...DEFAULT_PLAN_ORDER],
      },
      { status: 200, headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error: any) {
    return NextResponse.json(
      { ok: false, code: 'plan_metadata_fetch_failed', message: String(error?.message || error), requestId },
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
    const metadata = action === 'reset_to_defaults'
      ? { ...DEFAULT_PLAN_METADATA[plan] }
      : normalizeMetadata(plan, (body as any)?.metadata);

    const { error } = await supabase
      .from('au_plan_metadata')
      .upsert(
        {
          plan,
          ...metadata,
          feature_bullets: metadata.feature_bullets,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'plan' },
      );

    if (error) {
      return NextResponse.json(
        { ok: false, code: 'plan_metadata_save_failed', message: error.message, requestId },
        { status: 500, headers: { 'Cache-Control': 'no-store' } },
      );
    }

    return NextResponse.json(
      {
        ok: true,
        requestId,
        action,
        plan,
        metadata,
      },
      { status: 200, headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error: any) {
    return NextResponse.json(
      { ok: false, code: 'plan_metadata_save_failed', message: String(error?.message || error), requestId },
      { status: 500, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}
