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
  Trash2 
} from 'lucide-react';
import { Icons } from '@/components/icons';
import { useToast } from '@/hooks/use-toast';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import PwaInstallButton from '@/components/pwa-install-button';
import { useSupabaseUser } from '@/hooks/use-supabase-auth';
import { supabase } from '@/lib/supabase/client';
import { Switch } from '@/components/ui/switch';

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
import { motion, AnimatePresence } from 'framer-motion';

export default function SettingsPage() {
  const [user] = useSupabaseUser();
  const { toast } = useToast();
  const router = useRouter();

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

  useEffect(() => {
    if (user) {
      const stored = localStorage.getItem(`au_assistant_settings_${user.id}`);
      setIsAssistantEnabled(stored !== 'disabled');
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

  const isAnonymous = user ? ((user as any).is_anonymous ?? !user.email) : true;

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
                    <Button onClick={handleGoogleSignIn} disabled={isLoadingGoogle} className="w-full sm:w-auto">
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
