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
  Bot, 
  Loader2, 
  ShieldAlert,
  Trash2,
  AlertTriangle
} from 'lucide-react';
import { Icons } from '@/components/icons';
import { useToast } from '@/hooks/use-toast';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import PwaInstallButton from '@/components/pwa-install-button';
import { useSupabaseUser } from '@/hooks/use-supabase-auth';
import { supabase } from '@/lib/supabase-client/client';
import { Switch } from '@/components/ui/switch';
import { explicitSignOut } from '@/lib/auth/explicit-signout';
import { useEffectiveEntitlements } from '@/hooks/use-effective-entitlements';
import { getRetentionPolicyNotice } from '@/lib/plans/subscription-policy';
import { USERNAME_TAKEN_MESSAGE, normalizeUsername, validateUsername } from '@/lib/auth/username';

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
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
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { motion, AnimatePresence } from 'framer-motion';
import { useDelayedLoadingState } from '@/hooks/use-delayed-loading-state';
import { SettingsPageSkeleton, SlowNetworkNotice } from '@/components/skeletons/page-skeletons';

export default function SettingsPage() {
  const retentionPolicy = getRetentionPolicyNotice();
  const [user, , isUserLoading] = useSupabaseUser();
  const { toast } = useToast();
  const router = useRouter();
  const { showSkeleton, showSlowNotice } = useDelayedLoadingState(isUserLoading);
  const { entitlements, loading: isPlanStatusLoading } = useEffectiveEntitlements();

  const currentDisplayName = useMemo(() => {
    if (!user) return '';
    return (
      (user.user_metadata?.full_name as string | undefined) ??
      (user.user_metadata?.name as string | undefined) ??
      ''
    );
  }, [user]);

  const [displayName, setDisplayName] = useState(currentDisplayName);
  const [username, setUsername] = useState('');
  const [currentUsername, setCurrentUsername] = useState('');
  const [isUsernameLoading, setIsUsernameLoading] = useState(false);
  const [usernameHelp, setUsernameHelp] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isLoadingGoogle, setIsLoadingGoogle] = useState(false);
  const [isAssistantEnabled, setIsAssistantEnabled] = useState(true);
  const [showAuthPopup, setShowAuthPopup] = useState(false);
  const [showAuthCancelConfirm, setShowAuthCancelConfirm] = useState(false);
  const [showSignOutPopup, setShowSignOutPopup] = useState(false);
  const [isSigningOut, setIsSigningOut] = useState(false);
  const [showDeletePopup, setShowDeletePopup] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState('');

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

  useEffect(() => {
    if (!user?.id) {
      setUsername('');
      setCurrentUsername('');
      setUsernameHelp(null);
      return;
    }

    let cancelled = false;

    const loadUsername = async () => {
      setIsUsernameLoading(true);
      try {
        const res = await fetch('/api/profile/username', {
          method: 'GET',
          cache: 'no-store',
          credentials: 'include',
          headers: { Accept: 'application/json' },
        });
        const payload = await res.json().catch(() => ({}));
        if (cancelled) return;

        if (res.ok && payload?.ok === true) {
          const nextUsername = typeof payload.username === 'string' ? payload.username : '';
          setUsername(nextUsername);
          setCurrentUsername(nextUsername);
          setUsernameHelp(payload.needsUsername ? 'Choose a unique username to complete your profile.' : null);
          return;
        }

        setUsernameHelp(payload?.message || 'Username setup is not available yet.');
      } catch {
        if (!cancelled) {
          setUsernameHelp('Could not load username right now.');
        }
      } finally {
        if (!cancelled) {
          setIsUsernameLoading(false);
        }
      }
    };

    void loadUsername();

    return () => {
      cancelled = true;
    };
  }, [user?.id]);

  const hasPaidPro = useMemo(
    () => entitlements.entitlementSource === 'paid' && entitlements.hasPro,
    [entitlements.entitlementSource, entitlements.hasPro],
  );
  const planStatusLabel = useMemo(() => {
    if (isPlanStatusLoading) return 'Updating...';
    if (entitlements.plan === 'admin') return 'Admin';
    if (entitlements.plan === 'premium') return 'Premium';
    if (entitlements.entitlementSource === 'promo' || entitlements.promoActive) return 'Promo Pro';
    if (hasPaidPro) return 'Pro';
    return 'Free';
  }, [
    entitlements.entitlementSource,
    entitlements.plan,
    entitlements.promoActive,
    hasPaidPro,
    isPlanStatusLoading,
  ]);
  const planStatusMeta = useMemo(() => {
    if (entitlements.entitlementSource === 'promo' || entitlements.promoActive) {
      if (entitlements.promoEndsAtLagos) {
        const promoEnd = new Date(entitlements.promoEndsAtLagos);
        if (!Number.isNaN(promoEnd.getTime())) {
          return `Promo ends: ${promoEnd.toLocaleString('en-US', {
            timeZone: 'Africa/Lagos',
            month: 'short',
            day: 'numeric',
            year: 'numeric',
            hour: 'numeric',
            minute: '2-digit',
          })} (Africa/Lagos)`;
        }
      }
      return 'Promo mode active';
    }

    if (entitlements.plan === 'premium') {
      if (entitlements.entitlementEndsAt) {
        const expires = new Date(entitlements.entitlementEndsAt);
        if (!Number.isNaN(expires.getTime())) {
          return `Premium expires: ${expires.toLocaleDateString(undefined, {
            year: 'numeric',
            month: 'short',
            day: 'numeric',
          })}`;
        }
      }
      return 'Premium entitlement active';
    }

    if (hasPaidPro && entitlements.entitlementEndsAt) {
      const expires = new Date(entitlements.entitlementEndsAt);
      if (!Number.isNaN(expires.getTime())) {
        return `Expires: ${expires.toLocaleDateString(undefined, {
          year: 'numeric',
          month: 'short',
          day: 'numeric',
        })}`;
      }
    }

    if (hasPaidPro) return 'Paid Pro entitlement active';
    return 'No active paid entitlement';
  }, [
    entitlements.entitlementEndsAt,
    entitlements.entitlementSource,
    entitlements.plan,
    entitlements.promoActive,
    entitlements.promoEndsAtLagos,
    hasPaidPro,
  ]);

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
        description: enabled ? 'The guide button is available when you need page help.' : 'The guide has been hidden.',
      });
    }
  };

  const handleGoogleSignIn = async () => {
    setIsLoadingGoogle(true);
    setShowAuthPopup(true);
    
    // Artificial delay to show the animation
    await new Promise(resolve => setTimeout(resolve, 1500));

    try {
      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent('/dashboard')}`,
        },
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

  const hasProfileChanges = useMemo(
    () =>
      displayName !== currentDisplayName ||
      normalizeUsername(username) !== normalizeUsername(currentUsername),
    [currentDisplayName, currentUsername, displayName, username],
  );

  const startSignOutFlow = () => {
    setShowSignOutPopup(true);
  };

  const handleSignOutConfirm = async () => {
    if (isSigningOut) return;
    setIsSigningOut(true);

    try {
      if (user?.id) {
        localStorage.removeItem(`au_assistant_progress_${user.id}`);
        localStorage.removeItem(`au_assistant_settings_${user.id}`);
      }
      await explicitSignOut(user?.id ?? null);
    } catch (error) {
      console.error('[signOut] Error signing out:', error);
    } finally {
      setShowSignOutPopup(false);
      if (typeof window !== 'undefined') {
        window.location.replace('/');
        return;
      }
      router.replace('/');
    }
  };

  const startDeleteFlow = () => {
    setDeleteConfirmText('');
    setShowDeletePopup(true);
  };

  const handleDeleteConfirm = async () => {
    if (isDeleting || deleteConfirmText !== 'DELETE MY ACCOUNT') return;
    setIsDeleting(true);

    try {
      const res = await fetch('/api/account/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ confirmation: deleteConfirmText }),
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        throw new Error(data?.message || 'Account deletion failed.');
      }

      // Clear all local storage
      if (typeof localStorage !== 'undefined') {
        localStorage.clear();
      }

      toast({
        title: 'Account Deleted',
        description: 'Your account has been permanently removed.',
      });

      // Redirect to home
      if (typeof window !== 'undefined') {
        window.location.replace('/');
        return;
      }
      router.replace('/');
    } catch (error: any) {
      toast({
        variant: 'destructive',
        title: 'Deletion Failed',
        description: error?.message || 'Could not delete your account. Please try again.',
      });
    } finally {
      setIsDeleting(false);
      setShowDeletePopup(false);
    }
  };

  const handleSaveChanges = async () => {
    if (!user) return;
    
    setIsSaving(true);
    const oldDisplayName = currentDisplayName;

    try {
      const normalizedUsername = normalizeUsername(username);
      if (normalizedUsername !== normalizeUsername(currentUsername)) {
        const validation = validateUsername(username);
        if (!validation.ok) {
          throw new Error(validation.message || 'Choose a valid username.');
        }

        const res = await fetch('/api/profile/username', {
          method: 'POST',
          credentials: 'include',
          cache: 'no-store',
          headers: {
            Accept: 'application/json',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ username: validation.normalized }),
        });
        const payload = await res.json().catch(() => ({}));

        if (res.status === 409 || payload?.code === 'username_taken') {
          throw new Error(USERNAME_TAKEN_MESSAGE);
        }
        if (!res.ok || payload?.ok !== true) {
          throw new Error(payload?.message || 'Could not save username.');
        }

        const nextUsername = typeof payload.username === 'string' ? payload.username : validation.normalized;
        setUsername(nextUsername);
        setCurrentUsername(nextUsername);
        setUsernameHelp(null);
      }

      if (oldDisplayName !== displayName) {
        const { error } = await supabase.auth.updateUser({
          data: { full_name: displayName },
        });
        if (error) throw error;
      }

      toast({
        title: 'Success',
        description: 'Your profile has been updated.',
      });
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

  if (isUserLoading && showSkeleton) {
    return <SettingsPageSkeleton />;
  }
  
  return (
    <main className="flex flex-1 flex-col gap-4 p-4 md:gap-8 md:p-8">
      {showSlowNotice && isUserLoading ? <SlowNetworkNotice /> : null}

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
            {retentionPolicy.summary}
          </AlertDescription>
        </Alert>
      </div>

      <div className="mx-auto grid w-full max-w-4xl items-start gap-6">
        <div className="grid gap-6">
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
                        <Label htmlFor="displayName">Display name</Label>
                        <Input
                        id="displayName"
                        value={displayName}
                        onChange={(e) => setDisplayName(e.target.value)}
                        />
                    </div>
                    </div>
                    <div className="grid w-full gap-1.5">
                        <Label htmlFor="settings-username">Username</Label>
                        <Input
                        id="settings-username"
                        autoComplete="username"
                        value={username}
                        onChange={(e) => setUsername(normalizeUsername(e.target.value))}
                        placeholder="Choose a unique username"
                        disabled={isUsernameLoading}
                        />
                        <p className="text-xs text-muted-foreground">
                          {usernameHelp || 'Usernames are unique, lowercase, and visible only as account identity metadata.'}
                        </p>
                    </div>
                    <div className="grid w-full gap-1.5">
                        <Label htmlFor="email">Email</Label>
                        <Input id="email" type="email" value={user?.email || ''} disabled />
                    </div>
                </form>
                </CardContent>
                <CardFooter className="border-t px-6 py-4 flex flex-col-reverse sm:flex-row sm:justify-between items-center gap-4">
                <Button onClick={handleSaveChanges} disabled={isSaving || isUsernameLoading || !hasProfileChanges} className="w-full sm:w-auto">
                    {isSaving ? <><Save className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" /> Saving...</> : 'Save Changes'}
                </Button>
                <div className="flex gap-2 w-full sm:w-auto">
                  <Button variant="outline" onClick={startSignOutFlow} className="w-full sm:w-auto">
                      <LogOut className="mr-2 h-4 w-4" aria-hidden="true" />
                      Sign Out
                  </Button>
                  <Button variant="destructive" onClick={startDeleteFlow} className="w-full sm:w-auto" id="delete-account-btn">
                      <Trash2 className="mr-2 h-4 w-4" aria-hidden="true" />
                      Delete Account
                  </Button>
                </div>
                </CardFooter>
            </Card>
          <Card>
            <CardHeader>
              <CardTitle className="font-headline">Subscription</CardTitle>
              <CardDescription>
                Billing and plan management are handled on the dedicated pricing page.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="rounded-xl border bg-muted/20 p-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="text-xs uppercase tracking-wide text-muted-foreground">Plan Status</p>
                    <p className="text-base font-semibold">
                      {planStatusLabel}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {planStatusMeta}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <Button asChild variant="outline" size="sm">
                      <Link href="/dashboard/settings/subscription">Manage</Link>
                    </Button>
                    {!hasPaidPro && !entitlements.promoActive ? (
                      <Button asChild size="sm">
                        <Link href="/pricing">Upgrade</Link>
                      </Button>
                    ) : null}
                  </div>
                </div>
              </div>
              <div className="rounded-xl border bg-card p-5">
                <p className="text-sm text-muted-foreground">
                  Use the standalone Subscription page for payment methods, plan upgrades, and billing history.
                </p>
                <div className="mt-4 flex flex-col gap-3 sm:flex-row">
                  <Button asChild className="w-full sm:w-auto">
                    <Link href="/dashboard/settings/subscription">
                      Open Subscription Page
                    </Link>
                  </Button>
                  <Button asChild variant="outline" className="w-full sm:w-auto">
                    <Link href="/dashboard/settings/subscription">
                      View Simple, Transparent Pricing
                    </Link>
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
          
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

          <Card className="border-destructive/50">
            <CardHeader>
              <CardTitle className="font-headline text-destructive flex items-center gap-2">
                <AlertTriangle className="h-5 w-5" />
                Danger Zone
              </CardTitle>
              <CardDescription>
                Irreversible actions that permanently affect your account.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="rounded-xl border border-destructive/30 bg-destructive/5 dark:bg-destructive/10 p-5">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="space-y-1">
                    <p className="text-sm font-semibold text-destructive">Delete Account</p>
                    <p className="text-xs text-muted-foreground">
                      Permanently delete your account and all associated data including documents, chat history, generated content, and billing records. This action cannot be undone.
                    </p>
                  </div>
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={startDeleteFlow}
                    className="shrink-0"
                    id="danger-zone-delete-btn"
                  >
                    <Trash2 className="mr-2 h-4 w-4" />
                    Delete Account
                  </Button>
                </div>
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

      <AlertDialog open={showSignOutPopup} onOpenChange={(open) => {
        if (!isSigningOut) setShowSignOutPopup(open);
      }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Sign out now?</AlertDialogTitle>
            <AlertDialogDescription>
              This immediately ends your session on this device and returns you to the home page.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isSigningOut}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => void handleSignOutConfirm()} disabled={isSigningOut}>
              {isSigningOut ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Sign out
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Account Deletion Confirmation */}
      <AlertDialog open={showDeletePopup} onOpenChange={(open) => {
        if (!isDeleting) {
          setShowDeletePopup(open);
          if (!open) setDeleteConfirmText('');
        }
      }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="font-headline text-xl text-destructive flex items-center gap-2">
              <AlertTriangle className="h-5 w-5" />
              Delete Your Account?
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3">
                <p className="text-base">
                  This will <strong>permanently</strong> delete your account and all your data:
                </p>
                <ul className="list-disc pl-5 space-y-1 text-sm text-muted-foreground">
                  <li>All uploaded documents and generated content</li>
                  <li>Chat history and conversation threads</li>
                  <li>Knowledge hub, predictions, and practice exams</li>
                  <li>Billing records and subscription</li>
                  <li>Your user profile and preferences</li>
                </ul>
                <div className="rounded-md bg-destructive/10 border border-destructive/30 p-3 mt-3">
                  <p className="text-sm font-semibold text-destructive">
                    ⚠️ This action is irreversible. There is no recovery.
                  </p>
                </div>
                <div className="pt-2">
                  <label className="text-sm font-medium" htmlFor="delete-confirm-input">
                    Type <span className="font-mono font-bold text-destructive">DELETE MY ACCOUNT</span> to confirm:
                  </label>
                  <Input
                    id="delete-confirm-input"
                    value={deleteConfirmText}
                    onChange={(e) => setDeleteConfirmText(e.target.value)}
                    placeholder="DELETE MY ACCOUNT"
                    className="mt-2 font-mono"
                    disabled={isDeleting}
                    autoComplete="off"
                  />
                </div>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeleting}>Cancel</AlertDialogCancel>
            <Button
              variant="destructive"
              onClick={() => void handleDeleteConfirm()}
              disabled={isDeleting || deleteConfirmText !== 'DELETE MY ACCOUNT'}
            >
              {isDeleting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Trash2 className="mr-2 h-4 w-4" />}
              {isDeleting ? 'Deleting...' : 'Permanently Delete Account'}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </main>
  );
}
