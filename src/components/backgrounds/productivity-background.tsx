'use client';

import { motion } from 'framer-motion';

export function ProductivityBackground() {
  return (
    <div className="fixed inset-0 z-0 pointer-events-none overflow-hidden bg-background" aria-hidden="true">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_20%,rgba(99,102,241,0.2),transparent_38%),radial-gradient(circle_at_78%_75%,rgba(14,165,233,0.16),transparent_40%),linear-gradient(160deg,rgba(15,23,42,0.84),rgba(17,24,39,0.9))]" />
      <div 
        className="absolute inset-0 opacity-[0.02]" 
        style={{ 
          backgroundImage: 'radial-gradient(currentColor 1px, transparent 1px)', 
          backgroundSize: '20px 20px' 
        }} 
      />
      <motion.div
        className="absolute -left-24 top-16 h-72 w-72 rounded-full bg-primary/30 blur-3xl mix-blend-screen"
        animate={{ x: [0, 28, -12, 0], y: [0, -20, 10, 0], opacity: [0.16, 0.3, 0.16] }}
        transition={{ duration: 22, repeat: Infinity, ease: 'easeInOut' }}
      />
      <motion.div
        className="absolute -right-20 bottom-8 h-80 w-80 rounded-full bg-accent/25 blur-3xl mix-blend-screen"
        animate={{ x: [0, -24, 14, 0], y: [0, 16, -10, 0], opacity: [0.14, 0.26, 0.14] }}
        transition={{ duration: 26, repeat: Infinity, ease: 'easeInOut', delay: 2 }}
      />
      <div className="absolute top-0 left-0 right-0 h-32 bg-gradient-to-b from-background to-transparent" />
    </div>
  );
}
