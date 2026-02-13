'use client';

export function ProductivityBackground() {
  return (
    <div className="fixed inset-0 -z-50 pointer-events-none bg-background">
      {/* Subtle dots for structure, no motion to prevent distraction */}
      <div 
        className="absolute inset-0 opacity-[0.02]" 
        style={{ 
          backgroundImage: 'radial-gradient(currentColor 1px, transparent 1px)', 
          backgroundSize: '20px 20px' 
        }} 
      />
      <div className="absolute top-0 left-0 right-0 h-32 bg-gradient-to-b from-background to-transparent" />
    </div>
  );
}
