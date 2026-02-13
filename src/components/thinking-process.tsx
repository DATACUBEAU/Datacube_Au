'use client';

import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Brain, ChevronDown, ChevronUp, Sparkles, Loader2, CheckCircle2, Circle, Check } from 'lucide-react';
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
  const auThinkingSteps = useStore(state => state.auThinkingSteps);

  // Helper to clean thought text (remove [Tags], **bold**, etc.)
  const cleanThought = (text: string) => {
    if (!text) return '';
    return text
      .replace(/\[.*?\]/g, '') // Remove [Exploratory] tags
      .replace(/\*\*/g, '')    // Remove bold markdown
      .trim();
  };

  // 1. ACTIVE THINKING STATE (Tree View)
  if (isThinking) {
    return (
      <div className="mb-6 pl-2 animate-in fade-in slide-in-from-left-2 duration-300">
        {/* Header */}
        <div className="flex items-center gap-3 text-sm text-muted-foreground mb-3">
          <Brain className="h-4 w-4 animate-pulse text-primary" />
          <span className="font-medium bg-gradient-to-r from-primary/80 to-primary/50 bg-clip-text text-transparent animate-pulse">
            {auThinkingStatus || 'AU is thinking...'}
          </span>
        </div>

        {/* Tree Structure */}
        <div className="relative pl-2 ml-2 border-l-2 border-primary/10 space-y-3">
            {auThinkingSteps.map((step, idx) => (
                <motion.div 
                    key={idx}
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: idx * 0.1 }}
                    className={cn(
                        "flex items-center gap-3 text-xs transition-colors",
                        step.status === 'active' ? "text-primary font-medium" : 
                        step.status === 'completed' ? "text-muted-foreground/80" : "text-muted-foreground/40"
                    )}
                >
                    <div className="relative z-10 bg-background">
                        {step.status === 'completed' ? (
                            <CheckCircle2 className="h-3.5 w-3.5 text-green-500" />
                        ) : step.status === 'active' ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
                        ) : (
                            <Circle className="h-3 w-3" />
                        )}
                    </div>
                    <span className={cn(
                        step.status === 'active' && "animate-pulse"
                    )}>
                        {step.label}
                    </span>
                </motion.div>
            ))}
        </div>
      </div>
    );
  }

  // 2. COMPLETED THOUGHT (Expandable)
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
            <div className="pl-4 border-l-2 border-primary/20 py-2 ml-1.5 bg-muted/30 rounded-r-md">
               {/* Render the thought as a clean list if possible, otherwise text */}
              <p className="text-sm text-muted-foreground/90 leading-relaxed whitespace-pre-wrap font-mono text-xs">
                {cleanThought(thought)}
              </p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
