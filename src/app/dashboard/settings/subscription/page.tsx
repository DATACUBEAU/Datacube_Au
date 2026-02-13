'use client';

import { useEffect, useState, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { CheckCircle2, CreditCard, Banknote, Loader2, AlertTriangle, ShieldCheck, Lock, RefreshCw, XCircle } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/lib/supabase-client/client';
import { useSupabaseUser } from '@/hooks/use-supabase-auth';
import { useSearchParams, useRouter } from 'next/navigation';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';

export default function SubscriptionPage() {
  const [user] = useSupabaseUser();
  const { toast } = useToast();
  const searchParams = useSearchParams();
  const router = useRouter();
  
  const [tier, setTier] = useState<string>('free');
  const [expiry, setExpiry] = useState<string | null>(null);
  const [subscription, setSubscription] = useState<any>(null);
  
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
      weekly: { amount: number, compare_at: number, label: string },
      monthly: { amount: number, compare_at: number, label: string }
  }>({
    weekly: { amount: 1900, compare_at: 2500, label: "Save 24%" },
    monthly: { amount: 4500, compare_at: 6000, label: "Save 25%" }
  });

  // Calculate savings percentage dynamically
  const getSavings = (amount: number, compareAt: number) => {
      if (!compareAt || compareAt <= amount) return 0;
      return Math.round(((compareAt - amount) / compareAt) * 100);
  };

  // Initial Load & URL Check
  useEffect(() => {
    if (!user) return;

    if (user.is_anonymous) {
        toast({ 
            title: "Account Required", 
            description: "You must create an account to upgrade your plan.",
            variant: "destructive" 
        });
        return;
    }

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
  }, [user, searchParams]);

  const verifyPayment = async (ref: string) => {
      try {
          const { data: { session } } = await supabase.auth.getSession();
          const res = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/paystack-verify?reference=${ref}`, {
             headers: { 'Authorization': `Bearer ${session?.access_token}` }
          });
          
          if (res.ok) {
            const data = await res.json();
            if (data.status === 'success') {
                setPaymentState('success');
                fetchBillingStatus();
                return;
            }
          }
      } catch (e) {
          console.error("Verification failed", e);
      }
      startPolling();
  };

  const fetchBillingStatus = async () => {
      try {
          const { data: { session } } = await supabase.auth.getSession();
          if (!session) return;

          const res = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/billing-status`, {
              headers: { 'Authorization': `Bearer ${session.access_token}` }
          });
          
          if (res.ok) {
              const data = await res.json();
              setTier(data.tier || 'free');
              setExpiry(data.tier_expires_at);
              setSubscription(data.subscription);
              
              if (data.pricing) {
                  setPricing(data.pricing);
              }
              
              // If user has active subscription, default to auto-renew view (though buttons are disabled/hidden usually if already pro)
              if (data.subscription?.status === 'active') {
                  setIsAutoRenew(true);
              }
              return data;
          }
      } catch (e) {
          console.error("Failed to fetch billing status", e);
      }
      return null;
  };

  const startPolling = () => {
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
  };

  const stopPolling = () => {
      if (pollTimerRef.current) {
          clearInterval(pollTimerRef.current);
          pollTimerRef.current = null;
      }
  };

  const handlePaystack = async (planType: 'weekly' | 'monthly') => {
      if (user?.is_anonymous) {
          toast({ 
              title: "Account Required", 
              description: "Please sign in or create an account to subscribe.",
              variant: "destructive" 
          });
          return;
      }

      setLoadingPlan(planType);
      
      try {
          const { data: { session } } = await supabase.auth.getSession();
          const token = session?.access_token;
          
          const returnUrl = `${window.location.origin}/dashboard/settings/subscription`;
          
          // If Auto-renew: Subscription Mode, Card only
          // If Manual: One-time Mode, Bank Transfer + Card
          const mode = isAutoRenew ? 'subscription' : 'one_time';
          const channels = isAutoRenew ? ['card'] : ['bank_transfer', 'card'];

          const res = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/paystack-initiate`, {
              method: 'POST',
              headers: {
                  'Authorization': `Bearer ${token}`,
                  'Content-Type': 'application/json'
              },
              body: JSON.stringify({ 
                  planType,
                  channels,
                  mode,
                  redirectUrls: {
                      success: `${returnUrl}?success=true`,
                      cancel: `${returnUrl}?cancelled=true`
                  }
              }) 
          });

          const { url, error } = await res.json();
          if (error) throw new Error(error);
          
          if (url) {
              setPaymentState('redirecting');
              window.location.href = url;
          } else {
              throw new Error("No authorization URL returned");
          }

      } catch (e: any) {
          toast({ variant: 'destructive', title: 'Payment Error', description: e.message });
          setLoadingPlan(null);
          setPaymentState('idle');
      }
  };

  const handleCancelSubscription = async () => {
      if (!cancelReason || cancelReason.length < 10) {
          toast({ variant: 'destructive', title: 'Reason too short', description: 'Please provide a reason (min 10 chars).' });
          return;
      }

      setIsCancelling(true);
      try {
          const { data: { session } } = await supabase.auth.getSession();
          const res = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/paystack-cancel-subscription`, {
              method: 'POST',
              headers: {
                  'Authorization': `Bearer ${session?.access_token}`,
                  'Content-Type': 'application/json'
              },
              body: JSON.stringify({ reason: cancelReason })
          });

          const data = await res.json();
          if (!res.ok) throw new Error(data.error || 'Failed to cancel');

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

  // --- UI States ---

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
              <p className="text-muted-foreground">We’re verifying your payment. This usually takes a few seconds.</p>
              <div className="max-w-xs mx-auto space-y-2 text-left bg-muted/30 p-4 rounded-lg">
                   <div className="flex items-center gap-2 text-green-600"><CheckCircle2 className="h-4 w-4" /> Redirecting</div>
                   <div className="flex items-center gap-2 text-green-600"><CheckCircle2 className="h-4 w-4" /> Payment received</div>
                   <div className="flex items-center gap-2 text-primary animate-pulse"><Loader2 className="h-4 w-4 animate-spin" /> Activating Pro...</div>
              </div>
              <p className="text-xs text-muted-foreground">Don’t close this page. We’ll activate your plan as soon as confirmation arrives.</p>
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
              <Button onClick={() => router.push('/dashboard')} size="lg" className="mt-4">
                  Go to Dashboard
              </Button>
          </div>
      );
  }

  if (paymentState === 'pending') {
      return (
          <div className="container max-w-2xl py-20 text-center space-y-6">
              <div className="flex justify-center">
                   <div className="h-20 w-20 bg-yellow-100 text-yellow-600 rounded-full flex items-center justify-center">
                      <AlertTriangle className="h-10 w-10" />
                  </div>
              </div>
              <h2 className="text-2xl font-bold">Payment received — finishing setup...</h2>
              <p className="text-muted-foreground">We’ve received your payment and are completing activation. If this takes longer than a minute, refresh the page.</p>
              <Button onClick={() => window.location.reload()} variant="outline">
                  <RefreshCw className="mr-2 h-4 w-4" /> Refresh Status
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
                  <Button variant="outline" onClick={() => setPaymentState('idle')}>Back to Subscription</Button>
              </div>
          </div>
      );
  }

  // --- Default View ---

  return (
    <div className="container max-w-5xl py-8 space-y-8">
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-3">
            <div className="p-2 bg-primary/10 rounded-lg text-primary">
                <CreditCard className="w-8 h-8" />
            </div>
            <div>
                <h1 className="text-3xl font-bold font-headline">Subscription</h1>
                <p className="text-muted-foreground">Manage your billing and plan details.</p>
            </div>
        </div>
      </div>

      {tier === 'pro' && (
          <Card className="border-primary/50 bg-primary/5">
              <CardContent className="flex flex-col sm:flex-row items-center justify-between p-6 gap-4">
                  <div>
                      <h3 className="font-bold text-lg flex items-center gap-2">
                          Current Plan: Pro <Badge>Active</Badge>
                      </h3>
                      {expiry && (
                          <p className="text-sm text-muted-foreground mt-1">
                              {subscription?.status === 'active' ? 'Renews on: ' : 'Expires on: '} 
                              <span className="font-medium text-foreground">{formatDate(expiry)}</span>
                          </p>
                      )}
                      {subscription?.status === 'non_renewing' && (
                          <Badge variant="outline" className="mt-2 text-yellow-600 border-yellow-600">Cancels at period end</Badge>
                      )}
                  </div>
                  <div className="flex gap-3 w-full sm:w-auto">
                      {subscription?.status === 'active' ? (
                          <Dialog open={isCancelDialogOpen} onOpenChange={setIsCancelDialogOpen}>
                              <DialogTrigger asChild>
                                  <Button variant="destructive" size="sm">Cancel Auto-renew</Button>
                              </DialogTrigger>
                              <DialogContent>
                                  <DialogHeader>
                                      <DialogTitle>Cancel Subscription</DialogTitle>
                                      <DialogDescription>
                                          Are you sure? You will lose access to Pro features at the end of your current billing period ({formatDate(expiry || '')}).
                                      </DialogDescription>
                                  </DialogHeader>
                                  <div className="space-y-4 py-4">
                                      <Label>Please tell us why you are leaving (required)</Label>
                                      <Textarea 
                                          placeholder="I'm cancelling because..." 
                                          value={cancelReason} 
                                          onChange={(e) => setCancelReason(e.target.value)}
                                      />
                                  </div>
                                  <DialogFooter>
                                      <Button variant="outline" onClick={() => setIsCancelDialogOpen(false)}>Keep Subscription</Button>
                                      <Button variant="destructive" onClick={handleCancelSubscription} disabled={isCancelling}>
                                          {isCancelling ? <Loader2 className="animate-spin h-4 w-4" /> : 'Confirm Cancellation'}
                                      </Button>
                                  </DialogFooter>
                              </DialogContent>
                          </Dialog>
                      ) : (
                          <Button variant="outline" disabled>
                              Managed by Paystack
                          </Button>
                      )}
                  </div>
              </CardContent>
          </Card>
      )}

      {/* Toggle */}
      {tier !== 'pro' && (
        <div className="flex items-center justify-center space-x-4 py-4 bg-muted/20 rounded-lg max-w-fit mx-auto px-6">
            <Label htmlFor="auto-renew-mode" className={`cursor-pointer transition-colors ${!isAutoRenew ? 'font-bold text-foreground' : 'text-muted-foreground'}`}>
                One-time Payment
            </Label>
            <Switch id="auto-renew-mode" checked={isAutoRenew} onCheckedChange={setIsAutoRenew} />
            <Label htmlFor="auto-renew-mode" className={`cursor-pointer transition-colors ${isAutoRenew ? 'font-bold text-foreground' : 'text-muted-foreground'}`}>
                Auto-renew Subscription
            </Label>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* Free Plan */}
        <Card className={`flex flex-col ${tier === 'free' ? 'border-primary shadow-md' : ''}`}>
            <CardHeader>
                <CardTitle className="font-headline text-xl">Free Plan</CardTitle>
                <CardDescription>For personal exploration</CardDescription>
                <div className="pt-2">
                    <span className="text-3xl font-bold">₦0</span>
                </div>
            </CardHeader>
            <CardContent className="flex-1 space-y-3 text-sm">
                <div className="flex items-center gap-2"><CheckCircle2 className="h-4 w-4 text-green-500" /> <span>Max 4 docs (2 text, 2 PQ)</span></div>
                <div className="flex items-center gap-2"><CheckCircle2 className="h-4 w-4 text-green-500" /> <span>14-day retention</span></div>
                <div className="flex items-center gap-2"><CheckCircle2 className="h-4 w-4 text-green-500" /> <span>Basic AU models</span></div>
            </CardContent>
            <CardFooter>
                {tier === 'free' ? (
                    <Button variant="secondary" className="w-full" disabled>Current Plan</Button>
                ) : (
                    <Button variant="outline" className="w-full" disabled>Included</Button>
                )}
            </CardFooter>
        </Card>

        {/* Pro Weekly */}
        <Card className="flex flex-col border-muted hover:border-primary/50 transition-all">
            <CardHeader>
                <div className="flex justify-between items-start">
                    <CardTitle className="font-headline text-xl">Pro Weekly</CardTitle>
                    <Badge variant="secondary" className="bg-green-100 text-green-700 hover:bg-green-100">Save {getSavings(pricing.weekly.amount, pricing.weekly.compare_at)}%</Badge>
                </div>
                <CardDescription>Short-term access</CardDescription>
                <div className="pt-2 flex items-baseline gap-2">
                    <span className="text-3xl font-bold">₦{pricing.weekly.amount.toLocaleString()}</span>
                    <span className="text-muted-foreground line-through text-sm">₦{pricing.weekly.compare_at.toLocaleString()}</span>
                    <span className="text-muted-foreground text-sm"> / 7 days</span>
                </div>
            </CardHeader>
            <CardContent className="flex-1 space-y-3 text-sm">
                <div className="flex items-center gap-2"><CheckCircle2 className="h-4 w-4 text-primary" /> <span>Higher upload limits</span></div>
                <div className="flex items-center gap-2"><CheckCircle2 className="h-4 w-4 text-primary" /> <span>30-day retention</span></div>
                <div className="flex items-center gap-2"><CheckCircle2 className="h-4 w-4 text-primary" /> <span>Faster processing</span></div>
            </CardContent>
            <CardFooter className="flex flex-col gap-3">
                <Button 
                    onClick={() => handlePaystack('weekly')} 
                    disabled={!!loadingPlan && loadingPlan !== 'weekly'}
                    className="w-full flex justify-between items-center group" 
                    variant={isAutoRenew ? "default" : "outline"}
                >
                    {loadingPlan === 'weekly' ? (
                        <Loader2 className="h-4 w-4 animate-spin" /> 
                    ) : (
                        <span>{isAutoRenew ? 'Subscribe (Auto-renew)' : 'Pay One-time'}</span>
                    )}
                    {isAutoRenew ? <CreditCard className="h-4 w-4" /> : <Banknote className="h-4 w-4" />}
                </Button>
                <div className="text-[10px] text-center text-muted-foreground">
                    {isAutoRenew ? 'Auto-renews weekly. Cancel anytime.' : 'Valid for 7 days. No auto-renewal.'}
                </div>
            </CardFooter>
        </Card>

        {/* Pro Monthly */}
        <Card className="flex flex-col border-primary shadow-lg relative overflow-hidden">
            <div className="absolute top-0 right-0 bg-primary text-primary-foreground text-xs px-3 py-1 rounded-bl-lg font-bold">
                BEST VALUE
            </div>
            <CardHeader>
                <div className="flex justify-between items-start">
                    <CardTitle className="font-headline text-xl">Pro Monthly</CardTitle>
                    <Badge variant="secondary" className="bg-green-100 text-green-700 hover:bg-green-100">Save {getSavings(pricing.monthly.amount, pricing.monthly.compare_at)}%</Badge>
                </div>
                <CardDescription>Full access & power</CardDescription>
                <div className="pt-2 flex items-baseline gap-2">
                    <span className="text-3xl font-bold">₦{pricing.monthly.amount.toLocaleString()}</span>
                    <span className="text-muted-foreground line-through text-sm">₦{pricing.monthly.compare_at.toLocaleString()}</span>
                    <span className="text-muted-foreground text-sm"> / month</span>
                </div>
            </CardHeader>
            <CardContent className="flex-1 space-y-3 text-sm">
                <div className="flex items-center gap-2"><CheckCircle2 className="h-4 w-4 text-primary" /> <span>All Weekly features</span></div>
                <div className="flex items-center gap-2"><CheckCircle2 className="h-4 w-4 text-primary" /> <span>Advanced tools</span></div>
                <div className="flex items-center gap-2"><CheckCircle2 className="h-4 w-4 text-primary" /> <span>Priority support</span></div>
            </CardContent>
            <CardFooter className="flex flex-col gap-3">
                <Button 
                    onClick={() => handlePaystack('monthly')} 
                    disabled={!!loadingPlan && loadingPlan !== 'monthly'}
                    className="w-full flex justify-between items-center group" 
                    variant={isAutoRenew ? "default" : "outline"}
                >
                    {loadingPlan === 'monthly' ? (
                        <Loader2 className="h-4 w-4 animate-spin" /> 
                    ) : (
                        <span>{isAutoRenew ? 'Subscribe (Auto-renew)' : 'Pay One-time'}</span>
                    )}
                    {isAutoRenew ? <CreditCard className="h-4 w-4" /> : <Banknote className="h-4 w-4" />}
                </Button>
                <div className="text-[10px] text-center text-muted-foreground">
                    {isAutoRenew ? 'Auto-renews monthly. Cancel anytime.' : 'Valid for 30 days. No auto-renewal.'}
                </div>
            </CardFooter>
        </Card>
      </div>
      
      <div className="flex items-center justify-center gap-2 text-xs text-muted-foreground bg-muted/30 p-3 rounded-full max-w-fit mx-auto">
           <Lock className="h-3 w-3" />
           <span>Secured by Paystack. Your card details are processed by Paystack and are never stored by Datacube AU</span>
      </div>
    </div>
  );
}
