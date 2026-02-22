'use client';

import { useEffect, useState, useRef, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { CheckCircle2, Loader2, AlertTriangle, ShieldCheck, Lock, Check, Clock, Copy, Banknote } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { supabase, invokeEdgeFunction } from '@/lib/supabase-client/client';
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

const PRICING = {
  weekly: { amount: 1900, compare_at: 2500, label: 'Save 24%' },
  monthly: { amount: 4500, compare_at: 6000, label: 'Save 25%' },
} as const;

export default function SubscriptionPage() {
  const [user, session] = useSupabaseUser();
  const { toast } = useToast();
  const searchParams = useSearchParams();
  const router = useRouter();
  const { isOnline } = useNetworkStatus();
  
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

  const [pricing, setPricing] = useState<{
    weekly: { amount: number; compare_at: number; label: string };
    monthly: { amount: number; compare_at: number; label: string };
  }>(PRICING);
  const isPromoUnlocked = !billingEnabled;

  const fetchBillingStatus = useCallback(async () => {
      if (!isOnline) return null;
      if (!session?.access_token) return null;
      try {
          const { data, error } = await invokeEdgeFunction<any>('billing-status', {
              method: 'GET',
              requireAuth: true,
              timeoutMs: 10000,
              silent: true,
          });
          if (!error && data) {
              setTier(data.tier || 'free');
              setExpiry(data.tier_expires_at);
              setSubscription(data.subscription);
              setPayments(data.payments || []);
              
              if (data.pricing) {
                  setPricing(data.pricing);
              }
              if (typeof data.billingEnabled === 'boolean') {
                  setBillingEnabled(data.billingEnabled);
              }
              
              // If user has active subscription, default to auto-renew view
              if (data.subscription?.status === 'active') {
                  setIsAutoRenew(true);
              }
              return data;
          }
      } catch (e) {
          console.error("Failed to fetch billing status", e);
      }
      return null;
  }, [isOnline, session?.access_token]);

  const fetchBillingConfig = useCallback(async () => {
      if (!isOnline) return;
      try {
          const { data } = await supabase
              .from('au_config')
              .select('billing_enabled')
              .limit(1)
              .maybeSingle();
          if (typeof data?.billing_enabled === 'boolean') {
              setBillingEnabled(data.billing_enabled);
          }
      } catch {
      }
  }, [isOnline]);

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
          const { error } = await supabase.from('au_manual_payments').insert({
              user_id: user.id,
              amount: pricing[manualPlan].amount,
              reference_code: manualPaymentRef,
              status: 'pending',
          });

          if (error) throw error;
          setManualPaymentStatus('success');
          toast({
              title: 'Payment Submitted',
              description: 'Your transfer has been submitted for confirmation.',
          });
      } catch (error: any) {
          setManualPaymentStatus('idle');
          toast({
              variant: 'destructive',
              title: 'Submission Failed',
              description: error?.message || 'Unable to submit transfer proof.',
          });
      }
  }, [manualPaymentRef, manualPlan, pricing, toast, user]);

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
          if (data && data.tier === 'pro') {
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
    if (!user) return;

    fetchBillingStatus();
    fetchBillingConfig();

    // Check for Paystack return
    const reference = searchParams.get('reference');
    const success = searchParams.get('success');
    
    if (reference) {
        setPaymentState('confirming');
        verifyPayment(reference);
    } else if (success === 'true') {
        setPaymentState('confirming');
        startPolling();
    }
    
    if (searchParams.get('cancelled') === 'true') {
        setPaymentState('error');
    }

    return () => stopPolling();
  }, [user, searchParams, fetchBillingConfig, fetchBillingStatus, verifyPayment, startPolling, stopPolling]);

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
    const percent = Math.min(100, (used / limit) * 100);
    const isLimit = used >= limit;
    return (
        <div>
            <div className="flex justify-between text-sm mb-1.5">
                <span className="font-medium text-foreground">{label}</span>
                <span className={cn("font-mono text-xs", isLimit ? "text-destructive font-bold" : "text-muted-foreground")}>
                    {used} / {limit}
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
    const [usage, setUsage] = useState<any>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        invokeEdgeFunction<any>('usage-status', { method: 'GET', silent: true })
            .then(({ data }) => setUsage(data))
            .catch((e) => console.error(e))
            .finally(() => setLoading(false));
    }, []);

    if (loading) return null;
    if (!usage || !usage.billingEnabled || usage.isPro) return null;

    return (
        <div className="bg-card rounded-3xl shadow-sm p-6 border border-border mb-8 max-w-4xl mx-auto">
            <div className="flex items-center gap-2 mb-4">
                <ShieldCheck className="h-5 w-5 text-primary" />
                <h2 className="text-lg font-bold text-foreground">Daily Free Limits</h2>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <LimitBar label="Chat Messages" used={usage.usage.chat} limit={usage.limits.chat} />
                <LimitBar label="Exam Generations" used={usage.usage.exam} limit={usage.limits.exam} />
                <LimitBar label="Document Uploads" used={usage.usage.upload} limit={usage.limits.upload} />
            </div>
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
    <div className="min-h-screen bg-background pb-16 relative">
        <div className="pointer-events-none absolute left-1/2 top-[-10rem] h-[24rem] w-[24rem] -translate-x-1/2 rounded-full bg-primary/10 blur-3xl" />

        <section className="relative border-b border-border bg-background px-4 py-12 text-center">
            <div className="mx-auto max-w-3xl space-y-4">
                <Badge variant="outline" className="mb-2 rounded-full px-4 py-1.5">
                    Upgrade your experience
                </Badge>
                <h1 className="text-4xl md:text-5xl font-bold tracking-tight">Simple, Transparent Pricing</h1>
                <p className="text-muted-foreground text-lg max-w-xl mx-auto leading-relaxed">
                    Unlock the full power of AI with flexible plans. Cancel anytime, no hidden fees.
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
            {tier === 'pro' ? (
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
                                    <span className="font-medium">Extended Context Window</span>
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
                    <div className="relative">
                        {isPromoUnlocked && (
                            <div className="absolute inset-0 z-20 flex items-center justify-center rounded-3xl bg-background/70 backdrop-blur-sm">
                                <div className="max-w-md rounded-2xl border border-primary/20 bg-card p-6 text-center shadow-xl">
                                    <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
                                        <CheckCircle2 className="h-6 w-6 text-primary" />
                                    </div>
                                    <h3 className="text-xl font-bold font-headline mb-2">Free Premium Access</h3>
                                    <p className="text-muted-foreground mb-4">
                                        Enjoy the ultimate features while it lasts! We&apos;ve unlocked Pro capabilities for everyone temporarily.
                                    </p>
                                    <Badge variant="outline" className="bg-primary/5 border-primary/20">Limited Time Offer</Badge>
                                </div>
                            </div>
                        )}

                        <div className={cn('grid grid-cols-1 md:grid-cols-3 gap-8 items-start', isPromoUnlocked && 'pointer-events-none opacity-60')}>
                            {/* Free Plan */}
                            <PricingCard
                                title="Basic"
                                price="NGN 0"
                                period="forever"
                                features={[
                                    'Max 4 documents',
                                    '14-day history retention',
                                    'Standard AI models',
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
                                        '30-day history retention',
                                        'Premium AI models (GPT-4)',
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
                    </div>

                    {!isPromoUnlocked && (
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
