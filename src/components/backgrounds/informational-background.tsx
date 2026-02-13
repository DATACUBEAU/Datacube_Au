'use client';

import { motion } from 'framer-motion';

export function InformationalBackground() {
  return (
    <div className="fixed inset-0 -z-50 pointer-events-none bg-background">
      <motion.div 
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 1.5 }}
        className="absolute inset-0 bg-gradient-to-tr from-primary/5 via-transparent to-blue-500/5"
      />
      <div className="absolute inset-0 bg-[url('/grid-pattern.svg')] opacity-[0.02]" />
    </div>
  );
}
