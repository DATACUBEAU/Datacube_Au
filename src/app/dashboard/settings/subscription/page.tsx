'use client';

import { useEffect, useState, useRef, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { CheckCircle2, Loader2, AlertTriangle, ShieldCheck, Lock, Check, Clock } from 'lucide-react';
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
  
  const [paymentState, setPaymentState] = useState<'idle' | 'redirecting' | 'confirming' | 'success' | 'pending' | 'error'>('idle');
  const [pollCount, setPollCount] = useState(0);
  const pollTimerRef = useRef<NodeJS.Timeout | null>(null);

  const [pricing, setPricing] = useState<{
    weekly: { amount: number; compare_at: number; label: string };
    monthly: { amount: number; compare_at: number; label: string };
  }>(PRICING);

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
  }, [fetchBillingStatus, startPolling]);

  // Initial Load & URL Check
  useEffect(() => {
    if (!user) return;

    fetchBillingStatus();

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
  }, [user, searchParams, fetchBillingStatus, verifyPayment, startPolling, stopPolling]);

  const handlePaystack = async (planType: 'weekly' | 'monthly') => {
      if (!isOnline) {
          toast({ variant: 'destructive', title: 'Offline', description: 'Connect to the internet to manage billing.' });
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

          if (invokeError) throw new Error(invokeError.message || "Failed to initiate payment");
          const { url, error } = data || {};
          if (error) throw new Error(error);
          
          if (url) {
              setPaymentState('redirecting');
              window.location.href = url;
          } else {
              throw new Error("No authorization URL returned");
          }

      } catch (e: any) {
          console.error(e);
          toast({ variant: 'destructive', title: 'Payment Error', description: e.message || "Failed to initialize payment" });
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
                <span className="font-medium text-gray-700">{label}</span>
                <span className={cn("font-mono text-xs", isLimit ? "text-red-600 font-bold" : "text-gray-500")}>
                    {used} / {limit}
                </span>
            </div>
            <div className="h-2.5 bg-gray-100 rounded-full overflow-hidden">
                <div 
                    className={cn("h-full transition-all duration-500", isLimit ? "bg-red-500" : "bg-purple-600")} 
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
        <div className="bg-white rounded-3xl shadow-xl p-6 border border-gray-100 mb-8 max-w-4xl mx-auto">
            <div className="flex items-center gap-2 mb-4">
                <ShieldCheck className="h-5 w-5 text-purple-600" />
                <h2 className="text-lg font-bold text-gray-900">Daily Free Limits</h2>
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
        "relative flex flex-col bg-white rounded-3xl shadow-xl overflow-hidden transition-all duration-300",
        highlighted ? "border-2 border-purple-500 z-10 scale-105 shadow-2xl" : "border border-gray-100 hover:scale-[1.02]",
        disabled && "opacity-80"
    )}>
      {/* Header with Curve */}
      <div className={cn(
          "pt-10 pb-16 px-6 text-center relative",
          highlighted ? "bg-purple-600 text-white" : "bg-gray-50 text-gray-900"
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
                     highlighted ? "text-purple-200" : "text-gray-400"
                 )}>
                     {originalPrice}
                 </div>
             )}
            <div className="flex items-baseline gap-1">
                <span className="text-4xl font-extrabold">{price}</span>
            </div>
            <span className={cn("text-xs font-medium uppercase mt-2", highlighted ? "text-purple-100" : "text-muted-foreground")}>
                /{period}
            </span>
         </div>

         {savedLabel && (
             <span className={cn(
                 "absolute top-4 right-4 text-[10px] font-bold px-3 py-1 rounded-full shadow-sm",
                 highlighted ? "bg-white text-purple-700" : "bg-purple-100 text-purple-700"
             )}>
                 {savedLabel}
             </span>
         )}
      </div>

      {/* Content */}
      <div className="p-8 pt-6 flex-1 flex flex-col items-center z-10 bg-white">
          <ul className="space-y-4 text-sm text-gray-600 mb-8 w-full">
              {features.map((f: string, i: number) => (
                  <li key={i} className="flex items-center gap-3 text-left">
                      <Check className={cn("h-5 w-5 shrink-0", highlighted ? "text-purple-600" : "text-gray-400")} />
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
                        ? "bg-purple-600 hover:bg-purple-700 text-white shadow-lg shadow-purple-200 hover:shadow-purple-300" 
                        : "bg-white border-2 border-purple-100 hover:border-purple-600 hover:text-purple-600 text-gray-600",
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
              <div className="flex justify-center"><Loader2 className="h-16 w-16 animate-spin text-purple-600" /></div>
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
              <div className="flex justify-center"><Loader2 className="h-16 w-16 animate-spin text-purple-600" /></div>
              <h2 className="text-2xl font-bold">Confirming your payment...</h2>
              <p className="text-muted-foreground">We’re verifying your payment. This usually takes a few seconds.</p>
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
              <h2 className="text-3xl font-bold">You’re Pro 🎉</h2>
              <p className="text-lg text-muted-foreground">Your subscription is active. Enjoy higher limits, premium models, and advanced tools.</p>
              <Button onClick={() => router.push('/dashboard')} size="lg" className="mt-4 bg-purple-600 hover:bg-purple-700 rounded-full px-8">
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
    <div className="min-h-screen bg-gray-50/50 pb-20 relative">
        {/* Top Hero Section */}
        <div className="bg-purple-700 text-white pt-12 pb-32 px-4 text-center rounded-b-[2.5rem] relative overflow-hidden">
            <div className="absolute top-0 left-0 w-full h-full opacity-10 bg-[url('/grid-pattern.svg')]"></div>
            <div className="relative z-10 max-w-3xl mx-auto space-y-4">
                <Badge className="bg-purple-500/30 text-purple-100 hover:bg-purple-500/40 border-0 mb-4 px-4 py-1.5 rounded-full backdrop-blur-sm">
                    ✨ Upgrade your experience
                </Badge>
                <h1 className="text-4xl md:text-5xl font-bold tracking-tight">Simple, Transparent Pricing</h1>
                <p className="text-purple-100 text-lg max-w-xl mx-auto leading-relaxed">
                    Unlock the full power of AI with our flexible subscription plans. 
                    Cancel anytime, no hidden fees.
                </p>

                {/* Toggle Switch */}
                {tier !== 'pro' && (
                    <div className="flex items-center justify-center gap-4 pt-8 animate-in fade-in slide-in-from-bottom-4 duration-700">
                        <span className={cn("text-sm font-medium transition-colors", !isAutoRenew ? "text-white" : "text-purple-200")}>
                            One-time Payment
                        </span>
                        <Switch 
                            checked={isAutoRenew} 
                            onCheckedChange={setIsAutoRenew}
                            className="data-[state=checked]:bg-white data-[state=unchecked]:bg-purple-900 border-2 border-transparent"
                        />
                        <span className={cn("text-sm font-medium transition-colors", isAutoRenew ? "text-white" : "text-purple-200")}>
                            Auto-renew Subscription
                        </span>
                    </div>
                )}
            </div>
        </div>

        {/* Pricing Cards Grid */}
        <div className="container max-w-6xl mx-auto px-4 -mt-20 relative z-20">
            <UsageMeter />
            {tier === 'pro' ? (
                // Active Pro View
                <div className="max-w-4xl mx-auto space-y-8">
                    {/* Subscription Status */}
                    <div className="bg-white rounded-3xl shadow-xl p-8 border border-purple-100">
                        <div className="flex items-center justify-between mb-8">
                            <div>
                                <h2 className="text-2xl font-bold text-gray-900">Pro Plan Active</h2>
                                <p className="text-muted-foreground mt-1">You have full access to all premium features.</p>
                            </div>
                            <div className="h-12 w-12 bg-green-100 rounded-full flex items-center justify-center">
                                <CheckCircle2 className="h-6 w-6 text-green-600" />
                            </div>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-8 mb-8">
                            <div className="space-y-4">
                                <div className="flex items-center gap-3">
                                    <CheckCircle2 className="h-5 w-5 text-purple-600" />
                                    <span className="font-medium">Unlimited Premium Models</span>
                                </div>
                                <div className="flex items-center gap-3">
                                    <CheckCircle2 className="h-5 w-5 text-purple-600" />
                                    <span className="font-medium">High-Priority Processing</span>
                                </div>
                                <div className="flex items-center gap-3">
                                    <CheckCircle2 className="h-5 w-5 text-purple-600" />
                                    <span className="font-medium">Extended Context Window</span>
                                </div>
                            </div>
                            <div className="bg-gray-50 rounded-2xl p-6">
                                <div className="text-sm text-muted-foreground mb-1">
                                    {subscription?.status === 'active' ? 'Renews on' : 'Expires on'}
                                </div>
                                <div className="text-2xl font-bold text-gray-900 mb-4">
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
                                        <Button className="w-full bg-purple-600 hover:bg-purple-700" onClick={() => setTier('free')}>
                                            Re-subscribe
                                        </Button>
                                    </OfflineGuard>
                                )}
                            </div>
                        </div>
                    </div>

                    {/* Payment History Table */}
                    <div className="bg-white rounded-3xl shadow-xl p-8 border border-gray-100">
                        <div className="flex items-center gap-2 mb-6">
                            <Clock className="h-5 w-5 text-gray-500" />
                            <h2 className="text-xl font-bold text-gray-900">Payment History</h2>
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
                                                <TableCell>₦{p.amount_ngn.toLocaleString()}</TableCell>
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
                            <div className="text-center py-8 text-muted-foreground bg-gray-50 rounded-xl">
                                No payment history found.
                            </div>
                        )}
                    </div>
                </div>
            ) : (
                // Pricing Options
                <div className="grid grid-cols-1 md:grid-cols-3 gap-8 items-start">
                    {/* Free Plan */}
                    <PricingCard 
                        title="Basic"
                        price="₦0"
                        period="forever"
                        features={[
                            "Max 4 documents",
                            "14-day history retention",
                            "Standard AI models",
                            "Basic support"
                        ]}
                        onSelect={() => {}}
                        disabled={true}
                    />

                    {/* Monthly (Highlighted) */}
                    <OfflineGuard asChild>
                        <PricingCard 
                            title="Pro Monthly"
                            price={`₦${pricing.monthly.amount.toLocaleString()}`}
                            originalPrice={`₦${pricing.monthly.compare_at.toLocaleString()}`}
                            period="month"
                            highlighted={true}
                            savedLabel={pricing.monthly.label}
                            loading={loadingPlan === 'monthly'}
                            onSelect={() => handlePaystack('monthly')}
                            features={[
                                "Unlimited documents",
                                "30-day history retention",
                                "Premium AI models (GPT-4)",
                                "Priority processing",
                                "Advanced data analysis",
                                "Priority support"
                            ]}
                        />
                    </OfflineGuard>

                    {/* Weekly */}
                    <OfflineGuard asChild>
                        <PricingCard 
                            title="Pro Weekly"
                            price={`₦${pricing.weekly.amount.toLocaleString()}`}
                            originalPrice={`₦${pricing.weekly.compare_at.toLocaleString()}`}
                            period="week"
                            savedLabel={pricing.weekly.label}
                            loading={loadingPlan === 'weekly'}
                            onSelect={() => handlePaystack('weekly')}
                            features={[
                                "All Pro features",
                                "7-day access",
                                "Cancel anytime",
                                "Standard support"
                            ]}
                        />
                    </OfflineGuard>
                </div>
            )}
            
            <div className="mt-16 text-center">
                 <div className="inline-flex items-center gap-2 text-xs text-gray-400 bg-white/50 px-4 py-2 rounded-full border border-gray-100 shadow-sm">
                    <Lock className="h-3 w-3" />
                    <span>Secure payment processing by Paystack. Encrypted & Safe.</span>
                 </div>
            </div>
        </div>
    </div>
  );
}
