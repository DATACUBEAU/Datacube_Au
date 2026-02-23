'use client';

import { motion, useScroll, useTransform } from 'framer-motion';

export function MarketingBackground() {
  const { scrollY } = useScroll();
  
  // Parallax effects
  const y1 = useTransform(scrollY, [0, 1000], [0, 200]);
  const y2 = useTransform(scrollY, [0, 1000], [0, -150]);
  const opacity = useTransform(scrollY, [0, 500], [0.8, 0.4]);

  return (
    <div className="fixed inset-0 z-0 overflow-hidden pointer-events-none" aria-hidden="true">
      {/* Base Gradient */}
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_15%_20%,rgba(56,189,248,0.22),transparent_35%),radial-gradient(circle_at_80%_75%,rgba(14,165,233,0.16),transparent_40%),linear-gradient(180deg,rgba(15,23,42,0.85),rgba(17,24,39,0.92))]" />
      
      {/* Animated Orbs */}
      <motion.div 
        className="absolute top-[-10%] left-[-10%] w-[50vw] h-[50vw] rounded-full bg-primary/30 blur-3xl mix-blend-screen"
        animate={{ 
          scale: [1, 1.1, 1],
          opacity: [0.28, 0.52, 0.28],
          x: [0, 20, 0]
        }}
        transition={{ duration: 15, repeat: Infinity, ease: "easeInOut" }}
        style={{ y: y1, opacity }}
      />
      
      <motion.div 
        className="absolute bottom-[-10%] right-[-10%] w-[40vw] h-[40vw] rounded-full bg-blue-500/26 blur-3xl mix-blend-screen"
        animate={{ 
          scale: [1, 1.2, 1],
          opacity: [0.22, 0.4, 0.22],
          x: [0, -30, 0]
        }}
        transition={{ duration: 20, repeat: Infinity, ease: "easeInOut", delay: 2 }}
        style={{ y: y2, opacity }}
      />
      
      {/* Subtle Mesh Grid */}
      <div 
        className="absolute inset-0 opacity-[0.03]" 
        style={{ 
          backgroundImage: 'radial-gradient(circle at 1px 1px, currentColor 1px, transparent 0)',
          backgroundSize: '40px 40px' 
        }} 
      />
    </div>
  );
}
