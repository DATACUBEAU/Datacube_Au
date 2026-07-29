'use client';

import React, { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Bot, X, Lightbulb, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { usePathname } from 'next/navigation';
import { useSupabaseUser } from '@/hooks/use-supabase-auth';
import { useSmartAuth } from '@/hooks/use-smart-auth';

interface Step {
  target?: string;
  title: string;
  content: string;
  actions: string[];
}

const TOUR_STEPS: Record<string, Step> = {
  '/dashboard': {
    title: 'Your Dashboard',
    content: 'This is your study home. It brings together your documents, chats, generated study tools, plan status, and account activity.',
    actions: ['Upload a document', 'Open AU Chat', 'Check your plan status'],
  },
  '/dashboard/documents': {
    title: 'Documents',
    content: 'Upload files here so AU can read them and use them for summaries, questions, practice exams, and predictions.',
    actions: ['Upload a PDF or document', 'Wait for processing to finish', 'Ask a document question'],
  },
  '/dashboard/chat': {
    title: 'AU Chat',
    content: 'Ask questions about your uploaded material. AU answers from the selected document and keeps citations attached when sources are available.',
    actions: ['Choose a processed document', 'Ask a specific question', 'Open cited sources'],
  },
  '/dashboard/global-chat': {
    title: 'Global Chat',
    content: 'Use this for general study help, planning, and app guidance. Keep document-specific questions in AU Chat for grounded answers.',
    actions: ['Ask for a study plan', 'Clarify a concept', 'Switch to AU Chat for document answers'],
  },
  '/dashboard/knowledge': {
    title: 'Knowledge Hub',
    content: 'Turn a processed document into compact study material such as summaries, key points, concept links, and roadmaps.',
    actions: ['Select a document', 'Generate the study pack', 'Review saved output before chat'],
  },
  '/dashboard/predictions': {
    title: 'Exam Predictions',
    content: 'Create a focused exam briefing from your materials. Use it after uploading the textbook or past questions you want AU to compare.',
    actions: ['Pick source documents', 'Generate predictions', 'Review before practice'],
  },
  '/dashboard/practice': {
    title: 'Practice Exams',
    content: 'Generate practice questions from your document, then attempt and retry them while keeping your results separate from the source material.',
    actions: ['Select a document', 'Generate questions', 'Submit and review answers'],
  },
  '/dashboard/messages': {
    title: 'Messages',
    content: 'Check account alerts, upload updates, and system messages tied to your activity.',
    actions: ['Review unread messages', 'Open important alerts', 'Return to your study flow'],
  },
  '/dashboard/settings': {
    title: 'Settings',
    content: 'Manage account preferences, assistant behavior, security settings, and study defaults from one place.',
    actions: ['Review your preferences', 'Adjust assistant settings', 'Check subscription options'],
  },
  '/dashboard/settings/subscription': {
    title: 'Subscription',
    content: 'Review your current plan, billing status, feature access, and usage limits.',
    actions: ['Confirm billing status', 'Compare plan limits', 'Update your plan if needed'],
  },
  '/conex': {
    title: 'Conex Console',
    content: 'This admin area is for operational oversight: users, plans, feature flags, provider configuration, activity, and system health.',
    actions: ['Review system health', 'Check provider configuration', 'Open user management'],
  },
  '/conex/users': {
    title: 'User Management',
    content: 'Review user access, plan assignment, and account status without exposing private credentials or session values.',
    actions: ['Search for a user', 'Review plan status', 'Apply only necessary changes'],
  },
  '/conex/plan-limits': {
    title: 'Plan Limits',
    content: 'Tune feature limits and plan behavior for the product. Changes here affect what users can do across AI and document workflows.',
    actions: ['Review the active plan', 'Compare limit values', 'Save only intentional updates'],
  },
  '/pricing': {
    title: 'Plans and Pricing',
    content: 'Compare the available plans and choose the level that matches your document volume, AI usage, and study needs.',
    actions: ['Compare feature access', 'Check limits', 'Choose a plan when ready'],
  },
  '/login': {
    title: 'Sign In',
    content: 'Sign in to reach your dashboard, documents, chats, and saved study outputs. If your session expired, signing in again refreshes access.',
    actions: ['Enter your account details', 'Complete sign in', 'Return to your dashboard'],
  },
  '/signup': {
    title: 'Create Account',
    content: 'Create your account with a unique username and a strong password. Email confirmation may be required, and Google users can finish username setup from profile settings.',
    actions: ['Choose a unique username', 'Use a strong password', 'Confirm your email if asked'],
  },
};

const DEFAULT_STEP: Step = {
  title: 'AU Onboarding Assistant',
  content: 'Follow along as you explore DataCube AU. I will explain the current page and suggest useful next steps.',
  actions: ['Explore the page', 'Open help when needed', 'Dismiss this card anytime'],
};

const LONG_PRESS_MS = 650;
const DRAG_THRESHOLD_PX = 6;
const EDGE_PADDING_PX = 16;
const DEFAULT_BOTTOM_OFFSET_PX = 24;
const ONBOARDING_VERSION = '2026-07-29-core-hardening';
const ONBOARDING_MAYBE_LATER_COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000;
export const START_PRODUCT_TOUR_EVENT = 'dcau:start-product-tour';

type OnboardingState = {
  version: string;
  offeredAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
  skippedAt: string | null;
  maybeLaterAt: string | null;
  currentStep: string | null;
  lastStep: string | null;
};

function pageStoragePath(pathname: string | null): string {
  return String(pathname || '/').replace(/[^a-z0-9/_-]/gi, '_');
}

function onboardingStorageKey(scope: string): string {
  return `au_onboarding_state_${scope}_${ONBOARDING_VERSION}`;
}

function defaultOnboardingState(): OnboardingState {
  return {
    version: ONBOARDING_VERSION,
    offeredAt: null,
    startedAt: null,
    completedAt: null,
    skippedAt: null,
    maybeLaterAt: null,
    currentStep: null,
    lastStep: null,
  };
}

function readOnboardingState(scope: string): OnboardingState | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(onboardingStorageKey(scope));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<OnboardingState>;
    if (parsed.version !== ONBOARDING_VERSION) return null;
    return {
      ...defaultOnboardingState(),
      ...parsed,
      version: ONBOARDING_VERSION,
    };
  } catch {
    return null;
  }
}

function writeOnboardingState(scope: string, state: OnboardingState): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(onboardingStorageKey(scope), JSON.stringify(state));
  } catch {
    // Ignore storage failures; the assistant can still run for the current page.
  }
}

function hasCompletedOrSkippedOnboarding(state: OnboardingState | null): boolean {
  return Boolean(state?.completedAt || state?.skippedAt);
}

function isMaybeLaterCoolingDown(state: OnboardingState | null, nowMs = Date.now()): boolean {
  const maybeLaterAt = state?.maybeLaterAt ? new Date(state.maybeLaterAt).getTime() : Number.NaN;
  return Number.isFinite(maybeLaterAt) && nowMs - maybeLaterAt < ONBOARDING_MAYBE_LATER_COOLDOWN_MS;
}

function shouldSuppressOnboardingForPath(pathname: string | null): boolean {
  const normalized = String(pathname || '').replace(/\/$/, '') || '/';
  return (
    normalized.startsWith('/login') ||
    normalized.startsWith('/signup') ||
    normalized.startsWith('/auth/callback') ||
    normalized.startsWith('/session-expired')
  );
}

function hasLegacyAssistantActivity(scope: string): boolean {
  if (typeof window === 'undefined') return false;
  try {
    if (localStorage.getItem(`au_assistant_progress_${scope}`)) return true;
    if (localStorage.getItem(`au_assistant_position_${scope}`)) return true;
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index);
      if (key?.startsWith(`au_assistant_dismissed_${scope}_`)) return true;
    }
  } catch {
    return false;
  }
  return false;
}

function resolveStep(pathname: string | null): Step | null {
  const normalized = String(pathname || '').replace(/\/$/, '') || '/';
  if (TOUR_STEPS[normalized]) return TOUR_STEPS[normalized];

  if (normalized.startsWith('/conex/users')) return TOUR_STEPS['/conex/users'];
  if (normalized.startsWith('/conex/plan-limits')) return TOUR_STEPS['/conex/plan-limits'];
  if (normalized.startsWith('/conex')) return TOUR_STEPS['/conex'];
  if (normalized.startsWith('/dashboard/settings/subscription')) return TOUR_STEPS['/dashboard/settings/subscription'];
  if (normalized.startsWith('/dashboard/settings')) return TOUR_STEPS['/dashboard/settings'];
  if (normalized.startsWith('/dashboard')) return TOUR_STEPS['/dashboard'];

  return null;
}

export function AUAssistant() {
  const [isVisible, setIsVisible] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);
  const [showTourOffer, setShowTourOffer] = useState(false);
  const [onboardingState, setOnboardingState] = useState<OnboardingState | null>(null);
  const [dismissedCurrentPage, setDismissedCurrentPage] = useState(false);
  const pathname = usePathname();
  const [user] = useSupabaseUser();
  const { authState, runtimeAuthState } = useSmartAuth();
  const [currentStep, setCurrentStep] = useState<Step | null>(null);
  const [offsetY, setOffsetY] = useState(0);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const longPressTimerRef = useRef<number | null>(null);
  const longPressTriggeredRef = useRef(false);
  const dragStateRef = useRef<{ startClientY: number; startOffsetY: number; dragging: boolean } | null>(null);

  const assistantScope = user?.id || 'guest';

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const settingsKey = `au_assistant_settings_${assistantScope}`;
    const savedSetting = localStorage.getItem(settingsKey);
    setIsVisible(savedSetting !== 'disabled');

    const positionKey = `au_assistant_position_${assistantScope}`;
    const savedOffset = localStorage.getItem(positionKey);
    if (savedOffset != null) {
      const parsed = Number(savedOffset);
      if (Number.isFinite(parsed)) setOffsetY(parsed);
    }

    const handleSettingsUpdate = (e: CustomEvent) => {
      setIsVisible(e.detail.enabled);
    };

    window.addEventListener('au_assistant_settings_updated', handleSettingsUpdate as EventListener);
    return () => {
      window.removeEventListener('au_assistant_settings_updated', handleSettingsUpdate as EventListener);
    };
  }, [assistantScope]);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const nextStep = resolveStep(pathname);
    setCurrentStep(nextStep);
    const savedOnboarding = readOnboardingState(assistantScope);
    setOnboardingState(savedOnboarding);

    if (!nextStep) {
      setDismissedCurrentPage(false);
      setIsExpanded(false);
      setShowTourOffer(false);
      return;
    }

    const dismissedKey = `au_assistant_dismissed_${assistantScope}_${pageStoragePath(pathname)}`;
    const dismissed = localStorage.getItem(dismissedKey) === 'true';
    setDismissedCurrentPage(dismissed);
    const tourActive = Boolean(savedOnboarding?.startedAt && !hasCompletedOrSkippedOnboarding(savedOnboarding));
    if (isVisible) setIsExpanded(tourActive && !dismissed);
  }, [assistantScope, pathname, isVisible]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!isVisible || !currentStep || shouldSuppressOnboardingForPath(pathname)) {
      setShowTourOffer(false);
      return;
    }
    if (runtimeAuthState === 'RESTORING' || runtimeAuthState === 'EXPIRED' || runtimeAuthState === 'REAUTH_IN_PROGRESS') {
      setShowTourOffer(false);
      return;
    }
    if (authState === 'loading' && pathname?.startsWith('/dashboard')) {
      setShowTourOffer(false);
      return;
    }

    const saved = readOnboardingState(assistantScope);
    if (!saved && user?.id && hasLegacyAssistantActivity(assistantScope)) {
      const establishedState = {
        ...defaultOnboardingState(),
        offeredAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
        lastStep: pathname || null,
      };
      writeOnboardingState(assistantScope, establishedState);
      setOnboardingState(establishedState);
      setShowTourOffer(false);
      return;
    }

    if (hasCompletedOrSkippedOnboarding(saved) || isMaybeLaterCoolingDown(saved)) {
      setOnboardingState(saved);
      setShowTourOffer(false);
      return;
    }

    const next = {
      ...(saved || defaultOnboardingState()),
      offeredAt: saved?.offeredAt || new Date().toISOString(),
      currentStep: pathname || null,
    };
    writeOnboardingState(assistantScope, next);
    setOnboardingState(next);
    setShowTourOffer(true);
    setIsExpanded(false);
  }, [assistantScope, authState, currentStep, isVisible, pathname, runtimeAuthState, user?.id]);

  useEffect(() => {
    const handleStartProductTour = () => {
      const now = new Date().toISOString();
      const settingsKey = `au_assistant_settings_${assistantScope}`;
      const next = {
        ...(readOnboardingState(assistantScope) || defaultOnboardingState()),
        offeredAt: onboardingState?.offeredAt || now,
        startedAt: now,
        completedAt: null,
        skippedAt: null,
        maybeLaterAt: null,
        currentStep: pathname || null,
        lastStep: pathname || null,
      };
      localStorage.setItem(settingsKey, 'enabled');
      writeOnboardingState(assistantScope, next);
      setOnboardingState(next);
      setShowTourOffer(false);
      setIsVisible(true);
      setIsExpanded(true);
      window.dispatchEvent(new CustomEvent('au_assistant_settings_updated', { detail: { enabled: true } }));
    };

    window.addEventListener(START_PRODUCT_TOUR_EVENT, handleStartProductTour);
    return () => {
      window.removeEventListener(START_PRODUCT_TOUR_EVENT, handleStartProductTour);
    };
  }, [assistantScope, onboardingState?.offeredAt, pathname]);

  useEffect(() => {
    const handleResize = () => {
      if (!containerRef.current) return;
      const containerHeight = containerRef.current.getBoundingClientRect().height;
      const minOffsetY = EDGE_PADDING_PX + DEFAULT_BOTTOM_OFFSET_PX + containerHeight - window.innerHeight;
      const maxOffsetY = DEFAULT_BOTTOM_OFFSET_PX - EDGE_PADDING_PX;
      setOffsetY((prev) => Math.min(maxOffsetY, Math.max(minOffsetY, prev)));
    };

    handleResize();
    window.addEventListener('resize', handleResize);
    return () => {
      window.removeEventListener('resize', handleResize);
    };
  }, []);

  useEffect(() => {
    return () => {
      if (longPressTimerRef.current != null) window.clearTimeout(longPressTimerRef.current);
    };
  }, []);

  if (!isVisible || !currentStep || shouldSuppressOnboardingForPath(pathname)) return null;

  const hideAssistant = () => {
    const settingsKey = `au_assistant_settings_${assistantScope}`;
    localStorage.setItem(settingsKey, 'disabled');
    window.dispatchEvent(new CustomEvent('au_assistant_settings_updated', { detail: { enabled: false } }));
    setIsExpanded(false);
    setIsVisible(false);
  };

  const persistOffset = (nextOffset: number) => {
    const positionKey = `au_assistant_position_${assistantScope}`;
    localStorage.setItem(positionKey, String(nextOffset));
  };

  const persistOnboarding = (patch: Partial<OnboardingState>) => {
    const next = {
      ...(onboardingState || defaultOnboardingState()),
      ...patch,
      version: ONBOARDING_VERSION,
    };
    writeOnboardingState(assistantScope, next);
    setOnboardingState(next);
    return next;
  };

  const startTour = () => {
    const now = new Date().toISOString();
    const settingsKey = `au_assistant_settings_${assistantScope}`;
    localStorage.setItem(settingsKey, 'enabled');
    persistOnboarding({
      offeredAt: onboardingState?.offeredAt || now,
      startedAt: now,
      completedAt: null,
      skippedAt: null,
      maybeLaterAt: null,
      currentStep: pathname || null,
      lastStep: pathname || null,
    });
    setShowTourOffer(false);
    setIsVisible(true);
    setIsExpanded(true);
    window.dispatchEvent(new CustomEvent('au_assistant_settings_updated', { detail: { enabled: true } }));
  };

  const maybeLater = () => {
    persistOnboarding({
      offeredAt: onboardingState?.offeredAt || new Date().toISOString(),
      maybeLaterAt: new Date().toISOString(),
      currentStep: pathname || null,
    });
    setShowTourOffer(false);
    setIsExpanded(false);
  };

  const skipTour = () => {
    persistOnboarding({
      offeredAt: onboardingState?.offeredAt || new Date().toISOString(),
      skippedAt: new Date().toISOString(),
      currentStep: pathname || null,
      lastStep: pathname || null,
    });
    setShowTourOffer(false);
    setIsExpanded(false);
  };

  const completeTour = () => {
    persistOnboarding({
      completedAt: new Date().toISOString(),
      currentStep: pathname || null,
      lastStep: pathname || null,
    });
    setShowTourOffer(false);
    setIsExpanded(false);
  };

  const dismissCurrentPage = () => {
    const dismissedKey = `au_assistant_dismissed_${assistantScope}_${pageStoragePath(pathname)}`;
    localStorage.setItem(dismissedKey, 'true');
    setDismissedCurrentPage(true);
    if (onboardingState?.startedAt && !hasCompletedOrSkippedOnboarding(onboardingState)) {
      completeTour();
      return;
    }
    setIsExpanded(false);
  };

  const clampOffset = (nextOffset: number) => {
    const containerHeight = containerRef.current?.getBoundingClientRect().height ?? 0;
    const minOffsetY = EDGE_PADDING_PX + DEFAULT_BOTTOM_OFFSET_PX + containerHeight - window.innerHeight;
    const maxOffsetY = DEFAULT_BOTTOM_OFFSET_PX - EDGE_PADDING_PX;
    return Math.min(maxOffsetY, Math.max(minOffsetY, nextOffset));
  };

  const clearLongPressTimer = () => {
    if (longPressTimerRef.current != null) {
      window.clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (e.button !== 0) return;
    if (!buttonRef.current) return;
    buttonRef.current.setPointerCapture(e.pointerId);
    longPressTriggeredRef.current = false;

    dragStateRef.current = {
      startClientY: e.clientY,
      startOffsetY: offsetY,
      dragging: false,
    };

    clearLongPressTimer();
    longPressTimerRef.current = window.setTimeout(() => {
      const state = dragStateRef.current;
      if (!state || state.dragging) return;
      longPressTriggeredRef.current = true;
      hideAssistant();
    }, LONG_PRESS_MS);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLButtonElement>) => {
    const state = dragStateRef.current;
    if (!state) return;

    const deltaY = e.clientY - state.startClientY;
    if (!state.dragging && Math.abs(deltaY) >= DRAG_THRESHOLD_PX) {
      state.dragging = true;
      clearLongPressTimer();
      setIsExpanded(false);
    }
    if (!state.dragging) return;

    const nextOffset = clampOffset(state.startOffsetY + deltaY);
    setOffsetY(nextOffset);
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLButtonElement>) => {
    clearLongPressTimer();

    const state = dragStateRef.current;
    dragStateRef.current = null;

    if (!state) return;
    if (longPressTriggeredRef.current) return;
    if (state.dragging) {
      const deltaY = e.clientY - state.startClientY;
      const finalOffset = clampOffset(state.startOffsetY + deltaY);
      setOffsetY(finalOffset);
      persistOffset(finalOffset);
      return;
    }

    if (dismissedCurrentPage) {
      const dismissedKey = `au_assistant_dismissed_${assistantScope}_${pageStoragePath(pathname)}`;
      localStorage.removeItem(dismissedKey);
      setDismissedCurrentPage(false);
      setIsExpanded(true);
      return;
    }

    setIsExpanded((prev) => !prev);
  };

  const handlePointerCancel = () => {
    clearLongPressTimer();
    dragStateRef.current = null;
  };

  return (
    <AnimatePresence>
      <div
        ref={containerRef}
        className="pointer-events-none fixed inset-x-3 bottom-[calc(1rem+env(safe-area-inset-bottom))] z-50 flex flex-col items-end gap-2 sm:inset-x-auto sm:right-6 sm:bottom-6"
        style={{ transform: `translateY(${offsetY}px)` }}
      >
        {showTourOffer && (
          <motion.div
            initial={{ opacity: 0, y: 10, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 10, scale: 0.95 }}
            className="pointer-events-auto mb-2 w-full max-w-[calc(100vw-1.5rem)] rounded-lg border border-primary/20 bg-card p-4 shadow-xl sm:max-w-[340px]"
            role="dialog"
            aria-label="DataCube AU guided tour offer"
          >
            <div className="flex items-start gap-3">
              <div className="rounded-full bg-primary/10 p-2 text-primary">
                <Bot className="h-5 w-5" aria-hidden="true" />
              </div>
              <div className="min-w-0 flex-1 space-y-3">
                <div>
                  <h4 className="text-sm font-semibold text-primary">Would you like a quick guided tour of DataCube AU?</h4>
                  <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                    I can give you a short, page-aware tour and suggest a few useful next steps.
                  </p>
                </div>
                <div className="flex flex-col gap-2 sm:flex-row">
                  <Button size="sm" className="w-full sm:w-auto" onClick={startTour}>Start tour</Button>
                  <Button size="sm" variant="outline" className="w-full sm:w-auto" onClick={maybeLater}>Maybe later</Button>
                  <Button size="sm" variant="ghost" className="w-full sm:w-auto" onClick={skipTour}>Skip tour</Button>
                </div>
              </div>
            </div>
          </motion.div>
        )}

        {isExpanded && (
          <motion.div
            initial={{ opacity: 0, y: 10, scale: 0.9 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 10, scale: 0.9 }}
            className="pointer-events-auto relative mb-2 max-h-[min(70dvh,26rem)] w-full max-w-[calc(100vw-1.5rem)] overflow-y-auto rounded-lg border border-primary/20 bg-card p-4 shadow-xl sm:max-w-[340px]"
            role="status"
            aria-live="polite"
          >
            <Button
              variant="ghost"
              size="icon"
              className="absolute top-1 right-1 h-6 w-6 text-muted-foreground hover:text-foreground"
              onClick={dismissCurrentPage}
              aria-label={`Dismiss ${currentStep.title} guidance`}
            >
              <X className="h-3 w-3" />
            </Button>
            <div className="flex items-start gap-3">
              <div className="bg-primary/10 p-2 rounded-full shrink-0">
                <Lightbulb className="h-5 w-5 text-primary" />
              </div>
              <div className="min-w-0 pr-5">
                <h4 className="mb-1 text-sm font-semibold text-primary">{(currentStep ?? DEFAULT_STEP).title}</h4>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  {(currentStep ?? DEFAULT_STEP).content}
                </p>
                <ul className="mt-3 space-y-1.5 text-xs text-foreground/85" aria-label="Suggested next actions">
                  {(currentStep ?? DEFAULT_STEP).actions.slice(0, 3).map((action) => (
                    <li key={action} className="flex gap-2">
                      <span className="mt-[0.45rem] h-1.5 w-1.5 shrink-0 rounded-full bg-primary/70" aria-hidden="true" />
                      <span className="min-w-0 leading-relaxed">{action}</span>
                    </li>
                  ))}
                </ul>
                {onboardingState?.startedAt && !hasCompletedOrSkippedOnboarding(onboardingState) ? (
                  <div className="mt-3">
                    <Button size="sm" variant="outline" className="h-8" onClick={completeTour}>
                      Done
                    </Button>
                  </div>
                ) : null}
              </div>
            </div>
          </motion.div>
        )}

        <motion.button
          ref={buttonRef}
          initial={{ scale: 0 }}
          animate={{ scale: 1 }}
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerCancel}
          className="pointer-events-auto flex h-12 w-12 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg transition-colors hover:bg-primary/90"
          type="button"
          aria-label={isExpanded ? 'Collapse AU guidance' : dismissedCurrentPage ? 'Show AU guidance for this page' : 'Take a product tour'}
          aria-expanded={isExpanded}
        >
          {isExpanded ? <ChevronRight className="h-6 w-6" /> : <Bot className="h-6 w-6" />}
        </motion.button>
      </div>
    </AnimatePresence>
  );
}
