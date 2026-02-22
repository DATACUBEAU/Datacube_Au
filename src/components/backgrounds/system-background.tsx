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
          <div className="absolute inset-0 bg-neutral-50/50 dark:bg-neutral-950/50" />
          <div className="absolute inset-0 border-t border-border/20" />
        </>
      ) : (
        <>
          <motion.div
            className="absolute inset-0 bg-neutral-50/45 dark:bg-neutral-950/45"
            animate={{ opacity: [0.45, 0.62, 0.45] }}
            transition={{ duration: 10, repeat: Infinity, ease: 'easeInOut' }}
          />
          <motion.div
            className="absolute -top-20 left-1/3 h-72 w-72 rounded-full bg-primary/10 blur-3xl"
            animate={{ x: [0, 16, -10, 0], y: [0, 14, -10, 0], opacity: [0.08, 0.16, 0.08] }}
            transition={{ duration: 18, repeat: Infinity, ease: 'easeInOut' }}
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
