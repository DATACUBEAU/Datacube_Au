'use client';

import React, { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Bot, X, Lightbulb, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { usePathname } from 'next/navigation';
import { useSupabaseUser } from '@/hooks/use-supabase-auth';

interface Step {
  target?: string;
  title: string;
  content: string;
}

const TOUR_STEPS: Record<string, Step> = {
  '/dashboard': {
    title: 'Welcome to Dashboard',
    content: 'This is your central hub. You can access all your study tools from here. Start by uploading a document!',
  },
  '/dashboard/documents': {
    title: 'Document Management',
    content: 'Upload your textbooks, notes, and slides here. AU will analyze them to create your knowledge base.',
  },
  '/dashboard/chat': {
    title: 'AU Chat',
    content: 'Ask questions about your documents. AU uses your uploaded content to give accurate, cited answers.',
  },
  '/dashboard/knowledge': {
    title: 'Knowledge Graph',
    content: 'Visualize how concepts connect. Great for understanding complex relationships in your subject.',
  },
  '/dashboard/predictions': {
    title: 'Exam Predictions',
    content: 'See what questions AU thinks are likely to appear on your exam based on your materials.',
  },
  '/dashboard/practice': {
    title: 'Practice Exams',
    content: 'Test yourself with generated questions. Get instant feedback and scoring.',
  },
};

const DEFAULT_STEP: Step = {
  title: 'AU Onboarding Assistant',
  content: 'Follow along as you explore. I’ll show tips for each page as you navigate the dashboard.',
};

const LONG_PRESS_MS = 650;
const DRAG_THRESHOLD_PX = 6;
const EDGE_PADDING_PX = 16;
const DEFAULT_BOTTOM_OFFSET_PX = 24;

export function AUAssistant() {
  const [isVisible, setIsVisible] = useState(false);
  const [isExpanded, setIsExpanded] = useState(true);
  const pathname = usePathname();
  const [user] = useSupabaseUser();
  const [currentStep, setCurrentStep] = useState<Step | null>(null);
  const [offsetY, setOffsetY] = useState(0);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const longPressTimerRef = useRef<number | null>(null);
  const longPressTriggeredRef = useRef(false);
  const dragStateRef = useRef<{ startClientY: number; startOffsetY: number; dragging: boolean } | null>(null);

  useEffect(() => {
    if (!user) return;

    // Load initial state
    const settingsKey = `au_assistant_settings_${user.id}`;
    const savedSetting = localStorage.getItem(settingsKey);
    // Default to enabled if not set
    setIsVisible(savedSetting !== 'disabled');

    const positionKey = `au_assistant_position_${user.id}`;
    const savedOffset = localStorage.getItem(positionKey);
    if (savedOffset != null) {
      const parsed = Number(savedOffset);
      if (Number.isFinite(parsed)) setOffsetY(parsed);
    }

    // Listen for setting changes
    const handleSettingsUpdate = (e: CustomEvent) => {
      setIsVisible(e.detail.enabled);
    };

    window.addEventListener('au_assistant_settings_updated', handleSettingsUpdate as EventListener);
    return () => {
      window.removeEventListener('au_assistant_settings_updated', handleSettingsUpdate as EventListener);
    };
  }, [user]);

  useEffect(() => {
    if (TOUR_STEPS[pathname]) {
      setCurrentStep(TOUR_STEPS[pathname]);
      // Auto-expand on new page if visible
      if (isVisible) setIsExpanded(true);
    } else {
      setCurrentStep(null);
    }
  }, [pathname, isVisible]);

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

  if (!isVisible) return null;

  const hideAssistant = () => {
    if (!user) return;
    const settingsKey = `au_assistant_settings_${user.id}`;
    localStorage.setItem(settingsKey, 'disabled');
    window.dispatchEvent(new CustomEvent('au_assistant_settings_updated', { detail: { enabled: false } }));
    setIsExpanded(false);
    setIsVisible(false);
  };

  const persistOffset = (nextOffset: number) => {
    if (!user) return;
    const positionKey = `au_assistant_position_${user.id}`;
    localStorage.setItem(positionKey, String(nextOffset));
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
        className="fixed bottom-6 right-6 z-50 flex flex-col items-end gap-2 pointer-events-none"
        style={{ transform: `translateY(${offsetY}px)` }}
      >
        {/* Chat Bubble */}
        {isExpanded && (
          <motion.div
            initial={{ opacity: 0, y: 10, scale: 0.9 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 10, scale: 0.9 }}
            className="pointer-events-auto bg-card border border-primary/20 shadow-xl rounded-2xl p-4 max-w-[300px] mb-2 relative"
          >
            <Button
              variant="ghost"
              size="icon"
              className="absolute top-1 right-1 h-6 w-6 text-muted-foreground hover:text-foreground"
              onClick={() => setIsExpanded(false)}
            >
              <X className="h-3 w-3" />
            </Button>
            <div className="flex items-start gap-3">
              <div className="bg-primary/10 p-2 rounded-full shrink-0">
                <Lightbulb className="h-5 w-5 text-primary" />
              </div>
              <div>
                <h4 className="font-semibold text-sm mb-1 text-primary">{(currentStep ?? DEFAULT_STEP).title}</h4>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  {(currentStep ?? DEFAULT_STEP).content}
                </p>
              </div>
            </div>
          </motion.div>
        )}

        {/* Avatar Trigger */}
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
          className="pointer-events-auto h-12 w-12 rounded-full bg-primary text-primary-foreground shadow-lg flex items-center justify-center hover:bg-primary/90 transition-colors"
        >
          {isExpanded ? <ChevronRight className="h-6 w-6" /> : <Bot className="h-6 w-6" />}
        </motion.button>
      </div>
    </AnimatePresence>
  );
}
