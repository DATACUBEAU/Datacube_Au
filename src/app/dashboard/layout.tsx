'use client';

import Link from 'next/link';
import {
  BrainCircuit,
  ClipboardCheck,
  FileText as FileTextIcon,
  LayoutDashboard,
  MessageCircle,
  Settings,
  CreditCard,
  LogOut,
  Loader2,
  SquarePen,
  WifiOff,
  Globe,
  BookOpen,
  Bell,
  Inbox,
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
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
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
import { useEffect, useState, useMemo, useCallback, useRef } from 'react';
import PageLoader from '@/components/page-loader';
import { useStore } from '@/hooks/use-store';
import { useSupabaseUser } from '@/hooks/use-supabase-auth';
import HeaderPwaInstallButton from '@/components/header-pwa-install-button';
import { AnimatePresence, motion } from 'framer-motion';
import { updateUserActivity } from '@/lib/supabase-client/client';
import { supabase } from '@/lib/supabase-client/client';
import { AUAssistant } from '@/components/au-assistant';
import { InactivityPolicyBanner } from '@/components/inactivity-policy-banner';
import { AuChatProvider } from '@/providers/au-chat-provider';
import { ChatRuntimeProvider } from '@/components/providers/chat-runtime-provider';
import { useNetworkStatus } from '@/components/providers/network-status-provider';
import { SiteManualGuide } from '@/components/site-manual-guide';
import { GlobalChatDevDialog } from '@/components/global-chat-dev-dialog';
import { useUnreadCount } from '@/hooks/use-unread-count';
import { Badge } from '@/components/ui/badge';
import { UpgradeModal } from "@/components/ui/upgrade-modal";
import { ToastAction } from '@/components/ui/toast';
import { explicitSignOut } from '@/lib/auth/explicit-signout';
import { useSmartAuth } from '@/hooks/use-smart-auth';
import { useEffectiveEntitlements } from '@/hooks/use-effective-entitlements';
import { useFeatureFlags } from '@/components/feature-flag-provider';
import {
  buildUpgradeContext,
  getDashboardFeatureAccess,
  type DashboardFeatureAccess,
} from '@/lib/feature-access';

type NavItem = {
  href: string;
  label: string;
  icon: React.ComponentType<any>;
  isLoading?: boolean;
  tourId?: string;
  onClick?: () => void;
  badge?: number | string;
  proOnly?: boolean;
  prefetch?: boolean;
};

// --- Memoized Sidebar Nav Menu ---
const SidebarNavMenu = ({ navItems, pathname, isProUnlocked }: { navItems: NavItem[]; pathname: string; isProUnlocked: boolean }) => (
  <SidebarContent className="p-2">
    <SidebarMenu>
      {navItems.map((item: NavItem) => (
        <SidebarMenuItem key={item.href}>
          <SidebarMenuButton
            asChild={!item.onClick}
            isActive={pathname === item.href}
            tooltip={{ children: item.label }}
            data-tour={item.tourId}
            onClick={item.onClick}
          >
            {item.onClick ? (
              <button className="flex items-center gap-2 w-full h-full">
                {item.isLoading ? <Loader2 className="animate-spin" /> : <item.icon />}
                <span>{item.label}</span>
                {item.proOnly && !isProUnlocked ? (
                    <span className="ml-auto rounded-full border border-primary/40 bg-primary/10 px-2 py-0.5 text-[10px] font-semibold text-primary">
                      PRO
                    </span>
                ) : null}
                {item.badge ? (
                    <span className="ml-auto flex h-5 min-w-5 items-center justify-center rounded-full bg-destructive px-1.5 text-[10px] font-bold text-destructive-foreground">
                        {typeof item.badge === 'number' && item.badge > 9 ? '9+' : item.badge}
                    </span>
                ) : null}
              </button>
            ) : (
              <Link href={item.href} prefetch={item.prefetch !== false} className="flex items-center gap-2 w-full h-full">
                {item.isLoading ? <Loader2 className="animate-spin" /> : <item.icon />}
                <span className="flex-1">{item.label}</span>
                {item.proOnly && !isProUnlocked ? (
                    <span className="ml-auto rounded-full border border-primary/40 bg-primary/10 px-2 py-0.5 text-[10px] font-semibold text-primary">
                      PRO
                    </span>
                ) : null}
                {item.badge ? (
                    <span className="ml-auto flex h-5 min-w-5 items-center justify-center rounded-full bg-destructive px-1.5 text-[10px] font-bold text-destructive-foreground">
                        {typeof item.badge === 'number' && item.badge > 9 ? '9+' : item.badge}
                    </span>
                ) : null}
              </Link>
            )}
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
  planStatusLabel,
  planStatusBadge,
  planStatusMeta,
  isPlanStatusLoading,
  onOpenGuide,
}: {
  footerItems: Array<any>;
  isOnline: boolean;
  userInitial: string;
  userDisplayName: string;
  userEmail: string;
  planStatusLabel: string;
  planStatusBadge: string;
  planStatusMeta: string;
  isPlanStatusLoading: boolean;
  onOpenGuide: () => void;
}) => (
  <SidebarFooter className="p-2">
    <SidebarMenu>
      <SidebarMenuItem>
        <SidebarMenuButton tooltip={{ children: 'User Guide & Install' }} onClick={onOpenGuide}>
          <BookOpen />
          <span>User Guide</span>
        </SidebarMenuButton>
      </SidebarMenuItem>
      {footerItems.map((item) => (
        <SidebarMenuItem key={item.key}>
          {item.href ? (
            <SidebarMenuButton asChild>
              <Link href={item.href} prefetch>
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

      <SidebarMenuItem>
        <div className="rounded-md border border-sidebar-border bg-sidebar-accent/35 px-3 py-2">
          <div className="text-[10px] font-semibold uppercase tracking-wide text-sidebar-foreground/60">
            Plan Status
          </div>
          <div className="mt-1 flex items-center justify-between gap-2">
            <span className="text-sm font-semibold text-sidebar-foreground">
              {isPlanStatusLoading ? 'Updating...' : planStatusLabel}
            </span>
            <Badge variant="outline" className="h-5 px-1.5 text-[10px]">
              {isPlanStatusLoading ? 'Syncing' : planStatusBadge}
            </Badge>
          </div>
          <div className="mt-1 text-[10px] text-sidebar-foreground/65">
            {planStatusMeta}
          </div>
        </div>
      </SidebarMenuItem>

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
          <Link href="/dashboard/settings" prefetch>
            <Avatar className="size-8">
              <AvatarImage src={''} alt="User Avatar" />
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
  return (
    <AuChatProvider>
      <ChatRuntimeProvider>
        <SidebarProvider>
          <DashboardContent>{children}</DashboardContent>
        </SidebarProvider>
      </ChatRuntimeProvider>
    </AuChatProvider>
  );
}

function DashboardContent({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const hasWarmedRoutesRef = useRef(false);

  const [user, , isUserLoading] = useSupabaseUser();
  const { isAuthLocked } = useSmartAuth();
  const [showWhatsappDialog, setShowWhatsappDialog] = useState(false);
  const [showGlobalChatDevDialog, setShowGlobalChatDevDialog] = useState(false);
  const [isLoadingGoogle, setIsLoadingGoogle] = useState(false);
  const [showAuthPopup, setShowAuthPopup] = useState(false);
  const [showAuthCancelConfirm, setShowAuthCancelConfirm] = useState(false);
  const [showSignOutPopup, setShowSignOutPopup] = useState(false);
  const [isSigningOut, setIsSigningOut] = useState(false);
  const [isSiteGuideOpen, setIsSiteGuideOpen] = useState(false);

  const { toast } = useToast();
  const { isOnline } = useNetworkStatus();
  const { isGeneratingKnowledge, isGeneratingPredictions } = useStore();
  const setUpgradeModalOpen = useStore((s) => s.setUpgradeModalOpen);
  const upgradeBlockedUntil = useStore((s) => s.upgradeBlockedUntil);
  const clearUpgradeBlock = useStore((s) => s.clearUpgradeBlock);
  const unreadCount = useUnreadCount();
  const {
    entitlements,
    loading: isPlanStatusLoading,
    isUsingCachedData: isUsingCachedEntitlements,
    cachedAt: entitlementsCachedAt,
  } = useEffectiveEntitlements();
  const { records: featureFlagRecords } = useFeatureFlags();

  const isAuthenticated = !!user;

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

  const userDisplayName = (user?.user_metadata?.full_name as string | undefined) ??
      (user?.user_metadata?.name as string | undefined) ??
      'User';
  const userEmail = user?.email || '';
  const userInitial =
    userDisplayName?.charAt(0).toUpperCase() || userEmail?.charAt(0).toUpperCase() || 'G';

  const planStatusLabel = useMemo(() => {
    if (entitlements.plan === 'admin') return 'Admin';
    if (entitlements.entitlementSource === 'promo' || entitlements.promoActive) return 'Promo Pro';
    if (entitlements.entitlementSource === 'paid' && entitlements.hasPro) return 'Pro';
    return 'Free';
  }, [entitlements.entitlementSource, entitlements.hasPro, entitlements.plan, entitlements.promoActive]);

  const planStatusBadge = useMemo(() => {
    if (entitlements.plan === 'admin') return 'Admin';
    if (entitlements.entitlementSource === 'promo' || entitlements.promoActive) return 'Promo';
    if (entitlements.entitlementSource === 'paid' && entitlements.hasPro) return 'Active';
    return 'Free';
  }, [entitlements.entitlementSource, entitlements.hasPro, entitlements.plan, entitlements.promoActive]);

  const isProUnlocked = useMemo(() => {
    return (
      entitlements.plan === 'admin' ||
      entitlements.entitlementSource === 'paid' ||
      entitlements.entitlementSource === 'promo' ||
      entitlements.promoActive
    );
  }, [entitlements.entitlementSource, entitlements.plan, entitlements.promoActive]);

  const globalChatAccess = useMemo(
    () => getDashboardFeatureAccess('global_chat', entitlements, featureFlagRecords),
    [entitlements, featureFlagRecords],
  );
  const knowledgeAccess = useMemo(
    () => getDashboardFeatureAccess('knowledge_hub', entitlements, featureFlagRecords),
    [entitlements, featureFlagRecords],
  );
  const predictionsAccess = useMemo(
    () => getDashboardFeatureAccess('exam_prediction', entitlements, featureFlagRecords),
    [entitlements, featureFlagRecords],
  );
  const practiceAccess = useMemo(
    () => getDashboardFeatureAccess('practice_exam_generation', entitlements, featureFlagRecords),
    [entitlements, featureFlagRecords],
  );

  const planStatusMeta = useMemo(() => {
    if (entitlements.promoActive || entitlements.entitlementSource === 'promo') {
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
      return 'Promo mode active: premium unlocked for your account';
    }

    if (entitlements.entitlementSource === 'paid' && entitlements.entitlementEndsAt) {
      const expires = new Date(entitlements.entitlementEndsAt);
      if (!Number.isNaN(expires.getTime())) {
        return `Renews/Expires: ${expires.toLocaleDateString(undefined, {
          month: 'short',
          day: 'numeric',
          year: 'numeric',
        })}`;
      }
    }

    if (entitlements.entitlementSource === 'paid' && entitlements.hasPro) {
      return 'Paid Pro entitlement active';
    }

    if (isUsingCachedEntitlements && !isOnline) {
      return entitlementsCachedAt
        ? `Offline safe mode (cached ${new Date(entitlementsCachedAt).toLocaleTimeString()})`
        : 'Offline safe mode';
    }

    return 'No active paid entitlement';
  }, [
    entitlements.entitlementEndsAt,
    entitlements.entitlementSource,
    entitlements.hasPro,
    entitlements.promoActive,
    entitlements.promoEndsAtLagos,
    entitlementsCachedAt,
    isOnline,
    isUsingCachedEntitlements,
  ]);

  const handleWhatsAppRedirect = () => {
    const phoneNumber = '2349036553377';
    const message = "👋 Hello Fabian! I've just entered your domain from DataCube AU 🚀 and have a question...";
    const url = `https://wa.me/${phoneNumber}?text=${encodeURIComponent(message)}`;
    window.open(url, '_blank');
    setShowWhatsappDialog(false);
  };

  const startSignOutFlow = useCallback(() => {
    setShowSignOutPopup(true);
  }, []);

  const handleSignOutConfirm = useCallback(async () => {
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
  }, [isSigningOut, router, user?.id]);

  const handleBlockedFeatureClick = useCallback((access: DashboardFeatureAccess) => {
    if (!access.enabled) {
      toast({
        title: 'Feature unavailable',
        description: access.message,
        variant: 'destructive',
      });
      return;
    }

    setUpgradeModalOpen(true, buildUpgradeContext(access));
  }, [setUpgradeModalOpen, toast]);

  const navItems = useMemo(() => {
    const items: NavItem[] = [
      { href: '/dashboard', icon: LayoutDashboard, label: 'Dashboard' },
      { href: '/dashboard/documents', icon: FileTextIcon, label: 'Documents', tourId: 'upload-section' },
      { href: '/dashboard/chat', icon: MessageCircle, label: 'AU Chat', tourId: 'chat-section' },
      globalChatAccess.enabled ? {
        href: '/dashboard/global-chat',
        icon: Globe,
        label: 'Global Chat',
        proOnly: globalChatAccess.proRequired,
        onClick: globalChatAccess.allowed ? undefined : () => handleBlockedFeatureClick(globalChatAccess),
        prefetch: globalChatAccess.allowed,
      } : null,
      knowledgeAccess.enabled ? {
        href: '/dashboard/knowledge',
        icon: BrainCircuit,
        label: 'Knowledge',
        isLoading: isGeneratingKnowledge,
        proOnly: knowledgeAccess.proRequired,
        onClick: knowledgeAccess.allowed ? undefined : () => handleBlockedFeatureClick(knowledgeAccess),
        prefetch: knowledgeAccess.allowed,
      } : null,
      { href: '/dashboard/messages', icon: Inbox, label: 'Messages', badge: unreadCount > 0 ? unreadCount : undefined },
      predictionsAccess.enabled ? {
        href: '/dashboard/predictions',
        icon: ClipboardCheck,
        label: 'Predictions',
        isLoading: isGeneratingPredictions,
        tourId: 'predictions-section',
        proOnly: predictionsAccess.proRequired,
        onClick: predictionsAccess.allowed ? undefined : () => handleBlockedFeatureClick(predictionsAccess),
        prefetch: predictionsAccess.allowed,
      } : null,
      practiceAccess.enabled ? {
        href: '/dashboard/practice',
        icon: SquarePen,
        label: 'Practice',
        tourId: 'practice-section',
        onClick: practiceAccess.allowed ? undefined : () => handleBlockedFeatureClick(practiceAccess),
        prefetch: practiceAccess.allowed,
      } : null,
      { href: '/dashboard/settings', icon: Settings, label: 'Settings' },
      { href: '/dashboard/settings/subscription', icon: CreditCard, label: 'Subscription' },
    ].filter(Boolean) as NavItem[];

    return items;
  }, [
    globalChatAccess,
    handleBlockedFeatureClick,
    isGeneratingKnowledge,
    isGeneratingPredictions,
    knowledgeAccess,
    practiceAccess,
    predictionsAccess,
    unreadCount,
  ]);

  const prefetchRoutes = useMemo(
    () =>
      Array.from(
        new Set([
          ...navItems.filter((item) => item.prefetch !== false && !item.onClick).map((item) => item.href),
          '/dashboard/settings',
          '/dashboard/settings/subscription',
          '/conex',
        ]),
      ),
    [navItems],
  );

  const footerItems = useMemo(() => {
    const items = [
      {
        key: 'whatsapp',
        icon: Icons.whatsapp,
        label: 'Contact Fabian',
        onClick: () => setShowWhatsappDialog(true),
      },
      isAuthenticated && {
        key: 'signout',
        icon: () => (
          isSigningOut
            ? <Loader2 className="h-4 w-4 animate-spin" />
            : <LogOut className="h-4 w-4" />
        ),
        label: 'Sign Out',
        onClick: startSignOutFlow,
      },
      !isAuthenticated && {
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
  }, [isAuthenticated, isLoadingGoogle, isSigningOut, handleGoogleSignIn, startSignOutFlow]);

  const currentPageTitle = navItems.find((item) => item.href === pathname)?.label || 'DataCube AU';

  useEffect(() => {
    if (!isUserLoading && user && !isAuthLocked) {
      updateUserActivity(user, { isOnline });
      const activityInterval = setInterval(() => updateUserActivity(user, { isOnline }), 60 * 1000);
      return () => clearInterval(activityInterval);
    }
  }, [isAuthLocked, user, isUserLoading, toast, isOnline]);

  useEffect(() => {
    if (!isAuthenticated || !isOnline || isAuthLocked || hasWarmedRoutesRef.current) return;

    const prefetchAll = () => {
      for (const route of prefetchRoutes) {
        if (route === pathname) continue;
        router.prefetch(route);
      }
      hasWarmedRoutesRef.current = true;
    };

    const idleWindow = window as Window & {
      requestIdleCallback?: (callback: IdleRequestCallback, options?: IdleRequestOptions) => number;
      cancelIdleCallback?: (handle: number) => void;
    };

    let timeoutId: number | null = null;
    let idleId: number | null = null;

    if (typeof idleWindow.requestIdleCallback === 'function') {
      idleId = idleWindow.requestIdleCallback(() => {
        prefetchAll();
      }, { timeout: 1200 });
    } else {
      timeoutId = window.setTimeout(prefetchAll, 200);
    }

    return () => {
      if (timeoutId !== null) {
        window.clearTimeout(timeoutId);
      }
      if (idleId !== null && typeof idleWindow.cancelIdleCallback === 'function') {
        idleWindow.cancelIdleCallback(idleId);
      }
    };
  }, [isAuthLocked, isAuthenticated, isOnline, pathname, prefetchRoutes, router]);

  useEffect(() => {
    if (!isAuthenticated || !isOnline || isAuthLocked || !('serviceWorker' in navigator)) return;

    navigator.serviceWorker.ready
      .then((registration) => {
        registration.active?.postMessage({ type: 'PWA_WARM_ROUTES' });
      })
      .catch(() => {});
  }, [isAuthLocked, isAuthenticated, isOnline]);


  useEffect(() => {
    const handler = (event: any) => {
      const detail = event?.detail;
      const code = String(detail?.code || '').toUpperCase();
      if (['UPGRADE_REQUIRED', 'PRO_REQUIRED', 'LIMIT_REACHED', 'LIMIT_EXCEEDED'].includes(code)) {
        setUpgradeModalOpen(true, detail);
      }
    };
    window.addEventListener('au-upgrade-required', handler as any);
    return () => window.removeEventListener('au-upgrade-required', handler as any);
  }, [setUpgradeModalOpen]);

  useEffect(() => {
    const handleChatCompleted = (event: any) => {
      const detail = event?.detail as {
        route?: string;
        preview?: string;
      };
      const targetRoute = detail?.route;
      if (!targetRoute || pathname === targetRoute) return;

      toast({
        title: 'AU response is ready',
        description: detail.preview
          ? `${detail.preview}${detail.preview.length >= 200 ? '…' : ''}`
          : 'Your background response has completed.',
        action: (
          <ToastAction altText="Open chat" onClick={() => router.push(targetRoute)}>
            Open chat
          </ToastAction>
        ),
        duration: 7000,
      });
    };

    window.addEventListener('au-chat:completed', handleChatCompleted as EventListener);
    return () => window.removeEventListener('au-chat:completed', handleChatCompleted as EventListener);
  }, [pathname, router, toast]);

  useEffect(() => {
    if (!upgradeBlockedUntil) return;
    const timer = setInterval(() => {
      if (Date.now() >= upgradeBlockedUntil) {
        clearUpgradeBlock();
      }
    }, 30_000);
    return () => clearInterval(timer);
  }, [upgradeBlockedUntil, clearUpgradeBlock]);

  if (isUserLoading) return <PageLoader />;
  if (!user) {
    return (
      <div className="min-h-dvh w-full flex items-center justify-center px-4 sm:px-6 lg:px-8">
        <Card className="w-full max-w-md">
          <CardHeader className="text-center">
            <CardTitle>{isOnline ? 'Sign in required' : 'You are offline'}</CardTitle>
            <CardDescription>
              {isOnline
                ? 'Sign in to access uploads, chat, and your documents.'
                : 'Reconnect to the internet to sign in and use AU features.'}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <Button className="w-full" onClick={handleGoogleSignIn} disabled={!isOnline || isLoadingGoogle}>
              {isLoadingGoogle ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Icons.google className="mr-2 h-4 w-4" />}
              Continue with Google
            </Button>
            <Button className="w-full" variant="outline" onClick={() => router.push('/')}>Back to home</Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <>
      <UpgradeModal />
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

      {/* Global Chat Development Dialog */}
      <GlobalChatDevDialog 
        open={showGlobalChatDevDialog} 
        onOpenChange={setShowGlobalChatDevDialog}
        onContactSupport={() => setShowWhatsappDialog(true)}
      />

        <div className="flex min-h-dvh w-full bg-transparent">
          <Sidebar collapsible="icon" side="left" variant="sidebar" className="group-data-[variant=sidebar]:border-r">
            <SidebarHeader className="flex h-14 items-center gap-2 border-b p-2">
              <Link href="/" className="flex items-center gap-2 group-data-[collapsible=icon]:justify-center">
                <Icons.logo className="size-7 shrink-0 text-primary" />
                <span className="font-headline text-lg font-semibold group-data-[collapsible=icon]:hidden">
                  DataCube AU
                </span>
              </Link>
            </SidebarHeader>

            <SidebarNavMenu navItems={navItems} pathname={pathname} isProUnlocked={isProUnlocked} />
            <SidebarFooterMenu
              footerItems={footerItems}
              isOnline={isOnline}
              userInitial={userInitial}
              userDisplayName={userDisplayName}
              userEmail={userEmail}
              planStatusLabel={planStatusLabel}
              planStatusBadge={planStatusBadge}
              planStatusMeta={planStatusMeta}
              isPlanStatusLoading={isPlanStatusLoading}
              onOpenGuide={() => setIsSiteGuideOpen(true)}
            />
          </Sidebar>

          {/* Main content */}
          <div className="flex flex-1 flex-col">
            <header className="sticky top-0 z-20 flex h-14 items-center justify-between border-b bg-background/80 px-4 backdrop-blur-sm md:hidden">
              <SidebarTrigger />
              <span className="font-semibold">{currentPageTitle}</span>
              <div className="flex items-center gap-1">
                 <Link href="/dashboard/messages" prefetch className="p-2 relative">
                    <Bell className="h-5 w-5" />
                    {unreadCount > 0 && (
                        <span className="absolute top-1 right-1 h-2 w-2 bg-destructive rounded-full" />
                    )}
                 </Link>
                 <ThemeToggle />
              </div>
            </header>

            <header className="hidden h-14 items-center justify-end border-b bg-background/80 px-4 backdrop-blur-sm md:sticky md:top-0 md:z-20 md:flex">
              <div className="flex items-center gap-2">
                <HeaderPwaInstallButton />
                <Button variant="ghost" size="icon" asChild className="relative">
                  <Link href="/dashboard/messages" prefetch>
                    <Bell className="h-5 w-5" />
                    {unreadCount > 0 && (
                        <Badge variant="destructive" className="absolute -top-1 -right-1 h-4 w-4 p-0 flex items-center justify-center text-[10px] rounded-full">
                            {unreadCount > 9 ? '9+' : unreadCount}
                        </Badge>
                    )}
                    <span className="sr-only">Notifications</span>
                  </Link>
                </Button>
                <ThemeToggle />
              </div>
            </header>

            <main className="flex-1 overflow-y-auto">
              <div className="mx-auto max-w-7xl relative">
                {children}
              </div>
              <InactivityPolicyBanner />
            </main>
          </div>
        </div>
        <SiteManualGuide open={isSiteGuideOpen} onOpenChange={setIsSiteGuideOpen} />
      <AUAssistant />
    </>
  );
}
