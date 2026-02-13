'use client';

import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Sparkles, X, Heart, MessageCircle, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface UsageLimitNoticeProps {
  isResponding?: boolean;
  onContactSupport: () => void;
}

export function UsageLimitNotice({ isResponding, onContactSupport }: UsageLimitNoticeProps) {
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    // Only show once per session
    const hasSeenNotice = sessionStorage.getItem('au_usage_limit_notice_seen');
    if (!hasSeenNotice) {
      // Show after a small delay to not overwhelm on page load
      const timer = setTimeout(() => setIsVisible(true), 5000);
      return () => clearTimeout(timer);
    }
  }, []);

  const handleDismiss = () => {
    setIsVisible(false);
    sessionStorage.setItem('au_usage_limit_notice_seen', 'true');
  };

  return (
    <AnimatePresence>
      {isVisible && (
        <motion.div
          initial={{ opacity: 0, y: 50, scale: 0.9 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, scale: 0.9, transition: { duration: 0.2 } }}
          className="fixed bottom-24 right-4 z-50 max-w-[350px] w-full"
        >
          <div className="relative overflow-hidden rounded-2xl border border-primary/20 bg-background/95 p-5 shadow-2xl backdrop-blur-md">
            {/* Background Accent */}
            <div className="absolute -right-8 -top-8 h-24 w-24 rounded-full bg-primary/5 blur-2xl" />
            
            <button 
              onClick={handleDismiss}
              className="absolute right-3 top-3 rounded-full p-1 text-muted-foreground hover:bg-muted transition-colors"
            >
              <X className="h-4 w-4" />
            </button>

            <div className="flex flex-col gap-4">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/10">
                  <Sparkles className="h-5 w-5 text-primary" />
                </div>
                <div className="flex flex-col">
                  <h4 className="text-sm font-bold text-foreground uppercase tracking-tight">AU Usage Limit</h4>
                  {isResponding && (
                    <div className="flex items-center gap-1.5">
                      <Loader2 className="h-3 w-3 animate-spin text-primary" />
                      <span className="text-[10px] font-medium text-primary uppercase tracking-widest animate-pulse">Syncing...</span>
                    </div>
                  )}
                </div>
              </div>

              <p className="text-sm text-muted-foreground leading-relaxed">
                You may occasionally hit temporary AU response limits. If you enjoy using AU, supporting the creator helps ensure faster and more reliable responses in the future.
              </p>

              <div className="flex items-center gap-2 pt-1">
                <Button 
                  size="sm" 
                  onClick={() => {
                    handleDismiss();
                    onContactSupport();
                  }}
                  className="h-9 flex-1 gap-2 font-bold uppercase tracking-tighter shadow-lg shadow-primary/10"
                >
                  <Heart className="h-3.5 w-3.5 fill-current" />
                  Support Creator
                </Button>
                <Button 
                  variant="outline" 
                  size="sm" 
                  onClick={handleDismiss}
                  className="h-9 px-4 font-bold uppercase tracking-tighter"
                >
                  Dismiss
                </Button>
              </div>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
