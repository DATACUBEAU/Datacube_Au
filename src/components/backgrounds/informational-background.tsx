'use client';

import { motion } from 'framer-motion';

export function InformationalBackground() {
  return (
    <div className="fixed inset-0 z-0 pointer-events-none overflow-hidden bg-background" aria-hidden="true">
      <motion.div 
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 1.5 }}
        className="absolute inset-0 bg-[radial-gradient(circle_at_15%_15%,rgba(59,130,246,0.22),transparent_35%),radial-gradient(circle_at_80%_80%,rgba(14,165,233,0.16),transparent_38%),linear-gradient(140deg,rgba(15,23,42,0.82),rgba(30,41,59,0.9))]"
      />
      <motion.div
        className="absolute -top-24 right-[-6rem] h-80 w-80 rounded-full bg-primary/30 blur-3xl mix-blend-screen"
        animate={{ x: [0, -28, 10, 0], y: [0, 22, -12, 0], opacity: [0.18, 0.34, 0.18] }}
        transition={{ duration: 24, repeat: Infinity, ease: 'easeInOut' }}
      />
      <motion.div
        className="absolute -bottom-20 left-[-4rem] h-72 w-72 rounded-full bg-blue-500/28 blur-3xl mix-blend-screen"
        animate={{ x: [0, 20, -8, 0], y: [0, -18, 14, 0], opacity: [0.14, 0.28, 0.14] }}
        transition={{ duration: 20, repeat: Infinity, ease: 'easeInOut' }}
      />
      <div className="absolute inset-0 bg-[url('/grid-pattern.svg')] opacity-[0.02]" />
    </div>
  );
}
