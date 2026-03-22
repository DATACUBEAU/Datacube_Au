type AccountSnapshotLike = {
  entitlements?: {
    billingEnabled?: boolean | null;
    promoEnabled?: boolean | null;
  } | null;
} | null;

export function buildSnapshotFallbackFlags(snapshot: AccountSnapshotLike): Record<string, boolean> {
  const billingEnabled = snapshot?.entitlements?.billingEnabled === true;
  const promoEnabled = snapshot?.entitlements?.promoEnabled === true;

  return {
    billing_enabled: billingEnabled,
    paid_mode_enabled: billingEnabled,
    promo_enabled: promoEnabled,
  };
}
