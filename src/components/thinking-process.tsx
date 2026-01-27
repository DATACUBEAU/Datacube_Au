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

  // Helper to clean thought text (remove [Tags], **bold**, etc.)
  const cleanThought = (text: string) => {
    if (!text) return '';
    return text
      .replace(/\[.*?\]/g, '') // Remove [Exploratory] tags
      .replace(/\*\*/g, '')    // Remove bold markdown
      .trim();
  };

  if (isThinking) {
    return (
      <div className="flex items-center gap-3 text-sm text-muted-foreground mb-4 pl-2 animate-in fade-in slide-in-from-left-2 duration-300">
        <Loader2 className="h-4 w-4 animate-spin text-primary/70" />
        <span className="font-medium bg-gradient-to-r from-primary/80 to-primary/50 bg-clip-text text-transparent animate-pulse">
          {auThinkingStatus || 'Thinking...'}
        </span>
      </div>
    );
  }

  if (!thought) return null;

  return (
    <div className="mb-4 group">
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="flex items-center gap-2 text-xs font-medium text-muted-foreground/70 hover:text-primary transition-colors mb-2 px-1 select-none"
      >
        <Sparkles className="h-3 w-3" />
        <span className="uppercase tracking-wider text-[10px]">Thought Process</span>
        {isExpanded ? (
          <ChevronUp className="h-3 w-3 opacity-50" />
        ) : (
          <ChevronDown className="h-3 w-3 opacity-50" />
        )}
      </button>

      <AnimatePresence>
        {isExpanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: 'easeOut' }}
            className="overflow-hidden"
          >
            <div className="pl-4 border-l-2 border-primary/20 py-1 ml-1.5">
              <p className="text-sm text-muted-foreground/90 leading-relaxed whitespace-pre-wrap">
                {cleanThought(thought)}
              </p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
