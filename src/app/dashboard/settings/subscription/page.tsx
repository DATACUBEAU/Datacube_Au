'use client';

import { useEffect, useState, useRef, useCallback, useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { CheckCircle2, Loader2, AlertTriangle, ShieldCheck, Lock, Check, Clock, Banknote } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { useSupabaseUser } from '@/hooks/use-supabase-auth';
import { useSearchParams, useRouter } from 'next/navigation';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { OfflineGuard } from '@/components/offline-guard';
import { safeFetch } from '@/lib/api/safe-fetch';
import {
  buildSubscriptionCardState,
  canStartCheckoutForPlan,
  deriveNormalizedSubscriptionState,
  type BillingCheckoutCapability,
  type NormalizedSubscriptionState,
  type SubscriptionCardKey,
} from '@/lib/billing/subscription-state';
import { extractBillingReturnState, type BillingReturnState } from '@/lib/billing/payment-return';
import { readUserCache, writeUserCache } from '@/lib/cache/user-cache';
import { useDelayedLoadingState } from '@/hooks/use-delayed-loading-state';
import { BillingPageSkeleton, SlowNetworkNotice } from '@/components/skeletons/page-skeletons';
import { useLimits } from '@/components/providers/limits-provider';
import { useFeatureFlags } from '@/components/feature-flag-provider';
import { useAccountSnapshot } from '@/components/providers/account-snapshot-provider';
import type {
  AccountPlanSnapshot,
  PersistedCanonicalAccountSnapshot,
} from '@/lib/account/account-snapshot-cache';
import {
  buildPromoCopy,
  formatPromoEndsAtLabel,
  normalizePromoContentConfig,
} from '@/lib/conex/promo-content';
import {
  FREE_PLAN_EXPIRATION_DAYS,
  PAID_PRO_PLAN_EXPIRATION_DAYS,
  formatExpirationWindowLabel,
  resolvePlanExpirationDays,
} from '@/lib/plans/subscription-policy';
import {
  shouldApplyBillingStatusResponse,
} from '@/lib/billing/plan-refresh-state';
import {
  buildSubscriptionBootstrapKey,
  buildSubscriptionUsageRows,
  hasMeaningfulSubscriptionUsageData,
} from '@/lib/billing/subscription-page-state';
import { useConnectivityStatus } from '@/hooks/use-online-status';

const EMPTY_PRICING = {
  weekly: { amount: 0, compare_at: 0, label: '' },
  monthly: { amount: 0, compare_at: 0, label: '' },
} as const;

const EMPTY_CURRENT_PLAN = deriveNormalizedSubscriptionState({});
const EMPTY_CHECKOUT: BillingCheckoutCapability = {
  enabled: false,
  gateway: null,
  code: 'billing_loading',
  message: null,
};

const BILLING_ROUTE = '/dashboard/settings/subscription';
const BILLING_STATUS_SOURCE = 'billing-status';
const BILLING_CACHE_SCHEMA = 1;
const BILLING_CACHE_TTL_MS = 1000 * 60 * 30;

function makeBillingIdempotencyKey(prefix: string, seed?: string): string {
  const rawSeed =
    (seed && seed.trim()) ||
    (typeof globalThis.crypto?.randomUUID === 'function'
      ? globalThis.crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`);
  const cleaned = rawSeed.replace(/[^A-Za-z0-9._:-]/g, '-').slice(0, 96);
  return `${prefix}:${cleaned}`;
}

function withLeadingFeature(feature: string, features: string[]): string[] {
  return Array.from(new Set([feature, ...features.filter(Boolean)]));
}

type PlanCatalogEntry = {
  plan: string;
  metadata: {
    label: string;
    description: string;
    price_display: string;
    feature_bullets: string[];
    retention_days: number;
    expiration_days: number;
  };
  pricing: {
    monthly: { amount: number; compare_at: number | null; label: string; plan_key: string | null } | null;
    weekly: { amount: number; compare_at: number | null; label: string; plan_key: string | null } | null;
  };
};

type BillingPageSubscriptionSummary = {
  plan_key: string | null;
  status: string | null;
  starts_at: string | null;
  ends_at: string | null;
  cancel_at_period_end: boolean;
  updated_at: string | null;
} | null;

type BillingPageSnapshotSeed = {
  hasSnapshot: boolean;
  tier: string | null;
  expiry: string | null;
  subscription: BillingPageSubscriptionSummary;
  billingEnabled: boolean;
  canAccessBilling: boolean;
  entitlementSource: 'paid' | 'promo' | 'none';
  promoActive: boolean;
  promoEndsAtLabel: string;
  currentPlan: NormalizedSubscriptionState;
  planSnapshot: Pick<AccountPlanSnapshot, 'checksum' | 'issuedAt' | 'managedPlan'> | null;
};

function formatLagosDateLabel(value: string | null | undefined): string {
  if (typeof value !== 'string' || !value.trim()) return '';
  return new Date(value).toLocaleString('en-US', {
    timeZone: 'Africa/Lagos',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function buildBillingPageSnapshotSeed(
  snapshot: PersistedCanonicalAccountSnapshot | null,
): BillingPageSnapshotSeed {
  if (!snapshot) {
    return {
      hasSnapshot: false,
      tier: null,
      expiry: null,
      subscription: null,
      billingEnabled: false,
      canAccessBilling: false,
      entitlementSource: 'none',
      promoActive: false,
      promoEndsAtLabel: '',
      currentPlan: EMPTY_CURRENT_PLAN,
      planSnapshot: null,
    };
  }

  return {
    hasSnapshot: true,
    tier: snapshot.currentPlan.managedPlan || snapshot.plan || null,
    expiry: snapshot.entitlements.entitlementEndsAt ?? null,
    subscription: snapshot.subscription
      ? {
          plan_key: snapshot.subscription.planKey,
          status: snapshot.subscription.status,
          starts_at: snapshot.subscription.startsAt,
          ends_at: snapshot.subscription.endsAt,
          cancel_at_period_end: snapshot.subscription.cancelAtPeriodEnd,
          updated_at: snapshot.subscription.updatedAt,
        }
      : null,
    billingEnabled: snapshot.entitlements.billingEnabled,
    canAccessBilling: snapshot.entitlements.canAccessBilling,
    entitlementSource: snapshot.entitlements.entitlementSource,
    promoActive: snapshot.entitlements.promoActive,
    promoEndsAtLabel: formatLagosDateLabel(snapshot.entitlements.promoEndsAtLagos),
    currentPlan: snapshot.currentPlan,
    planSnapshot: snapshot.planSnapshot,
  };
}

export default function SubscriptionPage() {
  const [user, session, isUserLoading] = useSupabaseUser();
  const { toast } = useToast();
  const searchParams = useSearchParams();
  const searchParamsKey = searchParams.toString();
  const router = useRouter();
  const { isOnline, isDegraded, canPerformNetworkMutations, networkState } = useConnectivityStatus();
  const { usage: limitsUsage, refreshUsage } = useLimits();
  const { records: featureFlagRecords } = useFeatureFlags();
  const {
    snapshot: accountSnapshot,
    isUsingCachedData: isUsingCachedAccountSnapshot,
    cachedAt: accountSnapshotCachedAt,
  } = useAccountSnapshot();
  const paymentReturnState = useMemo(
    () => extractBillingReturnState(new URLSearchParams(searchParamsKey)),
    [searchParamsKey],
  );
  const initialSnapshotSeed = useMemo(
    () => buildBillingPageSnapshotSeed(accountSnapshot),
    [accountSnapshot],
  );
  
  const [tier, setTier] = useState<string | null>(initialSnapshotSeed.tier);
  const [expiry, setExpiry] = useState<string | null>(initialSnapshotSeed.expiry);
  const [subscription, setSubscription] = useState<any>(initialSnapshotSeed.subscription);
  const [payments, setPayments] = useState<any[]>([]);
  
  // Toggle: true = Auto-renew (Card), false = Manual (Bank Transfer)
  const [isAutoRenew, setIsAutoRenew] = useState(true);

  // Loading states
  const [loadingPlan, setLoadingPlan] = useState<string | null>(null); // 'weekly', 'monthly'
  const [isCancelling, setIsCancelling] = useState(false);
  const [isResubscribing, setIsResubscribing] = useState(false);
  const [cancelReason, setCancelReason] = useState('');
  const [isCancelDialogOpen, setIsCancelDialogOpen] = useState(false);
  const [billingEnabled, setBillingEnabled] = useState(initialSnapshotSeed.billingEnabled);
  const [canAccessBilling, setCanAccessBilling] = useState(initialSnapshotSeed.canAccessBilling);
  const [showBankTransfer, setShowBankTransfer] = useState(false);
  const [manualPlan, setManualPlan] = useState<'weekly' | 'monthly'>('monthly');
  const [promoActive, setPromoActive] = useState(initialSnapshotSeed.promoActive);
  const [promoEndsAtLabel, setPromoEndsAtLabel] = useState(initialSnapshotSeed.promoEndsAtLabel);
  const [entitlementSource, setEntitlementSource] = useState<'paid' | 'promo' | 'none'>(initialSnapshotSeed.entitlementSource);
  
  const [paymentState, setPaymentState] = useState<'idle' | 'redirecting' | 'confirming' | 'success' | 'pending' | 'error'>('idle');
  const [pollCount, setPollCount] = useState(0);
  const pollTimerRef = useRef<NodeJS.Timeout | null>(null);
  const [isInitialLoading, setIsInitialLoading] = useState(!initialSnapshotSeed.hasSnapshot);
  const [isUsingCachedData, setIsUsingCachedData] = useState(Boolean(initialSnapshotSeed.hasSnapshot && isUsingCachedAccountSnapshot));
  const [cachedAt, setCachedAt] = useState<number | null>(initialSnapshotSeed.hasSnapshot ? accountSnapshotCachedAt : null);
  const [isRefreshingUsage, setIsRefreshingUsage] = useState(false);
  const [usageError, setUsageError] = useState<string | null>(null);
  const [planCatalog, setPlanCatalog] = useState<PlanCatalogEntry[]>([]);
  const [planSnapshot, setPlanSnapshot] = useState<BillingPageSnapshotSeed['planSnapshot']>(initialSnapshotSeed.planSnapshot);
  const billingRequestTokenRef = useRef<string | null>(null);
  const statusRequestIdRef = useRef(0);
  const latestAppliedStatusIssuedAtRef = useRef<string | null>(null);
  const bootstrapKeyRef = useRef<string | null>(null);
  const usageRefreshAttemptRef = useRef<string | null>(null);

  const [pricing, setPricing] = useState<{
    weekly: { amount: number; compare_at: number; label: string };
    monthly: { amount: number; compare_at: number; label: string };
  }>(EMPTY_PRICING);
  const [currentPlan, setCurrentPlan] = useState<NormalizedSubscriptionState>(initialSnapshotSeed.currentPlan);
  const [checkoutCapability, setCheckoutCapability] = useState<BillingCheckoutCapability>({
    ...EMPTY_CHECKOUT,
    enabled: initialSnapshotSeed.canAccessBilling,
  });
  const supportedCheckoutPaymentMethods =
    Array.isArray(checkoutCapability.supportedPaymentMethods) && checkoutCapability.supportedPaymentMethods.length > 0
      ? checkoutCapability.supportedPaymentMethods
      : (['subscription', 'transfer'] as const);
  const supportsSubscriptionCheckout = supportedCheckoutPaymentMethods.includes('subscription');
  const supportsTransferCheckout = supportedCheckoutPaymentMethods.includes('transfer');
  const defaultCheckoutPaymentMethod =
    checkoutCapability.defaultPaymentMethod ||
    (supportsSubscriptionCheckout ? 'subscription' : 'transfer');
  const isPromoUnlocked = promoActive;
  const hasPaidProAccess = currentPlan.managedPlan === 'pro' && currentPlan.hasPaidEntitlement;
  const hasPremiumAccess = currentPlan.managedPlan === 'premium' && currentPlan.hasPaidEntitlement;
  const promoContent = useMemo(
    () => normalizePromoContentConfig(featureFlagRecords.promo_content?.config || {}),
    [featureFlagRecords],
  );
  const hasPromoContentOverride = useMemo(() => {
    const config = featureFlagRecords.promo_content?.config;
    return Boolean(config && typeof config === 'object' && Object.keys(config as Record<string, unknown>).length > 0);
  }, [featureFlagRecords]);
  const promoDisplayEndsAtLabel = useMemo(() => {
    if (hasPromoContentOverride) {
      return formatPromoEndsAtLabel(promoContent.promoEndsAtLagosIso);
    }
    if (promoEndsAtLabel.trim()) return promoEndsAtLabel;
    return formatPromoEndsAtLabel(promoContent.promoEndsAtLagosIso);
  }, [hasPromoContentOverride, promoContent.promoEndsAtLagosIso, promoEndsAtLabel]);
  const promoCopy = useMemo(
    () => buildPromoCopy(promoContent, promoDisplayEndsAtLabel),
    [promoContent, promoDisplayEndsAtLabel],
  );
  const catalogByPlan = useMemo(
    () => Object.fromEntries(planCatalog.map((entry) => [entry.plan, entry])),
    [planCatalog],
  );
  const freePlanCatalog = catalogByPlan.free || null;
  const proPlanCatalog = catalogByPlan.pro || null;
  const premiumPlanCatalog = catalogByPlan.premium || null;
  const currentPaidPlanCatalog = currentPlan.managedPlan === 'premium' ? premiumPlanCatalog : proPlanCatalog;
  const freeExpirationDays = Number(freePlanCatalog?.metadata?.expiration_days || FREE_PLAN_EXPIRATION_DAYS);
  const catalogProExpirationDays = Number(proPlanCatalog?.metadata?.expiration_days || 0);
  const proExpirationDays = Number.isFinite(catalogProExpirationDays)
      ? Math.max(PAID_PRO_PLAN_EXPIRATION_DAYS, catalogProExpirationDays)
      : PAID_PRO_PLAN_EXPIRATION_DAYS;
  const freeRetentionLabel = `Document expiration: ${formatExpirationWindowLabel(freeExpirationDays)}`;
  const proRetentionLabel = `Document expiration: ${formatExpirationWindowLabel(proExpirationDays)}`;
  const currentExpirationDays = resolvePlanExpirationDays({
    plan: tier,
    entitlementSource,
  });
  const checkoutNotice = checkoutCapability.enabled ? null : checkoutCapability.message || null;
  const freeCardState = useMemo(
    () => buildSubscriptionCardState({
      planKey: 'free',
      state: currentPlan,
      canAccessBilling,
      checkout: checkoutCapability,
    }),
    [canAccessBilling, checkoutCapability, currentPlan],
  );
  const monthlyCardState = useMemo(
    () => buildSubscriptionCardState({
      planKey: 'pro_monthly',
      state: currentPlan,
      canAccessBilling,
      checkout: checkoutCapability,
    }),
    [canAccessBilling, checkoutCapability, currentPlan],
  );
  const weeklyCardState = useMemo(
    () => buildSubscriptionCardState({
      planKey: 'pro_weekly',
      state: currentPlan,
      canAccessBilling,
      checkout: checkoutCapability,
    }),
    [canAccessBilling, checkoutCapability, currentPlan],
  );
  const bootstrapKey = useMemo(
    () => buildSubscriptionBootstrapKey(user?.id ?? null, paymentReturnState),
    [paymentReturnState, user?.id],
  );
  const usageHasMeaningfulData = useMemo(
    () => hasMeaningfulSubscriptionUsageData(limitsUsage),
    [limitsUsage],
  );
  const usageView = useMemo(() => buildSubscriptionUsageRows({
    snapshot: planSnapshot,
    currentPlanManagedPlan: tier ? currentPlan.managedPlan : null,
    tier,
    usage: {
      plan: typeof limitsUsage.plan === 'string' ? limitsUsage.plan : null,
      limits: limitsUsage.limits || {},
      limitRules: limitsUsage.limitRules || {},
      usageByLimit: limitsUsage.usageByLimit || {},
    },
  }), [
    currentPlan.managedPlan,
    limitsUsage.limitRules,
    limitsUsage.limits,
    limitsUsage.plan,
    limitsUsage.usageByLimit,
    planSnapshot,
    tier,
  ]);

  const billingRequest = useCallback(async <T,>(
      path: string,
      init?: RequestInit,
  ): Promise<{ data: T; retryAfter: string | null; requestToken: string | null; planChecksum: string | null }> => {
      const headers = new Headers(init?.headers || {});
      if (session?.access_token) {
          headers.set('Authorization', `Bearer ${session.access_token}`);
      }
      if (billingRequestTokenRef.current) {
          headers.set('x-billing-request-token', billingRequestTokenRef.current);
      }
      if (planSnapshot?.checksum) {
          headers.set('x-billing-plan-checksum', planSnapshot.checksum);
      }
      if (!headers.has('Content-Type') && init?.body) {
          headers.set('Content-Type', 'application/json');
      }

      const res = await safeFetch(`/api/billing/${path}`, {
          method: init?.method || 'GET',
          body: init?.body,
          headers,
          credentials: 'include',
          timeout: 15000,
          silent: true,
      });

       const retryAfter = res.headers.get('retry-after');
       const requestToken = res.headers.get('x-billing-request-token');
       const planChecksum = res.headers.get('x-billing-plan-checksum');
       const raw = await res.text();
       let parsed: any = null;
      try {
          parsed = raw ? JSON.parse(raw) : {};
      } catch {
          parsed = { message: raw };
      }

      if (!res.ok) {
          const err = new Error(parsed?.message || parsed?.error || `Request failed (${res.status})`) as Error & {
              status?: number;
              payload?: any;
              retryAfter?: string | null;
          };
          err.status = res.status;
          err.payload = parsed;
          err.retryAfter = retryAfter;
          throw err;
      }

       return { data: parsed as T, retryAfter, requestToken, planChecksum };
  }, [planSnapshot?.checksum, session?.access_token]);

  const initializePaymentRequest = useCallback(async (payload: {
      plan_key: string;
      payment_method: 'subscription' | 'transfer';
  }): Promise<{ authorization_url: string; reference: string }> => {
      const headers = new Headers();
       if (session?.access_token) {
           headers.set('Authorization', `Bearer ${session.access_token}`);
       }
       headers.set('Content-Type', 'application/json');
       if (billingRequestTokenRef.current) {
           headers.set('x-billing-request-token', billingRequestTokenRef.current);
       }
       if (planSnapshot?.checksum) {
           headers.set('x-billing-plan-checksum', planSnapshot.checksum);
       }
       headers.set(
           'x-idempotency-key',
           makeBillingIdempotencyKey('billing-checkout', `${payload.plan_key}:${payload.payment_method}`),
       );

      const res = await safeFetch('/api/payments/initialize', {
          method: 'POST',
          body: JSON.stringify(payload),
          headers,
          credentials: 'include',
          timeout: 15000,
          silent: true,
      });

      const raw = await res.text();
      let parsed: any = null;
      try {
          parsed = raw ? JSON.parse(raw) : {};
      } catch {
          parsed = { message: raw };
      }

      if (!res.ok) {
          const err = new Error(parsed?.message || parsed?.error || `Request failed (${res.status})`) as Error & {
              status?: number;
              payload?: any;
              retryAfter?: string | null;
          };
          err.status = res.status;
          err.payload = parsed;
          err.retryAfter = res.headers.get('retry-after');
          throw err;
      }

      return parsed as { authorization_url: string; reference: string };
  }, [planSnapshot?.checksum, session?.access_token]);

  const applyBillingStatus = useCallback((data: any, options?: {
      fromCache?: boolean;
      applyPlanAuthority?: boolean;
  }) => {
      if (!data) return;
      const paymentsList = Array.isArray(data.payments) ? data.payments : [];
      const subscriptionRow = data.subscription ?? null;
      const latestPaymentPlanKey =
          paymentsList.find((payment: any) => typeof payment?.plan_key === 'string')?.plan_key || null;
      const normalizedCurrentPlan = deriveNormalizedSubscriptionState({
          effectivePlan: data?.currentPlan?.effectivePlan || data.entitlementPlan || data.tier,
          entitlementSource: data?.currentPlan?.entitlementSource || data.entitlementSource || 'none',
          promoActive: data?.currentPlan?.promoActive ?? Boolean(data?.promo?.active),
          subscriptionPlanKey: data?.currentPlan?.activePlanKey || subscriptionRow?.plan_key,
           subscriptionStatus: data?.currentPlan?.subscriptionStatus || subscriptionRow?.status,
           latestPaymentPlanKey: data?.currentPlan?.activePlanKey || latestPaymentPlanKey,
           legacyTier: data?.currentPlan?.activePlanKey || data?.currentPlan?.managedPlan || data.tier,
       });

      setSubscription(subscriptionRow);
      setPayments(paymentsList);
      if (data.pricing) {
          setPricing({
              weekly: {
                  amount: Number(data.pricing?.weekly?.amount || 0),
                  compare_at: Number(data.pricing?.weekly?.compare_at || 0),
                  label: String(data.pricing?.weekly?.label || ''),
              },
              monthly: {
                  amount: Number(data.pricing?.monthly?.amount || 0),
                  compare_at: Number(data.pricing?.monthly?.compare_at || 0),
                  label: String(data.pricing?.monthly?.label || ''),
              },
          });
      }
        const nextCheckoutCapability = data?.checkout
            ? {
                ...EMPTY_CHECKOUT,
                ...data.checkout,
              }
            : {
                ...EMPTY_CHECKOUT,
                enabled: Boolean(data?.canAccessBilling),
              };
        if (Array.isArray(data.planCatalog)) {
            setPlanCatalog(data.planCatalog);
         }
         if (options?.applyPlanAuthority !== false) {
            setTier(data.tier || normalizedCurrentPlan.managedPlan || null);
            setExpiry(data.tier_expires_at ?? null);
             setBillingEnabled(data.billingEnabled ?? false);
             setCanAccessBilling(Boolean(data?.canAccessBilling));
             setEntitlementSource((data.entitlementSource || 'none') as 'paid' | 'promo' | 'none');
             setPromoActive(Boolean(data?.promo?.active));
             setCurrentPlan(normalizedCurrentPlan);
             setCheckoutCapability(nextCheckoutCapability);
             if (typeof data?.promo?.ends_at_lagos === 'string' && data.promo.ends_at_lagos.trim()) {
                 const label = new Date(data.promo.ends_at_lagos).toLocaleString('en-US', {
                    timeZone: 'Africa/Lagos',
                    month: 'long',
                    day: 'numeric',
                    year: 'numeric',
                    hour: 'numeric',
                    minute: '2-digit',
                });
                setPromoEndsAtLabel(label);
            }
            if (data?.planSnapshot && typeof data.planSnapshot === 'object') {
                setPlanSnapshot(data.planSnapshot);
                if (typeof data.planSnapshot.issuedAt === 'string') {
                    latestAppliedStatusIssuedAtRef.current = data.planSnapshot.issuedAt;
                 }
             }
         }
         const supportsSubscription =
             Array.isArray(nextCheckoutCapability.supportedPaymentMethods) &&
             nextCheckoutCapability.supportedPaymentMethods.length > 0
                 ? nextCheckoutCapability.supportedPaymentMethods.includes('subscription')
                 : true;
         if (!supportsSubscription) {
             setIsAutoRenew(false);
         } else if (
             Boolean(data?.canAccessBilling) &&
             subscriptionRow?.status === 'active' &&
             subscriptionRow?.cancel_at_period_end !== true
         ) {
             setIsAutoRenew(true);
         }
        if (options?.fromCache) {
            setIsUsingCachedData(true);
        }
  }, []);

  useEffect(() => {
      if (!supportsSubscriptionCheckout && isAutoRenew) {
          setIsAutoRenew(false);
      }
  }, [isAutoRenew, supportsSubscriptionCheckout]);

  const applyAccountSnapshotSeed = useCallback((snapshot: NonNullable<typeof accountSnapshot>, options?: {
      fromCache?: boolean;
      cachedAt?: number | null;
  }) => {
      const seed = buildBillingPageSnapshotSeed(snapshot);
      setTier(seed.tier);
      setExpiry(seed.expiry);
      setSubscription(seed.subscription);
      setBillingEnabled(seed.billingEnabled);
      setCanAccessBilling(seed.canAccessBilling);
      setEntitlementSource(seed.entitlementSource);
      setPromoActive(seed.promoActive);
      setCurrentPlan(seed.currentPlan);
      setPlanSnapshot(seed.planSnapshot);
      if (typeof seed.planSnapshot?.issuedAt === 'string') {
          latestAppliedStatusIssuedAtRef.current = seed.planSnapshot.issuedAt;
      }
      setCheckoutCapability((current) => ({
        ...current,
        enabled: seed.canAccessBilling,
      }));
      setPromoEndsAtLabel(seed.promoEndsAtLabel);
      if (options?.fromCache) {
          setIsUsingCachedData(true);
          setCachedAt(options.cachedAt ?? null);
      }
  }, []);

  const readCachedBillingStatus = useCallback(async () => {
      if (!user?.id) return { data: null as any, cachedAt: null as number | null };
      return readUserCache<any>({
          userId: user.id,
          route: BILLING_ROUTE,
          source: BILLING_STATUS_SOURCE,
          endpoint: 'get',
          schemaVersion: BILLING_CACHE_SCHEMA,
          maxAgeMs: BILLING_CACHE_TTL_MS,
      });
  }, [user?.id]);

  const writeCachedBillingStatus = useCallback(async (data: any) => {
      if (!user?.id) return;
      await writeUserCache({
          userId: user.id,
          route: BILLING_ROUTE,
          source: BILLING_STATUS_SOURCE,
          endpoint: 'get',
          schemaVersion: BILLING_CACHE_SCHEMA,
          ttlMs: BILLING_CACHE_TTL_MS,
          data,
      });
  }, [user?.id]);

  const fetchBillingStatus = useCallback(async () => {
      if (!user?.id) return null;
      if (!isOnline || !session?.access_token) {
          const cached = await readCachedBillingStatus();
          if (accountSnapshot) {
              applyAccountSnapshotSeed(accountSnapshot, {
                  fromCache: isUsingCachedAccountSnapshot,
                  cachedAt: accountSnapshotCachedAt,
              });
          }
          if (cached.data) {
              applyBillingStatus(cached.data, { fromCache: true, applyPlanAuthority: false });
              setCachedAt(accountSnapshotCachedAt ?? cached.cachedAt);
          }
             return cached.data;
        }
       const requestId = ++statusRequestIdRef.current;
       try {
           const res = await billingRequest<any>('status', { method: 'GET' });
           if (res.data) {
               const nextIssuedAt =
                   typeof res.data?.planSnapshot?.issuedAt === 'string' ? res.data.planSnapshot.issuedAt : null;
               if (!shouldApplyBillingStatusResponse({
                   requestId,
                   activeRequestId: statusRequestIdRef.current,
                   currentIssuedAt: latestAppliedStatusIssuedAtRef.current,
                   nextIssuedAt,
               })) {
                   return res.data;
               }
               if (res.requestToken) {
                   billingRequestTokenRef.current = res.requestToken;
               }
               applyBillingStatus(res.data);
               setIsUsingCachedData(false);
               setCachedAt(Date.now());
               void writeCachedBillingStatus(res.data);
               return res.data;
           }
        } catch (e) {
            console.error("Failed to fetch billing status", e);
            const cached = await readCachedBillingStatus();
            if (accountSnapshot) {
                applyAccountSnapshotSeed(accountSnapshot, {
                    fromCache: isUsingCachedAccountSnapshot,
                    cachedAt: accountSnapshotCachedAt,
                });
            }
            if (cached.data) {
                applyBillingStatus(cached.data, { fromCache: true, applyPlanAuthority: false });
                setCachedAt(accountSnapshotCachedAt ?? cached.cachedAt);
                return cached.data;
            }
        }
        return null;
  }, [
      accountSnapshot,
      accountSnapshotCachedAt,
      applyAccountSnapshotSeed,
      applyBillingStatus,
      billingRequest,
      isOnline,
      isUsingCachedAccountSnapshot,
      readCachedBillingStatus,
      session?.access_token,
      user?.id,
      writeCachedBillingStatus,
  ]);

  const resolvePlanCardKey = useCallback((planType: 'weekly' | 'monthly'): SubscriptionCardKey => {
      return planType === 'weekly' ? 'pro_weekly' : 'pro_monthly';
  }, []);

  const showPlanActionBlockedToast = useCallback((planKey: SubscriptionCardKey) => {
      const cardState = buildSubscriptionCardState({
          planKey,
          state: currentPlan,
          canAccessBilling,
          checkout: checkoutCapability,
      });
      toast({
          title: cardState.isCurrent ? 'Current plan' : 'Checkout unavailable',
          description: cardState.reason || 'This plan is not selectable right now.',
      });
  }, [canAccessBilling, checkoutCapability, currentPlan, toast]);

  const applyCheckoutFailureState = useCallback((error: any) => {
      const errorCode = String(error?.payload?.error || error?.code || '');
      const errorMessage = String(error?.payload?.message || error?.message || '').trim();
      if (
          errorCode === 'billing_gateway_not_configured' ||
          errorCode === 'billing_plan_not_configured' ||
          errorCode === 'billing_disabled' ||
          errorCode === 'promo_active' ||
          errorCode.endsWith('_env_missing')
      ) {
          setCheckoutCapability((current) => ({
              ...current,
              enabled: false,
              code: errorCode || current.code || 'checkout_unavailable',
              message: errorMessage || current.message || 'Checkout is temporarily unavailable.',
          }));
      }
  }, []);

  const openManualBankTransfer = useCallback((planType: 'weekly' | 'monthly') => {
      if (isPromoUnlocked) {
          toast({
              title: 'Free Premium Access is active',
              description: 'Payment options are disabled while premium is temporarily unlocked.',
          });
          return;
      }
      if (!canAccessBilling) {
          toast({
              title: 'Billing unavailable',
              description: 'Billing is disabled or entitlement validation is still pending.',
          });
          return;
      }
      if (!supportsTransferCheckout) {
          toast({
              title: 'Transfer unavailable',
              description: 'The current payment provider does not support transfer checkout.',
          });
          return;
      }
      const planKey = resolvePlanCardKey(planType);
      if (!canStartCheckoutForPlan({
          planKey,
          state: currentPlan,
          canAccessBilling,
          checkout: checkoutCapability,
      })) {
          showPlanActionBlockedToast(planKey);
          return;
      }
      setManualPlan(planType);
      setShowBankTransfer(true);
  }, [canAccessBilling, checkoutCapability, currentPlan, isPromoUnlocked, resolvePlanCardKey, showPlanActionBlockedToast, supportsTransferCheckout, toast]);

  const stopPolling = useCallback(() => {
      if (pollTimerRef.current) {
          clearInterval(pollTimerRef.current);
          pollTimerRef.current = null;
      }
  }, []);

  const startPolling = useCallback(() => {
      setPollCount(0);
      if (pollTimerRef.current) clearInterval(pollTimerRef.current);
      
      pollTimerRef.current = setInterval(async () => {
          setPollCount(prev => {
              if (prev >= 20) { // ~60 seconds
                  stopPolling();
                  setPaymentState(current => current === 'confirming' ? 'pending' : current);
                  return prev;
              }
              return prev + 1;
          });

          const data = await fetchBillingStatus();
          if (data?.currentPlan?.hasPaidEntitlement === true && data?.currentPlan?.managedPlan !== 'free') {
              setPaymentState('success');
              stopPolling();
          }
      }, 3000);
  }, [fetchBillingStatus, stopPolling]);

  const verifyPayment = useCallback(async (paymentReturn?: Pick<BillingReturnState, 'reference' | 'verificationTarget' | 'transactionId' | 'gatewayHint'>) => {
      if (!canPerformNetworkMutations) return;
      if (!session?.access_token) return;
      try {
          const verificationTarget = paymentReturn?.verificationTarget || paymentReturn?.reference || null;
           if (verificationTarget) {
               const headers = new Headers({
                   'Content-Type': 'application/json',
                   Authorization: `Bearer ${session.access_token}`,
               });
               if (billingRequestTokenRef.current) {
                   headers.set('x-billing-request-token', billingRequestTokenRef.current);
               }
               if (planSnapshot?.checksum) {
                   headers.set('x-billing-plan-checksum', planSnapshot.checksum);
               }
               headers.set(
                   'x-idempotency-key',
                   makeBillingIdempotencyKey('billing-verify', `${verificationTarget}:${paymentReturn?.transactionId || 'none'}`),
               );
               const verifyRes = await safeFetch('/api/payments/verify', {
                   method: 'POST',
                   body: JSON.stringify({
                      reference: paymentReturn?.reference || null,
                      verification_target: verificationTarget,
                      transaction_id: paymentReturn?.transactionId || null,
                      gateway: paymentReturn?.gatewayHint || null,
                  }),
                  headers,
                  credentials: 'include',
                  timeout: 15000,
                  silent: true,
              });
              const verifyBody = await verifyRes.json().catch(() => ({} as any));
              if (verifyRes.ok && verifyBody?.success === true) {
                  await fetchBillingStatus();
                  setPaymentState('success');
                  return;
              }
              if (verifyRes.ok) {
                  const paymentStatus = String(verifyBody?.payment_status || '').trim().toLowerCase();
                  if (paymentStatus === 'failed' || paymentStatus === 'cancelled' || paymentStatus === 'canceled') {
                      setPaymentState('error');
                      return;
                  }
              }
              if (!verifyRes.ok && Number(verifyRes.status || 0) >= 500) {
                  console.error('Verification failed', verifyBody);
              }
          }

          const data = await fetchBillingStatus();
          if (data?.currentPlan?.hasPaidEntitlement === true && data?.currentPlan?.managedPlan !== 'free') {
              setPaymentState('success');
              return;
          }
      } catch (e: any) {
          if (Number(e?.status || 0) >= 500 || !e?.status) {
              console.error('Verification failed', e);
          }
      }
       startPolling();
  }, [canPerformNetworkMutations, fetchBillingStatus, planSnapshot?.checksum, session?.access_token, startPolling]);
  const fetchBillingStatusRef = useRef(fetchBillingStatus);
  const verifyPaymentRef = useRef(verifyPayment);
  const startPollingRef = useRef(startPolling);
  const stopPollingRef = useRef(stopPolling);

  useEffect(() => {
      fetchBillingStatusRef.current = fetchBillingStatus;
  }, [fetchBillingStatus]);

  useEffect(() => {
      verifyPaymentRef.current = verifyPayment;
  }, [verifyPayment]);

  useEffect(() => {
      startPollingRef.current = startPolling;
  }, [startPolling]);

  useEffect(() => {
      stopPollingRef.current = stopPolling;
  }, [stopPolling]);

  const refreshUsageSection = useCallback(async () => {
      if (!isOnline) {
          setUsageError('Reconnect to load usage and limits.');
          return;
      }
      setIsRefreshingUsage(true);
      setUsageError(null);
      try {
          await refreshUsage();
      } catch (error) {
          console.error('Failed to refresh usage and limits', error);
          setUsageError('Unable to refresh usage and limits right now.');
      } finally {
          setIsRefreshingUsage(false);
      }
  }, [isOnline, refreshUsage]);

  // Initial Load & URL Check
  useEffect(() => {
      if (!accountSnapshot) return;
      const snapshotIssuedAt =
          (typeof accountSnapshot.planSnapshot?.issuedAt === 'string' && accountSnapshot.planSnapshot.issuedAt) ||
          (typeof accountSnapshot.validatedAt === 'string' && accountSnapshot.validatedAt) ||
          null;
      const snapshotIsNewer =
          Boolean(
              snapshotIssuedAt &&
              (
                  !latestAppliedStatusIssuedAtRef.current ||
                  new Date(snapshotIssuedAt).getTime() > new Date(latestAppliedStatusIssuedAtRef.current).getTime()
              ),
          );
      const hasBillingStatusState = Boolean(
          tier ||
          planSnapshot?.checksum ||
          subscription ||
          payments.length > 0 ||
          planCatalog.length > 0 ||
          pricing.weekly.amount ||
          pricing.monthly.amount,
      );
      if (hasBillingStatusState && !snapshotIsNewer) return;
      applyAccountSnapshotSeed(accountSnapshot, {
          fromCache: isUsingCachedAccountSnapshot,
          cachedAt: accountSnapshotCachedAt,
      });
      setIsInitialLoading(false);
  }, [
      accountSnapshot,
      accountSnapshotCachedAt,
      applyAccountSnapshotSeed,
      isUsingCachedAccountSnapshot,
      payments.length,
      planCatalog.length,
      planSnapshot?.checksum,
      pricing.monthly.amount,
      pricing.weekly.amount,
      subscription,
      tier,
  ]);

  useEffect(() => {
    if (!user?.id) {
        bootstrapKeyRef.current = null;
        setIsInitialLoading(false);
        return;
    }
    if (!bootstrapKey || bootstrapKeyRef.current === bootstrapKey) {
        return;
    }

    bootstrapKeyRef.current = bootstrapKey;
    stopPollingRef.current();

    let canceled = false;
    setIsInitialLoading(true);

    const bootstrap = async () => {
        await fetchBillingStatusRef.current();
        if (canceled) return;
        setIsInitialLoading(false);

        if (paymentReturnState.isCanceled && !paymentReturnState.isSuccess) {
            setPaymentState('error');
        } else if (paymentReturnState.verificationTarget) {
            setPaymentState('confirming');
            void verifyPaymentRef.current(paymentReturnState);
        } else if (paymentReturnState.isSuccess) {
            setPaymentState('confirming');
            startPollingRef.current();
        }

        if (paymentReturnState.hasCallbackState) {
            router.replace(BILLING_ROUTE, { scroll: false });
        }
    };

    void bootstrap();

    return () => {
        canceled = true;
    };
  }, [bootstrapKey, paymentReturnState, router, user?.id]);

  useEffect(() => {
      return () => {
          stopPollingRef.current();
      };
  }, []);

  useEffect(() => {
      if (isPromoUnlocked || !canAccessBilling) {
          setShowBankTransfer(false);
      }
  }, [canAccessBilling, isPromoUnlocked]);

  useEffect(() => {
      if (!user?.id) {
          usageRefreshAttemptRef.current = null;
          setUsageError(null);
          setIsRefreshingUsage(false);
          return;
      }
      if (limitsUsage.loading) return;
      if (usageHasMeaningfulData) {
          setUsageError(null);
          return;
      }
      if (!isOnline) {
          setUsageError('Reconnect to load usage and limits.');
          return;
      }
      if (usageRefreshAttemptRef.current === user.id) {
          if (!isRefreshingUsage) {
              setUsageError((current) => current || 'Usage and limits are still syncing. Retry shortly.');
          }
          return;
      }
      usageRefreshAttemptRef.current = user.id;
      void refreshUsageSection();
  }, [
      isOnline,
      isRefreshingUsage,
      limitsUsage.loading,
      refreshUsageSection,
      usageHasMeaningfulData,
      user?.id,
  ]);

  const handlePaymentCheckout = async (
      planType: 'weekly' | 'monthly',
      methodOverride?: 'subscription' | 'transfer'
  ) => {
      const planKey = resolvePlanCardKey(planType);
      if (!canPerformNetworkMutations) {
          toast({
              variant: 'destructive',
              title: isDegraded ? 'Connection unstable' : 'Offline',
              description: isDegraded
                  ? 'Billing is temporarily read-only until the connection stabilizes.'
                  : 'Connect to the internet to manage billing.',
          });
          return;
      }
      if (isPromoUnlocked) {
          toast({ title: 'Free Premium Access is active', description: 'Payments are paused while premium is unlocked.' });
          return;
      }
      if (!canAccessBilling) {
          toast({
              variant: 'destructive',
              title: 'Billing unavailable',
              description: 'Billing is disabled or entitlement validation is pending.',
          });
          return;
      }
      if (!canStartCheckoutForPlan({
          planKey,
          state: currentPlan,
          canAccessBilling,
          checkout: checkoutCapability,
      })) {
          showPlanActionBlockedToast(planKey);
          return;
      }
      if (!session?.access_token) {
          toast({ variant: 'destructive', title: 'Sign in required', description: 'Sign in to manage billing.' });
          return;
      }
      if (!billingRequestTokenRef.current) {
          await fetchBillingStatus();
      }
      const paymentMethod =
          methodOverride ||
          (isAutoRenew && supportsSubscriptionCheckout ? 'subscription' : defaultCheckoutPaymentMethod);
      if (paymentMethod === 'subscription' && !supportsSubscriptionCheckout) {
          setIsAutoRenew(false);
          toast({
              title: 'Auto-renew unavailable',
              description: 'The current payment provider only supports one-time transfer checkout.',
          });
          return;
      }
      if (paymentMethod === 'transfer' && !supportsTransferCheckout) {
          toast({
              variant: 'destructive',
              title: 'Transfer unavailable',
              description: 'The current payment provider cannot start a transfer checkout right now.',
          });
          return;
      }
      setLoadingPlan(planType);
      
      try {
          const response = await initializePaymentRequest({
              plan_key: planKey,
              payment_method: paymentMethod,
          });

          const url = response?.authorization_url;
          if (url) {
              setPaymentState('redirecting');
              setShowBankTransfer(false);
              window.location.href = url;
          } else {
              throw new Error('No authorization URL returned');
          }

      } catch (e: any) {
          console.error(e);
          const errorCode = String(e?.payload?.error || e?.code || '');
          const errorMessage = String(e?.payload?.message || e?.message || 'Failed to initialize payment');
          applyCheckoutFailureState(e);
          if (errorCode === 'plan_already_active' || errorCode === 'premium_plan_managed_separately') {
              await fetchBillingStatus();
              toast({
                  title: errorCode === 'plan_already_active' ? 'Current plan' : 'Managed separately',
                  description: errorMessage,
              });
          } else if (errorCode === 'payment_method_not_supported') {
              if (paymentMethod === 'subscription') {
                  setIsAutoRenew(false);
              }
              toast({
                  variant: 'destructive',
                  title: 'Payment method unavailable',
                  description: errorMessage,
              });
          } else if (Number(e?.status || 0) === 429) {
              toast({
                  variant: 'destructive',
                  title: 'High demand / rate limited — retry shortly.',
                  description: 'Checkout is temporarily rate limited. Please retry in a few seconds.',
              });
          } else {
              toast({
                  variant: 'destructive',
                  title:
                      errorCode === 'billing_gateway_not_configured' || errorCode.endsWith('_env_missing')
                          ? 'Checkout unavailable'
                          : 'Payment Error',
                  description: errorMessage,
              });
          }
          setLoadingPlan(null);
          setPaymentState('idle');
      }
  };

  const handleCancelSubscription = async () => {
      if (!canPerformNetworkMutations) {
          toast({
              variant: 'destructive',
              title: isDegraded ? 'Connection unstable' : 'Offline',
              description: isDegraded
                  ? 'Billing is temporarily read-only until the connection stabilizes.'
                  : 'Connect to the internet to manage billing.',
          });
          return;
      }
      if (!session?.access_token) {
          toast({ variant: 'destructive', title: 'Sign in required', description: 'Sign in to manage billing.' });
          return;
      }
      if (!cancelReason || cancelReason.length < 10) {
          toast({ variant: 'destructive', title: 'Reason too short', description: 'Please provide a reason (min 10 chars).' });
          return;
      }
      if (!billingRequestTokenRef.current) {
          await fetchBillingStatus();
      }

      setIsCancelling(true);
      try {
          const { data } = await billingRequest<{ outcome?: string; message?: string }>('cancel', {
              method: 'POST',
              body: JSON.stringify({ reason: cancelReason }),
          });

          const isNoop = data?.outcome === 'already_scheduled' || data?.outcome === 'no_subscription';
          toast({
              title: isNoop ? 'Subscription Updated' : 'Subscription Canceled',
              description: data?.message || 'Your plan will not renew.',
          });
          setCancelReason('');
          setIsCancelDialogOpen(false);
          fetchBillingStatus();

      } catch (e: any) {
          toast({ variant: 'destructive', title: 'Error', description: e.message });
      } finally {
          setIsCancelling(false);
      }
  };

  const handleResubscribe = async () => {
      if (!canPerformNetworkMutations) {
          toast({
              variant: 'destructive',
              title: isDegraded ? 'Connection unstable' : 'Offline',
              description: isDegraded
                  ? 'Billing is temporarily read-only until the connection stabilizes.'
                  : 'Connect to the internet to manage billing.',
          });
          return;
      }
      if (!session?.access_token) {
          toast({ variant: 'destructive', title: 'Sign in required', description: 'Sign in to manage billing.' });
          return;
      }
      if (!billingRequestTokenRef.current) {
          await fetchBillingStatus();
      }

      setIsResubscribing(true);
      try {
          const { data } = await billingRequest<{ outcome?: string; message?: string }>('resubscribe', {
              method: 'POST',
              body: JSON.stringify({}),
          });
          const outcome = String(data?.outcome || '');
          if (outcome === 'not_resumable') {
              toast({
                  title: 'Subscription ended',
                  description: data?.message || 'This subscription has ended. Please start a new checkout.',
              });
          } else if (outcome === 'already_renewing') {
              toast({
                  title: 'Auto-renew active',
                  description: data?.message || 'Auto-renew is already active for this subscription.',
              });
          } else {
              toast({
                  title: 'Auto-renew restored',
                  description: data?.message || 'Your subscription will now renew automatically.',
              });
          }
          await fetchBillingStatus();
      } catch (e: any) {
          const message = String(e?.payload?.message || e?.message || 'Failed to restore auto-renew.');
          toast({ variant: 'destructive', title: 'Error', description: message });
      } finally {
          setIsResubscribing(false);
      }
  };

  const formatDate = (dateStr: string) => {
      if (!dateStr) return '';
      return new Date(dateStr).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
  };
  const formatUsageMetric = (value: number) => (
      new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(Math.max(0, value))
  );

  // --- Usage Meter ---
  const LimitBar = ({ label, used, limit }: { label: string; used: number; limit: number | null }) => {
    const parsedLimit = limit === null ? null : Number(limit);
    const parsedUsed = Number(used);
    const safeLimit = parsedLimit === null ? null : (Number.isFinite(parsedLimit) ? Math.max(0, parsedLimit) : 0);
    const safeUsed = Number.isFinite(parsedUsed) ? Math.max(0, parsedUsed) : 0;
    const percent = typeof safeLimit === 'number' && safeLimit > 0 ? Math.min(100, (safeUsed / safeLimit) * 100) : 0;
    const isLimit = typeof safeLimit === 'number' && safeLimit > 0 ? safeUsed >= safeLimit : false;
    return (
        <div>
            <div className="mb-1.5 flex flex-col gap-1 text-sm sm:flex-row sm:items-center sm:justify-between">
                <span className="font-medium text-foreground">{label}</span>
                <span className={cn("font-mono text-xs", isLimit ? "text-destructive font-bold" : "text-muted-foreground")}>
                    {safeLimit === null
                        ? `${formatUsageMetric(safeUsed)} / Unlimited`
                        : `${formatUsageMetric(safeUsed)} / ${formatUsageMetric(safeLimit)}`}
                </span>
            </div>
            <div className="h-2.5 bg-muted rounded-full overflow-hidden">
                <div 
                    className={cn("h-full transition-all duration-500", isLimit ? "bg-destructive" : "bg-primary")} 
                    style={{ width: `${percent}%` }} 
                />
            </div>
        </div>
    );
  };

  const UsageMeter = () => {
    if (limitsUsage.loading && !usageView.planCode) return null;
    if (!usageView.planCode) return null;

    return (
        <div className="mx-auto mb-8 max-w-4xl rounded-3xl border border-border bg-card p-5 shadow-sm sm:p-6">
            <div className="flex items-center gap-2 mb-4">
                <ShieldCheck className="h-5 w-5 text-primary" />
                <h2 className="text-lg font-bold text-foreground">Limits & Usage</h2>
            </div>
            <p className="mb-4 text-xs text-muted-foreground">
              Plan: <span className="font-semibold text-foreground">{usageView.planCode.toUpperCase()}</span>
              {usageView.resetSummary.length > 0 ? ` / ${usageView.resetSummary.join(' / ')}` : ''}
            </p>
            {usageView.hasData ? (
              <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
                  {usageView.rows.map((row) => (
                    <div key={row.key} className="space-y-2">
                      <LimitBar
                        label={row.label}
                        used={row.used}
                        limit={row.limit}
                      />
                      {row.resetText ? <p className="text-[11px] text-muted-foreground">{row.resetText}</p> : null}
                    </div>
                  ))}
              </div>
            ) : (
              <div className="rounded-2xl border border-dashed border-border bg-muted/20 p-4 text-sm text-muted-foreground">
                <p>{usageError || 'Usage and limit data are still syncing for this account.'}</p>
                <div className="mt-3 flex flex-wrap items-center gap-3">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => void refreshUsageSection()}
                    disabled={isRefreshingUsage || !isOnline}
                  >
                    {isRefreshingUsage ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                    {isRefreshingUsage ? 'Refreshing usage...' : 'Retry usage sync'}
                  </Button>
                  {!isOnline ? <span>Reconnect to fetch the latest saved usage.</span> : null}
                </div>
              </div>
            )}
            {usageView.isFreePlan && billingEnabled ? (
              <p className="mt-4 text-xs text-muted-foreground">
                Free users get full visibility + limit alerts. Upgrade to increase caps instantly.
              </p>
            ) : (
              <p className="mt-4 text-xs text-muted-foreground">
                Paid plans get informational usage tracking with higher limits.
              </p>
            )}
        </div>
    );
  };

  // --- UI Components ---

  const PricingCard = ({ 
    title, 
    price, 
    originalPrice, 
    period, 
    features, 
    onSelect, 
    loading, 
    highlighted, 
    savedLabel,
    disabled,
    ctaLabel,
  }: any) => (
    <div className={cn(
        "relative flex flex-col overflow-hidden rounded-3xl bg-card shadow-sm transition-all duration-300",
        highlighted ? "z-10 border-2 border-primary shadow-xl shadow-primary/10 md:scale-[1.03]" : "border border-border md:hover:scale-[1.02]",
        disabled && "opacity-80"
    )}>
      {/* Header with Curve */}
      <div className={cn(
          "relative px-5 pb-14 pt-8 text-center sm:px-6 sm:pb-16 sm:pt-10",
          highlighted ? "bg-primary text-primary-foreground" : "bg-muted/40 text-foreground"
      )}>
         {/* Curve Overlay */}
         <div className={cn(
             "absolute bottom-0 left-0 right-0 h-12 bg-white",
             "rounded-t-[50%]"
         )} style={{ transform: 'translateY(50%) scaleX(1.5)' }}></div>
         
         <h3 className="text-sm font-bold uppercase tracking-widest mb-3 opacity-90">{title}</h3>
         
         <div className="flex flex-col items-center justify-center">
             {originalPrice && (
                 <div className={cn(
                     "text-sm font-medium line-through mb-1",
                     highlighted ? "text-primary-foreground/70" : "text-muted-foreground"
                 )}>
                     {originalPrice}
                 </div>
             )}
            <div className="flex flex-wrap items-baseline justify-center gap-1">
                <span className="break-words text-3xl font-extrabold leading-none sm:text-4xl">{price}</span>
            </div>
            <span className={cn("text-xs font-medium uppercase mt-2", highlighted ? "text-primary-foreground/80" : "text-muted-foreground")}>
                /{period}
            </span>
         </div>

          {savedLabel && (
              <span className={cn(
                  "absolute right-3 top-3 max-w-[calc(100%-1.5rem)] rounded-full px-3 py-1 text-[10px] font-bold shadow-sm sm:right-4 sm:top-4",
                  highlighted ? "bg-background text-primary" : "bg-primary/10 text-primary"
              )}>
                  {savedLabel}
              </span>
          )}
      </div>

      {/* Content */}
      <div className="z-10 flex flex-1 flex-col items-center bg-card p-6 pt-6 sm:p-8 sm:pt-6">
          <ul className="space-y-4 text-sm text-muted-foreground mb-8 w-full">
              {features.map((f: string, i: number) => (
                  <li key={i} className="flex items-start gap-3 text-left">
                      <Check className={cn("h-5 w-5 shrink-0", highlighted ? "text-primary" : "text-muted-foreground")} />
                      <span className="leading-tight">{f}</span>
                  </li>
              ))}
          </ul>
          
          <div className="mt-auto w-full">
             <Button 
                onClick={onSelect} 
                disabled={loading || disabled}
                className={cn(
                    "w-full rounded-full h-12 font-bold tracking-wide transition-all",
                    highlighted 
                        ? "bg-primary hover:bg-primary/90 text-primary-foreground shadow-lg shadow-primary/20 hover:shadow-primary/30" 
                        : "bg-background border-2 border-border hover:border-primary hover:text-primary text-foreground",
                    disabled && "cursor-not-allowed opacity-50"
                )}
             >
                {loading ? <Loader2 className="animate-spin" /> : (ctaLabel || (disabled ? 'CURRENT PLAN' : 'SELECT PLAN'))}
             </Button>
           </div>
       </div>
    </div>
  );

  // --- Payment States ---
  const isBootLoading = isUserLoading || isInitialLoading;
  const hasAuthoritativeSubscriptionState = Boolean(
      accountSnapshot ||
      planSnapshot?.checksum ||
      tier ||
      subscription ||
      payments.length > 0 ||
      isUsingCachedData,
  );
  const { showSkeleton, showSlowNotice } = useDelayedLoadingState(isBootLoading);

  if (isBootLoading && showSkeleton && paymentState === 'idle') {
      return <BillingPageSkeleton />;
  }

  if (paymentState === 'redirecting') {
      return (
          <div className="container max-w-2xl py-20 text-center space-y-6">
              <div className="flex justify-center"><Loader2 className="h-16 w-16 animate-spin text-primary" /></div>
              <h2 className="text-2xl font-bold">Redirecting to secure checkout...</h2>
              <p className="text-muted-foreground">Please wait while we connect you to secure checkout.</p>
              <div className="flex justify-center gap-2 text-sm text-muted-foreground">
                  <ShieldCheck className="h-4 w-4" /> Secured checkout
              </div>
          </div>
      );
  }

  if (paymentState === 'confirming') {
      return (
          <div className="container max-w-2xl py-20 text-center space-y-6">
              <div className="flex justify-center"><Loader2 className="h-16 w-16 animate-spin text-primary" /></div>
              <h2 className="text-2xl font-bold">Confirming your payment...</h2>
              <p className="text-muted-foreground">We are verifying your payment. This usually takes a few seconds.</p>
          </div>
      );
  }

  if (paymentState === 'success') {
      return (
          <div className="container max-w-2xl py-20 text-center space-y-6">
              <div className="flex justify-center">
                  <div className="h-20 w-20 bg-green-100 text-green-600 rounded-full flex items-center justify-center">
                      <CheckCircle2 className="h-10 w-10" />
                  </div>
              </div>
              <h2 className="text-3xl font-bold">You are Pro</h2>
              <p className="text-lg text-muted-foreground">Your subscription is active. Enjoy higher limits, premium models, and advanced tools.</p>
              <Button onClick={() => router.push('/dashboard')} size="lg" className="mt-4 bg-primary hover:bg-primary/90 rounded-full px-8">
                  Go to Dashboard
              </Button>
          </div>
      );
  }

  if (paymentState === 'error') {
      return (
          <div className="container max-w-2xl py-20 text-center space-y-6">
               <div className="flex justify-center">
                   <div className="h-20 w-20 bg-red-100 text-red-600 rounded-full flex items-center justify-center">
                      <AlertTriangle className="h-10 w-10" />
                  </div>
              </div>
              <h2 className="text-2xl font-bold">Payment not completed</h2>
              <p className="text-muted-foreground">No charge was made. You can try again anytime.</p>
              <div className="flex justify-center gap-4">
                  <Button onClick={() => setPaymentState('idle')}>Try Again</Button>
              </div>
          </div>
      );
  }

  if (!isBootLoading && !hasAuthoritativeSubscriptionState) {
      return (
          <div className="container max-w-2xl py-20 text-center space-y-6">
              <div className="flex justify-center">
                  <div className="h-20 w-20 bg-muted text-muted-foreground rounded-full flex items-center justify-center">
                      <Clock className="h-10 w-10" />
                  </div>
              </div>
              <h2 className="text-2xl font-bold">
                  {isOnline
                      ? (isDegraded ? 'Connection unstable while syncing subscription' : 'Syncing your subscription...')
                      : 'Subscription snapshot unavailable offline'}
              </h2>
              <p className="text-muted-foreground">
                  {isOnline
                      ? (isDegraded
                          ? 'Your last validated subscription snapshot is still shown while the app reconnects.'
                          : 'We are still validating your current plan with the server.')
                      : 'Reconnect once to refresh your subscription snapshot on this device.'}
              </p>
              <div className="flex justify-center gap-4">
                  <Button onClick={() => void fetchBillingStatus()} disabled={!isOnline}>
                      Retry sync
                  </Button>
              </div>
          </div>
      );
  }

  const isAutoRenewActive = subscription?.status === 'active' && subscription?.cancel_at_period_end !== true;
  const canResumeAutoRenew = subscription?.cancel_at_period_end === true || subscription?.status === 'non_renewing';

  const activeBillingSummary = (hasPaidProAccess || hasPremiumAccess) ? (
      <div className="mb-8 max-w-4xl mx-auto space-y-8">
          <div className="rounded-3xl border border-border bg-card p-6 shadow-sm sm:p-8">
              <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                      <h2 className="text-2xl font-bold text-foreground">{currentPlan.currentPlanLabel} Active</h2>
                      <p className="text-muted-foreground mt-1">
                          {hasPremiumAccess
                              ? 'Your Premium workspace is active and managed separately from self-serve upgrades.'
                              : 'Your current paid plan is active and synchronized across billing and entitlements.'}
                      </p>
                  </div>
                  <div className="h-12 w-12 bg-green-100 rounded-full flex items-center justify-center">
                      <CheckCircle2 className="h-6 w-6 text-green-600" />
                  </div>
              </div>

              <div className="mb-8 grid grid-cols-1 gap-6 md:grid-cols-2 md:gap-8">
                  <div className="space-y-4">
                      {(currentPaidPlanCatalog?.metadata?.feature_bullets?.length ? currentPaidPlanCatalog.metadata.feature_bullets : [
                          'Premium model access',
                          'High-priority processing',
                          'Expanded study tools',
                      ]).slice(0, 4).map((feature) => (
                          <div key={feature} className="flex items-center gap-3">
                              <CheckCircle2 className="h-5 w-5 text-primary" />
                              <span className="font-medium">{feature}</span>
                          </div>
                      ))}
                  </div>
                  <div className="rounded-2xl bg-muted/40 p-5 sm:p-6">
                      <div className="text-sm text-muted-foreground mb-1">
                          {subscription?.status === 'active' ? 'Renews on' : 'Expires on'}
                      </div>
                      <div className="text-2xl font-bold text-foreground mb-4">
                          {formatDate(expiry || '')}
                      </div>
                      <p className="mb-2 text-xs text-muted-foreground">
                          Current plan: {currentPlan.currentPlanLabel}
                      </p>
                      <p className="mb-4 text-xs text-muted-foreground">
                          Document expiration window: {formatExpirationWindowLabel(currentExpirationDays)}
                      </p>
                      {isAutoRenewActive && !hasPremiumAccess ? (
                          <OfflineGuard
                              blockWhenDegraded
                              degradedReason="Connection is unstable. Wait for sync to finish before changing billing."
                          >
                              <Dialog open={isCancelDialogOpen} onOpenChange={setIsCancelDialogOpen}>
                                  <DialogTrigger asChild>
                                      <Button variant="outline" className="w-full text-red-600 hover:text-red-700 hover:bg-red-50 border-red-100">
                                          Cancel Auto-renew
                                      </Button>
                                  </DialogTrigger>
                                  <DialogContent>
                                      <DialogHeader>
                                          <DialogTitle>Cancel Subscription</DialogTitle>
                                          <DialogDescription>
                                              Are you sure? You will lose access to Pro features at the end of your current billing period.
                                          </DialogDescription>
                                      </DialogHeader>
                                      <div className="space-y-4 py-4">
                                          <Label>Reason for cancellation (required)</Label>
                                          <Textarea
                                              placeholder="Please tell us why you are leaving..."
                                              value={cancelReason}
                                              onChange={(e) => setCancelReason(e.target.value)}
                                          />
                                      </div>
                                      <DialogFooter>
                                          <Button variant="outline" onClick={() => setIsCancelDialogOpen(false)}>Keep Plan</Button>
                                          <Button variant="destructive" onClick={handleCancelSubscription} disabled={isCancelling}>
                                              {isCancelling ? <Loader2 className="animate-spin h-4 w-4" /> : 'Confirm Cancellation'}
                                          </Button>
                                      </DialogFooter>
                                  </DialogContent>
                              </Dialog>
                          </OfflineGuard>
                      ) : hasPremiumAccess ? (
                          <Button variant="outline" className="w-full" disabled>
                              Manage Premium via Support
                          </Button>
                      ) : canResumeAutoRenew ? (
                          <OfflineGuard
                              blockWhenDegraded
                              degradedReason="Connection is unstable. Wait for sync to finish before changing billing."
                          >
                              <Button
                                  className="w-full bg-primary hover:bg-primary/90"
                                  onClick={() => void handleResubscribe()}
                                  disabled={isResubscribing}
                              >
                                  {isResubscribing ? <Loader2 className="animate-spin h-4 w-4" /> : 'Re-subscribe'}
                              </Button>
                          </OfflineGuard>
                      ) : (
                          <Button variant="outline" className="w-full" disabled>
                              Subscription managed by gateway
                          </Button>
                      )}
                  </div>
              </div>
          </div>

          <div className="rounded-3xl border border-border bg-card p-6 shadow-sm sm:p-8">
              <div className="flex items-center gap-2 mb-6">
                  <Clock className="h-5 w-5 text-muted-foreground" />
                  <h2 className="text-xl font-bold text-foreground">Payment History</h2>
              </div>

              {payments.length > 0 ? (
                  <>
                      <div className="space-y-3 md:hidden">
                          {payments.map((p) => (
                              <div key={p.reference} className="rounded-2xl border border-border/70 bg-muted/20 p-4">
                                  <div className="flex flex-col gap-3">
                                      <div className="flex items-start justify-between gap-3">
                                          <div className="min-w-0">
                                              <p className="font-medium text-foreground">{formatDate(p.created_at)}</p>
                                              <p className="capitalize text-sm text-muted-foreground">{p.plan} Plan</p>
                                          </div>
                                          <Badge variant={p.status === 'success' ? 'default' : 'secondary'} className={p.status === 'success' ? 'bg-green-100 text-green-700 hover:bg-green-100' : ''}>
                                              {p.status}
                                          </Badge>
                                      </div>
                                      <div className="grid grid-cols-1 gap-2 text-sm">
                                          <div>
                                              <span className="text-muted-foreground">Amount:</span>{' '}
                                              <span className="font-medium text-foreground">NGN {p.amount_ngn.toLocaleString()}</span>
                                          </div>
                                          <div className="min-w-0">
                                              <span className="text-muted-foreground">Reference:</span>{' '}
                                              <span className="break-all font-mono text-xs text-muted-foreground">{p.reference}</span>
                                          </div>
                                      </div>
                                  </div>
                              </div>
                          ))}
                      </div>
                      <div className="hidden md:block">
                          <Table>
                              <TableHeader>
                                  <TableRow>
                                      <TableHead>Date</TableHead>
                                      <TableHead>Description</TableHead>
                                      <TableHead>Amount</TableHead>
                                      <TableHead>Status</TableHead>
                                      <TableHead className="text-right">Reference</TableHead>
                                  </TableRow>
                              </TableHeader>
                              <TableBody>
                                  {payments.map((p) => (
                                      <TableRow key={p.reference}>
                                          <TableCell className="font-medium">{formatDate(p.created_at)}</TableCell>
                                          <TableCell className="capitalize">{p.plan} Plan</TableCell>
                                          <TableCell>NGN {p.amount_ngn.toLocaleString()}</TableCell>
                                          <TableCell>
                                              <Badge variant={p.status === 'success' ? 'default' : 'secondary'} className={p.status === 'success' ? 'bg-green-100 text-green-700 hover:bg-green-100' : ''}>
                                                  {p.status}
                                              </Badge>
                                          </TableCell>
                                          <TableCell className="text-right font-mono text-xs text-muted-foreground">{p.reference.substring(0, 8)}...</TableCell>
                                      </TableRow>
                                  ))}
                              </TableBody>
                          </Table>
                      </div>
                  </>
              ) : (
                  <div className="text-center py-8 text-muted-foreground bg-muted/30 rounded-xl">
                      No payment history found.
                  </div>
              )}
          </div>
      </div>
  ) : null;

  const pricingOptions = (
      <div className="space-y-8">
          {isPromoUnlocked ? (
              <div className="mb-8 rounded-2xl border border-primary/30 bg-primary/5 p-4 text-sm">
                  <p className="font-semibold">{promoCopy.intro}</p>
                  <p className="text-muted-foreground">{proPlanCatalog?.metadata?.price_display ? `Pricing after promo: ${proPlanCatalog.metadata.price_display}` : promoCopy.pricing}</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                      Promo access keeps the {formatExpirationWindowLabel(FREE_PLAN_EXPIRATION_DAYS)} document expiration window.
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">{promoCopy.ending}</p>
              </div>
          ) : null}

          {!canAccessBilling && !isPromoUnlocked ? (
              <div className="rounded-3xl border border-amber-300 bg-amber-50/70 p-6 text-sm dark:border-amber-800 dark:bg-amber-950/20">
                  <p className="font-semibold text-amber-900 dark:text-amber-200">Billing is unavailable right now.</p>
                  <p className="mt-2 text-amber-800/90 dark:text-amber-300">
                      Current plan data stays visible, but checkout actions are disabled until billing verification completes.
                  </p>
              </div>
          ) : null}

          {checkoutNotice && canAccessBilling && !isPromoUnlocked ? (
              <div className="rounded-3xl border border-amber-300 bg-amber-50/70 p-6 text-sm dark:border-amber-800 dark:bg-amber-950/20">
                  <p className="font-semibold text-amber-900 dark:text-amber-200">Checkout is temporarily unavailable.</p>
                  <p className="mt-2 text-amber-800/90 dark:text-amber-300">
                      {checkoutNotice}
                  </p>
              </div>
          ) : null}

          <div className="grid grid-cols-1 gap-6 md:grid-cols-2 xl:grid-cols-3 xl:gap-8 items-start">
              <PricingCard
                  title={freePlanCatalog?.metadata?.label || 'Free'}
                  price={freePlanCatalog?.metadata?.price_display || 'Loading...'}
                  period="forever"
                  features={withLeadingFeature(
                      freeRetentionLabel,
                      freePlanCatalog?.metadata?.feature_bullets?.length ? freePlanCatalog.metadata.feature_bullets : [
                          'Core chat',
                          'Basic support',
                      ],
                  )}
                  onSelect={() => {}}
                  disabled={freeCardState.disabled}
                  ctaLabel={freeCardState.ctaLabel}
              />

              <OfflineGuard
                  asChild
                  blockWhenDegraded
                  degradedReason="Connection is unstable. Wait for sync to finish before starting checkout."
              >
                  <PricingCard
                      title={`${proPlanCatalog?.metadata?.label || 'Pro'} Monthly`}
                      price={pricing.monthly.amount > 0 ? `NGN ${pricing.monthly.amount.toLocaleString()}` : (proPlanCatalog?.metadata?.price_display || 'Loading...')}
                      originalPrice={pricing.monthly.compare_at > 0 ? `NGN ${pricing.monthly.compare_at.toLocaleString()}` : undefined}
                      period="month"
                      highlighted={monthlyCardState.isCurrent || !weeklyCardState.isCurrent}
                      savedLabel={pricing.monthly.label || proPlanCatalog?.pricing?.monthly?.label || undefined}
                      loading={loadingPlan === 'monthly'}
                      onSelect={() => handlePaymentCheckout('monthly')}
                      disabled={monthlyCardState.disabled}
                      ctaLabel={monthlyCardState.ctaLabel}
                      features={withLeadingFeature(
                          proRetentionLabel,
                          proPlanCatalog?.metadata?.feature_bullets?.length ? proPlanCatalog.metadata.feature_bullets : [
                              'Priority processing',
                              'Advanced data analysis',
                          ],
                      )}
                  />
              </OfflineGuard>

              <OfflineGuard
                  asChild
                  blockWhenDegraded
                  degradedReason="Connection is unstable. Wait for sync to finish before starting checkout."
              >
                  <PricingCard
                      title={`${proPlanCatalog?.metadata?.label || 'Pro'} Weekly`}
                      price={pricing.weekly.amount > 0 ? `NGN ${pricing.weekly.amount.toLocaleString()}` : (proPlanCatalog?.metadata?.price_display || 'Loading...')}
                      originalPrice={pricing.weekly.compare_at > 0 ? `NGN ${pricing.weekly.compare_at.toLocaleString()}` : undefined}
                      period="week"
                      highlighted={weeklyCardState.isCurrent}
                      savedLabel={pricing.weekly.label || proPlanCatalog?.pricing?.weekly?.label || undefined}
                      loading={loadingPlan === 'weekly'}
                      onSelect={() => handlePaymentCheckout('weekly')}
                      disabled={weeklyCardState.disabled}
                      ctaLabel={weeklyCardState.ctaLabel}
                      features={withLeadingFeature(
                          proRetentionLabel,
                          proPlanCatalog?.metadata?.feature_bullets?.length ? proPlanCatalog.metadata.feature_bullets : [
                              'All Pro features',
                              'Cancel anytime',
                              'Standard support',
                          ],
                      )}
                  />
              </OfflineGuard>
          </div>

          <div className="flex flex-col items-stretch justify-center gap-3 sm:flex-row sm:items-center">
              <OfflineGuard
                  asChild
                  blockWhenDegraded
                  degradedReason="Connection is unstable. Wait for sync to finish before starting checkout."
              >
                  <Button
                      variant="outline"
                      className="w-full sm:w-auto"
                      onClick={() => openManualBankTransfer('monthly')}
                      disabled={!canStartCheckoutForPlan({
                          planKey: 'pro_monthly',
                          state: currentPlan,
                          canAccessBilling,
                          checkout: checkoutCapability,
                      }) || !supportsTransferCheckout}
                      >
                          <Banknote className="mr-2 h-4 w-4" />
                      {monthlyCardState.isCurrent
                          ? 'Current Monthly Plan'
                          : monthlyCardState.disabled
                            ? 'Transfer Unavailable'
                            : 'Pay with Transfer (Monthly)'}
                  </Button>
              </OfflineGuard>
              <OfflineGuard
                  asChild
                  blockWhenDegraded
                  degradedReason="Connection is unstable. Wait for sync to finish before starting checkout."
              >
                  <Button
                      variant="outline"
                      className="w-full sm:w-auto"
                      onClick={() => openManualBankTransfer('weekly')}
                      disabled={!canStartCheckoutForPlan({
                          planKey: 'pro_weekly',
                          state: currentPlan,
                          canAccessBilling,
                          checkout: checkoutCapability,
                      }) || !supportsTransferCheckout}
                      >
                          <Banknote className="mr-2 h-4 w-4" />
                      {weeklyCardState.isCurrent
                          ? 'Current Weekly Plan'
                          : weeklyCardState.disabled
                            ? 'Transfer Unavailable'
                            : 'Pay with Transfer (Weekly)'}
                  </Button>
              </OfflineGuard>
          </div>
      </div>
  );

    // --- Main Render ---

  return (
    <div className="relative min-h-screen overflow-x-clip bg-transparent pb-16">
        {showSlowNotice && isBootLoading ? <SlowNetworkNotice onRetry={() => void fetchBillingStatus()} /> : null}
        {isUsingCachedData && networkState !== 'online' ? (
            <div className="mx-4 mt-4 rounded-lg border border-blue-200 bg-blue-50/80 px-4 py-2 text-xs text-blue-900 dark:border-blue-500/40 dark:bg-blue-950/30 dark:text-blue-100 md:mx-8">
                {isOnline ? 'Connection unstable' : 'Offline'}
                {' '}• showing cached subscription data{cachedAt ? ` from ${new Date(cachedAt).toLocaleString()}` : ''}.
            </div>
        ) : null}

        <div className="pointer-events-none absolute left-1/2 top-[-10rem] h-[24rem] w-[24rem] -translate-x-1/2 rounded-full bg-primary/10 blur-3xl" />

        <section className="relative border-b border-border bg-background px-4 py-12 text-center">
            <div className="mx-auto max-w-3xl space-y-4">
                <Badge variant="outline" className="mb-2 rounded-full px-4 py-1.5">
                    Upgrade your experience
                </Badge>
                <h1 className="text-3xl font-bold tracking-tight sm:text-4xl md:text-5xl">Simple, Transparent Pricing</h1>
                <p className="text-muted-foreground text-lg max-w-xl mx-auto leading-relaxed">
                    Unlock the full power of AU with flexible plans. Cancel anytime, no hidden fees.
                </p>

                {/* Toggle Switch */}
                {canAccessBilling && currentPlan.managedPlan !== 'premium' && (
                    <div className="flex flex-wrap items-center justify-center gap-4 pt-6">
                        <span className={cn("text-sm font-medium transition-colors", !isAutoRenew ? "text-foreground" : "text-muted-foreground") }>
                            One-time Transfer (manual renew)
                        </span>
                        <Switch
                            checked={isAutoRenew}
                            onCheckedChange={setIsAutoRenew}
                            disabled={isPromoUnlocked || !supportsSubscriptionCheckout}
                            className="data-[state=checked]:bg-primary"
                        />
                        <span className={cn("text-sm font-medium transition-colors", isAutoRenew ? "text-foreground" : "text-muted-foreground") }>
                            Auto-renew Subscription
                        </span>
                        {!supportsSubscriptionCheckout ? (
                            <span className="w-full text-center text-xs text-muted-foreground">
                                Auto-renew is unavailable on the current payment provider. One-time transfer checkout will be used.
                            </span>
                        ) : null}
                    </div>
                )}
            </div>
        </section>

        {/* Pricing Cards Grid */}
        <div className="container relative z-20 mx-auto max-w-6xl px-4 pt-10 sm:px-6">
            <UsageMeter />
            {activeBillingSummary}
            {pricingOptions}

            <div className="mt-12 text-center">
                 <div className="inline-flex max-w-full flex-wrap items-center justify-center gap-2 rounded-full border border-border bg-card/50 px-4 py-2 text-center text-xs text-muted-foreground shadow-sm">
                    <Lock className="h-3 w-3" />
                    <span>Secure payment processing. Encrypted and safe.</span>
                 </div>
            </div>
        </div>

        <Dialog open={showBankTransfer} onOpenChange={setShowBankTransfer}>
            <DialogContent className="sm:max-w-[430px]">
                <DialogHeader>
                    <DialogTitle>Pay With Transfer</DialogTitle>
                    <DialogDescription>
                        This uses an automated transfer channel. It is one-time and does not auto-renew.
                    </DialogDescription>
                </DialogHeader>
                <div className="space-y-4 py-2">
                    <div className="rounded-lg border bg-muted/40 p-4 text-sm">
                        <p className="font-medium">Selected plan: {manualPlan === 'weekly' ? 'Pro Weekly' : 'Pro Monthly'}</p>
                        <p className="text-muted-foreground">Amount: NGN {pricing[manualPlan].amount.toLocaleString()}</p>
                        <p className="mt-2 text-xs text-muted-foreground">
                            Transfer purchases are one-time only. Renew manually each period.
                        </p>
                    </div>
                    <Button
                        className="w-full"
                        onClick={() => void handlePaymentCheckout(manualPlan, 'transfer')}
                        disabled={
                            loadingPlan === manualPlan ||
                            !supportsTransferCheckout ||
                            !canStartCheckoutForPlan({
                                planKey: manualPlan === 'weekly' ? 'pro_weekly' : 'pro_monthly',
                                state: currentPlan,
                                canAccessBilling,
                                checkout: checkoutCapability,
                            })
                        }
                    >
                        {loadingPlan === manualPlan ? (
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        ) : (
                            <Banknote className="mr-2 h-4 w-4" />
                        )}
                        Continue to Transfer Checkout
                    </Button>
                </div>
            </DialogContent>
        </Dialog>
    </div>
  );
}
