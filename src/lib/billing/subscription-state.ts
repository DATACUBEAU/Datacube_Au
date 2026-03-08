import {
  formatBillingPlanLabel,
  normalizeBillingEntitlementSource,
  normalizeBillingInterval,
  normalizeBillingManagedPlan,
  normalizeCanonicalBillingPlanKey,
  normalizeEffectiveEntitlementPlan,
  type CanonicalBillingInterval,
  type CanonicalBillingManagedPlan,
  type CanonicalBillingPlanKey,
  type CanonicalEntitlementSource,
  type EffectiveEntitlementPlan,
} from './plans';

const ACTIVE_SUBSCRIPTION_STATUSES = new Set(['active', 'trialing', 'non_renewing']);

export type SubscriptionPlanResolutionSource =
  | 'promo'
  | 'subscription'
  | 'transaction'
  | 'effective_plan'
  | 'legacy_tier'
  | 'free';

export type NormalizedSubscriptionState = {
  managedPlan: CanonicalBillingManagedPlan;
  effectivePlan: EffectiveEntitlementPlan;
  entitlementSource: CanonicalEntitlementSource;
  promoActive: boolean;
  hasPaidEntitlement: boolean;
  hasPromoEntitlement: boolean;
  hasManagedPaidPlan: boolean;
  activePlanKey: CanonicalBillingPlanKey | null;
  activeInterval: CanonicalBillingInterval;
  subscriptionStatus: string | null;
  hasActiveSubscription: boolean;
  resolutionSource: SubscriptionPlanResolutionSource;
  currentPlanLabel: string;
};

export type BillingCheckoutCapability = {
  enabled: boolean;
  gateway?: string | null;
  code?: string | null;
  message?: string | null;
};

export type SubscriptionCardKey = 'free' | 'pro_monthly' | 'pro_weekly';

export type SubscriptionCardState = {
  planKey: SubscriptionCardKey;
  isCurrent: boolean;
  disabled: boolean;
  action: 'current' | 'manage' | 'select' | 'unavailable';
  ctaLabel: string;
  reason: string | null;
};

export function normalizeSubscriptionStatus(raw: unknown): string | null {
  const value = String(raw || '').trim().toLowerCase();
  return value || null;
}

export function isActiveSubscriptionStatus(raw: unknown): boolean {
  const status = normalizeSubscriptionStatus(raw);
  return Boolean(status && ACTIVE_SUBSCRIPTION_STATUSES.has(status));
}

export function deriveNormalizedSubscriptionState(input: {
  effectivePlan?: unknown;
  entitlementSource?: unknown;
  promoActive?: boolean;
  subscriptionPlanKey?: unknown;
  subscriptionStatus?: unknown;
  latestPaymentPlanKey?: unknown;
  legacyTier?: unknown;
}): NormalizedSubscriptionState {
  const effectivePlan = normalizeEffectiveEntitlementPlan(input.effectivePlan);
  const entitlementSource = normalizeBillingEntitlementSource(input.entitlementSource);
  const promoActive = input.promoActive === true || entitlementSource === 'promo';
  const subscriptionStatus = normalizeSubscriptionStatus(input.subscriptionStatus);
  const hasActiveSubscription = isActiveSubscriptionStatus(subscriptionStatus);
  const subscriptionPlanKey = normalizeCanonicalBillingPlanKey(input.subscriptionPlanKey);
  const latestPaymentPlanKey = normalizeCanonicalBillingPlanKey(input.latestPaymentPlanKey);
  const legacyPlanKey = normalizeCanonicalBillingPlanKey(input.legacyTier);

  const managedPlan = (() => {
    if (effectivePlan === 'admin' || effectivePlan === 'premium') return 'premium';
    if (effectivePlan === 'pro' || effectivePlan === 'promo_pro') return 'pro';

    const legacyManagedPlan = normalizeBillingManagedPlan(input.legacyTier);
    return legacyManagedPlan;
  })();

  let activePlanKey: CanonicalBillingPlanKey | null = null;
  let resolutionSource: SubscriptionPlanResolutionSource = 'free';

  if (promoActive) {
    activePlanKey = managedPlan === 'premium' ? 'premium' : 'pro';
    resolutionSource = 'promo';
  } else if (managedPlan === 'premium') {
    activePlanKey = 'premium';
    resolutionSource = effectivePlan === 'premium' || effectivePlan === 'admin' ? 'effective_plan' : 'legacy_tier';
  } else if (hasActiveSubscription && subscriptionPlanKey) {
    activePlanKey = subscriptionPlanKey;
    resolutionSource = 'subscription';
  } else if (latestPaymentPlanKey) {
    activePlanKey = latestPaymentPlanKey;
    resolutionSource = 'transaction';
  } else if (legacyPlanKey && legacyPlanKey !== 'free') {
    activePlanKey = legacyPlanKey;
    resolutionSource = 'legacy_tier';
  } else if (managedPlan === 'pro' || entitlementSource === 'paid') {
    activePlanKey = 'pro';
    resolutionSource = effectivePlan === 'pro' || effectivePlan === 'promo_pro' ? 'effective_plan' : 'legacy_tier';
  } else {
    activePlanKey = 'free';
    resolutionSource = 'free';
  }

  return {
    managedPlan,
    effectivePlan,
    entitlementSource,
    promoActive,
    hasPaidEntitlement: entitlementSource === 'paid',
    hasPromoEntitlement: promoActive,
    hasManagedPaidPlan: managedPlan !== 'free',
    activePlanKey,
    activeInterval: normalizeBillingInterval(activePlanKey),
    subscriptionStatus,
    hasActiveSubscription,
    resolutionSource,
    currentPlanLabel: formatBillingPlanLabel(activePlanKey || (managedPlan === 'premium' ? 'premium' : managedPlan === 'pro' ? 'pro' : 'free')),
  };
}

function isCurrentCardPlan(state: NormalizedSubscriptionState, planKey: SubscriptionCardKey): boolean {
  if (planKey === 'free') {
    return state.managedPlan === 'free' && !state.hasPromoEntitlement;
  }

  return state.hasPaidEntitlement && state.activePlanKey === planKey;
}

function hasGenericManagedProPlan(state: NormalizedSubscriptionState): boolean {
  return state.managedPlan === 'pro' && state.hasPaidEntitlement && state.activePlanKey === 'pro';
}

export function buildSubscriptionCardState(input: {
  planKey: SubscriptionCardKey;
  state: NormalizedSubscriptionState;
  canAccessBilling: boolean;
  checkout: BillingCheckoutCapability;
}): SubscriptionCardState {
  const { planKey, state, canAccessBilling, checkout } = input;

  if (planKey === 'free') {
    const isCurrent = isCurrentCardPlan(state, 'free');
    return {
      planKey,
      isCurrent,
      disabled: true,
      action: 'current',
      ctaLabel: isCurrent ? 'CURRENT PLAN' : 'FREE PLAN',
      reason: null,
    };
  }

  const isCurrent = isCurrentCardPlan(state, planKey);
  if (isCurrent) {
    return {
      planKey,
      isCurrent: true,
      disabled: true,
      action: state.hasActiveSubscription ? 'manage' : 'current',
      ctaLabel: state.hasActiveSubscription ? 'MANAGE PLAN' : 'CURRENT PLAN',
      reason: 'This plan is already active on your account.',
    };
  }

  if (hasGenericManagedProPlan(state)) {
    return {
      planKey,
      isCurrent: false,
      disabled: true,
      action: state.hasActiveSubscription ? 'manage' : 'current',
      ctaLabel: state.hasActiveSubscription ? 'MANAGE PLAN' : 'CURRENT PLAN',
      reason: 'Your active Pro plan is already attached to this account.',
    };
  }

  if (state.managedPlan === 'premium') {
    return {
      planKey,
      isCurrent: false,
      disabled: true,
      action: 'unavailable',
      ctaLabel: 'MANAGE PLAN',
      reason: 'Premium subscriptions are managed separately.',
    };
  }

  if (state.hasPromoEntitlement) {
    return {
      planKey,
      isCurrent: false,
      disabled: true,
      action: 'unavailable',
      ctaLabel: 'PROMO ACTIVE',
      reason: 'Checkout is paused while promo Pro access is active.',
    };
  }

  if (!canAccessBilling) {
    return {
      planKey,
      isCurrent: false,
      disabled: true,
      action: 'unavailable',
      ctaLabel: 'BILLING UNAVAILABLE',
      reason: 'Billing is currently unavailable.',
    };
  }

  if (!checkout.enabled) {
    return {
      planKey,
      isCurrent: false,
      disabled: true,
      action: 'unavailable',
      ctaLabel: 'UNAVAILABLE',
      reason: checkout.message || 'Checkout is temporarily unavailable.',
    };
  }

  return {
    planKey,
    isCurrent: false,
    disabled: false,
    action: 'select',
    ctaLabel: 'SELECT PLAN',
    reason: null,
  };
}

export function canStartCheckoutForPlan(input: {
  planKey: SubscriptionCardKey;
  state: NormalizedSubscriptionState;
  canAccessBilling: boolean;
  checkout: BillingCheckoutCapability;
}): boolean {
  return buildSubscriptionCardState(input).action === 'select';
}

export function resolvePlanStatusLabelFromState(state: NormalizedSubscriptionState): string {
  if (state.effectivePlan === 'admin') return 'Admin';
  if (state.managedPlan === 'premium') return 'Premium';
  if (state.hasPromoEntitlement) return 'Promo Pro';
  if (state.hasPaidEntitlement && state.managedPlan === 'pro') return 'Pro';
  return 'Free';
}
