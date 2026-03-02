'use client';

import { useEffect, useState, useRef, useCallback } from 'react';
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
import { useNetworkStatus } from '@/components/providers/network-status-provider';
import { safeFetch } from '@/lib/api/safe-fetch';
import { readUserCache, writeUserCache } from '@/lib/cache/user-cache';
import { useDelayedLoadingState } from '@/hooks/use-delayed-loading-state';
import { BillingPageSkeleton, SlowNetworkNotice } from '@/components/skeletons/page-skeletons';
import { useLimits } from '@/components/providers/limits-provider';

const PRICING = {
  weekly: { amount: 1500, compare_at: 2500, label: 'Save 40%' },
  monthly: { amount: 4500, compare_at: 6000, label: 'Save 25%' },
} as const;

const BILLING_ROUTE = '/dashboard/settings/subscription';
const BILLING_STATUS_SOURCE = 'billing-status';
const BILLING_CACHE_SCHEMA = 1;
const BILLING_CACHE_TTL_MS = 1000 * 60 * 30;

export default function SubscriptionPage() {
  const [user, session, isUserLoading] = useSupabaseUser();
  const { toast } = useToast();
  const searchParams = useSearchParams();
  const router = useRouter();
  const { isOnline } = useNetworkStatus();
  const { usage: limitsUsage } = useLimits();
  
  const [tier, setTier] = useState<string>('free');
  const [expiry, setExpiry] = useState<string | null>(null);
  const [subscription, setSubscription] = useState<any>(null);
  const [payments, setPayments] = useState<any[]>([]);
  
  // Toggle: true = Auto-renew (Card), false = Manual (Bank Transfer)
  const [isAutoRenew, setIsAutoRenew] = useState(true);

  // Loading states
  const [loadingPlan, setLoadingPlan] = useState<string | null>(null); // 'weekly', 'monthly'
  const [isCancelling, setIsCancelling] = useState(false);
  const [cancelReason, setCancelReason] = useState('');
  const [isCancelDialogOpen, setIsCancelDialogOpen] = useState(false);
  const [billingEnabled, setBillingEnabled] = useState(true);
  const [showBankTransfer, setShowBankTransfer] = useState(false);
  const [manualPlan, setManualPlan] = useState<'weekly' | 'monthly'>('monthly');
  const [promoActive, setPromoActive] = useState(false);
  const [promoEndsAtLabel, setPromoEndsAtLabel] = useState('April 2nd, 2026');
  const [entitlementSource, setEntitlementSource] = useState<'paid' | 'promo' | 'none'>('none');
  
  const [paymentState, setPaymentState] = useState<'idle' | 'redirecting' | 'confirming' | 'success' | 'pending' | 'error'>('idle');
  const [pollCount, setPollCount] = useState(0);
  const pollTimerRef = useRef<NodeJS.Timeout | null>(null);
  const [isInitialLoading, setIsInitialLoading] = useState(true);
  const [isUsingCachedData, setIsUsingCachedData] = useState(false);
  const [cachedAt, setCachedAt] = useState<number | null>(null);

  const [pricing, setPricing] = useState<{
    weekly: { amount: number; compare_at: number; label: string };
    monthly: { amount: number; compare_at: number; label: string };
  }>(PRICING);
  const isPromoUnlocked = promoActive;
  const hasPaidProAccess = tier === 'pro' && entitlementSource === 'paid';
  const retentionPolicyLabel = '7-day signed-out cleanup / 14-day inactivity cleanup';
  const freeRetentionLabel = retentionPolicyLabel;
  const proRetentionLabel = retentionPolicyLabel;

  const billingRequest = useCallback(async <T,>(path: string, init?: RequestInit): Promise<{ data: T; retryAfter: string | null }> => {
      const headers = new Headers(init?.headers || {});
      if (session?.access_token) {
          headers.set('Authorization', `Bearer ${session.access_token}`);
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

      return { data: parsed as T, retryAfter };
  }, [session?.access_token]);

  const applyBillingStatus = useCallback((data: any, options?: { fromCache?: boolean }) => {
      if (!data) return;
      setTier(data.tier || 'free');
      setExpiry(data.tier_expires_at ?? null);
      setSubscription(data.subscription ?? null);
      setPayments(Array.isArray(data.payments) ? data.payments : []);
      setBillingEnabled(data.billingEnabled ?? true);
      setEntitlementSource((data.entitlementSource || 'none') as 'paid' | 'promo' | 'none');
      setPromoActive(Boolean(data?.promo?.active));
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
      if (data.pricing) {
          setPricing(data.pricing);
      }
      if ((data.billingEnabled ?? true) && data.subscription?.status === 'active') {
          setIsAutoRenew(true);
      }
      if (options?.fromCache) {
          setIsUsingCachedData(true);
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
          if (cached.data) {
              applyBillingStatus(cached.data, { fromCache: true });
              setCachedAt(cached.cachedAt);
          }
          return cached.data;
      }
      try {
          const res = await billingRequest<any>('status', { method: 'GET' });
          if (res.data) {
              applyBillingStatus(res.data);
              setIsUsingCachedData(false);
              setCachedAt(Date.now());
              void writeCachedBillingStatus(res.data);
              return res.data;
          }
      } catch (e) {
          console.error("Failed to fetch billing status", e);
          const cached = await readCachedBillingStatus();
          if (cached.data) {
              applyBillingStatus(cached.data, { fromCache: true });
              setCachedAt(cached.cachedAt);
              return cached.data;
          }
      }
      return null;
  }, [applyBillingStatus, billingRequest, isOnline, readCachedBillingStatus, session?.access_token, user?.id, writeCachedBillingStatus]);

  const openManualBankTransfer = useCallback((planType: 'weekly' | 'monthly') => {
      if (isPromoUnlocked) {
          toast({
              title: 'Free Premium Access is active',
              description: 'Payment options are disabled while premium is temporarily unlocked.',
          });
          return;
      }
      setManualPlan(planType);
      setShowBankTransfer(true);
  }, [isPromoUnlocked, toast]);

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
          if (data && (data.billingEnabled ?? true) && data.tier === 'pro') {
              setPaymentState('success');
              stopPolling();
          }
      }, 3000);
  }, [fetchBillingStatus, stopPolling]);

  const verifyPayment = useCallback(async () => {
      if (!isOnline) return;
      if (!session?.access_token) return;
      try {
          const data = await fetchBillingStatus();
          if (data?.tier === 'pro') {
              setPaymentState('success');
              return;
          }
      } catch (e) {
          console.error("Verification failed", e);
      }
      startPolling();
  }, [fetchBillingStatus, isOnline, session?.access_token, startPolling]);

  // Initial Load & URL Check
  useEffect(() => {
    if (!user) {
        setIsInitialLoading(false);
        return;
    }

    let canceled = false;
    setIsInitialLoading(true);

    const bootstrap = async () => {
        await Promise.all([fetchBillingStatus()]);
        if (canceled) return;
        setIsInitialLoading(false);

        // Check for Paystack return
        const reference = searchParams.get('reference');
        const success = searchParams.get('success');
        
        if (reference) {
            setPaymentState('confirming');
            void verifyPayment();
        } else if (success === 'true') {
            setPaymentState('confirming');
            startPolling();
        }
        
        if (searchParams.get('cancelled') === 'true') {
            setPaymentState('error');
        }
    };

    void bootstrap();

    return () => {
        canceled = true;
        stopPolling();
    };
  }, [user, searchParams, fetchBillingStatus, verifyPayment, startPolling, stopPolling]);

  useEffect(() => {
      if (!isPromoUnlocked) return;
      setShowBankTransfer(false);
  }, [isPromoUnlocked]);

  const handlePaystack = async (
      planType: 'weekly' | 'monthly',
      methodOverride?: 'subscription' | 'transfer'
  ) => {
      if (!isOnline) {
          toast({ variant: 'destructive', title: 'Offline', description: 'Connect to the internet to manage billing.' });
          return;
      }
      if (isPromoUnlocked) {
          toast({ title: 'Free Premium Access is active', description: 'Payments are paused while premium is unlocked.' });
          return;
      }
      if (!session?.access_token) {
          toast({ variant: 'destructive', title: 'Sign in required', description: 'Sign in to manage billing.' });
          return;
      }
      setLoadingPlan(planType);
      
      try {
          const planKey = planType === 'weekly' ? 'pro_weekly' : 'pro_monthly';
          const paymentMethod = methodOverride || (isAutoRenew ? 'subscription' : 'transfer');
          const response = await billingRequest<{ authorization_url: string; reference: string }>('checkout', {
              method: 'POST',
              body: JSON.stringify({
                  plan_key: planKey,
                  payment_method: paymentMethod,
              }),
          });

          const url = response.data?.authorization_url;
          if (url) {
              setPaymentState('redirecting');
              setShowBankTransfer(false);
              window.location.href = url;
          } else {
              throw new Error('No authorization URL returned');
          }

      } catch (e: any) {
          console.error(e);
          if (Number(e?.status || 0) === 429) {
              toast({
                  variant: 'destructive',
                  title: 'High demand / rate limited — retry shortly.',
                  description: 'Checkout is temporarily rate limited. Please retry in a few seconds.',
              });
          } else {
              toast({ variant: 'destructive', title: 'Payment Error', description: e?.message || 'Failed to initialize payment' });
          }
          setLoadingPlan(null);
          setPaymentState('idle');
      }
  };

  const handleCancelSubscription = async () => {
      if (!isOnline) {
          toast({ variant: 'destructive', title: 'Offline', description: 'Connect to the internet to manage billing.' });
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

      setIsCancelling(true);
      try {
          await billingRequest('cancel', {
              method: 'POST',
              body: JSON.stringify({ reason: cancelReason }),
          });
          
          toast({ title: "Subscription Canceled", description: "Your plan will not renew." });
          setIsCancelDialogOpen(false);
          fetchBillingStatus();

      } catch (e: any) {
          toast({ variant: 'destructive', title: 'Error', description: e.message });
      } finally {
          setIsCancelling(false);
      }
  };

  const formatDate = (dateStr: string) => {
      if (!dateStr) return '';
      return new Date(dateStr).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
  };

  // --- Usage Meter ---
  const LimitBar = ({ label, used, limit }: any) => {
    const isUnlimited = !Number.isFinite(limit) || Number(limit) <= 0;
    const safeLimit = isUnlimited ? 1 : Number(limit);
    const safeUsed = Number.isFinite(used) ? used : 0;
    const percent = isUnlimited ? 0 : Math.min(100, (safeUsed / safeLimit) * 100);
    const isLimit = !isUnlimited && safeUsed >= safeLimit;
    return (
        <div>
            <div className="flex justify-between text-sm mb-1.5">
                <span className="font-medium text-foreground">{label}</span>
                <span className={cn("font-mono text-xs", isLimit ? "text-destructive font-bold" : "text-muted-foreground")}>
                    {isUnlimited ? `${safeUsed} / Unlimited` : `${safeUsed} / ${safeLimit}`}
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
    if (limitsUsage.loading) return null;

    const planCode = String(limitsUsage.plan || tier || 'free').toLowerCase();
    const isFreePlan = planCode === 'free';
    const usageTotal = limitsUsage.usageTotal || {};
    const limits = limitsUsage.limits || {};

    return (
        <div className="bg-card rounded-3xl shadow-sm p-6 border border-border mb-8 max-w-4xl mx-auto">
            <div className="flex items-center gap-2 mb-4">
                <ShieldCheck className="h-5 w-5 text-primary" />
                <h2 className="text-lg font-bold text-foreground">Limits & Usage</h2>
            </div>
            <p className="mb-4 text-xs text-muted-foreground">
              Plan: <span className="font-semibold text-foreground">{planCode.toUpperCase()}</span>
              {' • Fixed plan caps (no daily reset)'}
            </p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <LimitBar
                  label="Chat Messages"
                  used={Number(usageTotal.used_chats ?? usageTotal.messages_count ?? 0)}
                  limit={Number(limits.max_chats_total ?? 0)}
                />
                <LimitBar
                  label="Uploads"
                  used={Number(usageTotal.used_uploads ?? usageTotal.uploads_count ?? 0)}
                  limit={Number(limits.max_uploads_total ?? 0)}
                />
                <LimitBar
                  label="Tokens"
                  used={Number(usageTotal.used_tokens ?? usageTotal.tokens_used ?? 0)}
                  limit={Number(limits.max_tokens_total ?? 0)}
                />
                <LimitBar
                  label="Storage (MB)"
                  used={Math.round(Number(usageTotal.used_storage_mb ?? usageTotal.uploaded_mb ?? 0))}
                  limit={Number(limits.max_storage_mb ?? 0)}
                />
            </div>
            {isFreePlan && billingEnabled ? (
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
    disabled
  }: any) => (
    <div className={cn(
        "relative flex flex-col bg-card rounded-3xl shadow-sm overflow-hidden transition-all duration-300",
        highlighted ? "border-2 border-primary z-10 scale-105 shadow-xl shadow-primary/10" : "border border-border hover:scale-[1.02]",
        disabled && "opacity-80"
    )}>
      {/* Header with Curve */}
      <div className={cn(
          "pt-10 pb-16 px-6 text-center relative",
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
            <div className="flex items-baseline gap-1">
                <span className="text-4xl font-extrabold">{price}</span>
            </div>
            <span className={cn("text-xs font-medium uppercase mt-2", highlighted ? "text-primary-foreground/80" : "text-muted-foreground")}>
                /{period}
            </span>
         </div>

         {savedLabel && (
             <span className={cn(
                 "absolute top-4 right-4 text-[10px] font-bold px-3 py-1 rounded-full shadow-sm",
                 highlighted ? "bg-background text-primary" : "bg-primary/10 text-primary"
             )}>
                 {savedLabel}
             </span>
         )}
      </div>

      {/* Content */}
      <div className="p-8 pt-6 flex-1 flex flex-col items-center z-10 bg-card">
          <ul className="space-y-4 text-sm text-muted-foreground mb-8 w-full">
              {features.map((f: string, i: number) => (
                  <li key={i} className="flex items-center gap-3 text-left">
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
                {loading ? <Loader2 className="animate-spin" /> : (disabled ? 'CURRENT PLAN' : 'SELECT PLAN')}
             </Button>
          </div>
      </div>
    </div>
  );

  // --- Payment States ---
  const isBootLoading = isUserLoading || isInitialLoading;
  const { showSkeleton, showSlowNotice } = useDelayedLoadingState(isBootLoading);

  if (isBootLoading && showSkeleton && paymentState === 'idle') {
      return <BillingPageSkeleton />;
  }

  if (paymentState === 'redirecting') {
      return (
          <div className="container max-w-2xl py-20 text-center space-y-6">
              <div className="flex justify-center"><Loader2 className="h-16 w-16 animate-spin text-primary" /></div>
              <h2 className="text-2xl font-bold">Redirecting to secure checkout...</h2>
              <p className="text-muted-foreground">Please wait while we connect you to Paystack.</p>
              <div className="flex justify-center gap-2 text-sm text-muted-foreground">
                  <ShieldCheck className="h-4 w-4" /> Secured by Paystack
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

    // --- Main Render ---

  return (
    <div className="min-h-screen bg-transparent pb-16 relative">
        {showSlowNotice && isBootLoading ? <SlowNetworkNotice onRetry={() => void fetchBillingStatus()} /> : null}
        {isUsingCachedData && !isOnline ? (
            <div className="mx-4 mt-4 rounded-lg border border-blue-200 bg-blue-50/80 px-4 py-2 text-xs text-blue-900 dark:border-blue-500/40 dark:bg-blue-950/30 dark:text-blue-100 md:mx-8">
                Offline • showing cached subscription data{cachedAt ? ` from ${new Date(cachedAt).toLocaleString()}` : ''}.
            </div>
        ) : null}

        <div className="pointer-events-none absolute left-1/2 top-[-10rem] h-[24rem] w-[24rem] -translate-x-1/2 rounded-full bg-primary/10 blur-3xl" />

        <section className="relative border-b border-border bg-background px-4 py-12 text-center">
            <div className="mx-auto max-w-3xl space-y-4">
                <Badge variant="outline" className="mb-2 rounded-full px-4 py-1.5">
                    Upgrade your experience
                </Badge>
                <h1 className="text-4xl md:text-5xl font-bold tracking-tight">Simple, Transparent Pricing</h1>
                <p className="text-muted-foreground text-lg max-w-xl mx-auto leading-relaxed">
                    Unlock the full power of AU with flexible plans. Cancel anytime, no hidden fees.
                </p>

                {/* Toggle Switch */}
                {tier !== 'pro' && (
                    <div className="flex flex-wrap items-center justify-center gap-4 pt-6">
                        <span className={cn("text-sm font-medium transition-colors", !isAutoRenew ? "text-foreground" : "text-muted-foreground") }>
                            One-time Transfer (manual renew)
                        </span>
                        <Switch
                            checked={isAutoRenew}
                            onCheckedChange={setIsAutoRenew}
                            disabled={isPromoUnlocked}
                            className="data-[state=checked]:bg-primary"
                        />
                        <span className={cn("text-sm font-medium transition-colors", isAutoRenew ? "text-foreground" : "text-muted-foreground") }>
                            Auto-renew Subscription
                        </span>
                    </div>
                )}
            </div>
        </section>

        {/* Pricing Cards Grid */}
        <div className="container max-w-6xl mx-auto px-4 pt-10 relative z-20">
            <UsageMeter />
            {isPromoUnlocked ? (
                <div className="mb-8 rounded-2xl border border-primary/30 bg-primary/5 p-4 text-sm">
                    <p className="font-semibold">You are currently on Promo Pro.</p>
                    <p className="text-muted-foreground">
                        On April 2nd, 2026, Pro becomes NGN 4,500/month or NGN 1,500/week.
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                        Promo ends at {promoEndsAtLabel} Africa/Lagos time.
                    </p>
                </div>
            ) : null}
            {hasPaidProAccess ? (
                // Active Pro View
                <div className="max-w-4xl mx-auto space-y-8">
                    {/* Subscription Status */}
                    <div className="bg-card rounded-3xl shadow-sm p-8 border border-border">
                        <div className="flex items-center justify-between mb-8">
                            <div>
                                <h2 className="text-2xl font-bold text-foreground">Pro Plan Active</h2>
                                <p className="text-muted-foreground mt-1">You have full access to all premium features.</p>
                            </div>
                            <div className="h-12 w-12 bg-green-100 rounded-full flex items-center justify-center">
                                <CheckCircle2 className="h-6 w-6 text-green-600" />
                            </div>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-8 mb-8">
                            <div className="space-y-4">
                                <div className="flex items-center gap-3">
                                    <CheckCircle2 className="h-5 w-5 text-primary" />
                                    <span className="font-medium">Unlimited Premium Models</span>
                                </div>
                                <div className="flex items-center gap-3">
                                    <CheckCircle2 className="h-5 w-5 text-primary" />
                                    <span className="font-medium">High-Priority Processing</span>
                                </div>
                                <div className="flex items-center gap-3">
                                    <CheckCircle2 className="h-5 w-5 text-primary" />
                                    <span className="font-medium">7-day signed-out / 14-day inactivity cleanup</span>
                                </div>
                            </div>
                            <div className="bg-muted/40 rounded-2xl p-6">
                                <div className="text-sm text-muted-foreground mb-1">
                                    {subscription?.status === 'active' ? 'Renews on' : 'Expires on'}
                                </div>
                                <div className="text-2xl font-bold text-foreground mb-4">
                                    {formatDate(expiry || '')}
                                </div>
                                {subscription?.status === 'active' ? (
                                    <OfflineGuard>
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
                                ) : (
                                    <OfflineGuard>
                                        <Button className="w-full bg-primary hover:bg-primary/90" onClick={() => setTier('free')}>
                                            Re-subscribe
                                        </Button>
                                    </OfflineGuard>
                                )}
                            </div>
                        </div>
                    </div>

                    {/* Payment History Table */}
                    <div className="bg-card rounded-3xl shadow-sm p-8 border border-border">
                        <div className="flex items-center gap-2 mb-6">
                            <Clock className="h-5 w-5 text-muted-foreground" />
                            <h2 className="text-xl font-bold text-foreground">Payment History</h2>
                        </div>

                        {payments.length > 0 ? (
                            <div className="overflow-x-auto">
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
                        ) : (
                            <div className="text-center py-8 text-muted-foreground bg-muted/30 rounded-xl">
                                No payment history found.
                            </div>
                        )}
                    </div>
                </div>
            ) : (
                // Pricing Options
                <div className="space-y-8">
                    {isPromoUnlocked ? (
                        <div className="relative min-h-[440px] overflow-hidden rounded-3xl border border-primary/20 bg-card">
                            <div className="absolute inset-0 z-0 p-6">
                                <div className="grid h-full grid-cols-1 gap-6 md:grid-cols-3">
                                    <div className="rounded-3xl border border-border/60 bg-muted/30" />
                                    <div className="rounded-3xl border border-border/60 bg-muted/30" />
                                    <div className="rounded-3xl border border-border/60 bg-muted/30" />
                                </div>
                            </div>
                            <div className="absolute inset-0 z-10 bg-background/85 backdrop-blur-sm" />
                            <div className="absolute inset-0 z-20 flex items-center justify-center p-6">
                                <div className="max-w-lg rounded-2xl border border-primary/20 bg-card p-8 text-center shadow-xl">
                                    <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
                                        <CheckCircle2 className="h-6 w-6 text-primary" />
                                    </div>
                                    <h3 className="mb-2 text-xl font-bold font-headline">Free Premium Access</h3>
                                    <p className="mb-4 text-muted-foreground">
                                        You are currently on Promo Pro. Access remains active until April 2nd, 2026 (Africa/Lagos).
                                    </p>
                                    <p className="mb-4 text-xs text-muted-foreground">
                                        After promo ends, only active paid entitlements retain Pro access.
                                    </p>
                                    <Badge variant="outline" className="border-primary/20 bg-primary/5">Limited Time Offer</Badge>
                                </div>
                            </div>
                        </div>
                    ) : (
                        <>
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-8 items-start">
                                {/* Free Plan */}
                                <PricingCard
                                    title="Basic"
                                    price="NGN 0"
                                    period="forever"
                                    features={[
                                        'Max 4 documents',
                                        freeRetentionLabel,
                                        'Standard AU models',
                                        'Basic support'
                                    ]}
                                    onSelect={() => {}}
                                    disabled={true}
                                />

                                {/* Monthly (Highlighted) */}
                                <OfflineGuard asChild>
                                    <PricingCard
                                        title="Pro Monthly"
                                        price={`NGN ${pricing.monthly.amount.toLocaleString()}`}
                                        originalPrice={`NGN ${pricing.monthly.compare_at.toLocaleString()}`}
                                        period="month"
                                        highlighted={true}
                                        savedLabel={pricing.monthly.label}
                                        loading={loadingPlan === 'monthly'}
                                        onSelect={() => handlePaystack('monthly')}
                                        disabled={isPromoUnlocked}
                                        features={[
                                            'Unlimited documents',
                                            proRetentionLabel,
                                            'Premium AU models',
                                            'Priority processing',
                                            'Advanced data analysis',
                                            'Priority support'
                                        ]}
                                    />
                                </OfflineGuard>

                                {/* Weekly */}
                                <OfflineGuard asChild>
                                    <PricingCard
                                        title="Pro Weekly"
                                        price={`NGN ${pricing.weekly.amount.toLocaleString()}`}
                                        originalPrice={`NGN ${pricing.weekly.compare_at.toLocaleString()}`}
                                        period="week"
                                        savedLabel={pricing.weekly.label}
                                        loading={loadingPlan === 'weekly'}
                                        onSelect={() => handlePaystack('weekly')}
                                        disabled={isPromoUnlocked}
                                        features={[
                                            'All Pro features',
                                            '7-day access',
                                            'Cancel anytime',
                                            'Standard support'
                                        ]}
                                    />
                                </OfflineGuard>
                            </div>

                            <div className="flex flex-col items-center justify-center gap-3 sm:flex-row">
                                <OfflineGuard asChild>
                                    <Button variant="outline" onClick={() => openManualBankTransfer('monthly')}>
                                        <Banknote className="mr-2 h-4 w-4" />
                                        Pay with Transfer (Monthly)
                                    </Button>
                                </OfflineGuard>
                                <OfflineGuard asChild>
                                    <Button variant="outline" onClick={() => openManualBankTransfer('weekly')}>
                                        <Banknote className="mr-2 h-4 w-4" />
                                        Pay with Transfer (Weekly)
                                    </Button>
                                </OfflineGuard>
                            </div>
                        </>
                    )}

                </div>
            )}

            <div className="mt-12 text-center">
                 <div className="inline-flex items-center gap-2 text-xs text-muted-foreground bg-card/50 px-4 py-2 rounded-full border border-border shadow-sm">
                    <Lock className="h-3 w-3" />
                    <span>Secure payment processing by Paystack. Encrypted and safe.</span>
                 </div>
            </div>
        </div>

        <Dialog open={showBankTransfer} onOpenChange={setShowBankTransfer}>
            <DialogContent className="sm:max-w-[430px]">
                <DialogHeader>
                    <DialogTitle>Pay With Transfer</DialogTitle>
                    <DialogDescription>
                        This uses Paystack's automated transfer channel. It is one-time and does not auto-renew.
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
                        onClick={() => void handlePaystack(manualPlan, 'transfer')}
                        disabled={loadingPlan === manualPlan}
                    >
                        {loadingPlan === manualPlan ? (
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        ) : (
                            <Banknote className="mr-2 h-4 w-4" />
                        )}
                        Continue to Paystack Transfer
                    </Button>
                </div>
            </DialogContent>
        </Dialog>
    </div>
  );
}
