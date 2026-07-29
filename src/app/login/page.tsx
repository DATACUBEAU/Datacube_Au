'use client';

import { useState, useEffect, type FormEvent } from 'react';
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
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Loader2, ShieldAlert } from 'lucide-react';
import Link from 'next/link';
import { useSupabaseUser } from '@/hooks/use-supabase-auth';
import { getSupabaseAccessToken, supabase } from '@/lib/supabase-client/client';
import { hasServerAuthSessionCookie, syncServerAuthSessionCookie } from '@/lib/auth/session-cookie';
import { Input } from '@/components/ui/input';
import { PasswordInput } from '@/components/ui/password-input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
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
import { explicitSignOut } from '@/lib/auth/explicit-signout';
import {
  USERNAME_TAKEN_MESSAGE,
  isUsernameTakenError,
  normalizeUsername,
  validateUsername,
} from '@/lib/auth/username';
import { sanitizeLocalRedirectPath } from '@/lib/auth/redirects';
import { getRetentionPolicyNotice } from '@/lib/plans/subscription-policy';

type AuthMode = 'login' | 'signup';

function safeAuthMessage(error: unknown, fallback: string): string {
  const message = String((error as any)?.message || fallback);
  if (/invalid login credentials/i.test(message)) {
    return 'Email or password is incorrect.';
  }
  if (/email not confirmed/i.test(message)) {
    return 'Please confirm your email before signing in.';
  }
  if (/already registered|already exists|user already/i.test(message)) {
    return 'This email is already registered. Try signing in instead.';
  }
  if (/password/i.test(message) && /6|weak|short/i.test(message)) {
    return 'Use a stronger password with at least 6 characters.';
  }
  return message || fallback;
}

export default function LoginPage() {
  const { signInWithGoogle } = useSmartAuth();
  const [isLoadingGoogle, setIsLoadingGoogle] = useState(false);
  const [isLoadingEmail, setIsLoadingEmail] = useState(false);
  const [isResolvingRedirect, setIsResolvingRedirect] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [username, setUsername] = useState('');
  const [fullName, setFullName] = useState('');
  const [authMode, setAuthMode] = useState<AuthMode>('login');
  const [authError, setAuthError] = useState<string | null>(null);
  const [authNotice, setAuthNotice] = useState<string | null>(null);
  
  const [user, , isUserLoading] = useSupabaseUser();
  const { toast } = useToast();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const redirectToParam = searchParams.get('redirectTo');
  const sessionReasonParam = searchParams.get('reason');
  const requestedModeParam = searchParams.get('mode');
  const wasSessionExpired = sessionReasonParam === 'session_expired';
  const hadAuthError = sessionReasonParam === 'auth_error';
  const safeRedirectPath = sanitizeLocalRedirectPath(redirectToParam);
  const retentionPolicy = getRetentionPolicyNotice();

  useEffect(() => {
    const nextMode: AuthMode =
      pathname?.startsWith('/signup') || requestedModeParam === 'signup' ? 'signup' : 'login';
    setAuthMode(nextMode);
  }, [pathname, requestedModeParam]);

  useEffect(() => {
    if (isUserLoading) return;
    if (!user) return;

    let cancelled = false;

    const resolveRedirect = async () => {
      const signOutAndStop = async () => {
        await explicitSignOut(user?.id ?? null);
        if (!cancelled) {
          setIsResolvingRedirect(false);
        }
      };

      const validateServerSessionCookie = async (): Promise<boolean> => {
        const res = await fetch('/api/auth/session', {
          method: 'GET',
          credentials: 'include',
          cache: 'no-store',
        });
        return res.ok;
      };

      const ensureServerSession = async (): Promise<string | null> => {
        const { data: initialSessionData } = await supabase.auth.getSession();
        let activeSession = initialSessionData.session;
        if (!activeSession?.access_token) {
          const fallbackToken = await getSupabaseAccessToken();
          if (!fallbackToken) return null;
          const { data: fallbackSessionData } = await supabase.auth.getSession();
          activeSession = fallbackSessionData.session;
        }

        if (!activeSession?.access_token) return null;
        syncServerAuthSessionCookie(activeSession);
        if (!hasServerAuthSessionCookie()) return null;

        if (await validateServerSessionCookie()) {
          return activeSession.access_token;
        }

        const { data: refreshed, error: refreshError } = await supabase.auth.refreshSession();
        if (refreshError || !refreshed.session?.access_token) return null;

        activeSession = refreshed.session;
        syncServerAuthSessionCookie(activeSession);
        if (!hasServerAuthSessionCookie()) return null;

        const validated = await validateServerSessionCookie();
        return validated ? activeSession.access_token : null;
      };

      try {
        setIsResolvingRedirect(true);
        const token = await ensureServerSession();
        if (!token) {
          await signOutAndStop();
          return;
        }

        const { data: validated, error: validateError } = await supabase.auth.getUser(token);
        if (validateError || !validated?.user?.id) {
          await signOutAndStop();
          return;
        }

        if (!hasServerAuthSessionCookie()) {
          await signOutAndStop();
          return;
        }

        if (safeRedirectPath.startsWith('/conex')) {
          const res = await fetch('/conex/users?mode=access', {
            method: 'GET',
            headers: {
              Accept: 'application/json',
              Authorization: `Bearer ${token}`,
            },
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
            await signOutAndStop();
            return;
          }

          router.replace('/dashboard');
          return;
        }

        router.replace(safeRedirectPath);
      } catch {
        await signOutAndStop();
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
    setAuthError(null);
    setAuthNotice(null);

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

  const checkUsernameAvailable = async (normalizedUsername: string): Promise<boolean> => {
    const res = await fetch(`/api/profile/username?username=${encodeURIComponent(normalizedUsername)}`, {
      method: 'GET',
      cache: 'no-store',
      credentials: 'same-origin',
      headers: { Accept: 'application/json' },
    });
    const payload = await res.json().catch(() => ({}));

    if (!res.ok || payload?.ok !== true) {
      throw new Error(payload?.message || 'Could not check username availability.');
    }
    if (payload?.available === false) {
      setAuthError(USERNAME_TAKEN_MESSAGE);
      return false;
    }
    return payload.available === true;
  };

  const saveUsernameForSession = async (normalizedUsername: string, accessToken: string) => {
    const res = await fetch('/api/profile/username', {
      method: 'POST',
      credentials: 'include',
      cache: 'no-store',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({ username: normalizedUsername }),
    });
    const payload = await res.json().catch(() => ({}));

    if (!res.ok || payload?.ok !== true) {
      throw new Error(payload?.message || 'Could not save username.');
    }
  };

  const handleEmailAuth = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (isLoadingEmail) return;

    const normalizedEmail = email.trim();
    if (!normalizedEmail || !password) {
      setAuthError('Enter your email and password to continue.');
      return;
    }

    const usernameValidation = authMode === 'signup' ? validateUsername(username) : null;
    if (usernameValidation && !usernameValidation.ok) {
      setAuthError(usernameValidation.message || 'Choose a username to continue.');
      return;
    }

    setIsLoadingEmail(true);
    setAuthError(null);
    setAuthNotice(null);

    try {
      if (authMode === 'signup') {
        const normalizedUsername = usernameValidation?.normalized || normalizeUsername(username);
        const isAvailable = await checkUsernameAvailable(normalizedUsername);
        if (!isAvailable) return;

        const emailRedirectTo =
          typeof window !== 'undefined'
            ? `${window.location.origin}/auth/callback?next=${encodeURIComponent(safeRedirectPath)}`
            : undefined;
        const { data, error } = await supabase.auth.signUp({
          email: normalizedEmail,
          password,
          options: {
            emailRedirectTo,
            data: {
              username: normalizedUsername,
              ...(fullName.trim() ? { full_name: fullName.trim() } : {}),
            },
          },
        });

        if (error) throw error;

        if (data.session?.access_token) {
          syncServerAuthSessionCookie(data.session);
          await saveUsernameForSession(normalizedUsername, data.session.access_token);
          toast({ title: 'Account created', description: 'Taking you to your dashboard.' });
          router.replace(safeRedirectPath);
          return;
        }

        setPassword('');
        setAuthNotice('Check your email to confirm your account, then sign in.');
        toast({
          title: 'Confirm your email',
          description: 'We sent a confirmation link if email confirmation is enabled.',
        });
        return;
      }

      const { data, error } = await supabase.auth.signInWithPassword({
        email: normalizedEmail,
        password,
      });

      if (error) throw error;

      if (!data.session?.access_token) {
        setAuthNotice('Please check your email to finish signing in.');
        return;
      }

      syncServerAuthSessionCookie(data.session);
      toast({ title: 'Signed in', description: 'Taking you to your dashboard.' });
      router.replace(safeRedirectPath);
    } catch (error) {
      setAuthError(
        isUsernameTakenError(error)
          ? USERNAME_TAKEN_MESSAGE
          : safeAuthMessage(error, authMode === 'signup' ? 'Could not create your account.' : 'Could not sign in.'),
      );
    } finally {
      setIsLoadingEmail(false);
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

  if (isResolvingRedirect || (isUserLoading && Boolean(user))) {
    return (
      <div className="flex h-dvh items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    );
  }
  
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center bg-transparent px-4">
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
            {wasSessionExpired
              ? 'Your session expired. Please sign in again to continue.'
              : hadAuthError
                ? 'Authentication could not be completed. Please try again.'
                : 'Sign in or create an account to upload documents, chat with your data, and unlock AU insights.'}
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          <Tabs value={authMode} onValueChange={(value) => setAuthMode(value === 'signup' ? 'signup' : 'login')}>
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="login">Sign In</TabsTrigger>
              <TabsTrigger value="signup">Sign Up</TabsTrigger>
            </TabsList>
          </Tabs>

          {authError ? (
            <Alert variant="destructive">
              <AlertDescription>{authError}</AlertDescription>
            </Alert>
          ) : null}

          {authNotice ? (
            <Alert>
              <AlertDescription>{authNotice}</AlertDescription>
            </Alert>
          ) : null}

          <form className="grid gap-3" onSubmit={handleEmailAuth}>
            {authMode === 'signup' ? (
              <div className="grid gap-2">
                <Label htmlFor="full-name">Name</Label>
                <Input
                  id="full-name"
                  autoComplete="name"
                  value={fullName}
                  onChange={(event) => setFullName(event.target.value)}
                  placeholder="Your name"
                />
              </div>
            ) : null}

            {authMode === 'signup' ? (
              <div className="grid gap-2">
                <Label htmlFor="username">Username</Label>
                <Input
                  id="username"
                  autoComplete="username"
                  value={username}
                  onChange={(event) => setUsername(normalizeUsername(event.target.value))}
                  placeholder="Choose a unique username"
                  required
                />
                <p className="text-xs text-muted-foreground">
                  Usernames are unique and saved in lowercase.
                </p>
              </div>
            ) : null}

            <div className="grid gap-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                autoComplete="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="you@example.com"
                required
              />
            </div>

            <div className="grid gap-2">
              <Label htmlFor="password">Password</Label>
              <PasswordInput
                id="password"
                autoComplete={authMode === 'signup' ? 'new-password' : 'current-password'}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder={authMode === 'signup' ? 'Create a password' : 'Enter your password'}
                required
              />
            </div>

            {authMode === 'signup' ? (
              <Alert className="border-primary/30 bg-primary/5">
                <ShieldAlert className="h-4 w-4" />
                <AlertDescription>
                  <span className="font-medium">Policy Update: Data Security Notice</span>
                  <br />
                  {retentionPolicy.summary}
                </AlertDescription>
              </Alert>
            ) : null}

            <Button
              type="submit"
              className="w-full"
              disabled={isLoadingEmail || !email.trim() || !password || (authMode === 'signup' && !username.trim())}
            >
              {isLoadingEmail ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              {authMode === 'signup' ? 'Create Account' : 'Sign In'}
            </Button>
          </form>

          <div className="relative flex items-center py-1">
            <div className="h-px flex-1 bg-border" />
            <span className="px-3 text-xs text-muted-foreground">or</span>
            <div className="h-px flex-1 bg-border" />
          </div>

          <Button
            onClick={handleGoogleSignIn}
            className="w-full"
            variant="outline"
            disabled={isLoadingGoogle}
          >
            {isLoadingGoogle ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Icons.google className="mr-2 h-4 w-4" />
            )}
            Sign in with Google
          </Button>

          <p className="text-center text-sm text-muted-foreground">
            {authMode === 'signup' ? (
              <>
                Already have an account?{' '}
                <button
                  type="button"
                  className="font-medium text-primary underline underline-offset-4"
                  onClick={() => setAuthMode('login')}
                >
                  Sign in
                </button>
              </>
            ) : (
              <>
                New to DataCube AU?{' '}
                <button
                  type="button"
                  className="font-medium text-primary underline underline-offset-4"
                  onClick={() => setAuthMode('signup')}
                >
                  Create an account
                </button>
              </>
            )}
          </p>
        </CardContent>
      </Card>
      <footer className="mt-8 text-center text-sm text-muted-foreground">
        By continuing, you agree to our{' '}
        <Link href="/policy#terms" className="text-primary underline underline-offset-4">Terms of Service</Link>
        {' '}and{' '}
        <Link href="/policy#privacy" className="text-primary underline underline-offset-4">Privacy Policy</Link>.
        <p className="mt-2">Datacube AU is a product of Zahed Investment Ltd (RC 8127949).</p>
      </footer>
    </div>
  );
}
