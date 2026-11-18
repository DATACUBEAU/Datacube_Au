'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { AlertCircle, ArrowRight, CheckCircle2, Loader2, ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import { useSupabaseUser } from '@/hooks/use-supabase-auth';
import { getSupabaseAccessToken } from '@/lib/supabase-client/client';
import { extractBillingReturnState } from '@/lib/billing/payment-return';

type PlanKey = 'pro_weekly' | 'pro_monthly';
type PaymentMethod = 'subscription' | 'transfer';

type BillingStatus = {
  canAccessBilling?: boolean;
  billingEnabled?: boolean;
  checkout?: {
    enabled?: boolean;
    message?: string | null;
    code?: string | null;
    supportedPaymentMethods?: PaymentMethod[];
    defaultPaymentMethod?: PaymentMethod | null;
  };
  pricing?: {
    weekly?: { amount?: number; compare_at?: number | null; label?: string; plan_key?: string | null };
    monthly?: { amount?: number; compare_at?: number | null; label?: string; plan_key?: string | null };
  };
  currentPlan?: {
    managedPlan?: string;
    hasPaidEntitlement?: boolean;
    hasActiveSubscription?: boolean;
  };
  subscription?: { status?: string | null; plan_key?: string | null } | null;
  planSnapshot?: { checksum?: string; issuedAt?: string };
};

function money(value: unknown): string {
  const amount = Number(value || 0);
  if (!Number.isFinite(amount) || amount <= 0) return 'Price unavailable';
  return `₦${amount.toLocaleString('en-NG')}`;
}

function makeIdempotencyKey(prefix: string, seed: string): string {
  const random = typeof globalThis.crypto?.randomUUID === 'function'
    ? globalThis.crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
  const normalized = `${prefix}:${seed}:${random}`.replace(/[^A-Za-z0-9._:-]/g, '-').slice(0, 120);
  return normalized;
}

export default function CheckoutPage() {
  const [user, , isUserLoading] = useSupabaseUser();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { toast } = useToast();
  const [billing, setBilling] = useState<BillingStatus | null>(null);
  const [requestToken, setRequestToken] = useState('');
  const [planChecksum, setPlanChecksum] = useState('');
  const [selectedPlan, setSelectedPlan] = useState<PlanKey>('pro_monthly');
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('subscription');
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [notice, setNotice] = useState<{ tone: 'success' | 'error' | 'info'; text: string } | null>(null);
  const verifiedReturnRef = useRef<string | null>(null);

  const returnState = useMemo(
    () => extractBillingReturnState(searchParams),
    [searchParams],
  );

  const loadBillingStatus = useCallback(async () => {
    const accessToken = await getSupabaseAccessToken();
    if (!accessToken) {
      router.replace('/login?redirectTo=/checkout');
      return null;
    }

    const response = await fetch('/api/billing/status', {
      method: 'GET',
      credentials: 'include',
      cache: 'no-store',
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(payload?.message || payload?.error || 'Unable to load subscription checkout.');
    }

    setRequestToken(response.headers.get('x-billing-request-token') || '');
    setPlanChecksum(
      response.headers.get('x-billing-plan-checksum') ||
      String(payload?.planSnapshot?.checksum || ''),
    );
    setBilling(payload as BillingStatus);

    const methods = Array.isArray(payload?.checkout?.supportedPaymentMethods)
      ? payload.checkout.supportedPaymentMethods
      : ['subscription', 'transfer'];
    const defaultMethod = payload?.checkout?.defaultPaymentMethod;
    setPaymentMethod(
      defaultMethod === 'transfer' && methods.includes('transfer')
        ? 'transfer'
        : methods.includes('subscription')
          ? 'subscription'
          : 'transfer',
    );
    return payload as BillingStatus;
  }, [router]);

  useEffect(() => {
    if (isUserLoading) return;
    if (!user) {
      router.replace('/login?redirectTo=/checkout');
      return;
    }
    let cancelled = false;
    setLoading(true);
    void loadBillingStatus()
      .catch((error) => {
        if (!cancelled) {
          setNotice({
            tone: 'error',
            text: error instanceof Error ? error.message : 'Unable to load checkout.',
          });
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [isUserLoading, loadBillingStatus, router, user?.id]);

  const verifyPaymentReturn = useCallback(async () => {
    const target = returnState.verificationTarget;
    if (!target || loading || !billing || verifying) return;
    const returnKey = `${target}:${returnState.transactionId || 'none'}`;
    if (verifiedReturnRef.current === returnKey) return;
    verifiedReturnRef.current = returnKey;

    if (returnState.isCanceled && !returnState.isSuccess) {
      setNotice({ tone: 'error', text: 'Checkout was cancelled. No payment was confirmed.' });
      router.replace('/checkout', { scroll: false });
      return;
    }

    const accessToken = await getSupabaseAccessToken();
    if (!accessToken || !requestToken || !planChecksum) {
      verifiedReturnRef.current = null;
      return;
    }

    setVerifying(true);
    setNotice({ tone: 'info', text: 'Payment returned. Confirming the transaction securely…' });
    try {
      const response = await fetch('/api/payments/verify', {
        method: 'POST',
        credentials: 'include',
        cache: 'no-store',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
          'x-billing-request-token': requestToken,
          'x-billing-plan-checksum': planChecksum,
          'x-idempotency-key': makeIdempotencyKey('billing-verify', returnKey),
        },
        body: JSON.stringify({
          reference: returnState.reference,
          verification_target: target,
          transaction_id: returnState.transactionId,
          gateway: returnState.gatewayHint,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload?.message || payload?.error || 'Payment verification is still pending.');
      }

      await loadBillingStatus();
      if (payload?.success === true) {
        setNotice({ tone: 'success', text: 'Payment confirmed. Your subscription status has been refreshed.' });
        toast({ title: 'Payment confirmed', description: 'Your subscription details are up to date.' });
      } else {
        setNotice({ tone: 'info', text: 'Your payment is being processed. Refresh this page shortly to check the updated status.' });
      }
      router.replace('/checkout', { scroll: false });
    } catch (error) {
      verifiedReturnRef.current = null;
      setNotice({
        tone: 'error',
        text: error instanceof Error ? error.message : 'Payment verification is pending.',
      });
    } finally {
      setVerifying(false);
    }
  }, [
    billing,
    loadBillingStatus,
    loading,
    planChecksum,
    requestToken,
    returnState,
    router,
    toast,
    verifying,
  ]);

  useEffect(() => {
    void verifyPaymentReturn();
  }, [verifyPaymentReturn]);

  const supportedMethods = useMemo(() => {
    const methods = billing?.checkout?.supportedPaymentMethods;
    return Array.isArray(methods) && methods.length > 0 ? methods : ['subscription', 'transfer'];
  }, [billing?.checkout?.supportedPaymentMethods]);

  const pricing = billing?.pricing;
  const weekly = pricing?.weekly;
  const monthly = pricing?.monthly;
  const checkoutEnabled =
    billing?.canAccessBilling === true &&
    billing?.checkout?.enabled === true;
  const currentPlanActive =
    billing?.currentPlan?.hasPaidEntitlement === true &&
    String(billing?.currentPlan?.managedPlan || '').toLowerCase() !== 'free';

  const startCheckout = async () => {
    if (submitting || !checkoutEnabled) return;
    const accessToken = await getSupabaseAccessToken();
    if (!accessToken) {
      router.replace('/login?redirectTo=/checkout');
      return;
    }
    if (!requestToken || !planChecksum) {
      setNotice({ tone: 'error', text: 'Checkout security details are missing. Reload checkout and try again.' });
      return;
    }

    setSubmitting(true);
    setNotice(null);
    try {
      const response = await fetch('/api/billing/checkout', {
        method: 'POST',
        credentials: 'include',
        cache: 'no-store',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
          'x-billing-request-token': requestToken,
          'x-billing-plan-checksum': planChecksum,
          'x-idempotency-key': makeIdempotencyKey('billing-checkout', selectedPlan),
        },
        body: JSON.stringify({
          plan_key: selectedPlan,
          payment_method: paymentMethod,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload?.message || payload?.error || 'Unable to start checkout.');
      }
      if (typeof payload?.authorization_url !== 'string' || !payload.authorization_url.startsWith('https://')) {
        throw new Error('The payment provider did not return a valid secure checkout link.');
      }
      window.location.assign(payload.authorization_url);
    } catch (error) {
      setNotice({
        tone: 'error',
        text: error instanceof Error ? error.message : 'Checkout could not be started.',
      });
      setSubmitting(false);
    }
  };

  if (isUserLoading || loading) {
    return (
      <main className="flex min-h-dvh items-center justify-center bg-background px-5">
        <div className="flex items-center gap-3 text-sm text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin text-primary" />
          Loading secure checkout…
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-dvh bg-background px-4 py-10 text-foreground sm:px-6">
      <div className="mx-auto w-full max-w-3xl space-y-7">
        <header className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-primary">DataCube AU</p>
          <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">Subscription checkout</h1>
          <p className="text-sm text-muted-foreground">
            Choose a plan and continue to the secure payment provider. Your account and subscription are verified before checkout starts.
          </p>
          {user?.email ? <p className="text-xs text-muted-foreground">Account: {user.email}</p> : null}
        </header>

        {notice ? (
          <div className={`flex gap-3 rounded-xl border p-4 text-sm ${
            notice.tone === 'success'
              ? 'border-emerald-500/30 bg-emerald-500/5'
              : notice.tone === 'error'
                ? 'border-destructive/30 bg-destructive/5'
                : 'border-primary/25 bg-primary/5'
          }`}>
            {notice.tone === 'success' ? (
              <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600" />
            ) : notice.tone === 'error' ? (
              <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-destructive" />
            ) : (
              <Loader2 className="mt-0.5 h-5 w-5 shrink-0 animate-spin text-primary" />
            )}
            <p>{notice.text}</p>
          </div>
        ) : null}

        {currentPlanActive ? (
          <section className="rounded-2xl border border-primary/30 bg-primary/5 p-5">
            <h2 className="font-semibold">An active paid plan is already attached to this account.</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Checkout is disabled while the current entitlement is active. Contact support if the plan status looks incorrect.
            </p>
          </section>
        ) : (
          <>
            <section className="grid gap-4 sm:grid-cols-2">
              <button
                type="button"
                onClick={() => setSelectedPlan('pro_weekly')}
                className={`rounded-2xl border p-5 text-left transition-colors ${
                  selectedPlan === 'pro_weekly'
                    ? 'border-primary bg-primary/5 ring-1 ring-primary'
                    : 'border-border hover:border-primary/50'
                }`}
              >
                <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Weekly</span>
                <span className="mt-2 block text-2xl font-bold">{money(weekly?.amount)}</span>
                {weekly?.compare_at ? (
                  <span className="mt-1 block text-xs text-muted-foreground line-through">{money(weekly.compare_at)}</span>
                ) : null}
                <span className="mt-3 block text-sm text-muted-foreground">{weekly?.label || '7-day subscription period'}</span>
              </button>

              <button
                type="button"
                onClick={() => setSelectedPlan('pro_monthly')}
                className={`rounded-2xl border p-5 text-left transition-colors ${
                  selectedPlan === 'pro_monthly'
                    ? 'border-primary bg-primary/5 ring-1 ring-primary'
                    : 'border-border hover:border-primary/50'
                }`}
              >
                <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Monthly</span>
                <span className="mt-2 block text-2xl font-bold">{money(monthly?.amount)}</span>
                {monthly?.compare_at ? (
                  <span className="mt-1 block text-xs text-muted-foreground line-through">{money(monthly.compare_at)}</span>
                ) : null}
                <span className="mt-3 block text-sm text-muted-foreground">{monthly?.label || 'Monthly subscription period'}</span>
              </button>
            </section>

            <section className="space-y-3 rounded-2xl border p-5">
              <label htmlFor="payment-method" className="block text-sm font-semibold">Payment method</label>
              <select
                id="payment-method"
                value={paymentMethod}
                onChange={(event) => setPaymentMethod(event.target.value as PaymentMethod)}
                className="h-11 w-full rounded-lg border border-input bg-background px-3 text-sm"
              >
                {supportedMethods.includes('subscription') ? <option value="subscription">Card / automatic renewal</option> : null}
                {supportedMethods.includes('transfer') ? <option value="transfer">Bank transfer</option> : null}
              </select>
              {!checkoutEnabled ? (
                <p className="text-sm text-muted-foreground">
                  {billing?.checkout?.message || 'Checkout is currently unavailable. Please contact the administrator.'}
                </p>
              ) : null}
              <Button
                className="h-12 w-full"
                onClick={() => void startCheckout()}
                disabled={!checkoutEnabled || submitting || !supportedMethods.includes(paymentMethod)}
              >
                {submitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ArrowRight className="mr-2 h-4 w-4" />}
                Continue to secure payment
              </Button>
              <div className="flex items-center justify-center gap-2 text-xs text-muted-foreground">
                <ShieldCheck className="h-4 w-4 text-primary" />
                Protected checkout • Account-bound payment verification
              </div>
            </section>
          </>
        )}
      </div>
    </main>
  );
}
