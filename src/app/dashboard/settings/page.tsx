'use client';
import { useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ThemeToggle } from '@/components/theme-toggle';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { 
  LogOut, 
  Save, 
  User as UserIcon, 
  Bot, 
  Loader2, 
  AlertTriangle, 
  ShieldAlert, 
  Trash2,
  CreditCard,
  Settings,
  CheckCircle2,
  Banknote,
  Download,
  Copy
} from 'lucide-react';
import { Icons } from '@/components/icons';
import { useToast } from '@/hooks/use-toast';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import PwaInstallButton from '@/components/pwa-install-button';
import { useSupabaseUser } from '@/hooks/use-supabase-auth';
import { supabase } from '@/lib/supabase-client/client';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { motion, AnimatePresence } from 'framer-motion';

export default function SettingsPage() {
  const [user] = useSupabaseUser();
  const { toast } = useToast();
  const router = useRouter();
  const isAnonymous = useMemo(() => {
    if (!user) return true;
    return (user as any).is_anonymous ?? !user.email;
  }, [user]);

  const currentDisplayName = useMemo(() => {
    if (!user) return '';
    return (
      (user.user_metadata?.full_name as string | undefined) ??
      (user.user_metadata?.name as string | undefined) ??
      ''
    );
  }, [user]);

  const [displayName, setDisplayName] = useState(currentDisplayName);
  const [isSaving, setIsSaving] = useState(false);
  const [isLoadingGoogle, setIsLoadingGoogle] = useState(false);
  const [isAssistantEnabled, setIsAssistantEnabled] = useState(true);
  const [showAuthPopup, setShowAuthPopup] = useState(false);
  const [showAuthCancelConfirm, setShowAuthCancelConfirm] = useState(false);
  const [showSignOutPopup, setShowSignOutPopup] = useState(false);
  const [signOutStep, setSignOutStep] = useState<'idle' | 'warning' | 'final' | 'processing'>('idle');
  const [showGuestSignInDisabledDialog, setShowGuestSignInDisabledDialog] = useState(false);

  // Billing State
  const [tier, setTier] = useState<string>('free');
  const [tierExpiresAt, setTierExpiresAt] = useState<string | null>(null);
  const [isLoadingBilling, setIsLoadingBilling] = useState(false);
  const [showBankTransfer, setShowBankTransfer] = useState(false);
  const [manualPaymentRef, setManualPaymentRef] = useState('');
  const [manualPaymentStatus, setManualPaymentStatus] = useState<'idle' | 'submitting' | 'success'>('idle');
  const [latestInvoiceUrl, setLatestInvoiceUrl] = useState<string | null>(null);
  const [billingConfig, setBillingConfig] = useState<any>(null);

  useEffect(() => {
    if (user?.id) {
      // Fetch Profile
      supabase.from('au_user_profiles')
        .select('tier, tier_expires_at, latest_invoice_url')
        .eq('user_id', user.id)
        .maybeSingle()
        .then(({ data }) => {
           if (data?.tier) setTier(data.tier);
           if (data?.tier_expires_at) setTierExpiresAt(data.tier_expires_at);
           if (data?.latest_invoice_url) setLatestInvoiceUrl(data.latest_invoice_url);
        });
      
      // Fetch Config
      supabase.from('au_conex_config')
        .select('*')
        .eq('id', 1)
        .single()
        .then(({ data }) => {
            if (data) setBillingConfig(data);
        });
    }
  }, [user]);

  const handleStripeCheckout = async (planType: 'weekly' | 'monthly') => {
      setIsLoadingBilling(true);
      try {
          const { data: { session } } = await supabase.auth.getSession();
          const token = session?.access_token;
          const res = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/stripe-checkout`, {
              method: 'POST',
              headers: {
                  'Authorization': `Bearer ${token}`,
                  'Content-Type': 'application/json'
              },
              body: JSON.stringify({ 
                  planType,
                  redirectUrls: {
                      success: window.location.href,
                      cancel: window.location.href
                  }
              }) 
          });
          const { url, error } = await res.json();
          if (error) throw new Error(error);
          if (url) window.location.href = url;
      } catch (e: any) {
          toast({ variant: 'destructive', title: 'Billing Error', description: e.message });
      } finally {
          setIsLoadingBilling(false);
      }
  };

  const handlePaystackCheckout = async (planType: 'weekly' | 'monthly') => {
      setIsLoadingBilling(true);
      try {
          const { data: { session } } = await supabase.auth.getSession();
          const token = session?.access_token;
          const origin = window.location.origin;
          const res = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/paystack-initiate`, {
              method: 'POST',
              headers: {
                  'Authorization': `Bearer ${token}`,
                  'Content-Type': 'application/json'
              },
              body: JSON.stringify({ 
                  planType,
                  redirectUrls: {
                      success: `${origin}/dashboard/settings/subscription?success=true`,
                      cancel: `${origin}/dashboard/settings`
                  }
              }) 
          });
          
          if (!res.ok) {
              const errorText = await res.text();
              try {
                  const errorJson = JSON.parse(errorText);
                  throw new Error(errorJson.error || errorText);
              } catch {
                  throw new Error(errorText || `Request failed with status ${res.status}`);
              }
          }

          const { url } = await res.json();
          if (url) window.location.href = url;
      } catch (e: any) {
          toast({ variant: 'destructive', title: 'Payment Error', description: e.message });
      } finally {
          setIsLoadingBilling(false);
      }
  };

  const handlePortal = async () => {

      setIsLoadingBilling(true);
      try {
          const { data: { session } } = await supabase.auth.getSession();
          const token = session?.access_token;
          const res = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/stripe-portal`, {
              method: 'POST',
              headers: {
                  'Authorization': `Bearer ${token}`,
              }
          });
          const { url, error } = await res.json();
          if (error) throw new Error(error);
          if (url) window.location.href = url;
      } catch (e: any) {
          toast({ variant: 'destructive', title: 'Portal Error', description: e.message });
      } finally {
          setIsLoadingBilling(false);
      }
  };

  const generateReference = () => {
      return `PAY-${user?.id.slice(0, 4).toUpperCase()}-${Math.floor(Math.random() * 10000)}`;
  };

  const handleManualPaymentSubmit = async () => {
      if (!user) return;
      setManualPaymentStatus('submitting');
      try {
          const refCode = manualPaymentRef || generateReference();
          
          const { error } = await supabase.from('au_manual_payments').insert({
              user_id: user.id,
              amount: 4500, // Monthly default
              reference_code: refCode,
              status: 'pending'
          });

          if (error) throw error;

          setManualPaymentStatus('success');
          toast({ title: 'Payment Submitted', description: 'Your payment is pending confirmation.' });
      } catch (e: any) {
          toast({ variant: 'destructive', title: 'Submission Failed', description: e.message });
          setManualPaymentStatus('idle');
      }
  };

  const openBankTransfer = () => {
      setManualPaymentRef(generateReference());
      setManualPaymentStatus('idle');
      setShowBankTransfer(true);
  };

  useEffect(() => {
    if (user) {
      const stored = localStorage.getItem(`au_assistant_settings_${user.id}`);
      setIsAssistantEnabled(stored !== 'disabled');

      const handleSettingsUpdate = (e: any) => {
        setIsAssistantEnabled(e.detail.enabled);
      };

      window.addEventListener('au_assistant_settings_updated', handleSettingsUpdate);
      return () => window.removeEventListener('au_assistant_settings_updated', handleSettingsUpdate);
    }
  }, [user]);

  const handleToggleAssistant = (enabled: boolean) => {
    setIsAssistantEnabled(enabled);
    if (user) {
      localStorage.setItem(`au_assistant_settings_${user.id}`, enabled ? 'enabled' : 'disabled');
      // Dispatch custom event for real-time update in AUAssistant
      window.dispatchEvent(new CustomEvent('au_assistant_settings_updated', { 
        detail: { enabled } 
      }));
      toast({
        title: enabled ? 'AU Assistant Enabled' : 'AU Assistant Disabled',
        description: enabled ? 'The guide will now appear to assist you.' : 'The guide has been hidden.',
      });
    }
  };

  const handleGoogleSignIn = async () => {
    if (isAnonymous) {
      setShowGuestSignInDisabledDialog(true);
      return;
    }
    setIsLoadingGoogle(true);
    setShowAuthPopup(true);
    
    // Artificial delay to show the animation
    await new Promise(resolve => setTimeout(resolve, 1500));

    try {
      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo: `${window.location.origin}/dashboard` },
      });
      if (error) throw error;
    } catch (error: any) {
      setShowAuthPopup(false);
      toast({
        variant: 'destructive',
        title: 'Sign-in Failed',
        description: error?.message || 'Could not start Google sign-in.',
      });
    } finally {
      setIsLoadingGoogle(false);
    }
  };

  const handleAuthCancelAttempt = () => {
    setShowAuthCancelConfirm(true);
  };

  const confirmAuthCancel = () => {
    setShowAuthCancelConfirm(false);
    setShowAuthPopup(false);
    setIsLoadingGoogle(false);
  };
  
  useEffect(() => {
    setDisplayName(currentDisplayName);
  }, [currentDisplayName]);

  const startSignOutFlow = () => {
    setSignOutStep('warning');
    setShowSignOutPopup(true);
  };

  const proceedToFinalWarning = () => {
    setSignOutStep('final');
  };

  const handleSignOutFinal = async () => {
    setSignOutStep('processing');
    
    try {
      // 1. Call wipe-user action in Edge Function
      const { data: { session } } = await supabase.auth.getSession();
      const guestToken = typeof window !== 'undefined' ? localStorage.getItem('guest_token') : null;
      const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/$/, '');
      const accessToken = session?.access_token || guestToken || undefined;

      await fetch(`${SUPABASE_URL}/functions/v1/document-management`, {
        method: 'POST',
        headers: {
          'apikey': process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '',
          'Content-Type': 'application/json',
          ...(accessToken ? { 'Authorization': `Bearer ${accessToken}` } : {})
        },
        body: JSON.stringify({ action: 'wipe-user' })
      });

      // Cool animation delay
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      // 2. Clear local storage items
      if (user?.id) {
        localStorage.removeItem(`au_assistant_progress_${user.id}`);
        localStorage.removeItem(`au_assistant_settings_${user.id}`);
      }
      localStorage.removeItem('guest_token');

      // 3. Final sign out
      await supabase.auth.signOut();
      router.push('/');
    } catch (error) {
      console.error("[signOut] Error wiping data:", error);
      // Even if wipe fails, we should sign out for safety
      await supabase.auth.signOut();
      router.push('/');
    }
  };

  const handleSaveChanges = async () => {
    if (!user || isAnonymous) return;
    
    setIsSaving(true);
    const oldDisplayName = currentDisplayName;

    try {
      if (oldDisplayName !== displayName) {
        const { error } = await supabase.auth.updateUser({
          data: { full_name: displayName },
        });
        if (error) throw error;
        
        toast({
          title: 'Success',
          description: 'Your profile has been updated.',
        });
      }
    } catch (error: any) {
      toast({
        variant: 'destructive',
        title: 'Error updating profile',
        description: error.message,
      });
    } finally {
      setIsSaving(false);
    }
  };
  
  return (
    <main className="flex flex-1 flex-col gap-4 p-4 md:gap-8 md:p-8">

      <div className="mx-auto grid w-full max-w-4xl gap-2">
        <h1 className="font-headline text-3xl font-semibold">Settings</h1>
      </div>
      
      <div className="mx-auto w-full max-w-4xl">
        <Alert variant="destructive" className="border-2 border-red-500 bg-red-50 dark:bg-red-950/20">
          <ShieldAlert className="h-5 w-5 text-red-600 dark:text-red-400" />
          <AlertTitle className="text-red-800 dark:text-red-400 font-bold mb-1">
            Policy Update: Data Security Notice
          </AlertTitle>
          <AlertDescription className="text-red-700 dark:text-red-300">
            Inactive accounts will be automatically deleted after <strong>14 DAYS</strong> to ensure data security. 
            Sign in regularly to keep your account active.
          </AlertDescription>
        </Alert>
      </div>

      <div className="mx-auto grid w-full max-w-4xl items-start gap-6">
        <div className="grid gap-6">
          {isAnonymous ? (
             <Card>
                <CardHeader>
                    <CardTitle className="font-headline">Create an Account</CardTitle>
                    <CardDescription>
                        You are currently using a temporary guest account. Sign in to save your documents and access them from any device.
                    </CardDescription>
                </CardHeader>
                <CardContent>
                    <Button
                      onClick={handleGoogleSignIn}
                      disabled={isLoadingGoogle}
                      aria-disabled={isAnonymous}
                      className={`w-full sm:w-auto ${isAnonymous ? 'opacity-60 cursor-not-allowed' : ''}`}
                    >
                        {isLoadingGoogle ? (
                            <Icons.google className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
                        ) : (
                            <Icons.google className="mr-2 h-4 w-4" aria-hidden="true" />
                        )}
                        Authenticate with Google
                    </Button>
                </CardContent>
            </Card>
          ) : (
            <Card>
                <CardHeader>
                <CardTitle className="font-headline">Profile</CardTitle>
                <CardDescription>
                    Update your personal information.
                </CardDescription>
                </CardHeader>
                <CardContent>
                <form className="space-y-6" onSubmit={(e) => { e.preventDefault(); handleSaveChanges(); }}>
                    <div className="flex flex-col sm:flex-row items-center gap-6">
                    <div className="relative">
                        <Avatar className="h-20 w-20">
                        <AvatarImage src={(user?.user_metadata?.avatar_url as string | undefined) || ''} />
                        <AvatarFallback className="text-3xl">
                            {displayName ? displayName.charAt(0).toUpperCase() : 'U'}
                        </AvatarFallback>
                        </Avatar>
                    </div>
                    <div className="grid w-full gap-1.5">
                        <Label htmlFor="displayName">Username</Label>
                        <Input
                        id="displayName"
                        value={displayName}
                        onChange={(e) => setDisplayName(e.target.value)}
                        />
                    </div>
                    </div>
                    <div className="grid w-full gap-1.5">
                        <Label htmlFor="email">Email</Label>
                        <Input id="email" type="email" value={user?.email || ''} disabled />
                    </div>
                </form>
                </CardContent>
                <CardFooter className="border-t px-6 py-4 flex flex-col-reverse sm:flex-row sm:justify-between items-center gap-4">
                <Button onClick={handleSaveChanges} disabled={isSaving || displayName === currentDisplayName} className="w-full sm:w-auto">
                    {isSaving ? <><Save className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" /> Saving...</> : 'Save Changes'}
                </Button>
                <Button variant="outline" onClick={startSignOutFlow} className="w-full sm:w-auto">
                    <LogOut className="mr-2 h-4 w-4" aria-hidden="true" />
                    Sign Out
                </Button>
                </CardFooter>
            </Card>
          )}
          
          <Card>
            <CardHeader>
              <CardTitle className="font-headline">Subscription</CardTitle>
              <CardDescription>
                Manage your billing and plan details.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              {tier === 'pro' ? (
                  <div className="p-6 rounded-xl border-2 border-primary bg-primary/5">
                      <div className="flex justify-between items-start mb-6">
                          <div>
                              <h3 className="text-2xl font-bold font-headline">Pro Plan Active</h3>
                              <p className="text-muted-foreground mt-1">
                                  You have full access to all premium features.
                              </p>
                          </div>
                          <Badge className="bg-primary text-lg px-4 py-1">Current</Badge>
                      </div>
                      
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                          <div className="space-y-4">
                              <div className="flex items-center gap-2">
                                  <CheckCircle2 className="h-5 w-5 text-primary" />
                                  <span className="font-medium">Unlimited Premium Models (GPT-4, Claude 3 Opus)</span>
                              </div>
                              <div className="flex items-center gap-2">
                                  <CheckCircle2 className="h-5 w-5 text-primary" />
                                  <span className="font-medium">High-Priority Processing</span>
                              </div>
                              <div className="flex items-center gap-2">
                                  <CheckCircle2 className="h-5 w-5 text-primary" />
                                  <span className="font-medium">Extended Context Window</span>
                              </div>
                              <div className="flex items-center gap-2">
                                  <CheckCircle2 className="h-5 w-5 text-primary" />
                                  <span className="font-medium">Advanced Data Analysis Tools</span>
                              </div>
                          </div>

                          <div className="space-y-4 border-l pl-6">
                              <div>
                                  <Label className="text-muted-foreground">Renewal Date</Label>
                                  <p className="text-xl font-bold">
                                      {tierExpiresAt ? new Date(tierExpiresAt).toLocaleDateString(undefined, { dateStyle: 'long' }) : 'Unknown'}
                                  </p>
                              </div>
                              
                              <div className="flex flex-col gap-3 pt-2">
                                  <Button onClick={handlePortal} disabled={isLoadingBilling} className="w-full">
                                      <Settings className="mr-2 h-4 w-4" /> Manage Subscription
                                  </Button>
                                  {latestInvoiceUrl && (
                                      <Button variant="outline" onClick={() => window.open(latestInvoiceUrl, '_blank')} className="w-full">
                                          <Download className="mr-2 h-4 w-4" /> Download Latest Invoice
                                      </Button>
                                  )}
                              </div>
                          </div>
                      </div>
                  </div>
              ) : (
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-6 relative">
                      {/* Overlay for Billing Disabled */}
                      {billingConfig && !billingConfig.billing_enabled && (
                          <div className="absolute inset-0 z-10 flex items-center justify-center bg-background/60 backdrop-blur-sm rounded-xl">
                              <div className="bg-background border border-primary/20 p-6 rounded-lg shadow-2xl max-w-md text-center animate-in fade-in zoom-in duration-500">
                                  <div className="h-12 w-12 bg-primary/10 rounded-full flex items-center justify-center mx-auto mb-4">
                                      <CheckCircle2 className="h-6 w-6 text-primary" />
                                  </div>
                                  <h3 className="text-xl font-bold font-headline mb-2">Free Premium Access</h3>
                                  <p className="text-muted-foreground mb-4">
                                      Enjoy the ultimate features while it lasts! We've unlocked Pro capabilities for everyone temporarily.
                                  </p>
                                  <Badge variant="outline" className="bg-primary/5 border-primary/20">Limited Time Offer</Badge>
                              </div>
                          </div>
                      )}

                      {/* Card 1: Free Plan */}
                      <div className="p-6 rounded-xl border-2 border-muted bg-card flex flex-col">
                          <div className="mb-4">
                              <h3 className="text-xl font-bold font-headline">Free Plan</h3>
                              <p className="text-sm text-muted-foreground mt-1">For personal exploration</p>
                              {tier === 'free' && <Badge className="mt-2 bg-secondary text-secondary-foreground">Current</Badge>}
                          </div>
                          <div className="space-y-3 text-sm mb-6 flex-1">
                              <div className="flex items-center gap-2"><CheckCircle2 className="h-4 w-4 text-green-500" /> <span>Small uploads</span></div>
                              <div className="flex items-center gap-2"><CheckCircle2 className="h-4 w-4 text-green-500" /> <span>Limited documents</span></div>
                              <div className="flex items-center gap-2"><CheckCircle2 className="h-4 w-4 text-green-500" /> <span>Basic AU models</span></div>
                          </div>
                          <Button variant="outline" className="w-full" disabled>Active</Button>
                      </div>

                      {/* Card 2: Pro Weekly */}
                      <div className="p-6 rounded-xl border-2 border-primary/20 bg-card hover:border-primary/50 transition-all flex flex-col relative overflow-hidden">
                          <div className="mb-4">
                              <h3 className="text-xl font-bold font-headline">Pro Weekly</h3>
                              <div className="flex items-baseline gap-1 mt-1">
                                  <span className="text-2xl font-bold">₦1,900</span>
                                  <span className="text-sm text-muted-foreground">/ 7 days</span>
                              </div>
                          </div>
                          <div className="space-y-3 text-sm mb-6 flex-1">
                              <div className="flex items-center gap-2"><CheckCircle2 className="h-4 w-4 text-primary" /> <span>Short-term access</span></div>
                              <div className="flex items-center gap-2"><CheckCircle2 className="h-4 w-4 text-primary" /> <span>Full Pro features</span></div>
                              <div className="flex items-center gap-2"><CheckCircle2 className="h-4 w-4 text-primary" /> <span>Cancel anytime</span></div>
                          </div>
                          <div className="space-y-2">
                              {/* Stripe Disabled/Hidden */}
                              {/* <Button onClick={() => handleStripeCheckout('weekly')} disabled={isLoadingBilling} className="w-full">
                                  {isLoadingBilling ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CreditCard className="mr-2 h-4 w-4" />}
                                  Pay with Card
                              </Button> */}
                              <Button variant="default" onClick={() => handlePaystackCheckout('weekly')} disabled={isLoadingBilling} className="w-full">
                                  {isLoadingBilling ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Banknote className="mr-2 h-4 w-4" />}
                                  Pay via Bank Transfer
                              </Button>
                          </div>
                      </div>

                      {/* Card 3: Pro Monthly */}
                      <div className="p-6 rounded-xl border-2 border-primary bg-primary/5 shadow-lg flex flex-col relative">
                          <div className="absolute top-0 right-0 bg-primary text-primary-foreground text-xs font-bold px-3 py-1 rounded-bl-lg">
                              BEST VALUE
                          </div>
                          <div className="mb-4">
                              <h3 className="text-xl font-bold font-headline">Pro Monthly</h3>
                              <div className="flex items-baseline gap-1 mt-1">
                                  <span className="text-2xl font-bold">₦4,500</span>
                                  <span className="text-sm text-muted-foreground">/ month</span>
                              </div>
                              <p className="text-xs text-primary font-bold mt-1 bg-primary/10 inline-block px-2 py-0.5 rounded">
                                  Try for 7 days – ₦1,900
                              </p>
                          </div>
                          <div className="space-y-3 text-sm mb-6 flex-1">
                              <div className="flex items-center gap-2"><CheckCircle2 className="h-4 w-4 text-primary" /> <span>Higher upload limits</span></div>
                              <div className="flex items-center gap-2"><CheckCircle2 className="h-4 w-4 text-primary" /> <span>Priority processing</span></div>
                              <div className="flex items-center gap-2"><CheckCircle2 className="h-4 w-4 text-primary" /> <span>Premium models</span></div>
                              <div className="flex items-center gap-2"><CheckCircle2 className="h-4 w-4 text-primary" /> <span>Advanced tools</span></div>
                          </div>
                          <div className="space-y-2">
                              {/* Stripe Disabled/Hidden */}
                              {/* <Button onClick={() => handleStripeCheckout('monthly')} disabled={isLoadingBilling} className="w-full shadow-md shadow-primary/20">
                                  {isLoadingBilling ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CreditCard className="mr-2 h-4 w-4" />}
                                  Pay with Card
                              </Button> */}
                              <Button variant="default" onClick={() => handlePaystackCheckout('monthly')} disabled={isLoadingBilling} className="w-full shadow-md shadow-primary/20">
                                  {isLoadingBilling ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Banknote className="mr-2 h-4 w-4" />}
                                  Pay via Bank Transfer
                              </Button>
                          </div>
                      </div>
                  </div>
              )}
              
              {/* Manual Fallback Link */}
              {tier !== 'pro' && (
                  <div className="text-center pt-4">
                      <button 
                          onClick={openBankTransfer}
                          className="text-xs text-muted-foreground hover:text-primary underline transition-colors"
                      >
                          Having trouble? Use Manual Bank Transfer
                      </button>
                  </div>
              )}
            </CardContent>
          </Card>

          {/* Bank Transfer Modal */}
          <Dialog open={showBankTransfer} onOpenChange={setShowBankTransfer}>
              <DialogContent className="sm:max-w-[425px]">
                  <DialogHeader>
                      <DialogTitle>Bank Transfer Payment</DialogTitle>
                      <DialogDescription>Make a transfer to the account below and confirm.</DialogDescription>
                  </DialogHeader>
                  
                  {manualPaymentStatus === 'success' ? (
                      <div className="flex flex-col items-center justify-center py-8 space-y-4 text-center">
                          <div className="h-16 w-16 bg-green-100 text-green-600 rounded-full flex items-center justify-center">
                              <CheckCircle2 className="h-8 w-8" />
                          </div>
                          <div>
                              <h3 className="font-bold text-lg">Payment Submitted</h3>
                              <p className="text-sm text-muted-foreground mt-1">
                                  We will activate your Pro plan as soon as we confirm the funds (usually within 2 hours).
                              </p>
                          </div>
                          <Button onClick={() => setShowBankTransfer(false)} className="w-full">Close</Button>
                      </div>
                  ) : (
                      <div className="space-y-6 py-2">
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
                                      <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => { navigator.clipboard.writeText("8023456789"); toast({ title: "Copied" }); }}>
                                          <Copy className="h-3 w-3" />
                                      </Button>
                                  </div>
                              </div>
                              <div className="flex justify-between text-sm pt-2 border-t border-dashed border-gray-300">
                                  <span className="text-muted-foreground">Amount:</span>
                                  <span className="font-bold text-primary">₦4,500</span>
                              </div>
                              <div className="flex justify-between text-sm items-center">
                                  <span className="text-muted-foreground">Reference Code:</span>
                                  <span className="font-mono font-bold bg-background px-2 py-1 rounded border select-all">{manualPaymentRef}</span>
                              </div>
                          </div>
                          
                          <div className="text-xs text-muted-foreground bg-yellow-50 text-yellow-800 p-3 rounded border border-yellow-200">
                              <p className="font-bold flex items-center gap-1"><AlertTriangle className="h-3 w-3" /> Important</p>
                              Please include the <strong>Reference Code</strong> in your transfer description/narration to ensure instant activation.
                          </div>

                          <Button onClick={handleManualPaymentSubmit} disabled={manualPaymentStatus === 'submitting'} className="w-full">
                              {manualPaymentStatus === 'submitting' ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CheckCircle2 className="mr-2 h-4 w-4" />}
                              I Have Made the Transfer
                          </Button>
                      </div>
                  )}
              </DialogContent>
          </Dialog>
          
          <Card>
            <CardHeader>
              <CardTitle className="font-headline">Application</CardTitle>
              <CardDescription>
                Install the app on your device for a native experience.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
                <PwaInstallButton />
                
                <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between rounded-lg border p-4 bg-muted/30 gap-4">
                  <div className="flex items-center gap-4">
                    <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10 text-primary shrink-0">
                      <Bot className="h-5 w-5" aria-hidden="true" />
                    </div>
                    <div className="space-y-0.5">
                      <Label className="text-base">AU Onboarding Assistant</Label>
                      <p className="text-sm text-muted-foreground">
                        Enable or disable the floating guide that helps you navigate the site.
                      </p>
                    </div>
                  </div>
                  <div className="flex w-full sm:w-auto justify-end">
                    <Switch 
                      checked={isAssistantEnabled} 
                      onCheckedChange={handleToggleAssistant} 
                    />
                  </div>
                </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="font-headline">Appearance</CardTitle>
              <CardDescription>
                Customize the look and feel of the application.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex items-center justify-between">
                <div>
                  <Label htmlFor="theme">Theme</Label>
                  <p className="text-sm text-muted-foreground">Select a light or dark theme.</p>
                </div>
                <ThemeToggle />
              </div>
            </CardContent>
          </Card>

        </div>
      </div>

      {/* Google Auth Popup */}
      <AnimatePresence>
        {showAuthPopup && (
          <Dialog open={showAuthPopup} onOpenChange={handleAuthCancelAttempt}>
            <DialogContent 
              className="sm:max-w-[425px] overflow-hidden [&>button]:hidden" 
              onPointerDownOutside={(e) => e.preventDefault()} 
              onEscapeKeyDown={(e) => e.preventDefault()}
            >
              <DialogHeader>
                <DialogTitle className="text-center font-headline text-2xl">Authenticating</DialogTitle>
                <DialogDescription className="text-center text-base">
                  Connecting to Google to secure your account...
                </DialogDescription>
              </DialogHeader>
              <div className="flex flex-col items-center justify-center py-10 space-y-8">
                <div className="relative w-28 h-28">
                  <motion.div
                    className="absolute inset-0 border-4 border-primary/20 border-t-primary rounded-full"
                    animate={{ rotate: 360 }}
                    transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
                  />
                  <motion.div
                    className="absolute inset-0 flex items-center justify-center"
                    animate={{ scale: [1, 1.1, 1] }}
                    transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}
                  >
                    <Icons.google className="w-12 h-12" />
                  </motion.div>
                </div>
                
                <motion.div 
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.5 }}
                  className="flex flex-col items-center gap-3"
                >
                  <div className="flex items-center gap-2 text-sm font-semibold text-primary">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    <span>Verifying credentials...</span>
                  </div>
                  <p className="text-xs text-muted-foreground px-6 text-center">
                    Please do not close this window until authentication is complete.
                  </p>
                </motion.div>
              </div>
            </DialogContent>
          </Dialog>
        )}
      </AnimatePresence>

      {/* Auth Cancel Confirmation */}
      <AlertDialog open={showAuthCancelConfirm} onOpenChange={setShowAuthCancelConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="font-headline text-xl text-destructive">Stop Authentication?</AlertDialogTitle>
            <AlertDialogDescription className="text-base">
              Are you sure you want to cancel the authentication process? This will prevent you from saving your progress.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="gap-2 sm:gap-0">
            <AlertDialogCancel className="font-medium">Continue Auth</AlertDialogCancel>
            <AlertDialogAction 
              onClick={confirmAuthCancel}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90 font-medium"
            >
              Stop & Cancel
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={showGuestSignInDisabledDialog} onOpenChange={setShowGuestSignInDisabledDialog}>
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle className="font-headline">Sign-in is disabled in Guest mode</DialogTitle>
            <DialogDescription>
              For security reasons and future-proofing, guest sessions are locked and can’t be linked to Google yet.
            </DialogDescription>
          </DialogHeader>
          <div className="text-sm text-muted-foreground">
            This prevents account-mixups and protects your data while we finalize the upgrade flow.
          </div>
          <DialogFooter>
            <Button onClick={() => setShowGuestSignInDisabledDialog(false)}>Ok</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Sign Out & Deletion Flow */}
      <AnimatePresence mode="wait">
        {showSignOutPopup && (
          <Dialog open={showSignOutPopup} onOpenChange={(open) => {
            if (signOutStep === 'warning') setShowSignOutPopup(open);
          }}>
            <DialogContent 
              className="sm:max-w-[450px] overflow-hidden [&>button]:hidden"
              onPointerDownOutside={(e) => signOutStep !== 'warning' && e.preventDefault()}
              onEscapeKeyDown={(e) => signOutStep !== 'warning' && e.preventDefault()}
            >
              <AnimatePresence mode="wait">
                {signOutStep === 'warning' && (
                  <motion.div
                    key="warning"
                    initial={{ opacity: 0, x: 20 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: -20 }}
                    className="space-y-6 py-4"
                  >
                    <DialogHeader>
                      <div className="mx-auto w-16 h-16 rounded-full bg-destructive/10 flex items-center justify-center mb-4">
                        <AlertTriangle className="w-8 h-8 text-destructive" />
                      </div>
                      <DialogTitle className="text-center font-headline text-2xl text-destructive">Warning: Account Deletion</DialogTitle>
                      <DialogDescription className="text-center text-base pt-2">
                        If you sign out now, your account will be <span className="font-bold text-destructive">deleted automatically</span> from the system.
                      </DialogDescription>
                    </DialogHeader>
                    <div className="bg-destructive/5 border border-destructive/20 rounded-lg p-4 text-sm text-destructive font-medium text-center">
                      All your documents, chat history, and generated knowledge will be permanently erased.
                    </div>
                    <div className="flex flex-col sm:flex-row gap-3 pt-2">
                      <Button variant="outline" onClick={() => setShowSignOutPopup(false)} className="flex-1">
                        Cancel
                      </Button>
                      <Button variant="destructive" onClick={proceedToFinalWarning} className="flex-1 font-bold">
                        I Understand, Sign Out
                      </Button>
                    </div>
                  </motion.div>
                )}

                {signOutStep === 'final' && (
                  <motion.div
                    key="final"
                    initial={{ opacity: 0, x: 20 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: -20 }}
                    className="space-y-6 py-4"
                  >
                    <DialogHeader>
                      <div className="mx-auto w-16 h-16 rounded-full bg-destructive/20 flex items-center justify-center mb-4 animate-pulse">
                        <ShieldAlert className="w-8 h-8 text-destructive" />
                      </div>
                      <DialogTitle className="text-center font-headline text-2xl text-destructive uppercase tracking-tight">Final Confirmation</DialogTitle>
                      <DialogDescription className="text-center text-base pt-2 font-bold">
                        THIS ACTION CANNOT BE STOPPED OR UNDONE.
                      </DialogDescription>
                    </DialogHeader>
                    <div className="text-center space-y-2">
                      <p className="text-sm text-muted-foreground">
                        Are you absolutely certain? This is your last chance to turn back.
                      </p>
                    </div>
                    <Button 
                      variant="destructive" 
                      onClick={handleSignOutFinal}
                      className="w-full h-12 text-lg font-black shadow-lg shadow-destructive/20 hover:scale-[1.02] active:scale-[0.98] transition-all"
                    >
                      ERASE EVERYTHING & SIGN OUT
                    </Button>
                  </motion.div>
                )}

                {signOutStep === 'processing' && (
                  <motion.div
                    key="processing"
                    initial={{ opacity: 0, scale: 0.95 }}
                    animate={{ opacity: 1, scale: 1 }}
                    className="flex flex-col items-center justify-center py-12 space-y-8"
                  >
                    <div className="relative w-24 h-24">
                      <motion.div
                        className="absolute inset-0 border-4 border-destructive/20 border-t-destructive rounded-full"
                        animate={{ rotate: -360 }}
                        transition={{ duration: 1.5, repeat: Infinity, ease: "linear" }}
                      />
                      <motion.div
                        className="absolute inset-0 flex items-center justify-center"
                        animate={{ 
                          scale: [1, 0.8, 1.2, 0.5, 1],
                          opacity: [1, 0.8, 1, 0.5, 1]
                        }}
                        transition={{ duration: 2, repeat: Infinity }}
                      >
                        <Trash2 className="w-10 h-10 text-destructive" />
                      </motion.div>
                    </div>
                    <div className="text-center space-y-2">
                      <h3 className="text-xl font-bold text-destructive">Clearing Data...</h3>
                      <p className="text-sm text-muted-foreground animate-pulse">
                        Wiping your session and permanent records...
                      </p>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </DialogContent>
          </Dialog>
        )}
      </AnimatePresence>
    </main>
  );
}
