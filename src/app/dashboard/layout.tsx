'use client';

import Link from 'next/link';
import {
  BrainCircuit,
  ClipboardCheck,
  FileText as FileTextIcon,
  LayoutDashboard,
  MessageCircle,
  Settings,
  User as UserIcon,
  LogOut,
  Loader2,
  SquarePen,
  WifiOff,
  AlertTriangle,
  ShieldAlert,
  Trash2,
  Globe,
} from 'lucide-react';
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
import { Button } from '@/components/ui/button';
import {
  Sidebar,
  SidebarContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
  SidebarProvider,
  SidebarFooter,
  SidebarTrigger,
} from '@/components/ui/sidebar';
import { Icons } from '@/components/icons';
import { usePathname, useRouter } from 'next/navigation';
import { useToast } from '@/hooks/use-toast';
import { ThemeToggle } from '@/components/theme-toggle';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Separator } from '@/components/ui/separator';
import { useEffect, useState, useMemo, useCallback } from 'react';
import PageLoader from '@/components/page-loader';
import { useStore } from '@/hooks/use-store';
import HeaderPwaInstallButton from '@/components/header-pwa-install-button';
import { useOnlineStatus } from '@/hooks/use-online-status';
import { AnimatePresence, motion } from 'framer-motion';
import { useSupabaseUser } from '@/hooks/use-supabase-auth';
import { supabase, updateUserActivity, getGuestToken, clearGuestToken } from '@/lib/supabase/client';
import { InactivityPolicyBanner } from '@/components/inactivity-policy-banner';

type NavItem = {
  href: string;
  label: string;
  icon: React.ComponentType<any>;
  isLoading?: boolean;
  tourId?: string;
};

// --- Memoized Sidebar Nav Menu ---
const SidebarNavMenu = ({ navItems, pathname }: { navItems: NavItem[]; pathname: string }) => (
  <SidebarContent className="p-2">
    <SidebarMenu>
      {navItems.map((item: NavItem) => (
        <SidebarMenuItem key={item.href}>
          <SidebarMenuButton
            asChild
            isActive={pathname === item.href}
            tooltip={{ children: item.label }}
            data-tour={item.tourId}
          >
            <Link href={item.href}>
              {item.isLoading ? <Loader2 className="animate-spin" /> : <item.icon />}
              <span>{item.label}</span>
            </Link>
          </SidebarMenuButton>
        </SidebarMenuItem>
      ))}
    </SidebarMenu>
  </SidebarContent>
);

// --- Memoized Sidebar Footer Menu ---
const SidebarFooterMenu = ({
  footerItems,
  isOnline,
  userInitial,
  userDisplayName,
  userEmail,
  isAnonymous,
}: {
  footerItems: Array<any>;
  isOnline: boolean;
  userInitial: string;
  userDisplayName: string;
  userEmail: string;
  isAnonymous: boolean;
}) => (
  <SidebarFooter className="p-2">
    <SidebarMenu>
      {footerItems.map((item) => (
        <SidebarMenuItem key={item.key}>
          {item.href ? (
            <SidebarMenuButton asChild>
              <Link href={item.href}>
                <item.icon />
                <span>{item.label}</span>
              </Link>
            </SidebarMenuButton>
          ) : (
            <SidebarMenuButton onClick={item.onClick}>
              <item.icon />
              <span>{item.label}</span>
            </SidebarMenuButton>
          )}
        </SidebarMenuItem>
      ))}

      <Separator className="my-2 bg-sidebar-border" />

      {!isOnline && (
        <SidebarMenuItem>
          <SidebarMenuButton className="pointer-events-none text-yellow-500 bg-yellow-500/10" tooltip={{ children: 'You are currently offline.' }}>
            <WifiOff className="text-yellow-500" />
            <span>Offline</span>
          </SidebarMenuButton>
        </SidebarMenuItem>
      )}

      {/* User Avatar */}
      <SidebarMenuItem>
        <SidebarMenuButton asChild size="lg" className="h-auto py-2">
          <Link href="/dashboard/settings">
            <Avatar className="size-8">
              <AvatarImage src={!isAnonymous ? '' : ''} alt="User Avatar" />
              <AvatarFallback>{userInitial}</AvatarFallback>
            </Avatar>
            <div className="flex flex-col">
              <span className="font-semibold">{userDisplayName}</span>
              <span className="text-xs text-sidebar-foreground/70">{userEmail}</span>
            </div>
          </Link>
        </SidebarMenuButton>
      </SidebarMenuItem>
    </SidebarMenu>
  </SidebarFooter>
);

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();

  const [user, isUserLoading] = useSupabaseUser();
  const [showWhatsappDialog, setShowWhatsappDialog] = useState(false);
  const [isLoadingGoogle, setIsLoadingGoogle] = useState(false);
  const [showAuthPopup, setShowAuthPopup] = useState(false);
  const [showAuthCancelConfirm, setShowAuthCancelConfirm] = useState(false);
  const [showSignOutPopup, setShowSignOutPopup] = useState(false);
  const [signOutStep, setSignOutStep] = useState<'idle' | 'warning' | 'final' | 'processing'>('idle');
  const [isSigningOut, setIsSigningOut] = useState(false);

  const { toast } = useToast();
  const isOnline = useOnlineStatus();
  const { isGeneratingKnowledge, isGeneratingPredictions } = useStore();

  const isAnonymous = (user as any)?.is_anonymous ?? !user?.email;

  const handleGoogleSignIn = useCallback(async () => {
    setIsLoadingGoogle(true);
    setShowAuthPopup(true);
    // Artificial delay for better UX
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
  }, [toast]);

  const handleAuthCancelAttempt = () => {
    setShowAuthCancelConfirm(true);
  };

  const confirmAuthCancel = () => {
    setShowAuthCancelConfirm(false);
    setShowAuthPopup(false);
    setIsLoadingGoogle(false);
  };

  const userDisplayName = isAnonymous
    ? 'Guest'
    : (user?.user_metadata?.full_name as string | undefined) ??
      (user?.user_metadata?.name as string | undefined) ??
      'User';
  const userEmail = isAnonymous ? 'Anonymous User' : user?.email || '';
  const userInitial =
    userDisplayName?.charAt(0).toUpperCase() || userEmail?.charAt(0).toUpperCase() || 'G';

  const handleWhatsAppRedirect = () => {
    const phoneNumber = '2349036553377';
    const message = "👋 Hello Fabian! I've just entered your domain from DataCube AU 🚀 and have a question...";
    const url = `https://wa.me/${phoneNumber}?text=${encodeURIComponent(message)}`;
    window.open(url, '_blank');
    setShowWhatsappDialog(false);
  };

  const startSignOutFlow = () => {
    setSignOutStep('warning');
    setShowSignOutPopup(true);
  };

  const proceedToFinalWarning = () => {
    setSignOutStep('final');
  };

  const handleSignOutFinal = async () => {
    setSignOutStep('processing');
    setIsSigningOut(true);
    
    try {
      // 1. Optional: Call wipe-user action in Edge Function (only for guests or if requested)
      const { data: { session } } = await supabase.auth.getSession();
      const guestToken = getGuestToken();
      const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/$/, '');
      const accessToken = session?.access_token || guestToken || undefined;

      // Only wipe if it's an anonymous user or explicitly requested (future-proofing)
      if (isAnonymous) {
        await fetch(`${SUPABASE_URL}/functions/v1/document-management`, {
          method: 'POST',
          headers: {
            'apikey': process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '',
            'Content-Type': 'application/json',
            ...(accessToken ? { 'Authorization': `Bearer ${accessToken}` } : {})
          },
          body: JSON.stringify({ action: 'wipe-user' })
        });
      }

      // Cool animation delay
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      // 2. Clear tokens (Only if guest)
      if (isAnonymous) {
        clearGuestToken();
      }

      // 3. Final sign out
      await supabase.auth.signOut();
      router.push('/');
    } catch (error) {
      console.error("[signOut] Error signing out:", error);
      await supabase.auth.signOut();
      router.push('/');
    }
  };

  const navItems = useMemo(() => [
    { href: '/dashboard', icon: LayoutDashboard, label: 'Dashboard' },
    { href: '/dashboard/documents', icon: FileTextIcon, label: 'Documents', tourId: 'upload-section' },
    { href: '/dashboard/chat', icon: MessageCircle, label: 'AU Chat', tourId: 'chat-section' },
    { href: '/dashboard/global-chat', icon: Globe, label: 'AU Global', tourId: 'global-chat-section' },
    { href: '/dashboard/knowledge', icon: BrainCircuit, label: 'Knowledge', isLoading: isGeneratingKnowledge },
    { href: '/dashboard/predictions', icon: ClipboardCheck, label: 'Predictions', isLoading: isGeneratingPredictions, tourId: 'predictions-section' },
    { href: '/dashboard/practice', icon: SquarePen, label: 'Practice', tourId: 'practice-section' },
  ], [isGeneratingKnowledge, isGeneratingPredictions]);

  const footerItems = useMemo(() => {
    const items = [
      {
        key: 'whatsapp',
        icon: Icons.whatsapp,
        label: 'Contact Fabian',
        onClick: () => setShowWhatsappDialog(true),
      },
      !isAnonymous && {
        key: 'signout',
        icon: () => (
          <motion.div animate={isSigningOut ? { x: [0, -4, 4, -4, 4, 0], opacity: [1, 0.5, 1] } : {}} transition={{ duration: 0.5, repeat: isSigningOut ? Infinity : 0 }}>
            <LogOut className="h-4 w-4" />
          </motion.div>
        ),
        label: 'Sign Out',
        onClick: startSignOutFlow,
      },
      isAnonymous && {
        key: 'signin',
        icon: () => (
          <motion.div animate={isLoadingGoogle ? { rotate: 360 } : {}} transition={{ duration: 2, repeat: Infinity, ease: "linear" }}>
            {isLoadingGoogle ? <Loader2 className="h-4 w-4" /> : <Icons.google className="h-4 w-4" />}
          </motion.div>
        ),
        label: 'Authenticate',
        onClick: handleGoogleSignIn,
      },
    ].filter(Boolean) as Array<any>;
    return items;
  }, [isAnonymous, router, isLoadingGoogle, isSigningOut, handleGoogleSignIn, startSignOutFlow]);

  const currentPageTitle = navItems.find((item) => item.href === pathname)?.label || 'DataCube AU';

  useEffect(() => {
    if (!isUserLoading && user) {
      updateUserActivity(user);
      
      // Handle Guest -> Auth migration
      const migrateGuest = async () => {
        const guestToken = getGuestToken();
        if (guestToken && !isAnonymous) {
          try {
            const { decodeJWT } = await import('@/lib/supabase/client');
            const decoded = decodeJWT(guestToken);
            const guestId = decoded?.guest_session_id || decoded?.sub;
            
            if (guestId) {
              console.log('[migration] Migrating guest data to authenticated user...');
              const { error } = await supabase.rpc('migrate_guest_to_user', {
                p_guest_id: guestId,
                p_user_id: user.id
              });
              
              if (error) throw error;
              console.log('[migration] Successfully migrated guest data.');
              clearGuestToken();
              toast({
                title: 'Account Secured',
                description: 'Your guest data has been successfully moved to your permanent account.'
              });
            }
          } catch (err) {
            console.error('[migration] Failed to migrate guest data:', err);
          }
        }
      };
      
      migrateGuest();

      const activityInterval = setInterval(() => updateUserActivity(user), 5 * 60 * 1000); // Every 5 minutes
      return () => clearInterval(activityInterval);
    }
  }, [user, isUserLoading, isAnonymous, toast]);

  if (isUserLoading) return <PageLoader />;
  if (!user) {
    return (
      <div className="flex min-h-dvh items-center justify-center p-6">
        <div className="w-full max-w-md space-y-4 rounded-lg border bg-card p-6 text-center">
          <div className="font-headline text-2xl font-semibold">Sign in to continue</div>
          <div className="text-sm text-muted-foreground">
            You need an account (or a guest session) to access the dashboard.
          </div>
          <div className="flex justify-center">
            <Button asChild>
              <Link href="/login">Go to Login</Link>
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <>
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
                      <DialogTitle className="text-center font-headline text-2xl text-destructive">
                        {isAnonymous ? "Warning: Account Deletion" : "Sign Out"}
                      </DialogTitle>
                      <DialogDescription className="text-center text-base pt-2">
                        {isAnonymous 
                          ? <>If you sign out now, your account will be <span className="font-bold text-destructive">deleted automatically</span> from the system.</>
                          : "Are you sure you want to sign out? Your session will be closed."}
                      </DialogDescription>
                    </DialogHeader>
                    {isAnonymous && (
                      <div className="bg-destructive/5 border border-destructive/20 rounded-lg p-4 text-sm text-destructive font-medium text-center">
                        All your documents, chat history, and generated knowledge will be permanently erased.
                      </div>
                    )}
                    <div className="flex flex-col sm:flex-row gap-3 pt-2">
                      <Button variant="outline" onClick={() => setShowSignOutPopup(false)} className="flex-1">
                        Cancel
                      </Button>
                      <Button variant="destructive" onClick={isAnonymous ? proceedToFinalWarning : handleSignOutFinal} className="flex-1 font-bold">
                        {isAnonymous ? "I Understand, Sign Out" : "Sign Out"}
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

      {/* WhatsApp Dialog */}
      <AlertDialog open={showWhatsappDialog} onOpenChange={setShowWhatsappDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Speak with Fabian?</AlertDialogTitle>
            <AlertDialogDescription>
              Drop your message on WhatsApp and he will get back to you. Clicking 'Continue' will redirect you to WhatsApp.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleWhatsAppRedirect}>Continue</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <SidebarProvider>
        <div className="flex min-h-dvh w-full bg-background">
          <Sidebar collapsible="icon" side="left" variant="sidebar" className="group-data-[variant=sidebar]:border-r">
            <SidebarHeader className="flex h-14 items-center gap-2 border-b p-2">
              <Link href="/" className="flex items-center gap-2 group-data-[collapsible=icon]:justify-center">
                <Icons.logo className="size-7 shrink-0 text-primary" />
                <span className="font-headline text-lg font-semibold group-data-[collapsible=icon]:hidden">
                  DataCube AU
                </span>
              </Link>
            </SidebarHeader>

            <SidebarNavMenu navItems={navItems} pathname={pathname} />
            <SidebarFooterMenu
              footerItems={footerItems}
              isOnline={isOnline}
              userInitial={userInitial}
              userDisplayName={userDisplayName}
              userEmail={userEmail}
              isAnonymous={isAnonymous}
            />
          </Sidebar>

          {/* Main content */}
          <div className="flex flex-1 flex-col">
            <header className="sticky top-0 z-20 flex h-14 items-center justify-between border-b bg-background/80 px-4 backdrop-blur-sm md:hidden">
              <SidebarTrigger />
              <span className="font-semibold">{currentPageTitle}</span>
              <ThemeToggle />
            </header>

            <header className="hidden h-14 items-center justify-end border-b bg-background/80 px-4 backdrop-blur-sm md:sticky md:top-0 md:z-20 md:flex">
              <div className="flex items-center gap-2">
                <HeaderPwaInstallButton />
                <ThemeToggle />
              </div>
            </header>

            <main className="flex-1 overflow-y-auto">
              <div className="mx-auto max-w-7xl relative">
                <AnimatePresence>
                  {!isOnline && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.3 }}
                      className="overflow-hidden"
                    >
                      <div className="flex items-center justify-center gap-2 bg-yellow-500/20 text-yellow-800 dark:text-yellow-300 py-2 text-sm font-medium">
                        <WifiOff className="h-4 w-4" />
                        <span>
                          Offline Mode: AU features are disabled. Queued actions will sync when you're back online.
                        </span>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
                {children}
              </div>
              <InactivityPolicyBanner />
            </main>
          </div>
        </div>
      </SidebarProvider>
    </>
  );
}
