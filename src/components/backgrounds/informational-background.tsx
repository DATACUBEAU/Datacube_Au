'use client';

import { motion } from 'framer-motion';

export function InformationalBackground() {
  return (
    <div className="fixed inset-0 z-0 pointer-events-none overflow-hidden bg-background" aria-hidden="true">
      <motion.div 
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 1.5 }}
        className="absolute inset-0 bg-gradient-to-tr from-primary/5 via-transparent to-blue-500/5"
      />
      <motion.div
        className="absolute -top-24 right-[-6rem] h-80 w-80 rounded-full bg-primary/15 blur-3xl"
        animate={{ x: [0, -28, 10, 0], y: [0, 22, -12, 0], opacity: [0.16, 0.28, 0.16] }}
        transition={{ duration: 24, repeat: Infinity, ease: 'easeInOut' }}
      />
      <motion.div
        className="absolute -bottom-20 left-[-4rem] h-72 w-72 rounded-full bg-blue-500/15 blur-3xl"
        animate={{ x: [0, 20, -8, 0], y: [0, -18, 14, 0], opacity: [0.12, 0.24, 0.12] }}
        transition={{ duration: 20, repeat: Infinity, ease: 'easeInOut' }}
      />
      <div className="absolute inset-0 bg-[url('/grid-pattern.svg')] opacity-[0.02]" />
    </div>
  );
}
