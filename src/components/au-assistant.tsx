'use client';

import React, { useState, useEffect } from 'react';
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

export function AUAssistant() {
  const [isVisible, setIsVisible] = useState(false);
  const [isExpanded, setIsExpanded] = useState(true);
  const pathname = usePathname();
  const [user] = useSupabaseUser();
  const [currentStep, setCurrentStep] = useState<Step | null>(null);

  useEffect(() => {
    if (!user) return;

    // Load initial state
    const settingsKey = `au_assistant_settings_${user.id}`;
    const savedSetting = localStorage.getItem(settingsKey);
    // Default to enabled if not set
    setIsVisible(savedSetting !== 'disabled');

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

  if (!isVisible || !currentStep) return null;

  return (
    <AnimatePresence>
      <div className="fixed bottom-6 right-6 z-50 flex flex-col items-end gap-2 pointer-events-none">
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
                <h4 className="font-semibold text-sm mb-1 text-primary">{currentStep.title}</h4>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  {currentStep.content}
                </p>
              </div>
            </div>
          </motion.div>
        )}

        {/* Avatar Trigger */}
        <motion.button
          initial={{ scale: 0 }}
          animate={{ scale: 1 }}
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
          onClick={() => setIsExpanded(!isExpanded)}
          className="pointer-events-auto h-12 w-12 rounded-full bg-primary text-primary-foreground shadow-lg flex items-center justify-center hover:bg-primary/90 transition-colors"
        >
          {isExpanded ? <ChevronRight className="h-6 w-6" /> : <Bot className="h-6 w-6" />}
        </motion.button>
      </div>
    </AnimatePresence>
  );
}
