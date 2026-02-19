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
import { useRouter, useSearchParams } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import Link from 'next/link';
import { useSupabaseUser } from '@/hooks/use-supabase-auth';
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

import { useSmartAuth } from '@/hooks/use-smart-auth';

export default function LoginPage() {
  const { signInWithGoogle, isLoading: isSmartLoading } = useSmartAuth();
  const [isLoadingGoogle, setIsLoadingGoogle] = useState(false);
  const [isResolvingRedirect, setIsResolvingRedirect] = useState(false);
  
  const [user, , isUserLoading] = useSupabaseUser();
  const { toast } = useToast();
  const router = useRouter();
  const searchParams = useSearchParams();

  const redirectToParam = searchParams.get('redirectTo');
  const safeRedirectPath =
    typeof redirectToParam === 'string' &&
    redirectToParam.startsWith('/') &&
    !redirectToParam.startsWith('//')
      ? redirectToParam
      : '/dashboard';

  useEffect(() => {
    if (isUserLoading) return;
    if (!user) return;

    let cancelled = false;

    const resolveRedirect = async () => {
      try {
        setIsResolvingRedirect(true);

        if (safeRedirectPath.startsWith('/conex')) {
          const res = await fetch('/conex/users', {
            method: 'GET',
            headers: { Accept: 'application/json' },
            cache: 'no-store',
          });

          if (cancelled) return;

          if (res.ok) {
            router.replace(safeRedirectPath);
            return;
          }

          if (res.status === 403) {
            router.replace('/403');
            return;
          }

          if (res.status === 401) {
            // Session exists locally but cannot access server-protected route.
            // Keep user on login page instead of infinite redirect loop.
            setIsResolvingRedirect(false);
            return;
          }

          router.replace('/dashboard');
          return;
        }

        router.replace(safeRedirectPath);
      } catch {
        if (!cancelled) router.replace('/dashboard');
      }
    };

    resolveRedirect();

    return () => {
      cancelled = true;
    };
  }, [user, isUserLoading, router, safeRedirectPath]);

  const [showAuthPopup, setShowAuthPopup] = useState(false);
  const [showAuthCancelConfirm, setShowAuthCancelConfirm] = useState(false);

  const handleGoogleSignIn = async () => {
    setIsLoadingGoogle(true);
    setShowAuthPopup(true);

    // Artificial delay for animation
    await new Promise(resolve => setTimeout(resolve, 1500));

    try {
      await signInWithGoogle(safeRedirectPath);
      // No need to manually push to dashboard, useEffect will handle it when user state updates
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

  if (isUserLoading || isResolvingRedirect) {
    return (
      <div className="flex h-dvh items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    );
  }
  
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
            disabled={isLoadingGoogle}
          >
            {isLoadingGoogle ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Icons.google className="mr-2 h-4 w-4" />
            )}
            Sign in with Google
          </Button>
        </CardContent>
      </Card>
      <footer className="mt-8 text-center text-sm text-muted-foreground">
        By continuing, you agree to our{' '}
        <Link href="/policy#terms" className="text-primary underline underline-offset-4">Terms of Service</Link>
        {' '}and{' '}
        <Link href="/policy#privacy" className="text-primary underline underline-offset-4">Privacy Policy</Link>.
      </footer>
    </div>
  );
}
