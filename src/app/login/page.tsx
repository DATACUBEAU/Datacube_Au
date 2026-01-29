'use client';

import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from '@/components/ui/card';
import { Icons } from '@/components/icons';
import { useToast } from '@/hooks/use-toast';
import { useRouter } from 'next/navigation';
import { Loader2, ShieldCheck, Clock, UserX } from 'lucide-react';
import Link from 'next/link';
import { supabase, clearGuestToken, setGuestToken } from '@/lib/supabase/client';
import { useSupabaseUser } from '@/hooks/use-supabase-auth';
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

export default function LoginPage() {
  const [isLoadingGoogle, setIsLoadingGoogle] = useState(false);
  const [isLoadingGuest, setIsLoadingGuest] = useState(false);
  const [showGuestDisabled, setShowGuestDisabled] = useState(false);
  
  const [user, isUserLoading] = useSupabaseUser();
  const { toast } = useToast();
  const router = useRouter();

  useEffect(() => {
    if (isUserLoading) return;
    if (user) {
         // If user is already logged in (Google or Guest), redirect to dashboard
         router.push('/dashboard');
    }
  }, [user, isUserLoading, router]);

  const [showAuthPopup, setShowAuthPopup] = useState(false);
  const [showAuthCancelConfirm, setShowAuthCancelConfirm] = useState(false);

  const handleGoogleSignIn = async () => {
    setIsLoadingGoogle(true);
    setShowAuthPopup(true);

    // Artificial delay for animation
    await new Promise(resolve => setTimeout(resolve, 1500));

    try {
      clearGuestToken(); // Clear any existing guest session
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

  const startGuestSession = async () => {
    setIsLoadingGuest(true);
    
    try {
      clearGuestToken();

      try {
        const { safeFetch } = await import('@/lib/api/safe-fetch');
        const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
        const data = await safeFetch(`${SUPABASE_URL}/functions/v1/guest-session`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        });
        if (data?.token) {
          setGuestToken(data.token);
          window.location.href = '/dashboard';
          return;
        }
      } catch {}

      const { error } = await supabase.auth.signInAnonymously();
      if (error) throw error;
      router.push('/dashboard');

    } catch (error: any) {
       console.error(error);
       toast({
        variant: 'destructive',
        title: 'Guest Access Failed',
        description: error?.message || 'Could not start guest session. Rate limit may be reached.',
      });
    } finally {
      setIsLoadingGuest(false);
    }
  };

  const isAnonymous = user ? ((user as any).is_anonymous ?? !user.email) : false;

  if (isUserLoading || (!isUserLoading && user)) {
    return (
      <div className="flex h-dvh items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    );
  }
  
  const anyLoading = isLoadingGoogle || isLoadingGuest;
  const disableAuthButtons = anyLoading;

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center bg-background px-4">
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

      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <Link href="/" className="mx-auto mb-4 flex items-center justify-center">
            <Icons.logo className="h-10 w-10 text-primary" />
          </Link>
          <CardTitle className="font-headline text-3xl">
            Welcome to DataCube AU
          </CardTitle>
          <CardDescription>
            Sign in to upload documents, chat with your data, and unlock A U insights.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          <Button
            onClick={handleGoogleSignIn}
            className="w-full"
            disabled={disableAuthButtons}
          >
            {isLoadingGoogle ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Icons.google className="mr-2 h-4 w-4" />
            )}
            Sign in with Google
          </Button>
          
          <div className="relative">
              <div className="absolute inset-0 flex items-center">
                <span className="w-full border-t" />
              </div>
              <div className="relative flex justify-center text-xs uppercase">
                <span className="bg-background px-2 text-muted-foreground">Or try instantly</span>
              </div>
          </div>

          <Button 
            variant="secondary" 
            onClick={() => setShowGuestDisabled(true)}
            className="w-full opacity-60 cursor-not-allowed"
          >
             {isLoadingGuest ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : <UserX className="mr-2 h-4 w-4" />}
            Continue as Guest (Disabled)
          </Button>
        </CardContent>
      </Card>
      <footer className="mt-8 text-center text-sm text-muted-foreground">
        By continuing, you agree to our{' '}
        <Link href="/policy#terms" className="text-primary underline underline-offset-4">Terms of Service</Link>
        {' '}and{' '}
        <Link href="/policy#privacy" className="text-primary underline underline-offset-4">Privacy Policy</Link>.
      </footer>

      {/* Guest Disabled Dialog */}
      <AlertDialog open={showGuestDisabled} onOpenChange={setShowGuestDisabled}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2 font-headline text-xl text-destructive">
                <UserX className="h-5 w-5" />
                Guest Mode Disabled
            </AlertDialogTitle>
            <AlertDialogDescription asChild className="text-base space-y-3">
              <div className="mt-2">
                <p>
                  Access to Guest Mode is currently disabled for <strong>security reasons</strong> and to ensure <strong>future-proof</strong> stability of the application.
                </p>
                <p className="mt-3">
                  We are working on a more secure way to provide anonymous access while protecting user data and system integrity. Please sign in with Google to continue.
                </p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogAction onClick={() => setShowGuestDisabled(false)}>
                Got it
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
