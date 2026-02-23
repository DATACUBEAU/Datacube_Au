'use client';

import { motion } from 'framer-motion';

type SystemBackgroundProps = {
  disableMotion?: boolean;
};

export function SystemBackground({ disableMotion = false }: SystemBackgroundProps) {
  return (
    <div className="fixed inset-0 z-0 pointer-events-none overflow-hidden bg-background" aria-hidden="true">
      {disableMotion ? (
        <>
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_20%,rgba(59,130,246,0.14),transparent_38%),linear-gradient(150deg,rgba(15,23,42,0.88),rgba(17,24,39,0.92))]" />
          <div className="absolute inset-0 border-t border-border/20" />
        </>
      ) : (
        <>
          <motion.div
            className="absolute inset-0 bg-[radial-gradient(circle_at_15%_15%,rgba(99,102,241,0.22),transparent_36%),radial-gradient(circle_at_85%_82%,rgba(56,189,248,0.18),transparent_40%),linear-gradient(155deg,rgba(15,23,42,0.84),rgba(17,24,39,0.92))]"
            animate={{ opacity: [0.86, 1, 0.86] }}
            transition={{ duration: 11, repeat: Infinity, ease: 'easeInOut' }}
          />
          <motion.div
            className="absolute -top-20 left-1/3 h-72 w-72 rounded-full bg-primary/28 blur-3xl mix-blend-screen"
            animate={{ x: [0, 16, -10, 0], y: [0, 14, -10, 0], opacity: [0.14, 0.26, 0.14] }}
            transition={{ duration: 14, repeat: Infinity, ease: 'easeInOut' }}
          />
          <motion.div
            className="absolute -bottom-20 right-1/4 h-72 w-72 rounded-full bg-cyan-400/24 blur-3xl mix-blend-screen"
            animate={{ x: [0, -18, 10, 0], y: [0, -14, 10, 0], opacity: [0.1, 0.22, 0.1] }}
            transition={{ duration: 16, repeat: Infinity, ease: 'easeInOut', delay: 1 }}
          />
          <motion.div
            className="absolute inset-0 border-t border-border/25"
            animate={{ opacity: [0.2, 0.4, 0.2] }}
            transition={{ duration: 8, repeat: Infinity, ease: 'easeInOut' }}
          />
        </>
      )}
    </div>
  );
}
