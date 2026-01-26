'use client';

import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Brain, ChevronDown, ChevronUp, Sparkles, Loader2 } from 'lucide-react';
import { useState, useEffect } from 'react';
import { cn } from '@/lib/utils';
import { useStore } from '@/hooks/use-store';

interface ThinkingProcessProps {
  isThinking?: boolean;
  thought?: string;
}

export function ThinkingProcess({ isThinking = false, thought }: ThinkingProcessProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const auThinkingStatus = useStore(state => state.auThinkingStatus);

  if (isThinking) {
    return (
      <div className="flex items-center gap-4 text-sm text-muted-foreground mb-6 bg-secondary/20 p-5 rounded-2xl border border-primary/10 w-full max-w-lg shadow-[0_4px_20px_-5px_rgba(0,0,0,0.05)] backdrop-blur-sm">
        <div className="relative flex-shrink-0">
          <div className="absolute inset-0 bg-primary/20 rounded-full blur-md animate-pulse" />
          <Brain className="h-6 w-6 text-primary relative z-10 animate-pulse" />
          <Loader2 className="h-6 w-6 text-primary/40 animate-spin absolute top-0 left-0 z-10" />
        </div>
        <div className="flex flex-col gap-1 min-w-0">
          <span className="font-semibold text-foreground truncate animate-in fade-in slide-in-from-left-2 duration-500">
            {auThinkingStatus || 'Analyzing...'}
          </span>
          <div className="flex items-center gap-2">
            <span className="text-[10px] uppercase tracking-[0.15em] text-primary/70 font-black">Analytical Engine Active</span>
            <div className="flex gap-1">
              <span className="h-1 w-1 bg-primary/40 rounded-full animate-bounce [animation-delay:-0.3s]" />
              <span className="h-1 w-1 bg-primary/40 rounded-full animate-bounce [animation-delay:-0.15s]" />
              <span className="h-1 w-1 bg-primary/40 rounded-full animate-bounce" />
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!thought) return null;

  return (
    <div className="mb-4 group">
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="flex items-center gap-2 text-xs font-medium text-muted-foreground hover:text-primary transition-colors mb-1 px-1"
      >
        <Sparkles className="h-3 w-3" />
        <span>THOUGHT PROCESS</span>
        {isExpanded ? (
          <ChevronUp className="h-3 w-3" />
        ) : (
          <ChevronDown className="h-3 w-3" />
        )}
      </button>

      <AnimatePresence>
        {isExpanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.3, ease: 'easeInOut' }}
            className="overflow-hidden"
          >
            <div className="bg-muted/50 rounded-lg p-4 text-sm text-muted-foreground border border-border/50 leading-relaxed italic shadow-inner">
              {thought}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
