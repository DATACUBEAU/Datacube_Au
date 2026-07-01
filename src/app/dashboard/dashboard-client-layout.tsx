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
  Lock,
  PanelLeftClose,
  PanelLeftOpen,
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
  useSidebar,
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
import { getDashboardFeatureAccess, buildUpgradeContext } from '@/lib/feature-access';
import { trackLockedClick } from '@/lib/analytics/premium-nav-events';

/**
 * Value propositions shown in sidebar tooltips for locked nav items.
 * These are visible to free users to communicate feature value before upgrading.
 */
const LOCKED_ITEM_TOOLTIPS: Record<string, string> = {
  global_chat: 'Chat across all your uploaded documents.',
  knowledge_hub: 'Generate study notes and AI summaries.',
  exam_prediction: 'See likely exam topics before test day.',
  practice_exam_generation: 'Generate and mark custom practice papers.',
};

const DASHBOARD_SIDEBAR_STORAGE_KEY = 'dcau:dashboard-sidebar-expanded';

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
  /** Set when the item is a pro feature the current user cannot access. */
  isLocked?: boolean;
  /** The DashboardFeatureKey used to build upgrade context and analytics. */
  featureKey?: string;
  /** One-line value proposition shown in the sidebar tooltip when locked. */
  tooltip?: string;
};

// --- Memoized Sidebar Nav Menu ---
const SidebarNavMenu = ({
  navItems,
  pathname,
  isProUnlocked,
  onLockedClick,
}: {
  navItems: NavItem[];
  pathname: string;
  isProUnlocked: boolean;
  onLockedClick: (item: NavItem) => void;
}) => (
  <SidebarContent className="p-2">
    <SidebarMenu>
      {navItems.map((item: NavItem) => {
        /**
         * Locked state: item is visible but not navigable.
         * Clicking opens the upgrade modal. Direct URL access is
         * still blocked by server-side middleware (untouched).
         */
        if (item.isLocked) {
          return (
            <SidebarMenuItem key={item.href}>
              <SidebarMenuButton
                asChild
                tooltip={{
                  children: item.tooltip || `Upgrade to Pro to unlock ${item.label}`,
                }}
                data-tour={item.tourId}
                data-testid={`locked-nav-${item.featureKey}`}
                onClick={() => onLockedClick(item)}
                className="opacity-70 hover:opacity-100 transition-opacity cursor-pointer"
              >
                <button
                  className="flex h-full w-full items-center gap-2"
                  type="button"
                  aria-label={`${item.label}. ${item.tooltip || 'Upgrade to Pro to unlock this feature.'}`}
                >
                  {/* Pulsing icon — draws the eye subtly */}
                  <span className="locked-icon-pulse">
                    {item.isLoading ? <Loader2 className="animate-spin" /> : <item.icon />}
                  </span>
                  <span className="flex-1 text-left group-data-[collapsible=icon]:sr-only">{item.label}</span>
                  {/* Shimmer badge */}
                  <span
                    className="pro-badge-shimmer ml-auto flex items-center gap-0.5 rounded-full px-2 py-0.5 text-[10px] font-semibold text-primary group-data-[collapsible=icon]:hidden"
                    aria-label="Pro feature — upgrade required"
                  >
                    <Lock className="h-2.5 w-2.5" />
                    <span>Pro</span>
                  </span>
                </button>
              </SidebarMenuButton>
            </SidebarMenuItem>
          );
        }

        return (
          <SidebarMenuItem key={item.href}>
            <SidebarMenuButton
              asChild
              isActive={pathname === item.href}
              tooltip={{ children: item.label }}
              data-tour={item.tourId}
              onClick={item.onClick}
            >
              {item.onClick ? (
                <button className="flex h-full w-full items-center gap-2" type="button" aria-label={item.label}>
                  {item.isLoading ? <Loader2 className="animate-spin" /> : <item.icon />}
                  <span className="group-data-[collapsible=icon]:sr-only">{item.label}</span>
                  {item.badge ? (
                    <span className="ml-auto flex h-5 min-w-5 items-center justify-center rounded-full bg-destructive px-1.5 text-[10px] font-bold text-destructive-foreground group-data-[collapsible=icon]:hidden">
                      {typeof item.badge === 'number' && item.badge > 9 ? '9+' : item.badge}
                    </span>
                  ) : null}
                </button>
              ) : (
                <Link href={item.href} prefetch={item.prefetch === true} className="flex items-center gap-2 w-full h-full">
                  {item.isLoading ? <Loader2 className="animate-spin" /> : <item.icon />}
                  <span className="flex-1 group-data-[collapsible=icon]:sr-only">{item.label}</span>
                  {item.badge ? (
                    <span className="ml-auto flex h-5 min-w-5 items-center justify-center rounded-full bg-destructive px-1.5 text-[10px] font-bold text-destructive-foreground group-data-[collapsible=icon]:hidden">
                      {typeof item.badge === 'number' && item.badge > 9 ? '9+' : item.badge}
                    </span>
                  ) : null}
                </Link>
              )}
            </SidebarMenuButton>
          </SidebarMenuItem>
        );
      })}
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
          <span className="group-data-[collapsible=icon]:sr-only">User Guide</span>
        </SidebarMenuButton>
      </SidebarMenuItem>
      {footerItems.map((item) => (
        <SidebarMenuItem key={item.key}>
          {item.href ? (
            <SidebarMenuButton asChild>
              <Link href={item.href} prefetch={false}>
                <item.icon />
                <span className="group-data-[collapsible=icon]:sr-only">{item.label}</span>
              </Link>
            </SidebarMenuButton>
          ) : (
            <SidebarMenuButton onClick={item.onClick} aria-label={item.label}>
              <item.icon />
              <span className="group-data-[collapsible=icon]:sr-only">{item.label}</span>
            </SidebarMenuButton>
          )}
        </SidebarMenuItem>
      ))}

      <SidebarMenuItem className="group-data-[collapsible=icon]:hidden">
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

      <SidebarMenuItem className="group-data-[collapsible=icon]:hidden">
        <div className="rounded-md border border-sidebar-border/80 bg-sidebar-accent/20 px-3 py-2 text-[10px] leading-relaxed text-sidebar-foreground/70">
          <p className="font-semibold text-sidebar-foreground">Datacube AU</p>
          <p>Built by Zahed Investment Ltd</p>
          <p>RC 8127949</p>
        </div>
      </SidebarMenuItem>

      {!isOnline && (
        <SidebarMenuItem>
          <SidebarMenuButton className="pointer-events-none text-yellow-500 bg-yellow-500/10" tooltip={{ children: 'You are currently offline.' }}>
            <WifiOff className="text-yellow-500" />
            <span className="group-data-[collapsible=icon]:sr-only">Offline</span>
          </SidebarMenuButton>
        </SidebarMenuItem>
      )}

      {/* User Avatar */}
      <SidebarMenuItem>
        <SidebarMenuButton asChild size="lg" className="h-auto py-2">
          <Link href="/dashboard/settings" prefetch={false}>
            <Avatar className="size-8">
              <AvatarImage src={''} alt="User Avatar" />
              <AvatarFallback>{userInitial}</AvatarFallback>
            </Avatar>
            <div className="flex min-w-0 flex-col group-data-[collapsible=icon]:sr-only">
              <span className="font-semibold">{userDisplayName}</span>
              <span className="text-xs text-sidebar-foreground/70">{userEmail}</span>
            </div>
          </Link>
        </SidebarMenuButton>
      </SidebarMenuItem>
    </SidebarMenu>
  </SidebarFooter>
);

export default function DashboardClientLayout({ children }: { children: React.ReactNode }) {
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [sidebarPreferenceReady, setSidebarPreferenceReady] = useState(false);

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(DASHBOARD_SIDEBAR_STORAGE_KEY);
      if (stored === 'false') setSidebarOpen(false);
      if (stored === 'true') setSidebarOpen(true);
    } catch {
      // Local preference is optional.
    } finally {
      setSidebarPreferenceReady(true);
    }
  }, []);

  const handleSidebarOpenChange = useCallback((open: boolean) => {
    setSidebarOpen(open);
    if (!sidebarPreferenceReady) return;
    try {
      window.localStorage.setItem(DASHBOARD_SIDEBAR_STORAGE_KEY, String(open));
    } catch {
      // Ignore localStorage failures; the sidebar still works for this session.
    }
  }, [sidebarPreferenceReady]);

  return (
    <AuChatProvider>
      <ChatRuntimeProvider>
        <SidebarProvider open={sidebarOpen} onOpenChange={handleSidebarOpenChange}>
          <DashboardContent>{children}</DashboardContent>
        </SidebarProvider>
      </ChatRuntimeProvider>
    </AuChatProvider>
  );
}

function DashboardSidebarToggle() {
  const { state, toggleSidebar, isMobile } = useSidebar();
  if (isMobile) return null;

  const expanded = state === 'expanded';
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      className="h-9 w-9 shrink-0 rounded-md"
      aria-label={expanded ? 'Collapse dashboard sidebar' : 'Expand dashboard sidebar'}
      aria-expanded={expanded}
      title={expanded ? 'Collapse sidebar' : 'Expand sidebar'}
      onClick={toggleSidebar}
    >
      {expanded ? <PanelLeftClose className="h-4 w-4" /> : <PanelLeftOpen className="h-4 w-4" />}
    </Button>
  );
}

function DashboardContent({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();

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
  const hasResolvedPlanState = useMemo(
    () => Boolean(entitlements.asOf || isUsingCachedEntitlements || !isPlanStatusLoading),
    [entitlements.asOf, isPlanStatusLoading, isUsingCachedEntitlements],
  );

  const planStatusLabel = useMemo(() => {
    if (!hasResolvedPlanState) return 'Syncing...';
    if (entitlements.plan === 'admin') return 'Admin';
    if (entitlements.plan === 'premium') return 'Premium';
    if (entitlements.entitlementSource === 'promo' || entitlements.promoActive) return 'Promo Pro';
    if (entitlements.entitlementSource === 'paid' && entitlements.hasPro) return 'Pro';
    return 'Free';
  }, [entitlements.entitlementSource, entitlements.hasPro, entitlements.plan, entitlements.promoActive, hasResolvedPlanState]);

  const planStatusBadge = useMemo(() => {
    if (!hasResolvedPlanState) return 'Syncing';
    if (entitlements.plan === 'admin') return 'Admin';
    if (entitlements.plan === 'premium') return 'Premium';
    if (entitlements.entitlementSource === 'promo' || entitlements.promoActive) return 'Promo';
    if (entitlements.entitlementSource === 'paid' && entitlements.hasPro) return 'Active';
    return 'Free';
  }, [entitlements.entitlementSource, entitlements.hasPro, entitlements.plan, entitlements.promoActive, hasResolvedPlanState]);

  const isProUnlocked = useMemo(() => {
    if (!hasResolvedPlanState) return false;
    return (
      entitlements.plan === 'admin' ||
      entitlements.plan === 'premium' ||
      entitlements.plan === 'pro' ||
      entitlements.plan === 'promo_pro' ||
      entitlements.entitlementSource === 'paid' ||
      entitlements.entitlementSource === 'promo' ||
      entitlements.promoActive
    );
  }, [entitlements.entitlementSource, entitlements.plan, entitlements.promoActive, hasResolvedPlanState]);

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
    if (!hasResolvedPlanState) {
      return 'Restoring your last validated subscription state...';
    }
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
    hasResolvedPlanState,
    isOnline,
    isUsingCachedEntitlements,
  ]);

  const handleWhatsAppRedirect = () => {
    const phoneNumber = '2349036553377';
    const message = "Hello Datacube AU Support! I just entered Datacube AU and have a question.";
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

  const navItems = useMemo(() => {
    /**
     * Helper to build a locked nav item when the user lacks access.
     * The item is always rendered — clicking opens the upgrade modal.
     * Server-side middleware prevents direct URL access regardless.
     */
    const lockedItem = (
      href: string,
      icon: React.ComponentType<any>,
      label: string,
      featureKey: string,
      extras?: Partial<NavItem>,
    ): NavItem => ({
      href,
      icon,
      label,
      featureKey,
      isLocked: true,
      tooltip: LOCKED_ITEM_TOOLTIPS[featureKey],
      prefetch: false,
      ...extras,
    });

    const items: NavItem[] = [
      { href: '/dashboard', icon: LayoutDashboard, label: 'Dashboard' },
      { href: '/dashboard/documents', icon: FileTextIcon, label: 'Documents', tourId: 'upload-section' },
      { href: '/dashboard/chat', icon: MessageCircle, label: 'AU Chat', tourId: 'chat-section' },

      // Global Chat — always visible; locked for free users
      globalChatAccess.enabled
        ? (globalChatAccess.allowed
          ? { href: '/dashboard/global-chat', icon: Globe, label: 'Global Chat', prefetch: false }
          : lockedItem('/dashboard/global-chat', Globe, 'Global Chat', 'global_chat'))
        : null,

      // Knowledge Hub — always visible; locked for free users
      knowledgeAccess.enabled
        ? (knowledgeAccess.allowed
          ? { href: '/dashboard/knowledge', icon: BrainCircuit, label: 'Knowledge', isLoading: isGeneratingKnowledge, prefetch: false }
          : lockedItem('/dashboard/knowledge', BrainCircuit, 'Knowledge', 'knowledge_hub', { isLoading: isGeneratingKnowledge }))
        : null,

      { href: '/dashboard/messages', icon: Inbox, label: 'Messages', badge: unreadCount > 0 ? unreadCount : undefined },

      // Exam Predictions — always visible; locked for free users
      predictionsAccess.enabled
        ? (predictionsAccess.allowed
          ? { href: '/dashboard/predictions', icon: ClipboardCheck, label: 'Predictions', isLoading: isGeneratingPredictions, tourId: 'predictions-section', prefetch: false }
          : lockedItem('/dashboard/predictions', ClipboardCheck, 'Predictions', 'exam_prediction', { isLoading: isGeneratingPredictions, tourId: 'predictions-section' }))
        : null,

      // Practice Exams — always visible; locked for free users
      practiceAccess.enabled
        ? (practiceAccess.allowed
          ? { href: '/dashboard/practice', icon: SquarePen, label: 'Practice', tourId: 'practice-section', prefetch: false }
          : lockedItem('/dashboard/practice', SquarePen, 'Practice', 'practice_exam_generation', { tourId: 'practice-section' }))
        : null,

      { href: '/dashboard/settings', icon: Settings, label: 'Settings' },
      { href: '/dashboard/settings/subscription', icon: CreditCard, label: 'Subscription', prefetch: false },
    ].filter(Boolean) as NavItem[];

    return items;
  }, [
    globalChatAccess,
    isGeneratingKnowledge,
    isGeneratingPredictions,
    knowledgeAccess,
    practiceAccess,
    predictionsAccess,
    unreadCount,
  ]);

  /**
   * Fired when a free user clicks a locked nav item.
   * Opens the upgrade modal with per-feature copy and fires analytics.
   * Navigation is NOT performed — server middleware still blocks direct URL access.
   */
  const handleLockedNavClick = useCallback((item: NavItem) => {
    const featureKey = (item.featureKey || 'unknown') as any;
    // Map back to access object to build the correct upgrade context
    const accessMap: Record<string, typeof globalChatAccess> = {
      global_chat: globalChatAccess,
      knowledge_hub: knowledgeAccess,
      exam_prediction: predictionsAccess,
      practice_exam_generation: practiceAccess,
    };
    const access = accessMap[featureKey];
    const upgradeCtx = access
      ? buildUpgradeContext(access)
      : { code: 'PRO_REQUIRED', reason: `${item.label} requires Pro.`, message: `${item.label} requires Pro.`, key: featureKey, limit: featureKey, used: 0, cta: 'Upgrade to Pro', upgradeUrl: '/pricing' };

    trackLockedClick(featureKey, planStatusLabel, 'sidebar_nav');
    setUpgradeModalOpen(true, upgradeCtx);
  }, [globalChatAccess, knowledgeAccess, predictionsAccess, practiceAccess, planStatusLabel, setUpgradeModalOpen]);

  const footerItems = useMemo(() => {
    const items = [
      {
        key: 'whatsapp',
        icon: Icons.whatsapp,
        label: 'Contact Support',
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
      const activityInterval = setInterval(() => updateUserActivity(user, { isOnline }), 5 * 60 * 1000);
      return () => clearInterval(activityInterval);
    }
  }, [isAuthLocked, user, isUserLoading, toast, isOnline]);

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
            <AlertDialogTitle>Contact Datacube AU Support?</AlertDialogTitle>
            <AlertDialogDescription>
              Send your message on WhatsApp and our support team will get back to you. Clicking "Continue" opens WhatsApp.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleWhatsAppRedirect}>Continue</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

        <div className="flex min-h-dvh w-full bg-transparent">
          <Sidebar collapsible="icon" side="left" variant="sidebar" className="group-data-[variant=sidebar]:border-r">
            <SidebarHeader className="border-b p-1.5 group-data-[collapsible=icon]:px-1.5">
              <div className="flex min-h-11 w-full items-center gap-2 group-data-[collapsible=icon]:min-h-[5rem] group-data-[collapsible=icon]:flex-col group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:gap-2">
                <Link
                  href="/"
                  className="flex h-10 min-w-0 flex-1 items-center gap-2 rounded-md px-1.5 group-data-[collapsible=icon]:h-9 group-data-[collapsible=icon]:w-9 group-data-[collapsible=icon]:flex-none group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-0"
                  aria-label="DataCube AU home"
                >
                  <Icons.logo className="size-7 shrink-0 text-primary" />
                  <span className="truncate font-headline text-lg font-semibold group-data-[collapsible=icon]:hidden">
                    DataCube AU
                  </span>
                </Link>
                <DashboardSidebarToggle />
              </div>
            </SidebarHeader>

            <SidebarNavMenu navItems={navItems} pathname={pathname} isProUnlocked={isProUnlocked} onLockedClick={handleLockedNavClick} />
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
