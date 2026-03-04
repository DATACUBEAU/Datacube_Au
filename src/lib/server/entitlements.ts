import type { SupabaseClient } from '@supabase/supabase-js';
import { getFeatureFlagBoolean } from '@/lib/server/feature-flags';

export const PROMO_PRO_END_LAGOS_ISO = '2026-04-02T00:00:00+01:00';
export const PROMO_PRO_END_UTC_ISO = '2026-04-01T23:00:00.000Z';
const PROMO_PRO_END_MS = new Date(PROMO_PRO_END_UTC_ISO).getTime();

export type ProEntitlementStatus = {
  hasPro: boolean;
  source: 'paid' | 'promo' | 'none';
  endsAt: string | null;
  promoActive: boolean;
  promoEndsAt: string;
};

export class EntitlementError extends Error {
  status: number;
  code: string;
  payload: Record<string, unknown>;

  constructor(status: number, code: string, message: string, payload?: Record<string, unknown>) {
    super(message);
    this.status = status;
    this.code = code;
    this.payload = payload || {};
  }
}

export function isPromoProActive(now = Date.now()): boolean {
  return now < PROMO_PRO_END_MS;
}

export async function isPromoModeActive(
  supabase: SupabaseClient,
  now = Date.now(),
): Promise<boolean> {
  const promoEnabled = await getFeatureFlagBoolean(supabase, 'promo_enabled', false);
  return promoEnabled && isPromoProActive(now);
}

export async function getProEntitlementStatus(
  supabase: SupabaseClient,
  userId: string
): Promise<ProEntitlementStatus> {
  const nowIso = new Date().toISOString();
  const promoActive = await isPromoModeActive(supabase);

  const { data: grants, error } = await supabase
    .from('entitlement_grants')
    .select('id,starts_at,ends_at,status')
    .eq('user_id', userId)
    .eq('entitlement', 'pro')
    .eq('status', 'active')
    .lte('starts_at', nowIso)
    .gte('ends_at', nowIso)
    .order('ends_at', { ascending: false })
    .limit(1);

  if (error) {
    throw error;
  }

  const activeGrant = grants?.[0] ?? null;
  if (activeGrant) {
    return {
      hasPro: true,
      source: 'paid',
      endsAt: String((activeGrant as any).ends_at || null),
      promoActive,
      promoEndsAt: PROMO_PRO_END_LAGOS_ISO,
    };
  }

  if (promoActive) {
    return {
      hasPro: true,
      source: 'promo',
      endsAt: PROMO_PRO_END_UTC_ISO,
      promoActive: true,
      promoEndsAt: PROMO_PRO_END_LAGOS_ISO,
    };
  }

  return {
    hasPro: false,
    source: 'none',
    endsAt: null,
    promoActive: false,
    promoEndsAt: PROMO_PRO_END_LAGOS_ISO,
  };
}

export async function assertProEntitlement(
  supabase: SupabaseClient,
  userId: string
): Promise<ProEntitlementStatus> {
  const status = await getProEntitlementStatus(supabase, userId);
  if (status.hasPro) {
    return status;
  }

  throw new EntitlementError(
    402,
    'UPGRADE_REQUIRED',
    'Pro entitlement required.',
    {
      code: 'UPGRADE_REQUIRED',
      reason: 'pro_entitlement_missing',
      cta: 'Upgrade to Pro to continue.',
      upgradeUrl: '/pricing?source=feature_pro_access',
    }
  );
}
