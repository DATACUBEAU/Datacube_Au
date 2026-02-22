'use client';

import { motion, AnimatePresence } from 'framer-motion';
import { useStore } from '@/hooks/use-store';
import { useEffect, useState } from 'react';

export function FocusBackground() {
  const auAnimationState = useStore(state => state.auAnimationState);
  // We use local state to smooth transitions if needed, but framer-motion handles it well.
  
  // Variants for different states
  const variants = {
    idle: {
      background: 'linear-gradient(135deg, rgba(var(--background), 1) 0%, rgba(var(--background), 1) 100%)',
    },
    thinking: {
      background: 'linear-gradient(135deg, rgba(56, 189, 248, 0.04) 0%, rgba(14, 165, 233, 0.03) 100%)',
    },
    responding: {
      background: 'linear-gradient(135deg, rgba(16, 185, 129, 0.04) 0%, rgba(56, 189, 248, 0.03) 100%)',
    },
    error: {
      background: 'linear-gradient(135deg, rgba(239, 68, 68, 0.05) 0%, rgba(239, 68, 68, 0.02) 100%)',
    }
  };

  return (
    <div className="fixed inset-0 z-0 pointer-events-none overflow-hidden" aria-hidden="true">
      <motion.div
        className="absolute inset-0"
        initial="idle"
        animate={auAnimationState}
        variants={variants}
        transition={{ duration: 1.5, ease: "easeInOut" }}
      />

      <motion.div
        className="absolute -left-24 top-10 h-72 w-72 rounded-full bg-sky-300/10 blur-3xl"
        animate={{ x: [0, 40, -10, 0], y: [0, -25, 15, 0], opacity: [0.18, 0.28, 0.2, 0.18] }}
        transition={{ duration: 24, repeat: Infinity, ease: 'easeInOut' }}
      />
      <motion.div
        className="absolute -right-16 bottom-0 h-80 w-80 rounded-full bg-emerald-300/10 blur-3xl"
        animate={{ x: [0, -35, 15, 0], y: [0, 20, -20, 0], opacity: [0.14, 0.24, 0.16, 0.14] }}
        transition={{ duration: 28, repeat: Infinity, ease: 'easeInOut' }}
      />
      
      {/* Pulse Effect for Thinking */}
      <AnimatePresence>
        {auAnimationState === 'thinking' && (
          <motion.div
            key="thinking-pulse"
            className="absolute inset-0 bg-primary/5"
            initial={{ opacity: 0 }}
            animate={{ opacity: [0.12, 0.22, 0.12] }}
            exit={{ opacity: 0 }}
            transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}
          />
        )}
      </AnimatePresence>
      
      {/* Glow Effect for Responding */}
      <AnimatePresence>
        {auAnimationState === 'responding' && (
          <motion.div
            key="responding-glow"
            className="absolute bottom-0 left-0 right-0 h-1/3 bg-gradient-to-t from-primary/10 to-transparent"
            initial={{ opacity: 0, y: 100 }}
            animate={{ opacity: 0.8, y: 0 }}
            exit={{ opacity: 0, y: 100 }}
            transition={{ duration: 1 }}
          />
        )}
      </AnimatePresence>
      
      {/* Subtle Orb for Idle Presence */}
      {auAnimationState === 'idle' && (
         <motion.div 
            className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[60vw] h-[60vw] rounded-full bg-primary/5 blur-3xl opacity-20"
            animate={{ scale: [0.9, 1.1, 0.9], opacity: [0.1, 0.2, 0.1] }}
            transition={{ duration: 10, repeat: Infinity, ease: "easeInOut" }}
         />
      )}
    </div>
  );
}
