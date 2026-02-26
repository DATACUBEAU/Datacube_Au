'use client';

import { useEffect, useState, useRef, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { CheckCircle2, Loader2, AlertTriangle, ShieldCheck, Lock, Check, Clock, Copy, Banknote } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { invokeEdgeFunction } from '@/lib/supabase-client/client';
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
import { readUserCache, writeUserCache } from '@/lib/cache/user-cache';
import { useDelayedLoadingState } from '@/hooks/use-delayed-loading-state';
import { BillingPageSkeleton, SlowNetworkNotice } from '@/components/skeletons/page-skeletons';
import { useFlag } from '@/components/feature-flag-provider';
import { useLimits } from '@/components/providers/limits-provider';

const PRICING = {
  weekly: { amount: 1900, compare_at: 2500, label: 'Save 24%' },
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
  const { enabled: billingFlagEnabled } = useFlag('billing_enabled');
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
  const [manualPaymentRef, setManualPaymentRef] = useState('');
  const [manualPlan, setManualPlan] = useState<'weekly' | 'monthly'>('monthly');
  const [manualPaymentStatus, setManualPaymentStatus] = useState<'idle' | 'submitting' | 'success'>('idle');
  
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
  const isPromoUnlocked = billingEnabled === false;
  const hasPaidProAccess = billingEnabled && tier === 'pro';
  const freeRetentionLabel = '14-day history retention';
  const proRetentionLabel = isPromoUnlocked
    ? '14-day history retention (promo mode)'
    : '30-day history retention';

  useEffect(() => {
      setBillingEnabled(billingFlagEnabled);
  }, [billingFlagEnabled]);

  const applyBillingStatus = useCallback((data: any, options?: { fromCache?: boolean }) => {
      if (!data) return;
      setTier(data.tier || 'free');
      setExpiry(data.tier_expires_at ?? null);
      setSubscription(data.subscription ?? null);
      setPayments(Array.isArray(data.payments) ? data.payments : []);
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
          const { data, error } = await invokeEdgeFunction<any>('billing-status', {
              method: 'GET',
              requireAuth: true,
              timeoutMs: 10000,
              silent: true,
          });
          if (!error && data) {
              applyBillingStatus(data);
              setIsUsingCachedData(false);
              setCachedAt(Date.now());
              void writeCachedBillingStatus(data);
              return data;
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
  }, [applyBillingStatus, isOnline, readCachedBillingStatus, session?.access_token, user?.id, writeCachedBillingStatus]);

  const generateReference = useCallback((planType: 'weekly' | 'monthly') => {
      const suffix = Math.floor(Math.random() * 10000).toString().padStart(4, '0');
      const userPrefix = (user?.id ?? 'anon').slice(0, 4).toUpperCase();
      const planPrefix = planType === 'weekly' ? 'WK' : 'MO';
      return `PAY-${planPrefix}-${userPrefix}-${suffix}`;
  }, [user?.id]);

  const openManualBankTransfer = useCallback((planType: 'weekly' | 'monthly') => {
      if (isPromoUnlocked) {
          toast({
              title: 'Free Premium Access is active',
              description: 'Payment options are disabled while premium is temporarily unlocked.',
          });
          return;
      }
      setManualPlan(planType);
      setManualPaymentRef(generateReference(planType));
      setManualPaymentStatus('idle');
      setShowBankTransfer(true);
  }, [generateReference, isPromoUnlocked, toast]);

  const handleManualPaymentSubmit = useCallback(async () => {
      if (!user) return;
      setManualPaymentStatus('submitting');
      try {
          const { error } = await invokeEdgeFunction<any>('submit-manual-payment', {
              method: 'POST',
              requireAuth: true,
              body: {
                  plan: manualPlan,
                  amount: pricing[manualPlan].amount,
                  reference: manualPaymentRef,
              },
          });
          if (error) throw error;

          setManualPaymentStatus('success');
          toast({
              title: 'Payment Submitted',
              description: 'Your transfer has been submitted for confirmation.',
          });
          void fetchBillingStatus();
      } catch (error: any) {
          setManualPaymentStatus('idle');
          toast({
              variant: 'destructive',
              title: 'Submission Failed',
              description: error?.message || 'Unable to submit transfer proof.',
          });
      }
  }, [fetchBillingStatus, manualPaymentRef, manualPlan, pricing, toast, user]);

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

  const verifyPayment = useCallback(async (ref: string) => {
      if (!isOnline) return;
      if (!session?.access_token) return;
      try {
          const { data, error } = await invokeEdgeFunction<any>(`paystack-verify?reference=${encodeURIComponent(ref)}`, {
              method: 'GET',
              requireAuth: true,
              timeoutMs: 10000,
              silent: true,
          });
          if (!error && data?.status === 'success') {
              setPaymentState('success');
              fetchBillingStatus();
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
            void verifyPayment(reference);
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
      setManualPaymentStatus('idle');
  }, [isPromoUnlocked]);

  const handlePaystack = async (planType: 'weekly' | 'monthly') => {
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
          const returnUrl = `${window.location.origin}/dashboard/settings/subscription`;
          
          // If Auto-renew: Subscription Mode, Card only
          // If Manual: One-time Mode, Bank Transfer + Card
          const mode = isAutoRenew ? 'subscription' : 'one_time';
          const channels = isAutoRenew ? ['card'] : ['bank_transfer', 'card'];

          const { data, error: invokeError } = await invokeEdgeFunction<any>('paystack-initiate', {
              method: 'POST',
              requireAuth: true,
              body: { 
                  email: user?.email,
                  planType,
                  channels,
                  mode,
                  redirectUrls: {
                      success: `${returnUrl}?success=true`,
                      cancel: `${returnUrl}?cancelled=true`
                  }
              }
          });

          if (invokeError) throw new Error(invokeError.message || 'Failed to initiate payment');
          const { url, error } = data || {};
          if (error) throw new Error(error);
          
          if (url) {
              setPaymentState('redirecting');
              window.location.href = url;
          } else {
              throw new Error('No authorization URL returned');
          }

      } catch (e: any) {
          console.error(e);
          toast({ variant: 'destructive', title: 'Payment Error', description: e?.message || 'Failed to initialize payment' });
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
          const { data, error } = await invokeEdgeFunction('paystack-cancel-subscription', {
              method: 'POST',
              requireAuth: true,
              body: { reason: cancelReason }
          });

          if (error) throw new Error(error.message || 'Failed to cancel');
          
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
    const safeLimit = Number.isFinite(limit) && limit > 0 ? limit : 1;
    const safeUsed = Number.isFinite(used) ? used : 0;
    const percent = Math.min(100, (safeUsed / safeLimit) * 100);
    const isLimit = safeUsed >= safeLimit;
    return (
        <div>
            <div className="flex justify-between text-sm mb-1.5">
                <span className="font-medium text-foreground">{label}</span>
                <span className={cn("font-mono text-xs", isLimit ? "text-destructive font-bold" : "text-muted-foreground")}>
                    {safeUsed} / {safeLimit}
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
    const usageToday = limitsUsage.usageToday || {};
    const usageTotal = limitsUsage.usageTotal || {};
    const limits = limitsUsage.limits || {};
    const resetAt = limitsUsage.resetAt;

    return (
        <div className="bg-card rounded-3xl shadow-sm p-6 border border-border mb-8 max-w-4xl mx-auto">
            <div className="flex items-center gap-2 mb-4">
                <ShieldCheck className="h-5 w-5 text-primary" />
                <h2 className="text-lg font-bold text-foreground">Limits & Usage</h2>
            </div>
            <p className="mb-4 text-xs text-muted-foreground">
              Plan: <span className="font-semibold text-foreground">{planCode.toUpperCase()}</span>
              {resetAt ? ` • Resets at ${new Date(resetAt).toLocaleTimeString()}` : ''}
            </p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <LimitBar
                  label="Daily Messages"
                  used={Number(usageToday.messages_count || 0)}
                  limit={Number(limits.max_messages_per_day || 0)}
                />
                <LimitBar
                  label="Daily Uploads"
                  used={Number(usageToday.uploads_count || 0)}
                  limit={Number(limits.max_uploads_per_day || 0)}
                />
                <LimitBar
                  label="Daily Tokens"
                  used={Number(usageToday.tokens_used || 0)}
                  limit={Number(limits.max_tokens_per_day || 0)}
                />
                <LimitBar
                  label="Storage (MB)"
                  used={Math.round(Number(usageTotal.uploaded_mb || 0))}
                  limit={Number(limits.max_storage_mb || 0)}
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
                            One-time Payment
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
                                    <span className="font-medium">30-day history retention</span>
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
                                        Enjoy the ultimate features while it lasts! We&apos;ve unlocked Pro capabilities for everyone temporarily.
                                    </p>
                                    <p className="mb-4 text-xs text-muted-foreground">
                                        Note: Document history retention remains 14 days in promo mode.
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
                                        Pay via Bank Transfer (Monthly)
                                    </Button>
                                </OfflineGuard>
                                <OfflineGuard asChild>
                                    <Button variant="outline" onClick={() => openManualBankTransfer('weekly')}>
                                        <Banknote className="mr-2 h-4 w-4" />
                                        Pay via Bank Transfer (Weekly)
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
                    <DialogTitle>Bank Transfer Payment</DialogTitle>
                    <DialogDescription>
                        Transfer the exact amount below and submit for verification.
                    </DialogDescription>
                </DialogHeader>

                {manualPaymentStatus === 'success' ? (
                    <div className="flex flex-col items-center justify-center py-8 space-y-4 text-center">
                        <div className="h-16 w-16 bg-green-100 text-green-600 rounded-full flex items-center justify-center">
                            <CheckCircle2 className="h-8 w-8" />
                        </div>
                        <div>
                            <h3 className="font-bold text-lg">Payment Submitted</h3>
                            <p className="text-sm text-muted-foreground mt-1">
                                We will activate your Pro access once the transfer is confirmed.
                            </p>
                        </div>
                        <Button onClick={() => setShowBankTransfer(false)} className="w-full">Close</Button>
                    </div>
                ) : (
                    <div className="space-y-6 py-1">
                        <div className="p-4 bg-muted rounded-lg space-y-3">
                            <div className="flex justify-between text-sm">
                                <span className="text-muted-foreground">Bank Name:</span>
                                <span className="font-bold">Moniepoint / OPay</span>
                            </div>
                            <div className="flex justify-between text-sm">
                                <span className="text-muted-foreground">Account Name:</span>
                                <span className="font-bold">Datacube AU Systems</span>
                            </div>
                            <div className="flex justify-between text-sm items-center">
                                <span className="text-muted-foreground">Account Number:</span>
                                <div className="flex items-center gap-2">
                                    <span className="font-mono font-bold text-lg">8023456789</span>
                                    <Button
                                        variant="ghost"
                                        size="icon"
                                        className="h-6 w-6"
                                        onClick={() => {
                                            navigator.clipboard.writeText('8023456789');
                                            toast({ title: 'Copied' });
                                        }}
                                    >
                                        <Copy className="h-3 w-3" />
                                    </Button>
                                </div>
                            </div>
                            <div className="flex justify-between text-sm pt-2 border-t border-dashed border-border">
                                <span className="text-muted-foreground">Amount:</span>
                                <span className="font-bold text-primary">NGN {pricing[manualPlan].amount.toLocaleString()}</span>
                            </div>
                            <div className="flex justify-between text-sm items-center">
                                <span className="text-muted-foreground">Reference Code:</span>
                                <span className="font-mono font-bold bg-background px-2 py-1 rounded border select-all">{manualPaymentRef}</span>
                            </div>
                        </div>

                        <div className="text-xs text-amber-800 bg-amber-50 p-3 rounded border border-amber-200">
                            <p className="font-bold flex items-center gap-1"><AlertTriangle className="h-3 w-3" /> Important</p>
                            Include the reference code in your transfer narration for faster confirmation.
                        </div>

                        <Button onClick={handleManualPaymentSubmit} disabled={manualPaymentStatus === 'submitting'} className="w-full">
                            {manualPaymentStatus === 'submitting' ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CheckCircle2 className="mr-2 h-4 w-4" />}
                            I Have Made the Transfer
                        </Button>
                    </div>
                )}
            </DialogContent>
        </Dialog>
    </div>
  );
}
