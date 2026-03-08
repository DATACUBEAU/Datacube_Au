import type { SupabaseClient } from '@supabase/supabase-js';
import { getEffectiveEntitlementsSnapshot } from '@/lib/server/effective-entitlements';
import {
  PROMO_PRO_END_LAGOS_ISO,
  PROMO_PRO_END_UTC_ISO,
  isPromoModeActive,
  isPromoProActive,
} from '@/lib/server/promo-entitlements';

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

export async function getProEntitlementStatus(
  supabase: SupabaseClient,
  userId: string
): Promise<ProEntitlementStatus> {
  const snapshot = await getEffectiveEntitlementsSnapshot(supabase, userId);
  return {
    hasPro: snapshot.hasPro,
    source: snapshot.entitlementSource,
    endsAt: snapshot.entitlementEndsAt,
    promoActive: snapshot.promoActive,
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
