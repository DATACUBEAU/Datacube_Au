'use client';

import { motion } from 'framer-motion';

export function ProductivityBackground() {
  return (
    <div className="fixed inset-0 z-0 pointer-events-none overflow-hidden bg-background" aria-hidden="true">
      <div 
        className="absolute inset-0 opacity-[0.02]" 
        style={{ 
          backgroundImage: 'radial-gradient(currentColor 1px, transparent 1px)', 
          backgroundSize: '20px 20px' 
        }} 
      />
      <motion.div
        className="absolute -left-24 top-16 h-72 w-72 rounded-full bg-primary/10 blur-3xl"
        animate={{ x: [0, 28, -12, 0], y: [0, -20, 10, 0], opacity: [0.1, 0.2, 0.1] }}
        transition={{ duration: 22, repeat: Infinity, ease: 'easeInOut' }}
      />
      <motion.div
        className="absolute -right-20 bottom-8 h-80 w-80 rounded-full bg-accent/10 blur-3xl"
        animate={{ x: [0, -24, 14, 0], y: [0, 16, -10, 0], opacity: [0.08, 0.18, 0.08] }}
        transition={{ duration: 26, repeat: Infinity, ease: 'easeInOut', delay: 2 }}
      />
      <div className="absolute top-0 left-0 right-0 h-32 bg-gradient-to-b from-background to-transparent" />
    </div>
  );
}
