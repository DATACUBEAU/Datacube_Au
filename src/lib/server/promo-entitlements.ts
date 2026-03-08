import type { SupabaseClient } from '@supabase/supabase-js';
import { getFeatureFlagBoolean } from '@/lib/server/feature-flags';

export const PROMO_PRO_END_LAGOS_ISO = '2026-04-02T00:00:00+01:00';
export const PROMO_PRO_END_UTC_ISO = '2026-04-01T23:00:00.000Z';

const PROMO_PRO_END_MS = new Date(PROMO_PRO_END_UTC_ISO).getTime();

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
