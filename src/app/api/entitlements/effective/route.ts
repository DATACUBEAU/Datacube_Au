import { NextRequest, NextResponse } from 'next/server';
import { requireUserFromRequest } from '@/app/api/proxy/_supabase-auth';
import { createSupabaseAdminClient } from '@/lib/server/supabase-admin';
import { getBillingStatus } from '@/lib/server/billing';
import { getFeatureFlagsSnapshot } from '@/lib/server/feature-flags';

export const runtime = 'nodejs';

function isMissingFunctionError(error: any): boolean {
  const code = String(error?.code || '').trim();
  const message = String(error?.message || '').toLowerCase();
  return (
    code === '42883' ||
    (message.includes('function') && message.includes('does not exist')) ||
    (message.includes('schema cache') && message.includes('function'))
  );
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function normalizePlan(raw: unknown): 'free' | 'pro' | 'promo_pro' | 'admin' {
  const value = String(raw || '').trim().toLowerCase();
  if (value === 'admin') return 'admin';
  if (value === 'pro') return 'pro';
  if (value === 'promo_pro') return 'promo_pro';
  return 'free';
}

function buildFromRpcPayload(payload: unknown, userId: string, requestId: string) {
  const row = asRecord(payload);
  return {
    requestId,
    userId: String(row.user_id || userId),
    plan: normalizePlan(row.plan),
    hasPro: Boolean(row.has_pro),
    entitlementSource: (() => {
      const source = String(row.entitlement_source || '').trim().toLowerCase();
      if (source === 'paid') return 'paid';
      if (source === 'promo') return 'promo';
      return 'none';
    })(),
    entitlementEndsAt: typeof row.entitlement_ends_at === 'string' ? row.entitlement_ends_at : null,
    billingEnabled: Boolean(row.billing_enabled),
    promoEnabled: Boolean(row.promo_enabled),
    promoActive: Boolean(row.promo_active),
    canAccessBilling: Boolean(row.can_access_billing),
    promoBannerEnabled: Boolean(row.promo_banner_enabled),
    promoContentConfig: asRecord(row.promo_content_config),
    promoEndsAtUtc: typeof row.promo_ends_at_utc === 'string' ? row.promo_ends_at_utc : null,
    promoEndsAtLagos: typeof row.promo_ends_at_lagos === 'string' ? row.promo_ends_at_lagos : null,
    asOf: typeof row.as_of === 'string' ? row.as_of : new Date().toISOString(),
    source: 'rpc',
  };
}

async function buildFallbackPayload(userId: string, requestId: string) {
  const supabase = createSupabaseAdminClient();
  const billing = await getBillingStatus(supabase, userId);
  const flags = await getFeatureFlagsSnapshot(supabase).catch(() => new Map());
  const promoFlag = flags.get('promo_enabled');
  const promoContent = flags.get('promo_content')?.config || {};
  const source = String((billing as any)?.entitlementSource || '').toLowerCase();
  const tier = String((billing as any)?.tier || '').toLowerCase();
  const promoActive = Boolean((billing as any)?.promo?.active);

  return {
    requestId,
    userId,
    plan: source === 'promo' ? 'promo_pro' : tier === 'pro' ? 'pro' : 'free',
    hasPro: tier === 'pro' || source === 'promo',
    entitlementSource: source === 'paid' ? 'paid' : source === 'promo' ? 'promo' : 'none',
    entitlementEndsAt:
      typeof (billing as any)?.tier_expires_at === 'string' ? (billing as any).tier_expires_at : null,
    billingEnabled: Boolean((billing as any)?.billingEnabled),
    promoEnabled: Boolean(promoFlag?.enabled ?? promoActive),
    promoActive,
    canAccessBilling: Boolean((billing as any)?.canAccessBilling),
    promoBannerEnabled: promoActive,
    promoContentConfig: asRecord(promoContent),
    promoEndsAtUtc:
      typeof (billing as any)?.promo?.ends_at_utc === 'string' ? (billing as any).promo.ends_at_utc : null,
    promoEndsAtLagos:
      typeof (billing as any)?.promo?.ends_at_lagos === 'string' ? (billing as any).promo.ends_at_lagos : null,
    asOf: new Date().toISOString(),
    source: 'billing_status_fallback',
  };
}

export async function GET(req: NextRequest) {
  const requestId = crypto.randomUUID();

  try {
    const auth = await requireUserFromRequest(req);
    if (!auth.ok) {
      return NextResponse.json(
        {
          code: 'unauthorized',
          message: 'Sign in required.',
          requestId,
          details: { reason: auth.reason },
        },
        { status: 401, headers: { 'Cache-Control': 'no-store' } },
      );
    }

    const supabase = createSupabaseAdminClient();
    const { data, error } = await supabase.rpc('get_effective_entitlements', {
      p_user_id: auth.userId,
    });

    if (error) {
      if (!isMissingFunctionError(error)) {
        console.error('[api/entitlements/effective] RPC failed', {
          requestId,
          userId: auth.userId,
          code: error.code,
          message: error.message,
          details: error.details,
        });
        return NextResponse.json(
          {
            code: 'effective_entitlements_rpc_failed',
            message: error.message || 'Failed to compute effective entitlements.',
            requestId,
            details: {
              pgCode: error.code || null,
              pgDetails: error.details || null,
            },
          },
          { status: 500, headers: { 'Cache-Control': 'no-store' } },
        );
      }

      const fallback = await buildFallbackPayload(auth.userId, requestId);
      return NextResponse.json(fallback, {
        status: 200,
        headers: { 'Cache-Control': 'no-store' },
      });
    }

    const payload = buildFromRpcPayload(data, auth.userId, requestId);
    return NextResponse.json(payload, {
      status: 200,
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (error: any) {
    console.error('[api/entitlements/effective] unexpected error', {
      requestId,
      message: String(error?.message || error),
      stack: String(error?.stack || ''),
    });
    return NextResponse.json(
      {
        code: 'internal_server_error',
        message: String(error?.message || 'Unexpected server error.'),
        requestId,
      },
      { status: 500, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}
